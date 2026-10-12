// Browser-side studio for the character skill (.claude/skills/character):
// seed a spec from reference images, build a spec (optionally shaped by the
// references), audit it, compare it with the references and render a review
// sheet (views, close-ups, motion frames) - Anatomy's "verify like a critic"
// step for rigged characters.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildFromSpec } from '/core/fromSpec.js';
import { generateCharacter } from '/core/pipeline.js';
import { auditCharacter } from '/core/audit.js';
import { analyzeImage, splitTurnaround, countComponents } from '/core/silhouette.js';
import { loadAnalysisImage, toAnalysisImage } from '/image-input.js';
import { renderViews, alignedIoU, widthProfile, meanAbsDiff, overlay, toPNG } from './views.js';

const VIEWS = ['front', 'side', 'back'];

/** ref: { front?, side?, back? } or { sheet } as URLs (data: URLs work). */
async function loadRefs(ref) {
  if (!ref) return null;
  if (ref.sheet) {
    const parts = splitTurnaround(await loadAnalysisImage(ref.sheet, 2048));
    const out = {};
    for (const v of VIEWS) if (parts[v]) out[v] = await toAnalysisImage(parts[v]);
    return out;
  }
  const out = {};
  for (const v of VIEWS) if (ref[v]) out[v] = await loadAnalysisImage(ref[v]);
  return out.front ? out : null;
}

const hex = (c) => c.map((x) => Math.round(x));

/** Draft spec from reference images: measured body type, styles and colours. */
export async function seed(ref) {
  const images = await loadRefs(ref);
  if (!images) throw new Error('seed needs at least a front view');
  const r = generateCharacter(images, { height: 1.7 });
  const look = r.character.spec.look, s = r.stats;
  const spec = {
    name: 'character', body: s.body, hair: s.hair, top: s.top, bottom: s.bottom, shoes: s.heels ? 'heels' : 'flat',
    colors: { Skin: hex(look.skin), Hair: hex(look.hair), Top: hex(look.top), Bottom: hex(look.bottom), Shoes: hex(look.shoes) },
    parts: [],
  };
  if (look.accent) spec.colors.Accent = hex(look.accent);
  return { spec, validation: s.validation, notes: s.notes };
}

async function compare(refs, glb, files) {
  const mod = await renderViews(glb, { bg: null, flat: true });
  const out = {};
  for (const v of VIEWS) {
    if (!refs?.[v]) continue;
    const a = analyzeImage(refs[v]), b = analyzeImage(mod[v], { raw: true });
    out[v] = { iou: +alignedIoU(a, b).toFixed(3), widthErr: +meanAbsDiff(widthProfile(a), widthProfile(b)).toFixed(4), pieces: countComponents(b.mask, b.w, b.h) };
    files[`overlay_${v}.png`] = Array.from(await toPNG(overlay(a, b)));
  }
  return out;
}

/**
 * Manual measuring aid: for one view, the figure's spans (body pixels) per row,
 * every `step` of the figure height, with each span's colour (median of its
 * middle half). Heights h are fractions of the figure from the floor; x is
 * relative to the figure's centre, as a fraction of its height.
 */
export async function spans(ref, view = 'front', step = 0.01) {
  const refs = await loadRefs(ref);
  const img = refs?.[view];
  if (!img) throw new Error(`no ${view} view`);
  const S = analyzeImage(img, { raw: true });
  const { x0, x1, y0, y1 } = S.bbox, Hp = y1 - y0, cx = (x0 + x1) / 2, d = img.data;
  const rows = [];
  for (let v = 0; v <= 1.0001; v += step) {
    const y = Math.min(y1, Math.round(y0 + v * Hp)), runs = [];
    for (const [a, b] of S.runs[y] || []) {
      if (b - a < 2) continue;
      const px = [];
      for (let x = a + Math.floor((b - a) / 4); x <= b - Math.floor((b - a) / 4); x++) { const i = (y * img.width + x) * 4; px.push([d[i], d[i + 1], d[i + 2]]); }
      px.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
      runs.push({ x0: +((a - cx) / Hp).toFixed(3), x1: +((b - cx) / Hp).toFixed(3), rgb: px[px.length >> 1] });
    }
    rows.push({ h: +(1 - v).toFixed(3), runs });
  }
  return { view, heightPx: Hp, rows };
}

