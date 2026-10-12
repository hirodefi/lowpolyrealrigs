// Silhouette analysis: turns an RGBA image into a clean body mask plus
// per-row "runs" (horizontal spans of body pixels) that the builder measures.
// Everything here is O(pixels) on a downscaled image, so it costs a few ms.

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img RGBA
 */
export function analyzeImage(img, opts = {}) {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);

  // 1. Foreground detection: use alpha when the image has real transparency,
  //    otherwise model the background and flood it in from the border.
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  if (opts.maskImage) {
    // User-supplied mask (white figure on black, or alpha), resampled if needed.
    const M = opts.maskImage;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const mx = Math.min(M.width - 1, Math.floor((x * M.width) / w)), my = Math.min(M.height - 1, Math.floor((y * M.height) / h));
      const j = (my * M.width + mx) * 4, lum = (M.data[j] + M.data[j + 1] + M.data[j + 2]) / 3;
      mask[y * w + x] = M.data[j + 3] >= 128 && lum >= 128 ? 1 : 0;
    }
  } else if (transparent > w * h * 0.05) {
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    floodBackground(img, mask);
  }

  // 2. Keep only the largest connected blob (drops noise, shadows, logos), then
  //    close short vertical holes: clothing the same colour as the backdrop
  //    (grey shorts on a grey studio wall) leaves a band with body above and
  //    below it. Long gaps (between the legs, beside the arms) stay open.
  // opts.raw: keep every pixel as-is (used for renders of our own models, where
  // a disconnected piece is a defect to report, not noise to drop).
  let dropped = 0;
  if (!opts.raw) {
    dropped = keepLargestComponent(mask, w, h);
    if (!opts.noClose) closeVertical(mask, w, h);
    keepLargestComponent(mask, w, h);
  }

  // 3. Bounding box.
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) throw new Error('No subject found in image - use a plain background or a transparent PNG.');

  // 4. Runs per row.
  const runs = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x];
      if (on && start < 0) start = x;
      else if (!on && start >= 0) { row.push([start, x - 1]); start = -1; }
    }
    runs.push(row);
  }

  const S = new Silhouette(img, mask, { x0, x1, y0, y1 }, runs);
  S.droppedFrac = dropped;
  return S;
}

/**
 * Background = pixels connected to the image border whose colour stays close
 * to a smooth lighting model fitted to the border (a quadratic surface per
 * channel). This copes with studio gradients and vignettes, where a single
 * background colour fails. Everything not flooded is the subject (mask = 1).
 */
