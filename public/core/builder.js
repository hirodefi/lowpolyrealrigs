// Builder: body spec + human template -> skeleton + flat-shaded low-poly skinned mesh.
//
// Shape comes from an averaged human template (template.js, measured from real
// low-poly character references): sloped shoulders, chest/waist/hip curve, neck,
// skull, mitten hands and feet, as stacks of cross-section rings. The photos
// decide size, proportions (per-ring width/depth factors), pose (arm angle),
// clothing extents and colours. Every ring knows its bone(s), so skin weights
// are exact and blend smoothly across joints. Every triangle belongs to one
// region material (Skin, Hair, Top, Bottom, Shoes) with one flat colour each.

import { TEMPLATE, BINS } from './template.js';

export const MATERIALS = ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes'];

/** Body-shape presets: multipliers over the measured widths. */
export const PRESETS = {
  measured: {},
  slim: { width: 0.88, limb: 0.85 },
  average: {},
  broad: { width: 1.14, limb: 1.2 },
};

// Ring segment counts per part. Template rings have BINS samples; we resample.
const DETAIL = {
  low: { torso: 10, head: 10, limb: 6, foot: 6 },
  medium: { torso: 12, head: 14, limb: 8, foot: 8 },
  high: { torso: 16, head: 20, limb: 10, foot: 10 },
};

export const BONES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
];
const PARENT = {
  Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
  LeftShoulder: 'Chest', LeftUpperArm: 'LeftShoulder', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm',
  RightShoulder: 'Chest', RightUpperArm: 'RightShoulder', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm',
  LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg', LeftToes: 'LeftFoot',
  RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg', RightToes: 'RightFoot',
};
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

// ---------- small helpers ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const TAU = Math.PI * 2;

/** Periodic interpolation of a BINS-sample ring shape at parametric angle t. */
function shapeAt(shape, t) {
  const x = (((t / TAU) * BINS) % BINS + BINS) % BINS;
  const i = Math.floor(x), f = x - i;
  return lerp(shape[i % BINS], shape[(i + 1) % BINS], f);
}
/** Shape mirrored across the v axis (left limb -> right limb). */
const mirrorShape = (shape) => shape.map((_, k) => shape[(BINS / 2 - k + BINS) % BINS]);

/** Template stations with gaps filled, plus interpolation at any u. */
function stations(list) {
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
function weightsAlong(s, segs, blend) {
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
const smooth = (arr, a, b) => arr.map((v, i) => clamp(0.25 * (arr[i - 1] ?? v) + 0.5 * v + 0.25 * (arr[i + 1] ?? v), a, b));
/** Linear lookup in a factor list sampled evenly over [0, 1]. */
const lookup = (arr, u) => { const n = arr.length - 1, x = clamp(u, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)); return lerp(arr[i], arr[i + 1], x - i); };
/** Bisection inverse of a monotonic increasing function on [0, 1]. */
const invert = (fn, y) => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (fn(m) < y) lo = m; else hi = m; } return (lo + hi) / 2; };

class MeshBuilder {
  constructor() { this.tris = []; this.mat = () => 'Skin'; }

