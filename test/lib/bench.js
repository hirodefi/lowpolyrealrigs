// Browser-side benchmark runner (loaded by test/benchmark.js through Playwright).
//
// Suite A - synthetic ground truth: build a character with known parameters,
// render it orthographically on a plain backdrop (front / side / back), feed the
// renders back in as if they were user images, and compare what comes out with
// the known truth: styles, colours, joint positions and silhouettes per view.
//
// External: real reference images (no ground truth). The generated model is
// rendered from the same views and compared with the reference silhouettes.
import { generateCharacter } from '/core/pipeline.js';
import { sampleImages } from '/core/samples.js';
import { analyzeImage, splitTurnaround, countComponents } from '/core/silhouette.js';
import { toAnalysisImage, loadAnalysisImage } from '/image-input.js';
import { renderViews, alignedIoU, widthProfile, meanAbsDiff, overlay, toPNG } from './views.js';

const H = 1.7;
const VIEWS = ['front', 'side', 'back'];

/** Joint landmarks (fractions of height) read from a built character's bind pose. */
function landmarks(character) {
  const b = Object.fromEntries(character.bones.map((x) => [x.name, x.pos]));
  const f = (v) => +(v / H).toFixed(4);
  return {
    neckY: f(b.Neck[1]), hipsY: f(b.Hips[1]), shoulderY: f(b.LeftUpperArm[1]), shoulderX: f(b.LeftUpperArm[0]),
    elbowY: f(b.LeftLowerArm[1]), wristY: f(b.LeftHand[1]), hipJointX: f(b.LeftUpperLeg[0]), kneeY: f(b.LeftLowerLeg[1]), ankleY: f(b.LeftFoot[1]),
  };
}

const look5 = (look) => Object.fromEntries(['skin', 'hair', 'top', 'bottom', 'shoes'].map((k) => [k, look[k]]));
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function compareSilhouettes(refViews, glb, files, prefix) {
  const mod = await renderViews(glb, { bg: null, flat: true });
  const out = {};
  for (const v of VIEWS) {
    if (!refViews[v]) continue;
    const a = analyzeImage(refViews[v]), b = analyzeImage(mod[v], { raw: true });
    out[v] = {
      iou: +alignedIoU(a, b).toFixed(4),
      widthErr: +meanAbsDiff(widthProfile(a), widthProfile(b)).toFixed(4),
      aspectRef: +((a.bbox.x1 - a.bbox.x0 + 1) / a.heightPx).toFixed(3),
      aspectModel: +((b.bbox.x1 - b.bbox.x0 + 1) / b.heightPx).toFixed(3),
      // A watertight-looking model is one connected silhouette (no see-through seams).
      modelPieces: countComponents(b.mask, b.w, b.h),
    };
    files[`${prefix}overlay_${v}.png`] = Array.from(await toPNG(overlay(a, b)));
    files[`${prefix}model_${v}.png`] = Array.from(await toPNG(mod[v]));
  }
  return out;
}

/** Suite A case: { name, gen: {body, hair, bottom, colors}, bg: [r,g,b] } */
export async function runSynthetic(c) {
  const files = {};
  // Ground truth uses pure template proportions (realistic humans), not the
  // cartoon proportions of the demo drawing; the drawing only supplies the pose.
  const truthGen = generateCharacter(sampleImages(), { ...c.gen, height: H, proportions: 'template' });
  const truth = {
    body: truthGen.stats.body, hair: truthGen.stats.hair, bottom: truthGen.stats.bottom,
    colors: look5(truthGen.character.spec.look), landmarks: landmarks(truthGen.character),
  };
  // The "user images": flat-lit orthographic renders on a plain backdrop.
  const shots = await renderViews(truthGen.glb, { bg: c.bg, flat: true });
  const input = {};
  for (const v of VIEWS) { input[v] = await toAnalysisImage(shots[v]); files[`input_${v}.png`] = Array.from(await toPNG(input[v])); }
  const rec = generateCharacter(input, { height: H });
  const got = {
    body: rec.stats.body, hair: rec.stats.hair, bottom: rec.stats.bottom,
    colors: look5(rec.character.spec.look), landmarks: landmarks(rec.character), notes: rec.stats.notes,
    validation: rec.stats.validation,
  };
  // Silhouettes: truth (transparent) vs recovered model, both from the same cameras.
  const truthMasks = await renderViews(truthGen.glb, { bg: null, flat: true });
  const views = await compareSilhouettes(truthMasks, rec.glb, files, '');
  // Hair colour is meaningless on a bald character.
  const colorErr = Object.fromEntries(Object.keys(truth.colors).filter((k) => !(k === 'hair' && truth.hair === 'bald')).map((k) => [k, +rgbDist(truth.colors[k], got.colors[k]).toFixed(1)]));
  const lmErr = Object.fromEntries(Object.keys(truth.landmarks).map((k) => [k, +Math.abs(truth.landmarks[k] - got.landmarks[k]).toFixed(4)]));
  return { name: c.name, truth, got, colorErr, lmErr, views, spec: summarizeSpec(rec.character.spec), truthSpec: summarizeSpec(truthGen.character.spec), triangles: rec.stats.triangles, files };
}