// ---------------------------------------------------------------------------
// fit: how closely the built model matches the reference silhouettes, row by row.
// Both silhouettes are aligned on the feet, the height and a vertical anchor line
// (front/back: the figure's centre; side: the ankle plumb line, centre of the
// silhouette at h = 0.10), so the lean, bust, glutes and shin shift of a z-relative
// body are compared where they are, not where a bounding box would put them.

const BANDS = [['head', 0.83, 1.0], ['neck+shoulders', 0.76, 0.83], ['torso', 0.52, 0.76], ['thighs', 0.33, 0.52], ['shins', 0.09, 0.33], ['feet', 0.0, 0.09]];
export const GATES = { iou: { front: 0.92, back: 0.92, side: 0.88 }, rowMean: 0.004, rowMax: 0.008 };

function anchorOf(S, view) {
  if (view !== 'side') return (S.bbox.x0 + S.bbox.x1) / 2;
  let sum = 0, n = 0;
  for (let h = 0.09; h <= 0.111; h += 0.005) {
    const r = S.runs[S.rowAt(1 - h)];
    if (r?.length) { sum += (r[0][0] + r[r.length - 1][1]) / 2; n++; }
  }
  return n ? sum / n : (S.bbox.x0 + S.bbox.x1) / 2;
}
function edges(S, anchor, h) {
  const r = S.runs[S.rowAt(1 - h)];
  if (!r?.length) return null;
  const k = S.heightPx;
  return { L: (r[0][0] - anchor) / k, R: (r[r.length - 1][1] - anchor) / k };
}
function alignedIoUAt(a, aa, b, ab) {
  const N = 420; let inter = 0, uni = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N / 2; i++) {
    const x = (i / (N / 2) - 0.5) * 0.7, y = j / (N - 1);
    const p = a.on(aa + x * a.heightPx, a.bbox.y0 + y * (a.heightPx - 1)), q = b.on(ab + x * b.heightPx, b.bbox.y0 + y * (b.heightPx - 1));
    if (p && q) inter++;
    if (p || q) uni++;
  }
  return uni ? inter / uni : 0;
}
function overlayAt(a, aa, b, ab, W = 300, H = 520) {
  const data = new Uint8ClampedArray(W * H * 4), sa = (H - 20) / a.heightPx, sb = (H - 20) / b.heightPx;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, p = a.on(aa + (x - W / 2) / sa, a.bbox.y0 + (y - 10) / sa), q = b.on(ab + (x - W / 2) / sb, b.bbox.y0 + (y - 10) / sb);
    data[o] = p ? 255 : 0; data[o + 1] = q ? 255 : 0; data[o + 2] = q ? 255 : 0; data[o + 3] = 255; // red = reference only, cyan = model only, white = both
  }
  return { width: W, height: H, data };
}

