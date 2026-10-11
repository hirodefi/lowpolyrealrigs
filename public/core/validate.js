// Input validator: checks the reference images against the input contract
// before (and alongside) generation, so a bad result can be traced to its input.
//
// Each check: { view, id, level: 'pass'|'warn'|'fail', message, value }.
// 'fail' blocks generation in the app; 'warn' allows it but is reported.
import { backgroundModel } from './silhouette.js';

const VIEWS = ['front', 'side', 'back'];

/**
 * @param images {front, side?, back?} RGBA ImageData-like
 * @param sil    {front, side?, back?} Silhouette objects from analyzeImage
 * @param spec   body spec from measureBody (for pose checks), optional
 */
export function validateInputs(images, sil, spec = null) {
  const out = [];
  const add = (view, id, level, message, value) => out.push({ view, id, level, message, value });

  // --- Which views exist: the fidelity tier.
  const have = VIEWS.filter((v) => images[v]);
  if (!images.front) add('front', 'views', 'fail', 'A front view is required.');
  else if (have.length === 3) add('all', 'views', 'pass', 'Front, side and back views: full multi-view reconstruction.');
  else if (images.side) add('all', 'views', 'warn', 'No back view: rear hair and clothing are inferred, not measured.');
  else add('all', 'views', 'warn', 'Front view only: body depth, hair length and rear clothing are inferred (basic mode).');

  for (const v of have) {
    const img = images[v], S = sil[v];
    const { width: w, height: h } = img;
    const bm = backgroundModel(img);

    // --- Backdrop: uniform and flat?
    const c0 = bm.at(w / 2, h / 2), cs = [bm.at(0, 0), bm.at(w - 1, 0), bm.at(0, h - 1), bm.at(w - 1, h - 1)];
    const grad = Math.max(...cs.map((c) => Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2])));
    if (bm.noise > 10) add(v, 'background-noise', 'warn', 'Backdrop is noisy or textured; use a plain, uniform background.', +bm.noise.toFixed(1));
    if (grad > 25) add(v, 'background-gradient', 'warn', 'Backdrop has a strong gradient or vignette; use flat, even lighting.', +grad.toFixed(1));

    if (!S) continue;
    // --- Cropping: the figure must not touch the image edge.
    const { x0, x1, y0, y1 } = S.bbox;
    if (y0 <= 1 || y1 >= h - 2 || x0 <= 1 || x1 >= w - 2) add(v, 'cropped', 'fail', 'The figure touches the image edge (head, hands or feet cropped).');
    // --- Broken figure: a sizeable piece cut off from the body usually means a
    //     body part blended into the backdrop (e.g. trousers matching the wall).
    if (S.droppedFrac > 0.01) add(v, 'figure-broken', 'warn', 'Part of the figure was separated from the body - clothing or hair may match the backdrop colour.', +S.droppedFrac.toFixed(3));
    // --- Size: enough pixels to measure.
    if (S.heightPx < h * 0.5) add(v, 'small-figure', 'warn', 'The figure fills less than half the image height; frame head to soles.', +(S.heightPx / h).toFixed(2));

    // --- Contrast: how much of the outline sits close to the backdrop colour.
    let edge = 0, weak = 0;
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!S.mask[i] || (S.mask[i - 1] && S.mask[i + 1] && S.mask[i - w] && S.mask[i + w])) continue;
      // Look one pixel inside the figure, away from anti-aliasing.
      const ix = S.mask[i - 1] ? x - 2 : x + 2;
      const j = y * w + Math.min(w - 1, Math.max(0, ix));
      edge++;
      if (bm.dist[j] < bm.thr * 2.5) weak++;
    }
    const weakFrac = edge ? weak / edge : 0;
    // Clean references score ~0.16 (soft low-poly shading), problem inputs 0.28+.
    if (weakFrac > 0.22) add(v, 'low-contrast', 'warn', 'Parts of the figure are close to the backdrop colour; pick a backdrop that contrasts with hair, skin and clothes.', +weakFrac.toFixed(2));
  }

  // --- Framing: the figure should be the same height in every view.
  const frac = (v) => sil[v] && sil[v].heightPx / images[v].height;
  if (sil.front) for (const v of ['side', 'back']) {
    if (!sil[v]) continue;
    const r = frac(v) / frac('front');
    if (Math.abs(r - 1) > 0.03) add(v, 'scale-mismatch', 'warn', `The figure is ${((r - 1) * 100).toFixed(0)}% ${r > 1 ? 'taller' : 'shorter'} than in the front view; keep the same scale and framing.`, +r.toFixed(3));
  }

  // --- Pose (from the measurement).
  if (spec) {
    if (spec.detected?.arms < 2) add('front', 'arms', 'warn', 'Arms not clearly separated from the body; use an A-pose with the arms a little away from the torso.', spec.detected.arms);
    if (!spec.detected?.crotch && spec.look?.skirtY == null) add('front', 'legs', 'warn', 'Legs not clearly visible (no gap between them and no skirt hem found).');
    if (!spec.detected?.neck) add('front', 'neck', 'warn', 'Neck not visible (hair or collar): neck height is inferred from proportions.');
  }
  // Side view: a stride shows two separate legs below the knee.
  if (sil.side) {
    const S = sil.side;
    let two = 0, rows = 0;
    for (let v = 0.72; v <= 0.92; v += 0.02) {
      const runs = S.runs[S.rowAt(v)].filter((r) => r[1] - r[0] > S.heightPx * 0.012);
      rows++;
      if (runs.length >= 2 && runs[runs.length - 1][0] - runs[0][1] > S.heightPx * 0.02) two++;
    }
    if (two / rows > 0.5) add('side', 'stride', 'warn', 'Side view looks mid-stride (legs apart); use a standing pose with the legs together.', +(two / rows).toFixed(2));
  }
  // Back view should not show a face.
  if (sil.back && spec?.look && images.back) {
    const S = sil.back, cx = (S.bbox.x0 + S.bbox.x1) / 2, y = S.rowAt(0.08), d = images.back.data;
    let skin = 0, n = 0;
    for (let x = cx - S.heightPx * 0.02; x <= cx + S.heightPx * 0.02; x++) {
      if (!S.on(x, y)) continue;
      const i = (y * S.w + Math.round(x)) * 4, c = [d[i], d[i + 1], d[i + 2]], s = spec.look.skin, hcol = spec.look.hair;
      n++;
      if (Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]) < Math.hypot(c[0] - hcol[0], c[1] - hcol[1], c[2] - hcol[2]) - 20) skin++;
    }
    if (spec.look.hasHair && n && skin / n > 0.6) add('back', 'back-shows-face', 'warn', 'The back view seems to show a face; use a direct rear view.', +(skin / n).toFixed(2));
  }

  return out;
}

/** Summary: worst level and the non-pass items. */
export function summarizeValidation(checks) {
  const level = checks.some((c) => c.level === 'fail') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'warn' : 'pass';
  return { level, issues: checks.filter((c) => c.level !== 'pass') };
}