/** External case: { name, sheet?: url, views?: {front, side?, back?} urls, opts? } */
export async function runExternal(c) {
  const files = {};
  let input = {};
  if (c.sheet) {
    const sheet = await loadAnalysisImage(c.sheet, 2048);
    const parts = splitTurnaround(sheet);
    for (const v of VIEWS) input[v] = await toAnalysisImage(parts[v]);
  } else {
    for (const v of VIEWS) if (c.views[v]) input[v] = await loadAnalysisImage(c.views[v]);
  }
  for (const v of VIEWS) if (input[v]) files[`input_${v}.png`] = Array.from(await toPNG(input[v]));
  const rec = generateCharacter(input, { height: H, ...(c.opts || {}) });
  // Side reference facing: compare against a model render that faces the same way.
  const views = await compareSilhouettes(input, rec.glb, files, '');
  return {
    name: c.name,
    got: { body: rec.stats.body, hair: rec.stats.hair, bottom: rec.stats.bottom, colors: look5(rec.character.spec.look), landmarks: landmarks(rec.character), notes: rec.stats.notes },
    validation: rec.stats.validation,
    spec: summarizeSpec(rec.character.spec),
    views, triangles: rec.stats.triangles, glb: Array.from(rec.glb), files,
  };
}

/** Machine-readable snapshot of the measured body spec (for report.json). */
function summarizeSpec(s) {
  const v = (y) => +(1 - y / s.height).toFixed(4);
  const look = Object.fromEntries(Object.entries(s.look).map(([k, x]) => [k, typeof x === 'number' && k.endsWith('Y') ? { v: v(x) } : x]));
  return {
    detected: s.detected, notes: s.notes,
    shape: Object.fromEntries(Object.entries(s.shape || {}).map(([k, x]) => [k, x == null ? null : +x.toFixed(3)])),
    v: { neck: v(s.neckY), shoulder: v(s.shoulderY), crotch: v(s.crotchY) },
    shoulderX: +s.shoulderX.toFixed(4), hipX: +s.hipX.toFixed(4),
    arm: Object.fromEntries(Object.entries(s.arm).map(([k, x]) => [k, +x.toFixed(4)])),
    look,
  };
}

/**
 * Suite C: break a clean synthetic input in one specific way and report which
 * validator checks fire. c = { name, gen, bg, perturb: 'gradient'|'lowcontrast'|'scale'|'crop'|'frontonly', expect: check id }
 */
export async function runAdversarial(c) {
  const truthGen = generateCharacter(sampleImages(), { ...c.gen, height: H, proportions: 'template' });
  const shots = await renderViews(truthGen.glb, { bg: c.bg, flat: true });
  const input = {};
  for (const v of VIEWS) input[v] = await toAnalysisImage(shots[v]);
  const files = {};
  const map = (img, fn) => { const d = img.data; for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const i = (y * img.width + x) * 4; fn(d, i, x, y); } };
  if (c.perturb === 'gradient') for (const v of VIEWS) map(input[v], (d, i, x, y) => { const k = 1.18 - 0.45 * (y / input[v].height); for (let j = 0; j < 3; j++) d[i + j] = Math.min(255, d[i + j] * k); });
  if (c.perturb === 'scale') { // side view at 90% scale, same canvas
    const src = input.side, c2 = new OffscreenCanvas(src.width, src.height), ctx = c2.getContext('2d');
    ctx.fillStyle = `rgb(${c.bg.join(',')})`; ctx.fillRect(0, 0, src.width, src.height);
    const tmp = new OffscreenCanvas(src.width, src.height); tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), 0, 0);
    ctx.drawImage(tmp, src.width * 0.05, src.height * 0.1, src.width * 0.9, src.height * 0.9);
    input.side = ctx.getImageData(0, 0, src.width, src.height);
  }
  if (c.perturb === 'crop') { // cut the feet off the front view
    const src = input.front, h2 = Math.round(src.height * 0.94);
    input.front = { width: src.width, height: h2, data: new Uint8ClampedArray(src.data.subarray(0, src.width * h2 * 4)) };
  }
  if (c.perturb === 'frontonly') { delete input.side; delete input.back; }
  for (const v of VIEWS) if (input[v]) files[`input_${v}.png`] = Array.from(await toPNG(input[v]));
  let issues = [];
  try { issues = generateCharacter(input, { height: H }).validation.filter((i) => i.level !== 'pass'); }
  catch (e) { issues = [{ id: 'error', level: 'fail', view: '-', message: e.message }]; }
  return { name: c.name, expect: c.expect, issues: issues.map((i) => ({ id: i.id, view: i.view, level: i.level })), files };
}