/** Build the spec against the references and report the fit: tables, bands, gates, overlays. */
export async function fit(spec, ref) {
  const refs = await loadRefs(ref);
  if (!refs) throw new Error('fit needs reference views');
  const r = buildFromSpec(spec, refs);
  const mod = await renderViews(r.glb, { bg: null, flat: true });
  const files = {}, report = { views: {}, pass: true, lines: [] };
  const f3 = (x) => (x >= 0 ? '+' : '') + x.toFixed(3);
  for (const v of VIEWS) {
    if (!refs[v]) continue;
    // noClose: the waist-band gap filling meant for photos would fill the real gaps between torso and arms of a clean reference
    const A = analyzeImage(refs[v], { noClose: true }), B = analyzeImage(mod[v], { raw: true });
    const aa = anchorOf(A, v), ab = anchorOf(B, v);
    const iou = alignedIoUAt(A, aa, B, ab);
    const rows = [];
    for (let h = 0.995; h > 0.004; h -= 0.01) {
      const ea = edges(A, aa, h), eb = edges(B, ab, h);
      if (!ea || !eb) continue;
      rows.push({ h, ref: ea, model: eb, dL: eb.L - ea.L, dR: eb.R - ea.R });
    }
    const bands = BANDS.map(([name, lo, hi]) => {
      const rs = rows.filter((q) => q.h >= lo && q.h <= hi);
      // Feet: the reference's feet are rarely symmetric (one toes out more); a symmetric character is judged on the mean outward
      // error of the two feet in front/back views, and the feet band has a looser gate (small parts, pose-dependent).
      const errs = name === 'feet' && v !== 'side' ? rs.map((q) => Math.abs((q.dR - q.dL) / 2)) : rs.flatMap((q) => [Math.abs(q.dL), Math.abs(q.dR)]);
      return { name, lo, hi, mean: errs.reduce((a, b) => a + b, 0) / (errs.length || 1), max: Math.max(0, ...errs) };
    });
    const iouOk = iou >= GATES.iou[v];
    const bandLim = (b, max) => (b.name === 'feet' ? (max ? 2.5 : 2) : 1.5);
    const bandsOk = bands.every((b) => b.mean <= GATES.rowMean * bandLim(b) && b.max <= GATES.rowMax * bandLim(b, 1));
    report.views[v] = { iou: +iou.toFixed(3), iouGate: GATES.iou[v], iouOk, bands, bandsOk };
    if (!iouOk || !bandsOk) report.pass = false;
    report.lines.push(`== ${v}: IoU ${iou.toFixed(3)} (gate ${GATES.iou[v]})${iouOk ? '' : '  <<'}`);
    for (const b of bands) report.lines.push(`   ${b.name.padEnd(15)} h ${b.lo.toFixed(2)}-${b.hi.toFixed(2)}  mean |err| ${b.mean.toFixed(4)}  max ${b.max.toFixed(4)}${b.mean > GATES.rowMean * bandLim(b) || b.max > GATES.rowMax * bandLim(b, 1) ? '  <<' : ''}`);
    report.lines.push('   rows (h | reference L R | model L R | err L R)  - err = model minus reference, + = model further right; flagged when |err| > ' + GATES.rowMax);
    for (const q of rows) report.lines.push(`   h ${q.h.toFixed(3)} | ${f3(q.ref.L)} ${f3(q.ref.R)} | ${f3(q.model.L)} ${f3(q.model.R)} | ${f3(q.dL)} ${f3(q.dR)}${Math.abs(q.dL) > GATES.rowMax || Math.abs(q.dR) > GATES.rowMax ? '  <<' : ''}`);
    files[`fit_overlay_${v}.png`] = Array.from(await toPNG(overlayAt(A, aa, B, ab)));
  }
  return { report, files, glb: Array.from(r.glb), triangles: r.budget.total };
}

/** Build a spec; with ref images the body is measured from them. */
export async function build(spec, ref) {
  const refs = await loadRefs(ref);
  const r = buildFromSpec(spec, refs);
  const audit = auditCharacter(r.character, r.animations);
  const files = {};
  const cmp = refs ? await compare(refs, r.glb, files) : null;
  files['sheet.png'] = Array.from(await reviewSheet(r.glb, refs, spec.name || 'character'));
  return {
    glb: Array.from(r.glb), files,
    stats: { body: r.stats.body, hair: r.stats.hair, top: r.stats.top, bottom: r.stats.bottom, heels: r.stats.heels, triangles: r.stats.triangles, materials: r.stats.materials, clips: r.stats.clips, notes: r.stats.notes, validation: r.stats.validation },
    budget: r.budget, audit, compare: cmp,
  };
}

/**
 * Review sheet: reference views next to the model (front, side, back), close-ups
 * (face front and 3/4, hands, feet) and motion frames (walk, run, sit, wave).
 */
