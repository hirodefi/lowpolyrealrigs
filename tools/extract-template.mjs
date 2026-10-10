// Dev tool: measures rigged reference humans (bind pose, T-pose) and writes
// averaged body proportions + cross-section shapes to public/core/template.js.
//
// Only derived numbers are written (normalised landmark heights, radii and
// shape ratios averaged over several figures) - no reference geometry is copied.
//
//   node tools/extract-template.mjs <reference.glb>
//
// The reference must contain skinned humans in a T-pose with a 3ds Max "bip"
// skeleton (e.g. the "Low Poly People Free Sample Pack" on Sketchfab).
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/extract-template.mjs <reference.glb>'); process.exit(1); }
const buf = readFileSync(file);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const jl = dv.getUint32(12, true);
const g = JSON.parse(buf.subarray(20, 20 + jl).toString());
const binOff = 20 + jl + 8;
function acc(i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
  const comp = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const stride = bv.byteStride || n * comp.BYTES_PER_ELEMENT;
  const out = new comp(a.count * n);
  for (let i = 0; i < a.count; i++) {
    const o = buf.byteOffset + binOff + (bv.byteOffset || 0) + (a.byteOffset || 0) + i * stride;
    out.set(new comp(buf.buffer.slice(o, o + n * comp.BYTES_PER_ELEMENT)), i * n);
  }
  return out;
}
function invert4(m) { // column-major 4x4 inverse (general)
  const a = m, inv = new Array(16);
  inv[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  inv[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  inv[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  inv[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  inv[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  inv[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  inv[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  inv[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  inv[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  inv[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  inv[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  inv[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  inv[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  inv[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  inv[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  inv[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  const det = a[0]*inv[0]+a[1]*inv[4]+a[2]*inv[8]+a[3]*inv[12];
  return inv.map((x) => x / det);
}

const BINS = 24; // parametric angles per cross-section ring
const GROUPS = { male: /casual_Male|Doctor_Male/, female: /casual_Female|elder_Female|police_Female/, child: /little_boy/ };

function measureFigure(meshIndex) {
  const mesh = g.meshes[meshIndex];
  const prim = mesh.primitives[0];
  const P = acc(prim.attributes.POSITION), I = acc(prim.indices);
  const node = g.nodes.find((n) => n.mesh === meshIndex);
  const skin = g.skins[node.skin];
  const ibm = acc(skin.inverseBindMatrices);
  // Joint bind positions in mesh space, keyed by role.
  const J = {};
  let spineCount = 0;
  skin.joints.forEach((ji, k) => {
    const raw = g.nodes[ji].name;
    const m = invert4(Array.from(ibm.subarray(k * 16, k * 16 + 16)));
    const p = [m[12], m[13], m[14]];
    let key = raw.replace(/^bip\d*\s*/, '').replace(/(\d+)?_\d+(_\d+)?$/, '');
    if (/^Spine/.test(key)) key = spineCount++ === 0 ? 'Spine' : 'Spine1';
    J[key] ??= p;
  });
  const need = ['Pelvis', 'Spine', 'Spine1', 'Neck', 'Head', 'L UpperArm', 'L Forearm', 'L Hand', 'L Thigh', 'L Calf', 'L Foot', 'L Toe'];
  for (const k of need) if (!J[k]) throw new Error(`${mesh.name}: joint ${k} not found (${Object.keys(J).join(',')})`);

  let minY = Infinity, maxY = -Infinity, maxX = -Infinity;
  for (let i = 0; i < P.length; i += 3) { minY = Math.min(minY, P[i + 1]); maxY = Math.max(maxY, P[i + 1]); maxX = Math.max(maxX, P[i]); }
  const H = maxY - minY;
  const tris = [];
  for (let i = 0; i < I.length; i += 3) tris.push([I[i], I[i + 1], I[i + 2]].map((v) => [P[v * 3], P[v * 3 + 1] - minY, P[v * 3 + 2]]));
  for (const k in J) J[k][1] -= minY;
  // Facing check: toes in front of ankles means the figure faces +Z.
  if (J['L Toe'][2] < J['L Foot'][2]) throw new Error(`${mesh.name}: not facing +Z`);
  if (J['L UpperArm'][0] < 0) throw new Error(`${mesh.name}: left arm not on +X`);

  // Planar slice: axis 0/1/2, returns 2D segments in the other two axes (a, b).
  const slice = (axis, c, filter) => {
    const [ia, ib] = axis === 1 ? [0, 2] : axis === 0 ? [1, 2] : [0, 1];
    const segs = [];
    for (const t of tris) {
      const pts = [];
      for (let e = 0; e < 3; e++) {
        const p = t[e], q = t[(e + 1) % 3];
        const dp = p[axis] - c, dq = q[axis] - c;
        if ((dp < 0) !== (dq < 0)) { const s = dp / (dp - dq); pts.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s]); }
      }
      if (pts.length === 2 && (!filter || filter(pts[0], pts[1]))) segs.push([[pts[0][ia], pts[0][ib]], [pts[1][ia], pts[1][ib]]]);
    }
    return segs;
  };
  // Cross-section summary: centre, half extents and ring shape (radius over the
  // ellipse radius at each parametric angle, so the builder can reuse it).
  const section = (segs, clipA = Infinity) => {
    if (!segs.length) return null;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const s of segs) for (const [a, b] of s) { a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    a0 = Math.max(a0, -clipA); a1 = Math.min(a1, clipA);
    const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2, ha = (a1 - a0) / 2, hb = (b1 - b0) / 2;
    if (ha <= 0 || hb <= 0) return null;
    const shape = [];
    for (let k = 0; k < BINS; k++) {
      const t = (k / BINS) * Math.PI * 2;
      const ex = ha * Math.cos(t), ey = hb * Math.sin(t), e = Math.hypot(ex, ey);
      const dx = ex / e, dy = ey / e;
      let best = 0;
      for (const [[x0, y0], [x1, y1]] of segs) { // ray-segment intersection
        const sx = x1 - x0, sy = y1 - y0, den = dx * sy - dy * sx;
        if (Math.abs(den) < 1e-9) continue;
        const ox = x0 - ca, oy = y0 - cb;
        const r = (ox * sy - oy * sx) / den, u = (ox * dy - oy * dx) / den;
        if (r > 0 && u >= 0 && u <= 1) best = Math.max(best, r);
      }
      shape.push(best > 0 ? Math.min(Math.max(best / e, 0.55), 1.25) : 1);
    }
    return { ca, cb, ha, hb, shape };
  };

  const yN = (k) => J[k][1] / H;
  const sh = J['L UpperArm'], el = J['L Forearm'], wr = J['L Hand'], hip = J['L Thigh'], kn = J['L Calf'], an = J['L Foot'];
  // Crotch: highest height where the slice has a gap at x = 0.
  let crotch = hip[1];
  for (let y = hip[1]; y > kn[1]; y -= H * 0.002) {
    const segs = slice(1, y);
    const hit = segs.some(([[a0], [a1]]) => (a0 <= 0) !== (a1 <= 0) || Math.abs(a0) < 1e-6);
    let spans0 = false;
    for (const [[x0, z0], [x1, z1]] of segs) if (Math.min(x0, x1) < 0 && Math.max(x0, x1) > 0) spans0 = true;
    if (!spans0 && !hit) { crotch = y; break; }
  }
  // Armpit: lowest height where the slice reaches well past the shoulder joint.
  let armpit = sh[1];
  for (let y = sh[1]; y > sh[1] - H * 0.12; y -= H * 0.002) {
    let ext = 0;
    for (const s of slice(1, y)) for (const [a] of s) ext = Math.max(ext, a);
    if (ext < sh[0] * 1.5) { armpit = y; break; }
  }

  const sec = (list) => list.map(([u, s]) => s && { u, cx: s.ca / H, cz: s.cb / H, hw: s.ha / H, hd: s.hb / H, shape: s.shape });
  const U = (n, a = 0, b = 1) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));

  // Torso: crotch -> neck joint. Above the armpit, clip off the T-posed arms.
  const neckY = J.Neck[1];
  const torso = sec(U(15).map((u) => {
    const y = crotch + (neckY - crotch) * u;
    const clip = y > armpit ? sh[0] * 0.95 : Infinity;
    return [u, section(slice(1, y, (p, q) => Math.abs(p[0]) < clip * 1.3 && Math.abs(q[0]) < clip * 1.3), clip)];
  }));
  // Neck + head: neck joint -> top of head (centre line component only).
  const headTop = H;
  const head = sec(U(14, 0, 0.985).map((u) => {
    const y = neckY + (headTop - neckY) * u;
    return [u, section(slice(1, y, (p, q) => Math.abs(p[0]) < sh[0] * 0.6 && Math.abs(q[0]) < sh[0] * 0.6))];
  }));
  // Left leg: crotch -> ankle, x > 0 component.
  const leg = sec(U(13).map((u) => {
    const y = crotch + (an[1] - crotch) * u - (u === 0 ? H * 0.004 : 0);
    return [u, section(slice(1, y, (p, q) => p[0] > 0 && q[0] > 0))];
  }));
  // Left arm: shoulder joint -> fingertip along +X; sections in (y, z).
  const tip = maxX;
  const arm = sec(U(14, 0.06, 0.985).map((u) => {
    const x = sh[0] + (tip - sh[0]) * u;
    return [u, section(slice(0, x, (p, q) => p[1] > armpit - H * 0.02 && q[1] > armpit - H * 0.02))];
  }));
  // Left foot: heel -> toe along +Z, sections in (x, y), below the ankle.
  let heel = Infinity, toe = -Infinity;
  for (const t of tris) for (const p of t) if (p[0] > 0 && p[1] < an[1] * 0.9) { heel = Math.min(heel, p[2]); toe = Math.max(toe, p[2]); }
  const foot = sec(U(9, 0.02, 0.98).map((u) => {
    const z = heel + (toe - heel) * u;
    return [u, section(slice(2, z, (p, q) => p[0] > 0 && q[0] > 0 && p[1] < an[1] * 1.15 && q[1] < an[1] * 1.15))];
  }));

  return {
    name: mesh.name, H,
    land: {
      crotch: crotch / H, hip: yN('L Thigh'), pelvis: yN('Pelvis'), spine: yN('Spine'), chest: yN('Spine1'), neck: yN('Neck'), head: yN('Head'),
      armpit: armpit / H, shoulder: [sh[0] / H, sh[1] / H, sh[2] / H], elbow: [el[0] / H, el[1] / H, el[2] / H], wrist: [wr[0] / H, wr[1] / H, wr[2] / H],
      fingertip: tip / H, hipJoint: [hip[0] / H, hip[1] / H, hip[2] / H], knee: [kn[0] / H, kn[1] / H, kn[2] / H], ankle: [an[0] / H, an[1] / H, an[2] / H],
      heelZ: heel / H, toeZ: toe / H, ball: (J['L Toe'][2]) / H,
    },
    torso, head, leg, arm, foot,
  };
}

// Average a list of same-shaped objects (numbers / arrays / nested objects).
function average(items) {
  const first = items.find((x) => x != null);
  if (typeof first === 'number') { const v = items.filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / v.length; }
  if (Array.isArray(first)) return first.map((_, i) => average(items.map((x) => x?.[i])));
  if (first && typeof first === 'object') return Object.fromEntries(Object.keys(first).map((k) => [k, average(items.map((x) => x?.[k]))]));
  return first;
}
const round = (x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : Array.isArray(x) ? x.map(round) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, round(v)])) : x);

const out = {};
for (const [group, re] of Object.entries(GROUPS)) {
  const figs = g.meshes.map((m, i) => i).filter((i) => re.test(g.meshes[i].name)).map(measureFigure);
  console.log(group, figs.map((f) => `${f.name.split('_').slice(0, 3).join('_')} H=${f.H.toFixed(1)}`).join(' | '));
  const avg = average(figs.map(({ name, H, ...rest }) => rest));
  // Symmetrise ring shapes left/right (bins k and BINS/2 - k mirror across the v axis) for torso/head.
  for (const part of ['torso', 'head']) for (const s of avg[part]) {
    if (!s) continue;
    const sym = s.shape.map((v, k) => (v + s.shape[(BINS / 2 - k + BINS) % BINS]) / 2);
    s.shape = sym; s.cx = 0;
  }
  out[group] = round(avg);
}
const src = `// GENERATED by tools/extract-template.mjs - do not edit by hand.
// Averaged human body template: landmark heights and joint positions as a
// fraction of height, and cross-section rings (centre, half width/depth, and a
// ${BINS}-sample shape ratio over the ellipse) for torso, neck+head, left leg,
// left arm (sections in y/z) and left foot (sections in x/y). Measured from
// rigged low-poly reference figures in T-pose; facing +Z, left = +X, feet at 0.
export const BINS = ${BINS};
export const TEMPLATE = ${JSON.stringify(out)};
`;
writeFileSync(new URL('../public/core/template.js', import.meta.url), src);
console.log('wrote public/core/template.js', (src.length / 1024).toFixed(1), 'KB');
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify(v.land));