  /**
   * rings: [{c, u, v, rx, ry, shape?, f?(t), w}] ; S segments ; caps: apex points (or null).
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
    const kept = (i, k) => !keep || keep(i, k);
    for (let i = 0; i + 1 < rings.length; i++) {
      const ctr = mul(add(rings[i].c, rings[i + 1].c), 0.5);
      for (let k = 0; k < S; k++) {
        const k2 = (k + 1) % S;
        if (!(kept(i, k) || kept(i, k2) || kept(i + 1, k) || kept(i + 1, k2))) continue;
        const a = pts[i][k], b = pts[i][k2], c = pts[i + 1][k2], d = pts[i + 1][k];
        const wa = rings[i].w, wb = rings[i + 1].w;
        this.tri([a, b, c], [wa, wa, wb], ctr);
        this.tri([a, c, d], [wa, wb, wb], ctr);
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
    this.tris.push({ p, w, m: this.mat(centroid, norm(cross(sub(p[1], p[0]), sub(p[2], p[0])))) });
  }
}

/** Pick a template body type from the photo proportions. */
export function pickBodyType(spec) {
  const H = spec.height;
  if (spec.detected?.neck && (H - spec.neckY) / H > 0.195) return 'child';
  // Hip width relative to shoulder width: women's templates carry wider hips.
  const hip = spec.torsoAt(spec.crotchY + 0.04 * H).hx, sh = spec.shoulderX / 0.82;
  return hip / sh > 0.86 ? 'female' : 'male';
}

/**
 * @param spec body spec from measureBody
 * @param {{detail?:'low'|'medium'|'high', body?:'auto'|'male'|'female'|'child', preset?:string}} opts
 */
export function buildCharacter(spec, opts = {}) {
  const D = DETAIL[opts.detail ?? 'medium'];
  const H = spec.height;
  const bodyType = !opts.body || opts.body === 'auto' ? pickBodyType(spec) : opts.body;
  const T = TEMPLATE[bodyType];
  const L = T.land;
  const P = PRESETS[opts.preset] || {};
  const look = spec.look;
  const mb = new MeshBuilder();

  // ---------- vertical mapping: template height fraction -> metres ----------
  // Photo landmarks win where they were clearly detected (within sane limits).
  const neckMidT = (L.neck + L.head) / 2; // narrowest point of the neck
  const crotchP = spec.detected?.crotch ? clamp(spec.crotchY / H, L.crotch - 0.06, L.crotch + 0.06) : L.crotch;
  const neckP = spec.detected?.neck ? clamp(spec.neckY / H, neckMidT - 0.04, neckMidT + 0.04) : neckMidT;
  const KEYS = [[0, 0], [L.crotch, crotchP], [neckMidT, neckP], [1, 1]];
  const Y = (yt) => {
    for (let i = 0; i + 1 < KEYS.length; i++) if (yt <= KEYS[i + 1][0]) return H * lerp(KEYS[i][1], KEYS[i + 1][1], (yt - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]));
    return H * yt;
  };

  // ---------- photo width/depth factors per template station ----------
  const torsoS = stations(T.torso), headS = stations(T.head), legS = stations(T.leg), armS = stations(T.arm), footS = stations(T.foot);
  const hasSide = !spec.notes.some((n) => n.startsWith('no side view'));
  const torsoY = (u) => lerp(L.crotch, L.neck, u);
  const TU = Array.from({ length: 15 }, (_, i) => i / 14);
  const shFactor = clamp(spec.shoulderX / (0.82 * L.shoulder[0] * H), 0.8, 1.3);
  const torsoW = smooth(TU.map((u) => {
    const yt = torsoY(u);
    if (yt > L.armpit - 0.02) return shFactor; // photo widths near the shoulders include the arms
    return spec.torsoAt(Y(yt)).hx / (torsoS(u).hw * H);
  }), 0.75, 1.35).map((f) => f * (P.width ?? 1));
  const torsoD = smooth(TU.map((u) => {
    if (!hasSide) return 1;
    const t = spec.torsoAt(Y(torsoY(u)));
    return (t.zf - t.zb) / 2 / (torsoS(u).hd * H);
  }), 0.75, 1.35).map((f) => f * (P.width ?? 1));

  const legY = (u) => lerp(L.crotch, L.ankle[1], u);
  const LU = Array.from({ length: 13 }, (_, i) => i / 12);
  const legW = smooth(LU.map((u) => spec.legAtY(Y(legY(u))).hx / (legS(u).hw * H)), 0.75, 1.35).map((f) => f * (P.limb ?? 1));
  const legD = smooth(LU.map((u) => {
    if (!hasSide) return 1;
    const l = spec.legAtY(Y(legY(u)));
    return (l.zf - l.zb) / 2 / (legS(u).hd * H);
  }), 0.75, 1.35).map((f) => f * (P.limb ?? 1));
  const hipW = lookup(torsoW, (L.hip - L.crotch) / (L.neck - L.crotch));

  // Head: one width factor from the widest part, one depth factor from the side.
  let headMaxT = 0, headMaxP = 0, headDT = 0, headDP = 0;
  for (let u = 0.3; u <= 0.8; u += 0.05) {
    const s = headS(u), h = spec.headAt(Y(lerp(L.neck, 1, u)));
    headMaxT = Math.max(headMaxT, s.hw * H); headMaxP = Math.max(headMaxP, h.hx);
    headDT = Math.max(headDT, s.hd * H); headDP = Math.max(headDP, (h.zf - h.zb) / 2);
  }
  const fh = clamp(headMaxP / headMaxT, 0.85, 1.2);
  const fhd = hasSide ? clamp(headDP / headDT, 0.85, 1.2) : fh;