export function floodBackground(img, mask, model = backgroundModel(img)) {
  const { width: w, height: h } = img;
  const { dist, thr } = model;
  // Flood from the border through background-like pixels.
  const bg = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i) => { if (!bg[i] && dist[i] < thr) { bg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (sp) {
    const p = stack[--sp], x = p % w, y = (p / w) | 0;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  for (let i = 0; i < w * h; i++) mask[i] = bg[i] ? 0 : 1;
}

/**
 * Smooth backdrop model fitted to the image border, plus every pixel's colour
 * distance from it. Shared by segmentation and the input validator.
 * @returns {{coef:number[][], noise:number, thr:number, dist:Float32Array, at:(x:number,y:number)=>number[]}}
 */
export function backgroundModel({ width: w, height: h, data }) {
  // Border samples (normalised coordinates).
  const pts = [];
  const push = (x, y) => { const i = (y * w + x) * 4; pts.push([x / w, y / h, data[i], data[i + 1], data[i + 2]]); };
  for (let x = 0; x < w; x += 2) { push(x, 0); push(x, 1); push(x, h - 1); push(x, h - 2); }
  for (let y = 0; y < h; y += 2) { push(0, y); push(1, y); push(w - 1, y); push(w - 2, y); }

  // Robust least-squares fit: c = a0 + a1 x + a2 y + a3 x^2 + a4 y^2 + a5 xy.
  const basis = (x, y) => [1, x, y, x * x, y * y, x * y];
  let use = pts.map(() => true);
  let coef = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]];
  const model = (x, y, c) => basis(x, y).reduce((a, b, k) => a + b * coef[c][k], 0);
  for (let pass = 0; pass < 3; pass++) {
    for (let c = 0; c < 3; c++) {
      const M = Array.from({ length: 6 }, () => new Array(7).fill(0));
      pts.forEach((p, i) => {
        if (!use[i]) return;
        const b = basis(p[0], p[1]);
        for (let r = 0; r < 6; r++) { for (let q = 0; q < 6; q++) M[r][q] += b[r] * b[q]; M[r][6] += b[r] * p[2 + c]; }
      });
      for (let r = 0; r < 6; r++) M[r][r] += 1e-6; // keep it well conditioned
      coef[c] = solve(M);
    }
    // Drop outliers (subject touching the border, logos) and refit.
    const res = pts.map((p) => Math.hypot(p[2] - model(p[0], p[1], 0), p[3] - model(p[0], p[1], 1), p[4] - model(p[0], p[1], 2)));
    const med = res.slice().sort((a, b) => a - b)[res.length >> 1];
    use = res.map((r) => r <= Math.max(6, med * 3));
  }
  const res = pts.map((p) => Math.hypot(p[2] - model(p[0], p[1], 0), p[3] - model(p[0], p[1], 1), p[4] - model(p[0], p[1], 2)));
  const noise = res.slice().sort((a, b) => a - b)[res.length >> 1];
  // Clean studio/CG backdrops have almost no noise, so dark hair in shadow can be
  // separated with a low threshold; noisy photos get a proportionally higher one.
  const thr = Math.max(13, Math.min(60, noise * 6 + 11));

  // Distance of every pixel from the background model.
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, nx = x / w, ny = y / h;
      const m = [0, 1, 2].map((c) => coef[c][0] + coef[c][1] * nx + coef[c][2] * ny + coef[c][3] * nx * nx + coef[c][4] * ny * ny + coef[c][5] * nx * ny);
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      dist[i] = Math.hypot(r - m[0], g - m[1], b - m[2]);
      // Floor shadows: clearly darker than the backdrop with the same tint, and
      // only at floor level. Anywhere higher this would erase neutral grey
      // clothing and anti-aliased seams; wall shadows are flagged by the validator.
      if (y > h * 0.88) {
        const sum = r + g + b + 1, ms = m[0] + m[1] + m[2] + 1, k = sum / ms;
        const chroma = Math.abs(r / sum - m[0] / ms) + Math.abs(g / sum - m[1] / ms) + Math.abs(b / sum - m[2] / ms);
        if (k > 0.3 && k < 0.92 && chroma < 0.04) dist[i] = Math.min(dist[i], chroma * 500);
      }
    }
  }

  const at = (x, y) => [0, 1, 2].map((c) => model(x / w, y / h, c));
  return { coef, noise, thr, dist, at };
}

/** Gaussian elimination on an augmented n x (n+1) matrix. */
function solve(M) {
  const n = M.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || !M[c][c]) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (row[i] ? row[n] / row[i] : 0));
}

function closeVertical(mask, w, h) {
  let y0 = h, y1 = -1;
  for (let i = 0; i < w * h; i++) if (mask[i]) { const y = (i / w) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (y1 < 0) return;
  // Only the waist-to-thigh band: that is where backdrop-coloured clothing
  // (shorts, belts, waistbands) breaks the silhouette. Elsewhere short gaps are
  // real (beside the neck, under the arms, between the feet).
  const maxGap = Math.round((y1 - y0) * 0.085);
  const b0 = Math.round(y0 + (y1 - y0) * 0.3), b1 = Math.round(y0 + (y1 - y0) * 0.62);
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = b0 - maxGap; y <= b1 + maxGap; y++) {
      if (y < y0 || y > y1) continue;
      if (!mask[y * w + x]) continue;
      if (last >= 0 && y - last > 1 && y - last - 1 <= maxGap && last + 1 >= b0 - maxGap && y - 1 <= b1 + maxGap) for (let k = last + 1; k < y; k++) mask[k * w + x] = 1;
      last = y;
    }
  }
}

