// Parts kit: a few solid primitives that build the small, real parts of a
// character (soles, belts, buckles, buttons, collar points, hair locks, glasses)
// as skinned triangles in the shared MeshBuilder.
//
// The method follows Anatomy (github.com/wheresryan22/anatomy, MIT): build an
// object from many small purposeful parts made of a handful of primitives, sit
// each part on another, and prove it afterwards. Here the parts are real mesh
// geometry for a rigged GLB instead of isometric SVG.
//
// Every primitive takes `w`: skin weights, either one object for the whole part
// ({Head: 1} = rigid on one bone) or a function of the vertex position (parts
// lying on a bending surface copy the body's weights). Each returns the number
// of triangles it added, so a spec can be held to a budget.
import { add, sub, mul, dot, cross, norm, lerp, clamp, TAU, shapeAt } from './mesh.js';

const weightAt = (w, p) => (typeof w === 'function' ? w(p) : w);

/** An orthonormal frame {o, x, y, z} with z along `axis` and x as close to `xHint` as possible. */
export function frame(o, axis, xHint = [1, 0, 0]) {
  const z = norm(axis);
  let x = sub(xHint, mul(z, dot(xHint, z)));
  if (Math.hypot(...x) < 1e-6) x = Math.abs(z[1]) < 0.9 ? cross([0, 1, 0], z) : cross([1, 0, 0], z);
  x = norm(x);
  return { o, x, y: cross(z, x), z };
}
/** Point in frame coordinates (a, b, c) along x, y, z. */
export const at = (F, a, b, c = 0) => add(F.o, add(mul(F.x, a), add(mul(F.y, b), mul(F.z, c))));

/** Count triangles added by fn(). */
function counted(mb, fn) { const n0 = mb.tris.length; fn(); return mb.tris.length - n0; }

/**
 * Turned part along frame z: profile [[s, r], ...] from one end to the other.
 * A radius of 0 at either end closes it to a point; otherwise the end is capped flat.
 */
export function lathe(mb, F, profile, segs, w) {
  return counted(mb, () => {
    const open = profile.filter(([, r]) => r > 1e-6);
    const rings = open.map(([s, r]) => {
      const c = add(F.o, mul(F.z, s));
      return { c, u: F.x, v: F.y, rx: r, ry: r, w: weightAt(w, c) };
    });
    const first = profile[0], last = profile[profile.length - 1];
    const capA = add(F.o, mul(F.z, first[0] - (first[1] > 1e-6 ? 0 : 0)));
    const capB = add(F.o, mul(F.z, last[0]));
    mb.tube(rings, segs, capA, capB);
  });
}

/**
 * Tube along a path of points with per-point radii (number or [rx, ry]).
 * Frames are carried along the path (no twisting). Ends are capped unless caps = false.
 * opts.up: preferred direction for the ring's v axis (to orient flat tubes, e.g. straps).
 */
export function tube(mb, path, radii, segs, w, opts = {}) {
  return counted(mb, () => {
    const n = path.length;
    const tang = path.map((_, i) => norm(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)])));
    let u = opts.up ? norm(cross(opts.up, tang[0])) : null;
    if (!u || Math.hypot(...u) < 1e-6 || Number.isNaN(u[0])) u = frame(path[0], tang[0]).x;
    const rings = path.map((c, i) => {
      if (i > 0) { // parallel transport of u
        u = sub(u, mul(tang[i], dot(u, tang[i])));
        u = norm(u);
      }
      const v = cross(tang[i], u);
      const r = radii[i] ?? radii[radii.length - 1];
      const [rx, ry] = Array.isArray(r) ? r : [r, r];
      return { c, u, v, rx, ry, w: weightAt(w, c) };
    });
    const caps = opts.caps ?? true;
    const endA = caps ? sub(path[0], mul(tang[0], (opts.capLen ?? 0) )) : null;
    const endB = caps ? add(path[n - 1], mul(tang[n - 1], (opts.capLen ?? 0))) : null;
    mb.tube(rings, segs, endA, endB);
  });
}