  // Arms: thickness from the front view, length and angle from the pose.
  const armLenT = (L.fingertip - L.shoulder[0]) * H;
  const A = spec.arm;
  const fa = clamp(((A.upper / 2) / (armS(0.25).hw * H) + (A.fore / 2) / (armS(0.6).hw * H)) / 2, 0.75, 1.35) * (P.limb ?? 1);
  const armLen = armLenT * (spec.detected?.arms ? clamp(A.length / armLenT, 0.88, 1.12) : 1);
  const angle = clamp(A.angle, 0, 80 * Math.PI / 180);
  const elbowU = (L.elbow[0] - L.shoulder[0]) / (L.fingertip - L.shoulder[0]);
  const wristU = (L.wrist[0] - L.shoulder[0]) / (L.fingertip - L.shoulder[0]);
  const kneeU = (L.crotch - L.knee[1]) / (L.crotch - L.ankle[1]);

  // ---------- skeleton (world positions, identity bind rotations) ----------
  const tuOf = (yt) => (yt - L.crotch) / (L.neck - L.crotch);
  const pos = {};
  const hipYm = Y(L.hip);
  pos.Hips = [0, hipYm, L.hipJoint[2] * H];
  const spineT = lerp(L.hip, L.chest, 0.45);
  pos.Spine = [0, Y(spineT), torsoS(tuOf(spineT)).cz * H];
  pos.Chest = [0, Y(L.chest), torsoS(tuOf(L.chest)).cz * H];
  pos.Neck = [0, Y(L.neck), torsoS(1).cz * H];
  pos.Head = [0, Y(L.head), headS((L.head - L.neck) / (1 - L.neck)).cz * H];
  const shX = L.shoulder[0] * H * shFactor * (P.width ?? 1);
  const arms = {};
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    const sh = [s * shX, Y(L.shoulder[1]), L.shoulder[2] * H];
    const dir = [s * Math.cos(angle), -Math.sin(angle), 0];
    const uA = [s * Math.sin(angle), Math.cos(angle), 0]; // the arm's "up" (T-pose +Y); v = +Z
    arms[side] = { sh, dir, uA };
    pos[side + 'Shoulder'] = [s * shX * 0.22, sh[1] + 0.006 * H, sh[2]];
    pos[side + 'UpperArm'] = sh;
    pos[side + 'LowerArm'] = add(sh, mul(dir, armLen * elbowU));
    pos[side + 'Hand'] = add(sh, mul(dir, armLen * wristU));

