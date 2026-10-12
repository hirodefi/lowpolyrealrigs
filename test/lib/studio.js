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