/** Closed loop tube (a ring of points), e.g. a glasses rim. */
export function loop(mb, path, r, segs, w) {
  return counted(mb, () => {
    const n = path.length;
    const ctr = mul(path.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / n);
    const pts = path.map((c, i) => {
      const t = norm(sub(path[(i + 1) % n], path[(i - 1 + n) % n]));
      const out = norm(sub(c, ctr));
      const u = norm(sub(out, mul(t, dot(out, t))));
      const v = cross(t, u);
      const ring = [];
      for (let k = 0; k < segs; k++) { const a = (k / segs) * TAU; ring.push(add(c, add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a))))); }
      return { c, ring, w: weightAt(w, c) };
    });
    for (let i = 0; i < n; i++) {
      const A = pts[i], B = pts[(i + 1) % n], mid = mul(add(A.c, B.c), 0.5);
      for (let k = 0; k < segs; k++) {
        const k2 = (k + 1) % segs;
        mb.tri([A.ring[k], A.ring[k2], B.ring[k2]], [A.w, A.w, B.w], mid);
        mb.tri([A.ring[k], B.ring[k2], B.ring[k]], [A.w, B.w, B.w], mid);
      }
    }
  });
}

/** Signed area of a 2-D polygon (positive = counter-clockwise). */
const area2 = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/** Ear-clipping triangulation of a simple 2-D polygon -> index triples. */
function triangulate(poly) {
  const idx = poly.map((_, i) => i);
  if (area2(poly) < 0) idx.reverse();
  const tris = [];
  const isConvex = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-12;
  const inside = (p, a, b, c) => {
    const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (!isConvex(a, b, c)) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(poly[j], a, b, c))) continue;
      tris.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push(idx.slice());
  return tris;
}

/**
 * Extruded outline: a 2-D polygon [[a, b], ...] in the frame's x/y plane, from
 * z = 0 to z = depth (depth may be negative). Concave outlines are fine.
 * opts.taper scales the far face (1 = straight walls).
 */
export function prism(mb, F, poly, depth, w, opts = {}) {
  return counted(mb, () => {
    const k = opts.taper ?? 1;
    const ccw = area2(poly) > 0;
    const c2 = poly.reduce((s, p) => [s[0] + p[0] / poly.length, s[1] + p[1] / poly.length], [0, 0]);
    const near = poly.map(([a, b]) => at(F, a, b, 0));
    const far = poly.map(([a, b]) => at(F, c2[0] + (a - c2[0]) * k, c2[1] + (b - c2[1]) * k, depth));
    const W = (p) => weightAt(w, p);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      // Outward normal of edge i->j in the plane, from the winding.
      const e = [poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]];
      const out2 = ccw ? [e[1], -e[0]] : [-e[1], e[0]];
      const mid = mul(add(add(near[i], near[j]), add(far[i], far[j])), 0.25);
      const toward = add(mid, add(mul(F.x, out2[0]), mul(F.y, out2[1])));
      mb.tri([near[i], near[j], far[j]], [W(near[i]), W(near[j]), W(far[j])], mid, toward);
      mb.tri([near[i], far[j], far[i]], [W(near[i]), W(far[j]), W(far[i])], mid, toward);
    }
    const sgn = depth >= 0 ? 1 : -1;
    for (const [a, b, c] of triangulate(poly)) {
      const mN = mul(add(add(near[a], near[b]), near[c]), 1 / 3), mF = mul(add(add(far[a], far[b]), far[c]), 1 / 3);
      mb.tri([near[a], near[b], near[c]], [W(near[a]), W(near[b]), W(near[c])], mN, add(mN, mul(F.z, -sgn)));
      mb.tri([far[a], far[b], far[c]], [W(far[a]), W(far[b]), W(far[c])], mF, add(mF, mul(F.z, sgn)));
    }
  });
}

/** Box centred on the frame origin with half extents [hx, hy, hz]. */
export function box(mb, F, [hx, hy, hz], w) {
  const G = { ...F, o: at(F, 0, 0, -hz) };
  return prism(mb, G, [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]], 2 * hz, w);
}