    const legX = (u) => s * legS(u).cx * H * hipW;
    pos[side + 'UpperLeg'] = [s * L.hipJoint[0] * H * hipW, hipYm, L.hipJoint[2] * H];
    pos[side + 'LowerLeg'] = [legX(kneeU), Y(L.knee[1]), L.knee[2] * H];
    pos[side + 'Foot'] = [legX(1), Y(L.ankle[1]), L.ankle[2] * H];
    pos[side + 'Toes'] = [legX(1), Y(0.012), L.ball * H];
  }

  // Clothing ring scales: a little looser than skin, with a lip at each edge.
  const LOOSE = 1.035, LIP = 1.07, EPS = 0.004 * H;

  // ---------- torso (Top over Bottom with a hem lip) ----------
  {
    const hemY = look.hemY;
    const rings = [];
    // Above the shoulder joint the T-posed reference continues into the arm, so
    // taper the rings along a trapezius slope from the shoulder to the neck.
    const slope0 = arms.Left.sh[1] - 0.03 * H, slope1 = pos.Neck[1] + 0.012 * H;
    const u0 = invert((u) => Y(torsoY(u)), slope0);
    const neckS = headS(0);
    const neckRx = neckS.hw * H * fh * 1.35, neckRy = neckS.hd * H * fhd * 1.2;
    const pushRing = (u, scale, y = Y(torsoY(u))) => {
      const s = torsoS(u);
      const w = weightsAlong(y, [['Hips', pos.Spine[1] - 0.01 * H], ['Spine', pos.Chest[1]], ['Chest', pos.Neck[1] - 0.012 * H], ['Neck', Infinity]], 0.03 * H);
      const sc = scale ?? (y > hemY ? LOOSE : 1);
      let rx = s.hw * H * lookup(torsoW, u), ry = s.hd * H * lookup(torsoD, u), shape = s.shape;
      if (y > slope0) {
        const base = torsoS(u0), t = clamp((y - slope0) / (slope1 - slope0), 0, 1);
        const bx = base.hw * H * lookup(torsoW, u0), by = base.hd * H * lookup(torsoD, u0);
        const e = Math.sqrt(t); // convex: shoulders fall away quickly from the neck
        rx = lerp(bx, neckRx, e); ry = lerp(by, neckRy, t);
        shape = base.shape.map((v, k) => lerp(v, 1, t));
      }
      rings.push({ c: [0, y, s.cz * H], u: [1, 0, 0], v: [0, 0, 1], rx: rx * sc, ry: ry * sc, shape, w });
    };
    const yOfU = (u) => Y(torsoY(u));
    const hemU = invert(yOfU, hemY), hemLowU = invert(yOfU, hemY - EPS);
    let hemDone = hemY <= yOfU(0) || hemY >= yOfU(1);
    for (const u of TU) {
      if (!hemDone && u > hemU) {
        pushRing(hemLowU, 1, hemY - EPS); // underside of the hem
        pushRing(hemU, LIP, hemY);        // the hem lip itself
        hemDone = true;
      }
      pushRing(u);
    }
    mb.mat = (c) => (c[1] >= hemY - EPS * 0.5 ? 'Top' : 'Bottom');
    mb.tube(rings, D.torso, add(rings[0].c, [0, -0.012 * H, 0]), add(rings[rings.length - 1].c, [0, 0.004 * H, 0]));
  }

  // ---------- neck + head (Skin) ----------
  const headYofU = (u) => Y(lerp(L.neck, 1, u));
  const HU = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.87, 0.93, 0.975];
  const headRing = (u, scale = 1) => {
    const s = headS(u), y = headYofU(u);
    return {
      c: [0, y, s.cz * H], u: [1, 0, 0], v: [0, 0, 1], rx: s.hw * H * fh * scale, ry: s.hd * H * fhd * scale, shape: s.shape,
      w: weightsAlong(y, [['Neck', pos.Head[1]], ['Head', Infinity]], 0.01 * H),
    };
  };
  const headTop = [0, Y(1), headS(0.985).cz * H];
  {
    const rings = [headRing(0, 0.95)];
    rings[0].c = add(rings[0].c, [0, -0.025 * H, 0]); // sink the neck into the collar
    for (const u of HU) rings.push(headRing(u));
    mb.mat = () => 'Skin';
    mb.tube(rings, D.head, null, headTop);
  }

  // Face details: a nose wedge and two small ears.
  {
    const W = { Head: 1 };
    const nu = invert(headYofU, Y(lerp(L.head, 1, 0.3)));
    const s = headS(nu), y = headYofU(nu);
    const zf = s.cz * H + s.hd * H * fhd * shapeAt(s.shape, Math.PI / 2);
    const nw = 0.011 * H, nh = 0.03 * H, np = 0.016 * H;
    mb.mat = () => 'Skin';
    mb.spike([[-nw, y - nh * 0.35, zf - 0.006 * H], [0, y + nh * 0.65, zf - 0.004 * H], [nw, y - nh * 0.35, zf - 0.006 * H]], [0, y - nh * 0.25, zf + np], W);
    const eu = invert(headYofU, Y(lerp(L.head, 1, 0.32)));
    const es = headS(eu), ey = headYofU(eu);
    for (const sx of [1, -1]) {
      const xs = sx * es.hw * H * fh * shapeAt(es.shape, 0) * 0.96, zc = es.cz * H - es.hd * H * 0.12;
      mb.spike([[xs, ey + 0.022 * H, zc + 0.006 * H], [xs, ey + 0.016 * H, zc - 0.012 * H], [xs, ey - 0.018 * H, zc - 0.004 * H], [xs, ey - 0.014 * H, zc + 0.008 * H]],
        [xs + sx * 0.008 * H, ey + 0.004 * H, zc - 0.004 * H], W);
    }
  }

  // ---------- hair shell ----------
  if (look.hasHair) {
    // Never let the fringe fall below the brow line, nor the back above the ears.
    const hairlineY = Math.max(look.hairlineY, Y(lerp(L.head, 1, 0.62)));
    const hairBackY = Math.min(look.hairBackY, Y(lerp(L.head, 1, 0.35)));
    const sideHairY = lerp(hairlineY, hairBackY, 0.5);
    const isHair = (y, t) => { const sn = Math.sin(t); return y > (sn > 0.35 ? hairlineY : sn < -0.3 ? hairBackY : sideHairY); };
    const lowest = Math.max(Math.min(hairlineY, sideHairY, hairBackY), pos.Neck[1]);
    const rings = [];
    for (const u of HU) {
      if (headYofU(u) < lowest - 0.02 * H) continue;
      const r = headRing(u), y = r.c[1];
      r.f = (t) => shapeAt(r.shape, t) * (isHair(y, t) ? 1.075 : 0.94);
      rings.push(r);
    }
    if (rings.length >= 2) {
      const S = D.head;
      const tk = (k) => (k / S) * TAU + Math.PI / S;
      mb.mat = () => 'Hair';
      mb.tube(rings, S, null, add(headTop, [0, 0.014 * H, 0]), (i, k) => isHair(rings[i].c[1], tk(k)));
    }
  }

  // ---------- arms (sleeve with cuff, mitten hand) ----------
  for (const side of ['Left', 'Right']) {
    const { sh, dir, uA } = arms[side];
    const sleeveEnd = Math.min(look.sleeveT, 1) * wristU; // fraction of the full arm length
    const segs = [[side + 'Shoulder', 0.02], [side + 'UpperArm', elbowU], [side + 'LowerArm', wristU], [side + 'Hand', Infinity]];
    const AU = [...new Set([-0.06, 0.06, 0.13, 0.2, 0.27, 0.34, elbowU - 0.04, elbowU, elbowU + 0.05, 0.58, 0.66, 0.74, wristU - 0.03, wristU, wristU + 0.03, 0.87, 0.93])].sort((a, b) => a - b);
    const rings = [];
    // Near the joint the T-pose slice also cuts the torso side: cap the root
    // rings at the deltoid size so the shoulder stays round.
    const delt = armS(0.2);
    const ring = (u, scale) => {
      let s = armS(clamp(u, 0.06, 0.985));
      if (u < 0.2) {
        const t = clamp(u / 0.2, 0, 1);
        s = { ...s, cx: lerp(delt.cx, s.cx, t), hw: Math.min(s.hw, delt.hw * lerp(1.03, 1, t)), hd: Math.min(s.hd, delt.hd * lerp(1.03, 1, t)), shape: delt.shape };
      }
      const f = u > wristU ? Math.sqrt(fa) : fa;
      const c = add(add(sh, mul(dir, armLen * u)), mul(uA, (s.cx - L.shoulder[1]) * H));
      rings.push({ c: add(c, [0, 0, (s.cz - L.shoulder[2]) * H]), u: uA, v: [0, 0, 1], rx: s.hw * H * f * scale, ry: s.hd * H * f * scale, shape: s.shape, w: weightsAlong(u, segs, 0.035) });
    };
    let cuffDone = sleeveEnd >= 0.985;
    for (const u of AU) {
      if (!cuffDone && u > sleeveEnd) { ring(sleeveEnd, LIP); ring(sleeveEnd + 0.006, 1); cuffDone = true; }
      // The root ring is buried in the torso: keep it small so it can't poke out.
      ring(u, u < 0 ? 0.72 : u <= sleeveEnd ? LOOSE : 1);
    }
    mb.mat = (c) => (dot(sub(c, sh), dir) / armLen <= sleeveEnd + 0.003 ? 'Top' : 'Skin');
    mb.tube(rings, D.limb, add(sh, mul(dir, -armLen * 0.075)), add(sh, mul(dir, armLen * 0.985))); // rounded mitten tip
  }

  // ---------- legs (trousers with hem) + feet (shoes) ----------
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    const trouserEnd = look.trouserT >= 1 ? 2 : look.trouserT; // leg u (crotch -> ankle); 2 = full length
    const LUx = [...new Set([-0.12, ...LU.slice(0, -1), kneeU - 0.03, kneeU, kneeU + 0.04, 0.97, 1])].sort((a, b) => a - b);
    const rings = [];
    const ring = (u, scale) => {
      const st = legS(clamp(u, 0, 1));
      const y = Y(legY(u));
      const w = weightsAlong(-y, [['Hips', -hipYm + 0.02 * H], [side + 'UpperLeg', -pos[side + 'LowerLeg'][1]], [side + 'LowerLeg', -pos[side + 'Foot'][1] + 0.01 * H], [side + 'Foot', Infinity]], 0.03 * H);
      const sc = u < 0 ? 0.9 : scale;
      rings.push({
        c: [s * st.cx * H * hipW, y, st.cz * H], u: [1, 0, 0], v: [0, 0, 1],
        rx: st.hw * H * lookup(legW, u) * sc, ry: st.hd * H * lookup(legD, u) * sc, shape: s > 0 ? st.shape : mirrorShape(st.shape), w,
      });
    };
    let hemDone = trouserEnd > 1;
    for (const u of LUx) {
      if (!hemDone && u > trouserEnd) { ring(trouserEnd, LIP); ring(trouserEnd + 0.008, 1); hemDone = true; }
      ring(u, u <= trouserEnd ? LOOSE : 1);
    }
    const endY = trouserEnd > 1 ? -Infinity : Y(legY(trouserEnd));
    mb.mat = (c) => (c[1] >= endY - 0.002 * H ? 'Bottom' : 'Skin');
    mb.tube(rings, D.limb, null, add(rings[rings.length - 1].c, [0, -0.008 * H, 0]));

    // Shoe: template foot sections from heel to toe (x/y rings along +Z).
    const footLen = (L.toeZ - L.heelZ) * H;
    const ballZ = pos[side + 'Toes'][2];
    const yScale = Y(L.ankle[1]) / (L.ankle[1] * H); // feet follow the leg's vertical scale
    const frings = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.82, 0.92, 1].map((u) => {
      const uu = lerp(0.02, 0.98, u);
      const st = footS(uu);
      const z = L.heelZ * H + footLen * uu;
      return {
        c: [s * st.cx * H * hipW, st.cz * H * yScale, z], u: [1, 0, 0], v: [0, 1, 0],
        rx: st.hw * H * 1.04, ry: st.hd * H * yScale * 1.04, shape: s > 0 ? st.shape : mirrorShape(st.shape),
        w: weightsAlong(z, [[side + 'Foot', ballZ], [side + 'Toes', Infinity]], 0.012 * H),
      };
    });
    mb.mat = () => 'Shoes';
    mb.tube(frings, D.foot, add(frings[0].c, [0, 0, -0.006 * H]), add(frings[frings.length - 1].c, [0, -0.004 * H, 0.008 * H]));
  }

  // ---------- normalise: feet on y = 0, total height exactly H ----------
  let minY = Infinity, maxY = -Infinity;
  for (const t of mb.tris) for (const p of t.p) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const k = H / (maxY - minY);
  const fix = (p) => [p[0] * k, (p[1] - minY) * k, p[2] * k];
  for (const t of mb.tris) t.p = t.p.map(fix);
  for (const b in pos) pos[b] = fix(pos[b]);

  // ---------- flatten to vertex streams, grouped by material ----------
  const order = MATERIALS.flatMap((m) => mb.tris.filter((t) => t.m === m));
  const N = order.length;
  const position = new Float32Array(N * 9), normal = new Float32Array(N * 9);
  const joints = new Uint8Array(N * 12), weights = new Float32Array(N * 12);
  order.forEach(({ p, w }, f) => {
    const n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    for (let j = 0; j < 3; j++) {
      const vi = f * 3 + j;
      position.set(p[j], vi * 3); normal.set(n, vi * 3);
      const ents = Object.entries(w[j]).filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = ents.reduce((a, [, x]) => a + x, 0);
      ents.forEach(([b, x], q) => { joints[vi * 4 + q] = BI[b]; weights[vi * 4 + q] = x / sum; });
    }
  });
  const groups = [];
  let start = 0;
  for (const m of MATERIALS) {
    const count = mb.tris.filter((t) => t.m === m).length;
    if (count) groups.push({ material: m, color: look[m.toLowerCase()], start, count });
    start += count;
  }

  const bones = BONES.map((name) => ({ name, parent: PARENT[name] ? BI[PARENT[name]] : -1, pos: pos[name] }));
  return { bones, bodyType, mesh: { position, normal, joints, weights, triangles: N, groups }, spec };
}
