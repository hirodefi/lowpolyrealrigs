// Fidelity check: generate a character from a turnaround sheet (front | side | back
// in one image), render the result with an orthographic camera from the same three
// directions, and compare silhouette widths height by height with the reference.
//
//   node test/fidelity.js <sheet.png|jpg|webp> [--body female] [--hair long] ...
//
// Writes out/fidelity_overlay.png (reference = red, model = cyan, overlap = white),
// out/fidelity.glb and prints a per-height width table plus summary errors.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright'));
}

const [sheetPath, ...rest] = process.argv.slice(2);
if (!sheetPath) { console.error('usage: node test/fidelity.js <sheet image> [--body female] [--hair long] [--bottom skirt]'); process.exit(1); }
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(sheetPath).toLowerCase()] || 'image/png';
const dataUrl = `data:${mime};base64,${readFileSync(sheetPath).toString('base64')}`;

const PORT = 5197;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));
mkdirSync('out', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let code = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`http://localhost:${PORT}/`);
  const res = await page.evaluate(async ([url, opts]) => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { splitTurnaround, analyzeImage } = await import('/core/silhouette.js');
    const { generateCharacter } = await import('/core/pipeline.js');

    // Decode the sheet, split it and scale each view like the app does.
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = c.getContext('2d'); cx.drawImage(bmp, 0, 0);
    const sheet = cx.getImageData(0, 0, c.width, c.height);
    const views = splitTurnaround(sheet);
    const scaled = {};
    for (const [k, v] of Object.entries(views)) {
      const s = Math.min(1, 600 / Math.max(v.width, v.height));
      const a = new OffscreenCanvas(v.width, v.height); a.getContext('2d').putImageData(new ImageData(v.data, v.width, v.height), 0, 0);
      const b = new OffscreenCanvas(Math.round(v.width * s), Math.round(v.height * s));
      const bx = b.getContext('2d', { willReadFrequently: true }); bx.drawImage(a, 0, 0, b.width, b.height);
      scaled[k] = bx.getImageData(0, 0, b.width, b.height);
    }
    const gen = generateCharacter(scaled, { height: 1.7, ...opts });

    // Render orthographic silhouettes of the bind pose.
    const gltf = await new GLTFLoader().parseAsync(gen.glb.buffer.slice(gen.glb.byteOffset, gen.glb.byteOffset + gen.glb.byteLength), '');
    const scene = new THREE.Scene(); scene.add(gltf.scene);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
    const W = 300, Hh = 600;
    const renderer = new THREE.WebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, Hh); renderer.setClearColor(0, 0);
    const cam = new THREE.OrthographicCamera(-0.875 * W / Hh, 0.875 * W / Hh, 1.75, -0.0, 0.01, 10);
    cam.left = -0.875 * W / Hh; cam.right = 0.875 * W / Hh; cam.top = 1.75; cam.bottom = 0; cam.updateProjectionMatrix();
    const shot = (pos) => {
      // Ortho frustum is relative to the camera: put it at y = 0 so top/bottom = 1.75/0 frame the figure.
      cam.position.set(pos[0], 0, pos[2]); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
      const gl = renderer.getContext(); const px = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const img = { width: W, height: Hh, data: new Uint8ClampedArray(W * Hh * 4) };
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { // flip + alpha -> mask image
        const s = ((Hh - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
        const on = px[s + 3] > 128;
        img.data[d] = on ? 0 : 255; img.data[d + 1] = on ? 0 : 255; img.data[d + 2] = on ? 0 : 255; img.data[d + 3] = on ? 255 : 0;
      }
      return img;
    };
    // Model faces +Z. Front: camera on +Z. Side: match the reference's facing. Back: camera on -Z.
    const refSide = analyzeImage(scaled.side);
    const model = { front: shot([0, 0.85, 3]), back: shot([0, 0.85, -3]) };
    // Reference side faces left if the feet point left of the ankles.
    const S = refSide, foot = S.runNear(S.rowAt(0.99), (S.bbox.x0 + S.bbox.x1) / 2), ank = S.runNear(S.rowAt(0.93), (S.bbox.x0 + S.bbox.x1) / 2);
    const facesLeft = foot && ank && (foot[0] + foot[1]) < (ank[0] + ank[1]);
    model.side = shot(facesLeft ? [3, 0.85, 0] : [-3, 0.85, 0]);

    // Width profiles: total silhouette width per height, as a fraction of figure height.
    const profile = (sil) => {
      const out = [];
      for (let v = 0; v <= 1.0001; v += 0.02) {
        const row = sil.runs[sil.rowAt(v)];
        const total = row.reduce((a, r) => a + r[1] - r[0] + 1, 0);
        const span = row.length ? row[row.length - 1][1] - row[0][0] + 1 : 0;
        out.push({ v: Math.round(v * 100) / 100, total: total / sil.heightPx, span: span / sil.heightPx });
      }
      return out;
    };
    const result = {};
    const overlays = {};
    for (const k of ['front', 'side', 'back']) {
      const ref = analyzeImage(scaled[k]), mod = analyzeImage(model[k]);
      result[k] = { ref: profile(ref), mod: profile(mod), aspect: { ref: (ref.bbox.x1 - ref.bbox.x0 + 1) / ref.heightPx, mod: (mod.bbox.x1 - mod.bbox.x0 + 1) / mod.heightPx } };
      // Overlay both silhouettes at the same figure height, aligned on the bbox centre.
      const OH = 500, OW = 300, cv = new OffscreenCanvas(OW, OH), ox = cv.getContext('2d');
      const od = ox.createImageData(OW, OH);
      const put = (sil, ch) => {
        const s = (OH - 20) / sil.heightPx, ccx = (sil.bbox.x0 + sil.bbox.x1) / 2;
        for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
          const sx = ccx + (x - OW / 2) / s, sy = sil.bbox.y0 + (y - 10) / s;
          if (sil.on(sx, sy)) od.data[(y * OW + x) * 4 + ch] = 255;
        }
      };
      put(ref, 0); put(mod, 1); put(mod, 2);
      for (let i = 3; i < od.data.length; i += 4) od.data[i] = 255;
      ox.putImageData(od, 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      overlays[k] = Array.from(new Uint8Array(await blob.arrayBuffer()));
    }
    const sp = gen.character.spec, vv = (y) => +(1 - y / 1.7).toFixed(3);
    const dims = Object.fromEntries(Object.entries(scaled).map(([k, v]) => [k, [v.width, v.height, JSON.stringify(analyzeImage(v).bbox)]]));
    const measured = { dims, neckV: vv(sp.neckY), shoulderV: vv(sp.shoulderY), crotchV: vv(sp.crotchY), shoulderX: +sp.shoulderX.toFixed(3), arm: sp.arm, detected: sp.detected,
      look: Object.fromEntries(Object.entries(sp.look).map(([k, x]) => [k, typeof x === 'number' && k.endsWith('Y') ? 'v' + vv(x) : x])) };
    return { result, overlays, stats: gen.stats, measured, glb: Array.from(gen.glb) };
  }, [dataUrl, opts]);

  writeFileSync('out/fidelity.glb', Buffer.from(res.glb));
  for (const k of ['front', 'side', 'back']) writeFileSync(`out/fidelity_${k}.png`, Buffer.from(res.overlays[k]));
  console.log('stats:', JSON.stringify({ ...res.stats, notes: res.stats.notes }));
  console.log('measured:', JSON.stringify(res.measured));
  for (const k of ['front', 'side', 'back']) {
    const { ref, mod, aspect } = res.result[k];
    let err = 0;
    console.log(`\n${k.toUpperCase()}  (bbox width/height: ref ${aspect.ref.toFixed(3)}, model ${aspect.mod.toFixed(3)})`);
    console.log('  v     ref.total  mod.total   diff   | ref.span  mod.span');
    ref.forEach((r, i) => {
      const m = mod[i];
      err += Math.abs(r.total - m.total);
      const d = m.total - r.total;
      console.log(`  ${r.v.toFixed(2)}  ${r.total.toFixed(3)}     ${m.total.toFixed(3)}    ${(d >= 0 ? '+' : '') + d.toFixed(3)} ${Math.abs(d) > 0.02 ? '<<' : '  '} | ${r.span.toFixed(3)}    ${m.span.toFixed(3)}`);
    });
    console.log(`  mean |width error| = ${(err / ref.length).toFixed(4)} of height`);
  }
} catch (e) { console.error(e); code = 1; }
finally { await browser.close(); server.kill(); }
process.exit(code);
