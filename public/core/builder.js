// Builder: body spec -> skeleton + flat-shaded low-poly skinned mesh.
//
// The body is a handful of lofted "tubes" (stacked elliptical rings): torso,
// neck+head, two arms, two legs, two feet. Every ring knows which bone(s) it
// belongs to, so skin weights are exact and cheap: one ring = one weight set,
// blended across joints for smooth bending. Every triangle belongs to one body
// region material (Skin, Hair, Top, Bottom, Shoes) with one flat colour each,
// so crowd tools can re-dress the character per person.

export const MATERIALS = ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes'];

const DETAIL = {
  low: { torso: 8, head: 8, limb: 6, foot: 5 },
  medium: { torso: 12, head: 10, limb: 8, foot: 6 },
  high: { torso: 16, head: 14, limb: 10, foot: 8 },
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

// ---------- small vector helpers ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Weights along a 1-D parameter. segs = [[bone, endParam], ..., [bone, Infinity]].
 * Within +-blend of each boundary the two bones are linearly mixed.
 */
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

class MeshBuilder {
  constructor() { this.tris = []; this.mat = () => 'Skin'; } // {p:[a,b,c], w:[wa,wb,wc], m}

  /**
   * rings: [{c, u, v, rx, ry, w}] ; S segments ; caps: apex points (or null).
   */
  tube(rings, S, capStart, capEnd) {
    const pts = rings.map((r) => {
      const out = [];
      for (let k = 0; k < S; k++) {
        const t = (k / S) * Math.PI * 2 + Math.PI / S;
        out.push(add(r.c, add(mul(r.u, r.rx * Math.cos(t)), mul(r.v, r.ry * Math.sin(t)))));
      }
      return out;
    });
    for (let i = 0; i + 1 < rings.length; i++) {
      const ctr = mul(add(rings[i].c, rings[i + 1].c), 0.5);
      for (let k = 0; k < S; k++) {
        const k2 = (k + 1) % S;
        const a = pts[i][k], b = pts[i][k2], c = pts[i + 1][k2], d = pts[i + 1][k];
        const wa = rings[i].w, wb = rings[i + 1].w;
        this.tri([a, b, c], [wa, wa, wb], ctr);
        this.tri([a, c, d], [wa, wb, wb], ctr);
      }
    }
    if (capStart) this.cap(pts[0], rings[0], capStart);
    if (capEnd) this.cap(pts[pts.length - 1], rings[rings.length - 1], capEnd);
  }

  cap(ring, r, apex) {
    const S = ring.length;
    for (let k = 0; k < S; k++) this.tri([ring[k], ring[(k + 1) % S], apex], [r.w, r.w, r.w], r.c, true);
  }

  // Adds a triangle wound so its normal points away from `inside`.
  tri(p, w, inside, isCap = false) {
    const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    if (Math.hypot(...n) < 1e-10) return;
    const centroid = mul(add(add(p[0], p[1]), p[2]), 1 / 3);
    let out = sub(centroid, inside);
    if (isCap) out = sub(p[2], inside); // apex direction
    if (dot(n, out) < 0) { p = [p[0], p[2], p[1]]; w = [w[0], w[2], w[1]]; }
    this.tris.push({ p, w, m: this.mat(centroid, norm(cross(sub(p[1], p[0]), sub(p[2], p[0])))) });
  }
}

/** Ring frame for a tube running along direction d. */
function frame(d) {
  d = norm(d);
  if (Math.abs(d[2]) > 0.9) return { u: [1, 0, 0], v: [0, 1, 0] };
  const u = norm(cross([0, 0, 1], d));
  return { u, v: [0, 0, 1] };
}

/**
 * @param spec body spec from measureBody
 * @param {{detail?:'low'|'medium'|'high'}} opts
 */
export function buildCharacter(spec, opts = {}) {
  const D = DETAIL[opts.detail ?? 'medium'];
  const H = spec.height;
  const mb = new MeshBuilder();
  const zmid = (y) => { const t = spec.torsoAt(y); return (t.zf + t.zb) / 2; };
  const look = spec.look;

  // ---------- skeleton (world positions, identity bind rotations) ----------
  const pos = {};
  const shoulderTopY = spec.shoulderY + 0.025 * H;
  pos.Hips = [0, spec.hipY, zmid(spec.hipY)];
  pos.Spine = [0, spec.waistY, zmid(spec.waistY)];
  pos.Chest = [0, spec.chestY, zmid(spec.chestY)];
  pos.Neck = [0, shoulderTopY, zmid(spec.shoulderY)];
  const headMid = spec.headAt(spec.neckY + 0.04 * H);
  pos.Head = [0, spec.neckY, (headMid.zf + headMid.zb) / 2 * 0.5 + pos.Neck[2] * 0.5];

  const A = spec.arm;
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    const sh = [s * spec.shoulderX, spec.shoulderY, zmid(spec.shoulderY)];
    const dir = [s * Math.cos(A.angle), -Math.sin(A.angle), 0];
    pos[side + 'Shoulder'] = [s * spec.shoulderX * 0.2, spec.shoulderY + 0.01 * H, sh[2]];
    pos[side + 'UpperArm'] = sh;
    pos[side + 'LowerArm'] = add(sh, mul(dir, A.length * 0.44));
    pos[side + 'Hand'] = add(sh, mul(dir, A.length * 0.8));

    const legX = (y) => s * Math.min(Math.max(spec.legAtY(y).off, spec.hipX * 0.6), spec.hipX * 1.3);
    const legZ = (y) => { const l = spec.legAtY(y); return (l.zf + l.zb) / 2; };
    pos[side + 'UpperLeg'] = [s * spec.hipX, spec.hipY, legZ(spec.crotchY - 0.02 * H)];
    pos[side + 'LowerLeg'] = [legX(spec.kneeY), spec.kneeY, legZ(spec.kneeY)];
    pos[side + 'Foot'] = [legX(spec.ankleY + 0.02 * H), spec.ankleY, legZ(spec.ankleY + 0.02 * H)];
    pos[side + 'Toes'] = [legX(spec.ankleY + 0.02 * H), 0.012 * H, spec.foot.heelZ + (spec.foot.toeZ - spec.foot.heelZ) * 0.72];
  }

  // ---------- torso ----------
  {
    const y0 = spec.crotchY - 0.015 * H, y1 = shoulderTopY + 0.012 * H;
    const N = 12, rings = [];
    for (let i = 0; i <= N; i++) {
      const y = lerp(y0, y1, Math.pow(i / N, 0.9));
      const t = spec.torsoAt(y);
      const w = weightsAlong(y, [['Hips', spec.waistY - 0.02 * H], ['Spine', spec.chestY], ['Chest', shoulderTopY], ['Neck', Infinity]], 0.035 * H);
      rings.push({ c: [0, y, (t.zf + t.zb) / 2], u: [1, 0, 0], v: [0, 0, 1], rx: t.hx, ry: (t.zf - t.zb) / 2, w });
    }
    mb.mat = (c) => (c[1] > look.hemY ? 'Top' : 'Bottom');
    mb.tube(rings, D.torso, add(rings[0].c, [0, -0.02 * H, 0]), add(rings[N].c, [0, 0.005 * H, 0]));
  }

  // ---------- neck + head ----------
  {
    const rings = [];
    const ys = [spec.shoulderY, shoulderTopY - 0.005 * H];
    const headTop = H;
    for (const f of [0, 0.12, 0.3, 0.5, 0.68, 0.83, 0.94]) ys.push(lerp(spec.neckY, headTop, f));
    for (const y of ys) {
      const h = spec.headAt(y);
      const isNeck = y < spec.neckY;
      // The front view gives exact head width; keep neck round-ish.
      const ry = isNeck ? Math.max(h.hx, (h.zf - h.zb) / 2 * 0.6) : (h.zf - h.zb) / 2;
      const cz = isNeck ? pos.Neck[2] * 0.5 + pos.Head[2] * 0.5 : (h.zf + h.zb) / 2;
      const w = weightsAlong(y, [['Neck', spec.neckY], ['Head', Infinity]], 0.012 * H);
      rings.push({ c: [0, y, cz], u: [1, 0, 0], v: [0, 0, 1], rx: Math.max(h.hx, 0.01 * H), ry: Math.max(ry, 0.01 * H), w });
    }
    const top = rings[rings.length - 1];
    // Hair: above the hairline on the face, lower down on the sides and back.
    const sideHairY = lerp(look.hairlineY, look.hairBackY, 0.5);
    mb.mat = (c, n) => {
      if (c[1] < spec.neckY || !look.hasHair) return 'Skin';
      const lim = n[2] > 0.35 ? look.hairlineY : n[2] > -0.2 ? sideHairY : look.hairBackY;
      return c[1] > lim ? 'Hair' : 'Skin';
    };
    mb.tube(rings, D.head, null, [top.c[0], headTop, top.c[2]]);
  }

  // ---------- arms ----------
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    const sh = pos[side + 'UpperArm'];
    const dir = norm(sub(pos[side + 'Hand'], sh));
    const { u, v } = frame(dir);
    const L = A.length;
    const prof = [
      [-0.06, A.upper * 0.6], [0.05, A.upper * 0.55], [0.22, A.upper * 0.5], [0.44, (A.upper + A.fore) * 0.24],
      [0.6, A.fore * 0.48], [0.78, A.fore * 0.36], [0.86, A.hand * 0.45], [0.95, A.hand * 0.42],
    ];
    const segs = [[side + 'Shoulder', 0.0], [side + 'UpperArm', 0.44], [side + 'LowerArm', 0.8], [side + 'Hand', Infinity]];
    const rings = prof.map(([t, r]) => {
      const isHand = t > 0.82;
      return { c: add(sh, mul(dir, L * t)), u, v, rx: r, ry: isHand ? r * 0.45 : r * 0.92, w: weightsAlong(t, segs, 0.05) };
    });
    const sleeveEnd = Math.min(look.sleeveT, 1) * 0.8; // 0.8 = wrist
    mb.mat = (c) => (dot(sub(c, sh), dir) / L < sleeveEnd ? 'Top' : 'Skin');
    mb.tube(rings, D.limb, add(sh, mul(dir, -L * 0.1)), add(sh, mul(dir, L)));
  }

  // ---------- legs + feet ----------
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    const top = spec.hipY + 0.03 * H, bottom = spec.ankleY * 0.55;
    const rings = [];
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const y = lerp(top, bottom, i / N);
      const yy = Math.min(y, spec.crotchY - 0.01 * H); // above the crotch, reuse thigh width
      const l = spec.legAtY(yy);
      const x = s * Math.min(Math.max(l.off, spec.hipX * 0.6), spec.hipX * 1.3);
      // Blend the very top towards the hip joint so the thigh meets the pelvis cleanly.
      const tx = i === 0 ? s * spec.hipX : x;
      const w = weightsAlong(-y, [['Hips', -spec.hipY], [side + 'UpperLeg', -spec.kneeY], [side + 'LowerLeg', -spec.ankleY], [side + 'Foot', Infinity]], 0.03 * H);
      rings.push({ c: [tx, y, (l.zf + l.zb) / 2], u: [1, 0, 0], v: [0, 0, 1], rx: l.hx, ry: (l.zf - l.zb) / 2, w });
    }
    const trouserEndY = look.trouserT >= 1 ? -Infinity : lerp(spec.crotchY, 0.045 * H, look.trouserT);
    mb.mat = (c) => (c[1] > trouserEndY ? 'Bottom' : 'Skin');
    mb.tube(rings, D.limb, null, add(rings[N].c, [0, -0.01 * H, 0]));

    // Foot: a tapered box-like tube running heel -> toe along +Z.
    const fx = pos[side + 'Foot'][0];
    const { heelZ, toeZ } = spec.foot;
    const fh = spec.ankleY;
    const prof = [[0, 0.5, 0.75], [0.25, 0.55, 1], [0.55, 0.45, 1], [0.8, 0.32, 0.95], [1, 0.2, 0.7]];
    const ballZ = heelZ + (toeZ - heelZ) * 0.72;
    const frings = prof.map(([t, hy, wx]) => {
      const z = lerp(heelZ, toeZ, t);
      const ry = fh * hy;
      return {
        c: [fx, ry, z], u: [1, 0, 0], v: [0, 1, 0], rx: spec.footHalf * wx, ry,
        w: weightsAlong(z, [[side + 'Foot', ballZ], [side + 'Toes', Infinity]], 0.015 * H),
      };
    });
    mb.mat = () => 'Shoes';
    mb.tube(frings, D.foot, add(frings[0].c, [0, 0, -0.01 * H]), add(frings[frings.length - 1].c, [0, 0, 0.012 * H]));
  }

  // ---------- flatten to vertex streams, grouped by material ----------
  const order = MATERIALS.flatMap((m) => mb.tris.filter((t) => t.m === m));
  const T = order.length;
  const position = new Float32Array(T * 9), normal = new Float32Array(T * 9);
  const joints = new Uint8Array(T * 12), weights = new Float32Array(T * 12);
  order.forEach(({ p, w }, f) => {
    const n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    for (let k = 0; k < 3; k++) {
      const vi = f * 3 + k;
      position.set(p[k], vi * 3); normal.set(n, vi * 3);
      const ents = Object.entries(w[k]).filter(([, x]) => x > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = ents.reduce((a, [, x]) => a + x, 0);
      ents.forEach(([b, x], j) => { joints[vi * 4 + j] = BI[b]; weights[vi * 4 + j] = x / sum; });
    }
  });
  // One group (= one glTF primitive) per material that is actually used.
  const groups = [];
  let start = 0;
  for (const m of MATERIALS) {
    const count = mb.tris.filter((t) => t.m === m).length;
    if (count) groups.push({ material: m, color: look[m.toLowerCase()], start, count });
    start += count;
  }

  const bones = BONES.map((name) => ({ name, parent: PARENT[name] ? BI[PARENT[name]] : -1, pos: pos[name] }));
  return {
    bones,
    mesh: { position, normal, joints, weights, triangles: T, groups },
    spec,
  };
}
