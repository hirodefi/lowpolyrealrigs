// Shared geometry: vector helpers, template ring helpers and the MeshBuilder that
// collects flat-shaded, skinned triangles. Used by the body builder and the parts kit.
import { BINS } from './template.js';

// ---------- small helpers ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const TAU = Math.PI * 2;

/** Periodic interpolation of a BINS-sample ring shape at parametric angle t. */
export function shapeAt(shape, t) {
  const x = (((t / TAU) * BINS) % BINS + BINS) % BINS;
  const i = Math.floor(x), f = x - i;
  return lerp(shape[i % BINS], shape[(i + 1) % BINS], f);
}
/** Shape mirrored across the v axis (left limb -> right limb). */
export const mirrorShape = (shape) => shape.map((_, k) => shape[(BINS / 2 - k + BINS) % BINS]);

/** Template stations with gaps filled, plus interpolation at any u. */
export function stations(list) {
  const filled = list.map((s, i) => s || list.slice(i).find(Boolean) || list.slice(0, i).reverse().find(Boolean));
  return (u) => {
    if (u <= filled[0].u) return filled[0];
    for (let i = 0; i + 1 < filled.length; i++) {
      const a = filled[i], b = filled[i + 1];
      if (u <= b.u) {
        const t = (u - a.u) / (b.u - a.u);
        return { u, cx: lerp(a.cx, b.cx, t), cz: lerp(a.cz, b.cz, t), hw: lerp(a.hw, b.hw, t), hd: lerp(a.hd, b.hd, t), shape: a.shape.map((v, k) => lerp(v, b.shape[k], t)) };
      }
    }
    return filled[filled.length - 1];
  };
}

/** Weights along a 1-D parameter. segs = [[bone, endParam], ..., [bone, Infinity]]. */
export function weightsAlong(s, segs, blend) {
  for (let i = 0; i < segs.length; i++) {
    const end = segs[i][1];
    const prevEnd = i > 0 ? segs[i - 1][1] : -Infinity;
    if (i > 0 && s < prevEnd + blend) {
      const t = (s - (prevEnd - blend)) / (2 * blend);
      return { [segs[i - 1][0]]: 1 - t, [segs[i][0]]: t };
    }
    if (s < end - blend || i === segs.length - 1) return { [segs[i][0]]: 1 };
    if (s < end) {
      const t = (s - (end - blend)) / (2 * blend);
      return { [segs[i][0]]: 1 - t, [segs[i + 1][0]]: t };
    }
  }
  return { [segs[segs.length - 1][0]]: 1 };
}

/** Light 3-tap smoothing of a factor list, then clamp. */
export const smooth = (arr, a, b) => arr.map((v, i) => clamp(0.25 * (arr[i - 1] ?? v) + 0.5 * v + 0.25 * (arr[i + 1] ?? v), a, b));
/** Linear lookup in a factor list sampled evenly over [0, 1]. */
export const lookup = (arr, u) => { const n = arr.length - 1, x = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)); return lerp(arr[i], arr[i + 1], x - i); };
/** Bisection inverse of a monotonic increasing function on [0, 1]. */
export const invert = (fn, y) => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fn(m) < y) lo = m; else hi = m; } return (lo + hi) / 2; };

export class MeshBuilder {
  constructor() { this.tris = []; this.mat = () => 'Skin'; this.tag = 'body'; }

  /**
   * rings: [{c, u, v, rx, ry, shape?, f?(t), w, wf?(t)}] ; S segments ; caps: apex points (or null).
   * wf(t) optionally gives per-vertex weights (e.g. a skirt following both thighs).
   * keep(i, k) optional: drop quads/caps whose vertices are all "not kept".
   */
  tube(rings, S, capStart, capEnd, keep) {
    const pts = rings.map((r) => {
      const out = [];
      for (let k = 0; k < S; k++) {
        const t = (k / S) * TAU + Math.PI / S;
        const f = r.f ? r.f(t) : r.shape ? shapeAt(r.shape, t) : 1;
        out.push(add(r.c, add(mul(r.u, r.rx * f * Math.cos(t)), mul(r.v, r.ry * f * Math.sin(t)))));
      }
      return out;
    });
    const W = rings.map((r) => Array.from({ length: S }, (_, k) => (r.wf ? r.wf((k / S) * TAU + Math.PI / S) : r.w)));
    const kept = (i, k) => !keep || keep(i, k);
    for (let i = 0; i + 1 < rings.length; i++) {
      const ctr = mul(add(rings[i].c, rings[i + 1].c), 0.5);
      for (let k = 0; k < S; k++) {
        const k2 = (k + 1) % S;
        if (!(kept(i, k) || kept(i, k2) || kept(i + 1, k) || kept(i + 1, k2))) continue;
        const a = pts[i][k], b = pts[i][k2], c = pts[i + 1][k2], d = pts[i + 1][k];
        this.tri([a, b, c], [W[i][k], W[i][k2], W[i + 1][k2]], ctr);
        this.tri([a, c, d], [W[i][k], W[i + 1][k2], W[i + 1][k]], ctr);
      }
    }
    if (capStart) this.cap(pts[0], rings[0], capStart, (k) => kept(0, k));
    if (capEnd) this.cap(pts[pts.length - 1], rings[rings.length - 1], capEnd, (k) => kept(rings.length - 1, k));
  }

  cap(ring, r, apex, kept) {
    const S = ring.length;
    for (let k = 0; k < S; k++) if (kept(k) || kept((k + 1) % S)) this.tri([ring[k], ring[(k + 1) % S], apex], [r.w, r.w, r.w], r.c, apex);
  }

  /** Pyramid: base polygon (on a surface) + apex, outward faces only. */
  spike(base, apex, w) {
    const ctr = mul(base.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / base.length);
    for (let k = 0; k < base.length; k++) this.tri([base[k], base[(k + 1) % base.length], apex], [w, w, w], ctr, apex);
  }

  // Adds a triangle wound so its normal points away from `inside` (or towards `toward`).
  tri(p, w, inside, toward = null) {
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    if (Math.hypot(...n) < 1e-12) return;
    const centroid = mul(add(add(p[0], p[1]), p[2]), 1 / 3);
    const out = toward ? sub(toward, inside) : sub(centroid, inside);
    if (dot(n, out) < 0) { p = [p[0], p[2], p[1]]; w = [w[0], w[2], w[1]]; }
    this.tris.push({ p, w, m: this.mat(centroid, norm(cross(sub(p[1], p[0]), sub(p[2], p[0])))), tag: this.tag });
  }
}