export async function reviewSheet(glb, refs, title) {
  const TW = 300, TH = 420;
  const gltf = await new GLTFLoader().parseAsync(glb.buffer ? glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) : new Uint8Array(glb).buffer, '');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe3ea);
  scene.add(gltf.scene);
  // Soft studio light (like the reference renders): a bright sky/ground fill, a
  // gentle key and a rim, so flat facets read as form rather than as blotches.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc4c8d2, 2.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(1.5, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-3, 1.5, 1); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(0, 3, -4); scene.add(rim);
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(TW, TH);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cam = new THREE.PerspectiveCamera(28, TW / TH, 0.01, 100);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const bone = (n) => gltf.scene.getObjectByName(n);
  const pose = (clip, t) => {
    mixer.stopAllAction();
    if (clip) { const c = gltf.animations.find((a) => a.name === clip); if (c) { const act = mixer.clipAction(c); act.reset().play(); mixer.setTime(t * c.duration); } }
    else mixer.setTime(0);
    gltf.scene.updateMatrixWorld(true);
  };
  const shot = ({ clip = null, t = 0, angle = 0, target = null, up = 0, dist = 3.6, h = 0.9, lift = 0.15 }) => {
    pose(clip, t);
    let c = new THREE.Vector3(0, h, 0);
    if (target) { const b = bone(target); if (b) b.getWorldPosition(c); c.y += up; }
    if (clip && !target) { const hips = bone('Hips'); if (hips) { const p = new THREE.Vector3(); hips.getWorldPosition(p); c.x = p.x; c.z = p.z; } }
    const a = (angle * Math.PI) / 180;
    cam.position.set(c.x + Math.sin(a) * dist, c.y + lift * dist, c.z + Math.cos(a) * dist);
    cam.lookAt(c);
    renderer.render(scene, cam);
    return canvas;
  };
  const tiles = [];
  const row1 = [];
  for (const [v, ang] of [['front', 0], ['side', 90], ['back', 180]]) {
    if (refs?.[v]) row1.push({ img: refs[v], label: `reference ${v}` });
    row1.push({ draw: () => shot({ angle: ang }), label: `model ${v}` });
  }
  tiles.push(row1);
  tiles.push([
    { draw: () => shot({ target: 'Head', up: 0.09, dist: 0.6, angle: 0, lift: 0.05 }), label: 'face' },
    { draw: () => shot({ target: 'Head', up: 0.09, dist: 0.6, angle: 35, lift: 0.05 }), label: 'face 3/4' },
    { draw: () => shot({ target: 'Chest', dist: 1.1, angle: 20, lift: 0.1 }), label: 'chest / collar' },
    { draw: () => shot({ target: 'LeftHand', up: -0.05, dist: 0.75, angle: 60, lift: 0.1 }), label: 'hand' },
    { draw: () => shot({ target: 'LeftToes', up: 0.04, dist: 0.85, angle: 35, lift: 0.25 }), label: 'feet' },
  ]);
  tiles.push([
    { draw: () => shot({ clip: 'walk', t: 0.1, angle: 70 }), label: 'walk' },
    { draw: () => shot({ clip: 'walk', t: 0.6, angle: 20 }), label: 'walk' },
    { draw: () => shot({ clip: 'run', t: 0.3, angle: 70 }), label: 'run' },
    { draw: () => shot({ clip: 'sit', t: 0, angle: 50, h: 0.7 }), label: 'sit' },
    { draw: () => shot({ clip: 'wave', t: 0.4, angle: 15 }), label: 'wave' },
  ]);
  const cols = Math.max(...tiles.map((r) => r.length));
  const out = new OffscreenCanvas(cols * TW, tiles.length * TH + 36);
  const g = out.getContext('2d');
  g.fillStyle = '#dfe3ea'; g.fillRect(0, 0, out.width, out.height);
  g.fillStyle = '#334'; g.font = 'bold 20px sans-serif'; g.fillText(title, 10, 25);
  tiles.forEach((row, r) => row.forEach((tile, c) => {
    const x = c * TW, y = 36 + r * TH;
    if (tile.img) {
      const im = tile.img, bmp = new OffscreenCanvas(im.width, im.height);
      bmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(im.data), im.width, im.height), 0, 0);
      const k = Math.min(TW / im.width, TH / im.height);
      g.drawImage(bmp, x + (TW - im.width * k) / 2, y + (TH - im.height * k) / 2, im.width * k, im.height * k);
    } else g.drawImage(tile.draw(), x, y);
    g.fillStyle = 'rgba(30,34,48,0.75)'; g.font = '14px sans-serif'; g.fillText(tile.label, x + 8, y + TH - 10);
  }));
  renderer.dispose();
  const blob = await out.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
