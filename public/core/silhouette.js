// Silhouette analysis: turns an RGBA image into a clean body mask plus
// per-row "runs" (horizontal spans of body pixels) that the builder measures.
// Everything here is O(pixels) on a downscaled image, so it costs a few ms.

/**
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img RGBA
 */
export function analyzeImage(img) {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);

  // 1. Foreground detection: use alpha when the image has real transparency,
  //    otherwise model the background and flood it in from the border.
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  if (transparent > w * h * 0.05) {
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    floodBackground(img, mask);
  }

  // 2. Keep only the largest connected blob (drops noise, shadows, logos).
  keepLargestComponent(mask, w, h);

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

  return new Silhouette(img, mask, { x0, x1, y0, y1 }, runs);
}

/**
 * Background = pixels connected to the image border whose colour stays close
 * to a smooth lighting model fitted to the border (a quadratic surface per
 * channel). This copes with studio gradients and vignettes, where a single
 * background colour fails. Everything not flooded is the subject (mask = 1).
 */
function floodBackground({ width: w, height: h, data }, mask) {
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
  const thr = Math.max(28, Math.min(60, noise * 6 + 18));

  // Distance of every pixel from the background model.
  const dist = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, nx = x / w, ny = y / h;
      const m = [0, 1, 2].map((c) => coef[c][0] + coef[c][1] * nx + coef[c][2] * ny + coef[c][3] * nx * nx + coef[c][4] * ny * ny + coef[c][5] * nx * ny);
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      dist[i] = Math.hypot(r - m[0], g - m[1], b - m[2]);
      // Floor shadows: darker than the background but with the same tint. Only
      // below the head zone, so dark hair against a pale backdrop is safe.
      if (y > h * 0.3) {
        const sum = r + g + b + 1, ms = m[0] + m[1] + m[2] + 1, k = sum / ms;
        const chroma = Math.abs(r / sum - m[0] / ms) + Math.abs(g / sum - m[1] / ms) + Math.abs(b / sum - m[2] / ms);
        if (k > 0.3 && k < 1 && chroma < 0.04) dist[i] = Math.min(dist[i], chroma * 500);
      }
    }
  }

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

function keepLargestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
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
    if (size > bestSize) { bestSize = size; best = next; }
  }
  for (let i = 0; i < w * h; i++) mask[i] = label[i] === best ? 1 : 0;
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