/** Low-poly ball (a lathe of a half circle), optionally squashed: r = [rx, ry, rz]. */
export function ball(mb, F, r, segs = 6, rows = 3, w) {
  const [rx, ry, rz] = Array.isArray(r) ? r : [r, r, r];
  return counted(mb, () => {
    const rings = [];
    for (let i = 1; i < rows; i++) {
      const a = -Math.PI / 2 + (i / rows) * Math.PI;
      const c = at(F, 0, 0, rz * Math.sin(a));
      rings.push({ c, u: F.x, v: F.y, rx: rx * Math.cos(a), ry: ry * Math.cos(a), w: weightAt(w, c) });
    }
    mb.tube(rings, segs, at(F, 0, 0, -rz), at(F, 0, 0, rz));
  });
}

// ---------------------------------------------------------------------------
// Body surfaces: the builder registers its ring stacks; parts query points on
// them (position, outward normal, skin weights) so they sit on the body.

const ringPoint = (r, t) => {
  const f = r.f ? r.f(t) : r.shape ? shapeAt(r.shape, t) : 1;
  return add(r.c, add(mul(r.u, r.rx * f * Math.cos(t)), mul(r.v, r.ry * f * Math.sin(t))));
};
const ringW = (r, t) => (r.wf ? r.wf(t) : r.w);
const mixW = (a, b, k) => {
  const out = {};
  for (const [n, x] of Object.entries(a)) out[n] = (out[n] || 0) + x * (1 - k);
  for (const [n, x] of Object.entries(b)) out[n] = (out[n] || 0) + x * k;
  return out;
};

/**
 * A surface over a stack of rings. s in [0, 1] runs from the first ring to the
 * last (by arc length of the ring centres); t is the ring angle (t = PI/2 is the
 * ring's +v side, the front for body rings).
 */
export function surface(rings) {
  const L = [0];
  for (let i = 1; i < rings.length; i++) L.push(L[i - 1] + Math.hypot(...sub(rings[i].c, rings[i - 1].c)));
  const total = L[L.length - 1] || 1;
  const seg = (s) => {
    const d = clamp(s, 0, 1) * total;
    let i = 0;
    while (i + 2 < rings.length && L[i + 1] < d) i++;
    const k = clamp((d - L[i]) / ((L[i + 1] - L[i]) || 1), 0, 1);
    return [i, k];
  };
  const point = (s, t) => { const [i, k] = seg(s); const a = ringPoint(rings[i], t), b = ringPoint(rings[i + 1], t); return add(a, mul(sub(b, a), k)); };
  const centre = (s) => { const [i, k] = seg(s); return add(rings[i].c, mul(sub(rings[i + 1].c, rings[i].c), k)); };
  const weights = (s, t) => { const [i, k] = seg(s); return mixW(ringW(rings[i], t), ringW(rings[i + 1], t), k); };
  const normal = (s, t) => {
    const e = 1e-3, p = point(s, t);
    let n = cross(sub(point(s, t + e), point(s, t - e)), sub(point(s + e, t), point(s - e, t)));
    if (dot(n, sub(p, centre(s))) < 0) n = mul(n, -1);
    return norm(n);
  };
  /** s at a given height y (rings must run upwards or downwards monotonically in y). */
  const sAtY = (y) => {
    let lo = 0, hi = 1;
    const up = centre(1)[1] > centre(0)[1];
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if ((centre(m)[1] < y) === up) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  /** The ring itself at s (for parts that wrap the body: belts, bands). */
  const ring = (s) => {
    const [i, k] = seg(s), a = rings[i], b = rings[i + 1];
    return {
      c: add(a.c, mul(sub(b.c, a.c), k)), u: a.u, v: a.v, rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k),
      f: (t) => lerp(a.f ? a.f(t) : a.shape ? shapeAt(a.shape, t) : 1, b.f ? b.f(t) : b.shape ? shapeAt(b.shape, t) : 1, k),
      wf: (t) => mixW(ringW(a, t), ringW(b, t), k),
    };
  };
  return { rings, point, normal, weights, centre, sAtY, ring, length: total };
}