/** Number of 4-connected foreground components larger than minSize pixels. */
export function countComponents(mask, w, h, minSize = 20) {
  const label = new Int32Array(w * h), stack = new Int32Array(w * h);
  let next = 0, big = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    next++; let sp = 0, size = 0; stack[sp++] = i; label[i] = next;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    if (size >= minSize) big++;
  }
  return big;
}

function keepLargestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  const sizes = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    next++;
    let sp = 0, size = 0;
    stack[sp++] = i; label[i] = next;
    while (sp) {
      const p = stack[--sp]; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    sizes.push(size);
    if (size > bestSize) { bestSize = size; best = next; }
  }
  for (let i = 0; i < w * h; i++) mask[i] = label[i] === best ? 1 : 0;
  // Size of the largest piece dropped, relative to the kept figure.
  sizes.sort((a, b) => b - a);
  return bestSize ? (sizes[1] || 0) / bestSize : 0;
}

export class Silhouette {
  constructor(img, mask, bbox, runs) {
    this.img = img;
    this.mask = mask;
    this.bbox = bbox;
    this.runs = runs;
    this.w = img.width;
    this.h = img.height;
    this.heightPx = bbox.y1 - bbox.y0 + 1;
  }

  /** Row index for normalised height v (0 = top of head, 1 = soles). */
  rowAt(v) {
    return Math.min(this.bbox.y1, Math.max(this.bbox.y0, Math.round(this.bbox.y0 + v * (this.heightPx - 1))));
  }

  on(x, y) {
    x = Math.round(x); y = Math.round(y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.mask[y * this.w + x] === 1;
  }

  /** Run containing x on row y, or the nearest run (null if row empty). */
  runNear(y, x) {
    const row = this.runs[y];
    let best = null, bestD = Infinity;
    for (const r of row) {
      const d = x < r[0] ? r[0] - x : x > r[1] ? x - r[1] : 0;
      if (d < bestD) { bestD = d; best = r; }
    }
    return best;
  }

  /** Average a small neighbourhood of masked pixels around (x,y); searches outward if needed. */
  sampleColor(x, y) {
    const { data } = this.img;
    for (let rad = 1; rad <= 6; rad += 2) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (!this.on(px, py)) continue;
        const i = (py * this.w + px) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      if (n) return [r / n, g / n, b / n];
    }
    return null;
  }
}

/**
 * Split a turnaround sheet (front, side and back side by side in one image)
 * into three images. Columns are separated where the background shows from
 * top to bottom; the three widest figure columns are kept, left to right.
 */
export function splitTurnaround(img) {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  floodBackground(img, mask);
  const col = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) col[x] += mask[y * w + x];
  const minOn = Math.max(2, h * 0.004);
  const runs = [];
  let s = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && col[x] >= minOn;
    if (on && s < 0) s = x;
    else if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
  }
  const big = runs.filter((r) => r[1] - r[0] > w * 0.04).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 3).sort((a, b) => a[0] - b[0]);
  if (big.length < 3) throw new Error('Could not find three figures (front, side, back) in the sheet.');
  // Cut halfway between neighbouring figures.
  const cuts = [0, ((big[0][1] + big[1][0]) / 2) | 0, ((big[1][1] + big[2][0]) / 2) | 0, w];
  return ['front', 'side', 'back'].reduce((out, name, i) => {
    const x0 = cuts[i], x1 = cuts[i + 1], cw = x1 - x0;
    const d = new Uint8ClampedArray(cw * h * 4);
    for (let y = 0; y < h; y++) d.set(data.subarray((y * w + x0) * 4, (y * w + x1) * 4), y * cw * 4);
    out[name] = { width: cw, height: h, data: d };
    return out;
  }, {});
}
