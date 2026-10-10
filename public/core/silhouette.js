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
  //    otherwise compare against the background colour sampled from the border.
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  if (transparent > w * h * 0.05) {
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const bg = borderColor(img);
    const thr = 42 * 42;
    for (let i = 0; i < w * h; i++) {
      const dr = data[i * 4] - bg[0], dg = data[i * 4 + 1] - bg[1], db = data[i * 4 + 2] - bg[2];
      mask[i] = dr * dr + dg * dg + db * db > thr ? 1 : 0;
    }
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

function borderColor({ width: w, height: h, data }) {
  const rs = [], gs = [], bs = [];
  const push = (x, y) => { const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  for (let x = 0; x < w; x += 2) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 2) { push(0, y); push(w - 1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
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
