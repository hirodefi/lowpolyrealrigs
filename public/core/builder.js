// Builder: body spec + human template -> skeleton + flat-shaded low-poly skinned mesh.
//
// Shape comes from an averaged human template (template.js, measured from real
// low-poly character references): sloped shoulders, chest/waist/hip curve, neck,
// skull, mitten hands and feet, as stacks of cross-section rings. The photos
// decide size, proportions (per-ring width/depth factors), pose (arm angle),
// clothing extents and colours. Every ring knows its bone(s), so skin weights
// are exact and blend smoothly across joints. Every triangle belongs to one
// region material (Skin, Hair, Top, Bottom, Shoes) with one flat colour each.

import { TEMPLATE } from './template.js';
import { add, sub, mul, dot, cross, norm, lerp, clamp, TAU, shapeAt, mirrorShape, stations, weightsAlong, smooth, lookup, invert, MeshBuilder } from './mesh.js';
import { surface } from './kit.js';
import { buildPart } from './parts/index.js';

// Skin/Hair/Top/Bottom/Shoes are recoloured per person by the crowd; Accent
// (collar, tie, belt), Trim (soles, buttons, buckles, frames) and Eyes keep
// their colour. Groups with no triangles are left out of the file.
export const MATERIALS = ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes', 'Accent', 'Trim', 'Eyes'];
const FIXED = { Accent: [150, 32, 44], Trim: [236, 234, 228], Eyes: [46, 34, 30] };

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
  medium: { torso: 12, head: 12, limb: 8, foot: 7 },
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


/** Hair style from the photo: none, short cap, bob to the jaw/neck, or long down the back. */
function pickHairStyle(opt, look, H, pos, shoulderY) {
  if (opt && opt !== 'auto') return opt;
  if (look.hairStyle) return look.hairStyle;
  if (!look.hasHair) return 'bald';
  if (look.hairEndY != null && look.hairEndY < shoulderY - 0.01 * H) return 'long';
  if (look.hairEndY != null) return 'bob';
  return 'short';
}

/** Pick a template body type from the photo proportions. */
export function pickBodyType(spec) {
  // Calibrated on the ground-truth benchmark: head height (neck at > 17% of the
  // height from the top) marks a child, unless the figure is clearly female; a waist much narrower than the hips or
  // a pronounced bust in profile marks a woman.
  // A clearly female figure (narrow waist AND a bust) is never a child: hair
  // hanging over the neck (a bob) can push the measured neck down.
  const sh = spec.shape || {};
  const clearlyFemale = sh.waistHip != null && sh.waistHip < 0.72 && sh.bust != null && sh.bust > 1.1;
  if (sh.head != null && sh.head > 0.17 && !clearlyFemale) return 'child';
  if (sh.waistHip != null && sh.waistHip < 0.78) return 'female';
  if (sh.bust != null && sh.bust > 1.1) return 'female';
  return 'male';
}

/**
 * @param spec body spec from measureBody
 * @param {{detail?:'low'|'medium'|'high', body?:'auto'|'male'|'female'|'child', preset?:string}} opts
 */
export function buildCharacter(spec, opts = {}) {
  // Photo measurements are fractions of the whole figure (hair and soles
  // included), while the build maps the template's skull top to H and then
  // rescales the finished model to exactly H. Build once to learn that ratio,
  // then again with the measurements expressed in build space, so a detected
  // neck or hem lands where the photo shows it.
  const first = buildOnce(spec, opts);
  const r = first.rawHeight / spec.height;
  if (Math.abs(r - 1) < 0.002) return first;
  return { ...buildOnce(scaleSpec(spec, r), opts), spec };
}

/** The body spec with every length scaled by r (angles and fractions unchanged). */
function scaleSpec(spec, r) {
  const len = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? v * r : v]));
  const y = (v) => (v == null ? v : v * r);
  const L = spec.look;
  return {
    ...spec,
    neckY: spec.neckY * r, shoulderY: spec.shoulderY * r, crotchY: spec.crotchY * r, shoulderX: spec.shoulderX * r, hipX: spec.hipX * r,
    arm: { ...spec.arm, length: spec.arm.length * r, upper: spec.arm.upper * r, fore: spec.arm.fore * r, hand: spec.arm.hand * r },
    torsoAt: (v) => len(spec.torsoAt(v / r)), headAt: (v) => len(spec.headAt(v / r)), legAtY: (v) => len(spec.legAtY(v / r)),
    look: { ...L, hemY: y(L.hemY), skirtY: y(L.skirtY), necklineY: y(L.necklineY), hairlineY: y(L.hairlineY), hairBackY: y(L.hairBackY), hairEndY: y(L.hairEndY) },
  };
}

function buildOnce(spec, opts) {
  const D = DETAIL[opts.detail ?? 'medium'];
  const H = spec.height;
  const bodyType = !opts.body || opts.body === 'auto' ? pickBodyType(spec) : opts.body;
  const T = TEMPLATE[bodyType];
  const L = T.land;
  const P = PRESETS[opts.preset] || {};
  const look = spec.look;
  const mb = new MeshBuilder();
  // Ring stacks of the body, kept so parts (kit.js) can sit on its surface.
  const surf = { arm: {}, leg: {}, foot: {} };

  // Template necks are about as wide as the jaw (the child's even wider), so the
  // chin doesn't read and the narrowest point lands on the chin. Cap the neck at
  // an anatomical fraction of the head's width.
  const headS = stations(T.head);
  let headMaxHW = 0;
  for (let u = 0.3; u <= 0.8; u += 0.05) headMaxHW = Math.max(headMaxHW, headS(u).hw);
  const neckCap = headMaxHW * (bodyType === 'female' ? 0.66 : bodyType === 'child' ? 0.64 : 0.8);
  const neckMidU = ((L.neck + L.head) / 2 - L.neck) / (1 - L.neck);
  const neckHW = (u) => { const hw = headS(u).hw, c = Math.min(hw, neckCap * (1 + 8 * (u - neckMidU) ** 2)); return u <= 0.16 ? c : u >= 0.24 ? hw : lerp(c, hw, (u - 0.16) / 0.08); };

  // ---------- vertical mapping: template height fraction -> metres ----------
  // Photo landmarks win where they were clearly detected (within sane limits).
  // The photo's neck is its narrowest point: map it onto the narrowest point of
  // the neck we build.
  // Same rule as measure.js: silhouette half-width along the built neck (piecewise
  // linear between the head rings), the middle of the rows within 6 % of the minimum.
  // (At the tube's actual vertex angles: a template bulge between them never shows.)
  const sideW = (u) => { const sh = headS(u).shape; let m = 0; for (let k = 0; k < D.head; k++) { const t = (k / D.head) * TAU + Math.PI / D.head; m = Math.max(m, shapeAt(sh, t) * Math.abs(Math.cos(t))); } return neckHW(u) * m; };
  const NU = [-0.025 / (1 - L.neck), 0.08, 0.16, 0.24, 0.32];
  const NW = NU.map((u, i) => sideW(Math.max(u, 0)) * (i === 0 ? 0.95 : 1));
  const neckW = (u) => { let i = 0; while (i + 2 < NU.length && NU[i + 1] < u) i++; return lerp(NW[i], NW[i + 1], (u - NU[i]) / (NU[i + 1] - NU[i])); };
  let wMin = Infinity, neckMinU = neckMidU;
  for (let u = 0; u <= 0.3; u += 0.005) if (neckW(u) < wMin) { wMin = neckW(u); neckMinU = u; }
  { let a = neckMinU, b = neckMinU;
    while (a - 0.005 >= 0 && neckW(a - 0.005) <= wMin * 1.06) a -= 0.005;
    while (b + 0.005 <= 0.3 && neckW(b + 0.005) <= wMin * 1.06) b += 0.005;
    neckMinU = (a + b) / 2; }
  const neckMidT = L.neck + neckMinU * (1 - L.neck);
  // proportions: 'template' ignores the photo's landmarks and widths (basic mode,
  // and ground-truth characters for the benchmark); the photo still sets pose,
  // clothing and colours.
  const TP = opts.proportions === 'template';
  const crotchP = !TP && spec.detected?.crotch ? clamp(spec.crotchY / H, L.crotch - 0.06, L.crotch + 0.06) : L.crotch;
  const neckP = !TP && spec.detected?.neck ? clamp(spec.neckY / H, neckMidT - 0.04, neckMidT + 0.04) : neckMidT;
  const KEYS = [[0, 0], [L.crotch, crotchP], [neckMidT, neckP], [1, 1]];
  const Y = (yt) => {
    for (let i = 0; i + 1 < KEYS.length; i++) if (yt <= KEYS[i + 1][0]) return H * lerp(KEYS[i][1], KEYS[i + 1][1], (yt - KEYS[i][0]) / (KEYS[i + 1][0] - KEYS[i][0]));
    return H * yt;
  };

  // ---------- photo width/depth factors per template station ----------
  const torsoS = stations(T.torso), legS = stations(T.leg), armS = stations(T.arm), footS = stations(T.foot);
  const hasSide = !spec.notes.some((n) => n.startsWith('no side view'));
  const torsoY = (u) => lerp(L.crotch, L.neck, u);
  const TU = Array.from({ length: 15 }, (_, i) => i / 14);
  // Photos personalise the build, but within human limits (drawings and loose
  // clothing would otherwise produce cartoon proportions).
  // Compare like with like: the photo gives the OUTER shoulder half-width
  // (deltoids included); the template's equivalent is joint + arm radius.
  const shFactor = TP ? 1 : clamp((spec.shoulderX / 0.82) / ((L.shoulder[0] + stations(T.arm)(0.2).hw) * H), 0.78, 1.15);
  const ones = (n) => new Array(n).fill(1);
  const torsoW = TP ? ones(15).map((f) => f * (P.width ?? 1)) : smooth(TU.map((u) => {
    const yt = torsoY(u);
    if (yt > L.armpit - 0.02) return shFactor; // photo widths near the shoulders include the arms
    return spec.torsoAt(Y(yt)).hx / (torsoS(u).hw * H);
  }), 0.85, 1.2).map((f) => f * (P.width ?? 1));
  const torsoD = TP ? ones(15).map((f) => f * (P.width ?? 1)) : smooth(TU.map((u) => {
    if (!hasSide) return 1;
    const t = spec.torsoAt(Y(torsoY(u)));
    return (t.zf - t.zb) / 2 / (torsoS(u).hd * H);
  }), 0.85, 1.2).map((f) => f * (P.width ?? 1));

  const legY = (u) => lerp(L.crotch, L.ankle[1], u);
  const LU = Array.from({ length: 13 }, (_, i) => i / 12);
  const legW = TP ? ones(13).map((f) => f * (P.limb ?? 1)) : smooth(LU.map((u) => spec.legAtY(Y(legY(u))).hx / (legS(u).hw * H)), 0.85, 1.35).map((f) => f * (P.limb ?? 1));
  const legD = TP ? ones(13).map((f) => f * (P.limb ?? 1)) : smooth(LU.map((u) => {
    if (!hasSide) return 1;
    const l = spec.legAtY(Y(legY(u)));
    return (l.zf - l.zb) / 2 / (legS(u).hd * H);
  }), 0.85, 1.2).map((f) => f * (P.limb ?? 1));
  const hipW = lookup(torsoW, (L.hip - L.crotch) / (L.neck - L.crotch));
  // Leg centre line (|x|) at leg station u: measured from the front view where
  // the legs are visible, template otherwise (bounded to stay anatomical).
  const legCX = (u) => {
    const t = legS(clamp(u, 0, 1)).cx * H * hipW;
    if (TP) return t;
    const m = spec.legAtY(Y(lerp(L.crotch, L.ankle[1], clamp(u, 0.04, 1)))).off;
    return clamp(m, t * 0.6, t * 1.3);
  };

  // Head: one width factor from the widest part, one depth factor from the side.
  let headMaxT = 0, headMaxP = 0, headDT = 0, headDP = 0;
  for (let u = 0.3; u <= 0.8; u += 0.05) {
    const s = headS(u), h = spec.headAt(Y(lerp(L.neck, 1, u)));
    headMaxT = Math.max(headMaxT, s.hw * H); headMaxP = Math.max(headMaxP, h.hx);
    headDT = Math.max(headDT, s.hd * H); headDP = Math.max(headDP, (h.zf - h.zb) / 2);
  }
  // The photo's head outline includes the hair; the hair shell is added on top
  // of the skull below, so take its thickness out first (else hair is counted twice).
  const hairK = look.hasHair ? 1.1 : 1;
  const fh = TP ? 1 : clamp(headMaxP / hairK / headMaxT, 0.9, 1.1);
  const fhd = TP ? 1 : hasSide ? clamp(headDP / hairK / headDT, 0.9, 1.1) : fh;

  // Arms: thickness from the front view, length and angle from the pose.
  const armLenT = (L.fingertip - L.shoulder[0]) * H;
  const A = spec.arm;
  const fa = TP ? (P.limb ?? 1) : clamp(((A.upper / 2) / (armS(0.25).hw * H) + (A.fore / 2) / (armS(0.6).hw * H)) / 2, 0.85, 1.2) * (P.limb ?? 1);
  const armLen = armLenT * (!TP && spec.detected?.arms ? clamp(A.length / armLenT, 0.88, 1.12) : 1);
  const angle = clamp(A.angle, 0, 88 * Math.PI / 180);
  const elbowU = (L.elbow[0] - L.shoulder[0]) / (L.fingertip - L.shoulder[0]);
  const wristU = (L.wrist[0] - L.shoulder[0]) / (L.fingertip - L.shoulder[0]);
  const kneeU = (L.crotch - L.knee[1]) / (L.crotch - L.ankle[1]);

  // Body-type shaping that reads at crowd distance: women get a narrower waist,
  // fuller hips and a bust; men a broader chest and shoulders.
  const g = (u, m, sd) => Math.exp(-(((u - m) / sd) ** 2));
  const female = bodyType === 'female', male = bodyType === 'male', child = bodyType === 'child';
  const widthMod = (u) => female ? 1 - 0.09 * g(u, 0.38, 0.1) + 0.08 * g(u, 0.05, 0.09) : male ? 1 + 0.05 * g(u, 0.8, 0.12) - 0.02 * g(u, 0.08, 0.1) : 1;
  const bustMod = (u) => (female ? 0.13 * g(u, 0.72, 0.07) : male ? 0.04 * g(u, 0.74, 0.1) : 0);

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
  // Anchor the arm to the torso actually built: the shoulder joint sits so the
  // arm root overlaps the torso's real half-width at armpit height. A template
  // joint further out leaves a see-through gap between arm and body.
  const armpitU = (L.armpit - L.crotch) / (L.neck - L.crotch);
  const torsoAtArmpit = torsoS(armpitU).hw * H * lookup(torsoW, armpitU) * widthMod(armpitU);
  const armRootR = armS(0.2).hw * H * fa;
  const shX = Math.min(L.shoulder[0] * H * shFactor * (P.width ?? 1), torsoAtArmpit + armRootR * 0.45);
  const arms = {};
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    // The reference rig's shoulder joint sits high (clavicle height); drop it a
    // little so the shoulder line slopes down from the neck.
    const sh = [s * shX, Y(L.shoulder[1]) - 0.018 * H, L.shoulder[2] * H];
    const dir = [s * Math.cos(angle), -Math.sin(angle), 0];
    const uA = [s * Math.sin(angle), Math.cos(angle), 0]; // the arm's "up" (T-pose +Y); v = +Z
    arms[side] = { sh, dir, uA };
    pos[side + 'Shoulder'] = [s * shX * 0.22, sh[1] + 0.006 * H, sh[2]];
    pos[side + 'UpperArm'] = sh;
    pos[side + 'LowerArm'] = add(sh, mul(dir, armLen * elbowU));
    pos[side + 'Hand'] = add(sh, mul(dir, armLen * wristU));

    const legX = (u) => s * legCX(u);
    pos[side + 'UpperLeg'] = [s * Math.min(L.hipJoint[0] * H * hipW, legCX(0.06) * 1.05), hipYm, L.hipJoint[2] * H];
    pos[side + 'LowerLeg'] = [legX(kneeU), Y(L.knee[1]), L.knee[2] * H];
    pos[side + 'Foot'] = [legX(1), Y(L.ankle[1]), L.ankle[2] * H];
    pos[side + 'Toes'] = [legX(1), Y(0.012), L.ball * H];
  }

  // Clothing ring scales: a little looser than skin, with a lip at each edge.
  const LOOSE = 1.035, LIP = 1.07, EPS = 0.004 * H;

  // Top style from the photo (or the UI): sleeveless tank, deep neckline.
  const topStyle = opts.top && opts.top !== 'auto' ? opts.top : look.sleeveT <= 0.02 ? 'tank' : 'tshirt';
  const tank = topStyle === 'tank';
  // Neckline: measured, or set by the spec (crew = closed at the neck, scoop / v = open).
  const necklineY = opts.neckline === 'crew' ? Y(L.neck) : opts.neckline === 'scoop' ? Y(L.neck) - 0.05 * H : opts.neckline === 'v' ? Y(L.neck) - 0.09 * H
    : Math.min(look.necklineY ?? Y(L.neck), Y(L.neck));
  const deepNeck = !opts.tie && necklineY < Y(L.neck) - 0.025 * H; // a tie means a closed collar
  const torsoUofY = (y) => clamp(invert((u) => Y(torsoY(u)), y), 0, 1);

  // ---------- torso (Top over Bottom with a hem lip) ----------
  {
    const hemY = look.hemY;
    const rings = [];
    // Above the shoulder joint the T-posed reference continues into the arm, so
    // taper the rings along a trapezius slope from the shoulder to the neck.
    const slope0 = arms.Left.sh[1] - 0.03 * H, slope1 = Y(L.neck);
    const u0 = invert((u) => Y(torsoY(u)), slope0);
    const neckS = headS(0);
    const neckRx = neckHW(0) * H * fh * 1.25, neckRy = neckS.hd * H * fhd * 1.15;
    // Shoulder profile, deltoid -> neck: a quick rounded corner over the deltoid,
    // then the trapezius slope, rising steeply only close to the neck.
    const slopeE = (t) => (t < 0.25 ? 0.4 * Math.sqrt(t / 0.25) : 0.4 + 0.6 * ((t - 0.25) / 0.75) ** 1.6);
    // The torso itself forms the shoulder cap, reaching just past the arm root,
    // so the arm emerges from under it instead of sitting on top like a pad.
    const capX = shX + armS(0.2).hw * H * fa * 0.7;
    // Body-type shaping that reads at crowd distance: women get a narrower waist,
    // fuller hips and a bust; men a broader chest and shoulders.
    const pushRing = (u, scale, y = Y(torsoY(u))) => {
      const s = torsoS(u);
      const w = weightsAlong(y, [['Hips', pos.Spine[1] - 0.01 * H], ['Spine', pos.Chest[1]], ['Chest', pos.Neck[1] - 0.012 * H], ['Neck', Infinity]], 0.03 * H);
      const sc = scale ?? (y > hemY ? LOOSE : 1);
      let rx = s.hw * H * lookup(torsoW, u) * widthMod(u), ry = s.hd * H * lookup(torsoD, u), shape = s.shape;
      if (y > slope0 - 0.03 * H && y <= slope0) rx = lerp(rx, Math.max(rx, capX), (y - (slope0 - 0.03 * H)) / (0.03 * H));
      if (y > slope0) {
        const base = torsoS(u0), t = clamp((y - slope0) / (slope1 - slope0), 0, 1);
        const bx = Math.max(base.hw * H * lookup(torsoW, u0) * widthMod(u0), capX), by = base.hd * H * lookup(torsoD, u0);
        rx = lerp(bx, neckRx, slopeE(t)); ry = lerp(by, neckRy, t);
        shape = base.shape.map((v, k) => lerp(v, 1, t));
      }
      const bust = bustMod(u);
      rings.push({ c: [0, y, s.cz * H], u: [1, 0, 0], v: [0, 0, 1], rx: rx * sc, ry: ry * sc, shape, w, f: (t) => shapeAt(shape, t) * (1 + bust * Math.max(0, Math.sin(t)) ** 2) });
    };
    const yOfU = (u) => Y(torsoY(u));
    const hemU = invert(yOfU, hemY), hemLowU = invert(yOfU, hemY - EPS);
    let hemDone = hemY <= yOfU(0) || hemY >= yOfU(1);
    // Ring stations: sparser over the belly, denser over the shoulders (where the
    // outline turns), plus one on a deep neckline so its edge is a clean line.
    // Clothing edges (neckline, tank armhole line) get a ring of their own, so the
    // colour change runs along a clean edge instead of zig-zagging across faces.
    const armLineY = Y(L.armpit) - 0.012 * H;
    const edges = [invert(yOfU, slope0)];
    if (tank || deepNeck) edges.push(clamp(invert(yOfU, necklineY), 0.6, 0.97));
    if (tank) edges.push(invert(yOfU, armLineY));
    const TR = [0, 0.08, 0.16, 0.24, 0.33, 0.42, 0.51, 0.6, 0.68, 0.76, 0.88, 0.94, 1]
      .filter((u) => u === 0 || u === 1 || edges.every((e) => Math.abs(u - e) > 0.025)).concat(edges).sort((a, b) => a - b);
    for (const u of TR) {
      if (!hemDone && u > hemU) {
        pushRing(hemLowU, 1, hemY - EPS); // underside of the hem
        pushRing(hemU, LIP, hemY);        // the hem lip itself
        hemDone = true;
      }
      pushRing(u);
    }
    // Top style: tank (sleeveless, straps over bare shoulders), scoop neckline
    // (chest skin above the neckline), or a plain crew neck.
    // Straps sit mid-way between the neck and the shoulder tip.
    const strapX = lerp(neckRx, capX, 0.42), strapW = 0.0065 * H;
    // Decided per face by its normal (both triangles of a quad agree), so the
    // front panel has straight sides. Tank: the front panel rises to the
    // neckline, everything else above the armhole line is bare.
    const front = (n) => n[2] > 0.8;
    mb.mat = (c, n) => {
      if (c[1] < hemY - EPS * 0.5) return 'Bottom';
      if (tank) return c[1] > (front(n) ? Math.max(necklineY, armLineY) : armLineY) ? 'Skin' : 'Top';
      if (deepNeck && front(n) && c[1] > necklineY) return 'Skin';
      return 'Top';
    };
    mb.tube(rings, D.torso, add(rings[0].c, [0, -0.012 * H, 0]), add(rings[rings.length - 1].c, [0, 0.004 * H, 0]));
    surf.torso = surface(rings);

    // Tank straps: thin ribbons from the front panel, over the shoulder, down to
    // the back armhole line, lying on the torso surface.
    if (tank) {
      const at = (y) => { // the built torso ring interpolated at height y
        let i = 0;
        while (i + 2 < rings.length && rings[i + 1].c[1] < y) i++;
        const a = rings[i], b = rings[i + 1], k = clamp((y - a.c[1]) / (b.c[1] - a.c[1]), 0, 1);
        const f = (t) => lerp(a.f ? a.f(t) : shapeAt(a.shape, t), b.f ? b.f(t) : shapeAt(b.shape, t), k);
        return { cz: lerp(a.c[2], b.c[2], k), rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k), f, w: k < 0.5 ? a.w : b.w };
      };
      // Surface point at |x| = strapX on the front (sgn 1) or back (-1) at height y.
      const surf = (y, sgn) => {
        const r = at(y);
        let t = 0;
        for (let i = 0; i < 4; i++) t = Math.acos(clamp(strapX / (r.rx * r.f(sgn * t)), -1, 1));
        return { z: r.cz + sgn * r.ry * r.f(sgn * t) * Math.sin(t), w: r.w, inside: strapX < r.rx * r.f(0) };
      };
      // Where the strap crosses the top of the shoulder.
      let yTop = armLineY;
      while (yTop < rings[rings.length - 1].c[1] && surf(yTop + 0.004 * H, 1).inside) yTop += 0.004 * H;
      const yFront = Math.max(necklineY, armLineY);
      const ys = [[yFront, 1], [lerp(yFront, yTop, 0.6), 1], [yTop, 0], [lerp(armLineY, yTop, 0.6), -1], [armLineY, -1]];
      for (const sx of [1, -1]) {
        const path = ys.map(([y, sgn]) => { const p = sgn ? surf(y, sgn) : { z: at(y).cz, w: at(y).w }; return { p: [sx * strapX, y, p.z], w: p.w }; });
        const hub = [sx * strapX, yTop - 0.06 * H, at(yTop).cz]; // inside the shoulder: "outward" points away from it
        const srings = path.map(({ p, w }, i) => {
          const d = norm(sub(path[Math.min(i + 1, path.length - 1)].p, path[Math.max(i - 1, 0)].p));
          let v = norm(cross([1, 0, 0], d));
          if (dot(v, sub(p, hub)) < 0) v = mul(v, -1);
          return { c: add(p, mul(v, 0.003 * H)), u: [1, 0, 0], v, rx: strapW / Math.SQRT1_2, ry: 0.0025 * H, w };
        });
        mb.mat = () => 'Top';
        mb.tube(srings, 4, null, null);
      }
    }
  }

  // ---------- skirt / dress ----------
  // A flared tube from the hips to the hem, wide enough to hold both legs. Each
  // vertex follows the thigh on its side a little more towards the hem, so the
  // legs don't poke through when walking.
  const bottomStyle = opts.bottom && opts.bottom !== 'auto' ? opts.bottom : look.skirtY != null ? 'skirt' : 'auto';
  const isSkirt = bottomStyle === 'skirt' || bottomStyle === 'pencil';
  const pencil = bottomStyle === 'pencil';
  // A-line: flares from the waist; pencil: straight to just above the knee.
  const skirtY = !isSkirt ? null : pencil ? (look.skirtY ?? Y(L.knee[1]) + 0.015 * H)
    : clamp(look.skirtY ?? Y(L.knee[1]) + 0.03 * H, Y(L.knee[1]) - 0.2 * H, Y(L.crotch) - 0.06 * H);
  if (skirtY != null) {
    const yTop = pencil ? Y(L.hip) + 0.02 * H : Y(lerp(L.hip, L.chest, 0.22));
    const tuTop = invert((u) => Y(torsoY(u)), yTop), ts = torsoS(tuTop);
    const rxTop = ts.hw * H * lookup(torsoW, tuTop) * 1.04, ryTop = ts.hd * H * lookup(torsoD, tuTop) * 1.04;
    const enclose = (y) => {
      const lu = clamp((Y(L.crotch) - y) / (Y(L.crotch) - Y(L.ankle[1])), 0, 1), ls = legS(lu);
      return [ls.cx * H * hipW + ls.hw * H * lookup(legW, lu) * 1.45, ls.hd * H * lookup(legD, lu) * 1.5];
    };
    const [ex, ey] = enclose(skirtY);
    const photoHem = spec.torsoAt(skirtY + 0.01 * H).hx;
    const rxHem = pencil ? Math.max(ex, rxTop * 0.98) : clamp(photoHem, Math.max(ex, rxTop * 1.18), rxTop * 1.6);
    const ryHem = Math.max(ey, ryTop * (rxHem / rxTop) * (pencil ? 1 : 0.9));
    const N = 5, rings = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, y = lerp(yTop, skirtY, t), [lx, ly] = enclose(y);
      // Above the hip joints the skirt rides on the hips; from there to just below
      // the crotch it hands over to the thighs (like trousers), so a raised thigh
      // carries the skirt with it instead of passing through it.
      const e = clamp((Y(L.hip) - y) / (Y(L.hip) - Y(L.crotch) + 0.05 * H), 0, 1);
      const k = 0.9 * e * e * (3 - 2 * e);
      rings.push({
        c: [0, y, lerp(ts.cz * H, legS(0.5).cz * H, t)], u: [1, 0, 0], v: [0, 0, 1],
        rx: Math.max(lerp(rxTop, rxHem, pencil ? t : t ** 1.15), lx), ry: Math.max(lerp(ryTop, ryHem, pencil ? t : t ** 1.15), ly), shape: ts.shape.map((v) => lerp(v, 1, t)),
        // Ease at the front: the front of the skirt can only follow the average of
        // both thighs, so it needs fullness where the forward thigh swings into it.
        f: (a) => shapeAt(ts.shape.map((v) => lerp(v, 1, t)), a) * (1 + (pencil ? 0.24 : 0.55) * t * t * Math.max(0, Math.sin(a)) ** 2),
        // Every hem vertex follows both thighs, weighted towards its own side.
        wf: (a) => { const c = Math.cos(a), wl = k * (1 + c) / 2, wr = k * (1 - c) / 2; return { Hips: 1 - k, LeftUpperLeg: wl, RightUpperLeg: wr }; },
      });
    }
    const last = rings[N];
    rings.push({ ...last, c: add(last.c, [0, 0.008 * H, 0]), rx: last.rx * 0.9, ry: last.ry * 0.9 }); // hem thickness
    mb.mat = () => 'Bottom';
    mb.tube(rings, Math.max(10, D.torso - 2), null, null); // a flat front panel would let the thighs through
  }

  // ---------- neck + head (Skin) ----------
  const headYofU = (u) => Y(lerp(L.neck, 1, u));
  const HU = [0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.87, 0.93, 0.97, 0.993];
  // Above u = 0.8 the skull is a dome: round the crown instead of a point.
  const dome = (u) => (u <= 0.8 ? 1 : Math.max(Math.sqrt(Math.max(0, 1 - ((u - 0.8) / 0.205) ** 2)), headS(u).hw / headS(0.8).hw));
  const headRing = (u, scale = 1) => {
    const s = u > 0.8 ? { ...headS(0.8), cz: headS(u).cz } : headS(u), y = headYofU(u), d = dome(u);
    const neck = u < 0.24 ? neckHW(u) / s.hw : 1;
    return {
      c: [0, y, s.cz * H], u: [1, 0, 0], v: [0, 0, 1], rx: s.hw * H * fh * scale * d * neck, ry: s.hd * H * fhd * scale * d, shape: s.shape,
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
    surf.head = surface(rings);
  }

  // Face details: a nose wedge and two small ears (hidden under hanging hair).
  const hairStyle = pickHairStyle(opts.hair, look, H, pos, Y(L.shoulder[1]));
  {
    const W = { Head: 1 };
    const nu = invert(headYofU, Y(lerp(L.head, 1, 0.3)));
    const s = headS(nu), y = headYofU(nu);
    const zf = s.cz * H + s.hd * H * fhd * shapeAt(s.shape, Math.PI / 2);
    const nw = 0.011 * H, nh = 0.027 * H, np = 0.012 * H;
    mb.mat = () => 'Skin';
    // Base sunk well into the face so the wedge never floats off it in profile.
    mb.spike([[-nw, y - nh * 0.35, zf - 0.016 * H], [0, y + nh * 0.65, zf - 0.014 * H], [nw, y - nh * 0.35, zf - 0.016 * H]], [0, y - nh * 0.25, zf + np], W);
    const eu = invert(headYofU, Y(lerp(L.head, 1, 0.32)));
    const es = headS(eu), ey = headYofU(eu);
    for (const sx of hairStyle === 'bob' || hairStyle === 'long' ? [] : [1, -1]) {
      const xs = sx * es.hw * H * fh * shapeAt(es.shape, 0) * 0.96, zc = es.cz * H - es.hd * H * 0.12;
      mb.spike([[xs, ey + 0.022 * H, zc + 0.006 * H], [xs, ey + 0.016 * H, zc - 0.012 * H], [xs, ey - 0.018 * H, zc - 0.004 * H], [xs, ey - 0.014 * H, zc + 0.008 * H]],
        [xs + sx * 0.008 * H, ey + 0.004 * H, zc - 0.004 * H], W);
    }
  }

  // ---------- eyes (Eyes) and brows (Hair) ----------
  {
    const W = { Head: 1 };
    const eu = invert(headYofU, Y(lerp(L.head, 1, 0.5)));
    const es = headS(eu), ey = headYofU(eu);
    const rx = es.hw * H * fh, ry = es.hd * H * fhd;
    surf.eyes = { y: ey, x: rx * 0.36 };
    const surfZ = (x) => { // front surface z of the head ring at |x|
      const t = Math.acos(clamp(x / (rx * 1.02), -1, 1));
      return es.cz * H + ry * shapeAt(es.shape, t) * Math.sin(t);
    };
    for (const sx of [1, -1]) {
      const x = sx * rx * 0.36, z = surfZ(Math.abs(x)) - 0.0015 * H;
      const ew = 0.0125 * H, eh = 0.0068 * H; // stylised, readable at crowd distance
      mb.mat = () => 'Eyes';
      // Almond shape, nearly flush with the face (a protruding point reads as a bead).
      mb.spike([[x - ew, ey - 0.001 * H, z], [x - sx * ew * 0.2, ey + eh, z + 0.001 * H], [x + ew, ey + 0.001 * H, z], [x + sx * ew * 0.2, ey - eh * 0.8, z + 0.001 * H]], [x, ey, z + 0.0018 * H], W);
      const by = ey + 0.019 * H, bz = surfZ(Math.abs(x)) + 0.0008 * H, bw = 0.012 * H;
      mb.mat = () => 'Hair';
      mb.spike([[x - sx * bw, by - 0.0015 * H, bz - 0.002 * H], [x + sx * bw, by + 0.001 * H, bz - 0.002 * H], [x + sx * bw, by + 0.0035 * H, bz - 0.002 * H], [x - sx * bw, by + 0.002 * H, bz - 0.002 * H]], [x, by + 0.001 * H, bz + 0.003 * H], W);
    }
  }

  // ---------- hair: short / bob / long / ponytail / bald ----------
  if (hairStyle !== 'bald') {
    // Never let the fringe fall below the brow line, nor the back above the ears.
    // The fringe may not drop below the upper forehead (photo hairlines are noisy).
    const hairlineY = Math.max(look.hairlineY, Y(lerp(L.head, 1, 0.72)));
    let hairBackY = Math.min(look.hairBackY, Y(lerp(L.head, 1, 0.35)));
    if (hairStyle === 'bob') hairBackY = Math.min(hairBackY, Y(lerp(L.neck, L.head, 0.3)));
    if (hairStyle === 'long') hairBackY = -Infinity; // the back is hair all the way down to the curtain
    const sideHairY = hairStyle === 'short' || hairStyle === 'ponytail' ? lerp(hairlineY, hairBackY, 0.5) : lerp(hairlineY, hairBackY, 0.85);
    // Front hairline curves up at the centre (parting) and sweeps down to the temples.
    // Hair framing the face: from the parting it sweeps down past the temples to
    // the side length (jaw level for long hair), not a straight fringe.
    // Long hair and bobs frame the face down to the jaw; short hair and ponytails
    // stop at the temples (a man's short cut must not read as a bob).
    const sideY = hairStyle === 'bob' || hairStyle === 'long' ? Math.max(sideHairY, pos.Neck[1] + 0.03 * H) : Math.max(sideHairY, Y(lerp(L.head, 1, 0.42)));
    const isHair = (y, t) => {
      const sn = Math.sin(t);
      if (sn > 0.8) return y > hairlineY + 0.014 * H * ((sn - 0.8) / 0.2) ** 1.5;
      if (sn > 0.3) { const e = (sn - 0.3) / 0.5; return y > lerp(sideY, hairlineY, e * e * (3 - 2 * e)); }
      return y > (sn < -0.3 ? hairBackY : sideHairY);
    };
    const lowest = Math.max(Math.min(hairlineY, sideHairY, hairBackY), pos.Neck[1]) - 0.02 * H;
    // Widest part of the head: longer hair hangs straight down from there.
    let widest = headRing(0.5);
    for (const u of HU) { const r = headRing(u); if (r.rx > widest.rx) widest = r; }
    const hangs = hairStyle === 'bob' || hairStyle === 'long';
    const rings = [];
    for (const u of HU) {
      if (headYofU(u) < lowest) continue;
      const r = headRing(u), y = r.c[1];
      if (hangs && y < widest.c[1]) { r.rx = Math.max(r.rx, widest.rx * 0.97); r.ry = Math.max(r.ry, widest.ry * 0.95); r.shape = widest.shape; }
      const out = hairStyle === 'long' ? 1.12 : hangs ? 1.09 : 1.075;
      r.f = (t) => shapeAt(r.shape, t) * (isHair(y, t) ? out : 0.94);
      r.hairY = y;
      rings.push(r);
    }
    // Long hair: a curtain down the back that follows the torso to the hair's end.
    if (hairStyle === 'long') {
      const end = Math.min(look.hairEndY ?? Y(L.chest), pos.Neck[1] - 0.04 * H);
      const yTop = rings[0].c[1];
      const curtain = [];
      for (let i = 1; i <= 4; i++) {
        const y = lerp(yTop, end, i / 4);
        const tu = clamp(invert((u) => Y(torsoY(u)), y), 0, 1), ts = torsoS(tu);
        // Actual back surface of the (loose) shirt at this height.
        const back = ts.cz * H - ts.hd * H * lookup(torsoD, tu) * shapeAt(ts.shape, -Math.PI / 2) * LIP;
        // Hair falls from the head's width and spreads a little over the shoulders.
        const rx = lerp(widest.rx * 1.16, Math.max(widest.rx * 1.3, ts.hw * H * lookup(torsoW, tu) * 0.72), i / 4);
        curtain.push({
          c: [0, y, back + widest.ry * 0.25], u: [1, 0, 0], v: [0, 0, 1], rx, ry: widest.ry * 0.6, shape: widest.shape,
          w: weightsAlong(y, [['Chest', pos.Neck[1]], ['Neck', pos.Head[1]], ['Head', Infinity]], 0.02 * H),
          f: () => 1.0, hairY: y, curtain: true,
        });
      }
      rings.unshift(...curtain.reverse()); // rings run bottom -> top
    }
    if (rings.length >= 2) {
      const S = D.head;
      const tk = (k) => (k / S) * TAU + Math.PI / S;
      // Curtain rings keep only their back half (plus a little round the sides).
      const keep = (i, k) => (rings[i].curtain ? Math.sin(tk(k)) < 0.3 : isHair(rings[i].hairY, tk(k)));
      mb.mat = () => 'Hair';
      mb.tube(rings, S, null, add(headTop, [0, 0.006 * H, 0]), keep);
    }
    // Ponytail: a tapered tube from the back of the head, hanging behind the neck.
    if (hairStyle === 'ponytail') {
      const hs = headS(0.62), y0 = headYofU(0.62);
      const zb = hs.cz * H - hs.hd * H * fhd * 1.02;
      const path = [[0, y0, zb + 0.012 * H], [0, y0 - 0.03 * H, zb - 0.02 * H], [0, y0 - 0.1 * H, zb - 0.03 * H], [0, y0 - 0.17 * H, zb - 0.022 * H], [0, y0 - 0.22 * H, zb - 0.012 * H]];
      const rad = [0.022, 0.03, 0.026, 0.018, 0.008].map((r) => r * H);
      const prings = path.map((c, i) => {
        const d = norm(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]));
        const v = norm(cross([1, 0, 0], d));
        return { c, u: [1, 0, 0], v, rx: rad[i], ry: rad[i] * 0.85, w: { Head: 1 } };
      });
      mb.mat = () => 'Hair';
      mb.tube(prings, 6, path[0], add(path[path.length - 1], [0, -0.012 * H, 0.004 * H]));
    }
  }

  // ---------- shirt collar (crew / shirt tops only) ----------
  if (!tank && !deepNeck) {
    const n0 = headS(0), cz = (n0.cz * H + torsoS(1).cz * H) / 2;
    const nr = neckHW(0) * H * fh * 1.2, nd = n0.hd * H * fhd * 1.1; // hugs the (capped) neck
    const w = weightsAlong(0, [['Chest', -0.5], ['Neck', Infinity]], 0.6); // half chest, half neck
    const ring = (y, k) => ({ c: [0, y, cz], u: [1, 0, 0], v: [0, 0, 1], rx: nr * k, ry: nd * k, shape: n0.shape, w });
    const y0 = pos.Neck[1] - 0.006 * H, y1 = pos.Neck[1] + 0.011 * H;
    mb.mat = () => (look.accent || opts.tie ? 'Accent' : 'Top');
    mb.tube([ring(y0, 1.06), ring(y1, 1.14), ring(y1 + 0.001 * H, 0.98)], D.head, null, null); // slim flared neckline
  }

  // ---------- tie (Accent) ----------
  if (opts.tie && !tank) {
    const zf = (y) => { const u = torsoUofY(y), t = torsoS(u); return t.cz * H + t.hd * H * lookup(torsoD, u) * shapeAt(t.shape, Math.PI / 2) * LOOSE * (1 + bustMod(u)) + 0.004 * H; };
    const yK = pos.Neck[1] - 0.012 * H, yB = Y(lerp(L.hip, L.chest, 0.35));
    const rings = [[yK + 0.006 * H, 0.012], [yK - 0.012 * H, 0.008], [lerp(yK, yB, 0.7), 0.018], [yB, 0.02]].map(([y, w]) => (
      { c: [0, y, zf(y)], u: [1, 0, 0], v: [0, 0, 1], rx: w * H * 0.5, ry: 0.004 * H, w: weightsAlong(y, [['Spine', pos.Chest[1]], ['Chest', Infinity]], 0.03 * H) }));
    mb.mat = () => 'Accent';
    mb.tube(rings, 4, null, add(rings[3].c, [0, -0.02 * H, 0]));
  }

  // ---------- arms (sleeve with cuff, mitten hand) ----------
  for (const side of ['Left', 'Right']) {
    const { sh, dir, uA } = arms[side];
    const sleeveEnd = tank ? -1 : Math.min(look.sleeveT, 1) * wristU; // fraction of the full arm length (-1: sleeveless)
    const segs = [[side + 'Shoulder', 0.02], [side + 'UpperArm', elbowU], [side + 'LowerArm', wristU], [side + 'Hand', Infinity]];
    const AU = [...new Set([-0.09, -0.035, 0.06, 0.13, 0.2, 0.32, elbowU - 0.04, elbowU, elbowU + 0.05, 0.58, 0.66, 0.74, wristU - 0.03, wristU, wristU + 0.03, 0.87, 0.93, 0.962])].sort((a, b) => a - b);
    const rings = [];
    const rootDir = norm([-Math.sign(dir[0]), 0.3, 0]);
    // Near the joint the T-pose slice also cuts the torso side: cap the root
    // rings at the deltoid size so the shoulder stays round.
    const delt = armS(0.2);
    const ring = (u, scale) => {
      let s = armS(clamp(u, 0.06, 0.985));
      if (u < 0.2) {
        const t = clamp(u / 0.2, 0, 1);
        s = { ...s, cx: lerp(delt.cx, s.cx, t), hw: Math.min(s.hw, delt.hw * lerp(0.9, 1, t)), hd: Math.min(s.hd, delt.hd * lerp(0.9, 1, t)), shape: delt.shape };
      }
      const f = u > wristU ? Math.sqrt(fa) : fa;
      // Fingers curl slightly towards the palm (palm = -uA).
      const curl = u > wristU + 0.04 ? -0.02 * H * ((u - wristU - 0.04) / (1 - wristU - 0.04)) ** 2 : 0;
      // The buried root (u < 0) runs inward into the torso, not up along a
      // hanging arm, so it can't poke out above the shoulder.
      const along = u < 0 ? mul(rootDir, -u * armLen) : mul(dir, armLen * u);
      const c = add(add(sh, along), mul(uA, (s.cx - L.shoulder[1]) * H + curl));
      const flat = u < 0.2 ? lerp(0.9, 1, clamp(u / 0.2, 0, 1)) : 1; // flatter top at the arm root
      rings.push({ c: add(c, [0, 0, (s.cz - L.shoulder[2]) * H]), u: uA, v: [0, 0, 1], rx: s.hw * H * f * scale * flat, ry: s.hd * H * f * scale, shape: s.shape, w: weightsAlong(u, segs, 0.035) });
    };
    let cuffDone = sleeveEnd >= 0.985 || sleeveEnd < 0;
    for (const u of AU) {
      if (!cuffDone && u > sleeveEnd) { ring(sleeveEnd, LIP); ring(sleeveEnd + 0.006, 1); cuffDone = true; }
      // The root ring is buried in the torso: keep it small so it can't poke out.
      ring(u, u < -0.06 ? 0.72 : u < 0 ? 0.9 : u > 0.95 ? 0.72 : u <= sleeveEnd ? LOOSE : 1); // blunt fingertips
    }
    mb.mat = (c) => (dot(sub(c, sh), dir) / armLen <= sleeveEnd + 0.003 ? 'Top' : 'Skin');
    surf.arm[side] = surface(rings.filter((r, i) => i === 0 || dot(sub(r.c, rings[i - 1].c), dir) > 0));
    mb.tube(rings, D.limb, add(sh, mul(rootDir, armLen * 0.1)), add(add(sh, mul(dir, armLen * 0.972)), mul(uA, -0.018 * H))); // rounded mitten tip

    // Thumb: from the side of the palm, pointing forward and down along the hand.
    const hs = armS(wristU + 0.05);
    const base = add(add(sh, mul(dir, armLen * (wristU + 0.035))), add([0, 0, (hs.cz - L.shoulder[2]) * H + hs.hd * H * 0.55], mul(uA, -0.006 * H)));
    const td = norm(add(add(mul(dir, 0.65), [0, 0, 0.55]), mul(uA, -0.3)));
    const tl = 0.045 * H;
    const tv = norm(cross(td, uA));
    const trings = [0, 0.45, 0.85].map((f, i) => ({ c: add(base, mul(td, tl * f)), u: uA, v: tv, rx: [0.008, 0.0075, 0.0055][i] * H, ry: [0.009, 0.0085, 0.006][i] * H, w: { [side + 'Hand']: 1 } }));
    mb.mat = () => 'Skin';
    mb.tube(trings, 4, null, add(base, mul(td, tl)));
  }

  const heels = opts.shoes && opts.shoes !== 'auto' ? opts.shoes === 'heels' : !!look.heels;

  // ---------- legs (trousers with hem) + feet (shoes) ----------
  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    // Leg u (crotch -> ankle) where the trousers end; 2 = full length. Under a skirt the legs are bare.
    const trouserEnd = skirtY != null ? clamp((Y(L.crotch) - skirtY) / (Y(L.crotch) - Y(L.ankle[1])), 0, 1) - 0.06
      : bottomStyle === 'trousers' ? 2 : bottomStyle === 'shorts' ? (opts.shortsLength != null ? opts.shortsLength : !TP && look.trouserT < 0.6 ? look.trouserT : 0.2) : look.trouserT >= 1 ? 2 : look.trouserT; // shorts: the measured length when there is a reference
    const LUx = [...new Set([-0.12, ...LU.slice(0, -1), kneeU - 0.03, kneeU, kneeU + 0.04, 0.97, 1])].sort((a, b) => a - b);
    const rings = [];
    const ring = (u, scale) => {
      const st = legS(clamp(u, 0, 1));
      const y = Y(legY(u));
      const w = weightsAlong(-y, [['Hips', -hipYm + 0.02 * H], [side + 'UpperLeg', -pos[side + 'LowerLeg'][1]], [side + 'LowerLeg', -pos[side + 'Foot'][1] + 0.01 * H], [side + 'Foot', Infinity]], 0.03 * H);
      const sc = u < 0 ? 0.9 : scale;
      rings.push({
        c: [s * legCX(u), y, st.cz * H], u: [1, 0, 0], v: [0, 0, 1],
        rx: st.hw * H * lookup(legW, u) * sc, ry: st.hd * H * lookup(legD, u) * sc, shape: s > 0 ? st.shape : mirrorShape(st.shape), w,
      });
    };
    let hemDone = trouserEnd > 1;
    // Under a skirt only the legs just above the hem are ever visible.
    const legTopU = skirtY != null ? clamp((Y(L.crotch) - (skirtY + 0.06 * H)) / (Y(L.crotch) - Y(L.ankle[1])), 0, 1) : -1;
    for (const u of LUx.filter((u) => u >= legTopU)) {
      if (!hemDone && u > trouserEnd && skirtY == null) { ring(trouserEnd, LIP); ring(trouserEnd + 0.008, 1); hemDone = true; }
      ring(u, u <= trouserEnd ? LOOSE : 1);
    }
    const endY = skirtY != null ? Infinity : trouserEnd > 1 ? -Infinity : Y(legY(trouserEnd)); // bare legs under a skirt
    mb.mat = (c) => (c[1] >= endY - 0.002 * H ? 'Bottom' : 'Skin');
    mb.tube(rings, D.limb, null, add(rings[rings.length - 1].c, [0, -0.008 * H, 0]));
    surf.leg[side] = surface(rings);

    // Shoe: template foot sections from heel to toe (x/y rings along +Z).
    const footLen = (L.toeZ - L.heelZ) * H;
    const ballZ = pos[side + 'Toes'][2];
    const yScale = Y(L.ankle[1]) / (L.ankle[1] * H); // feet follow the leg's vertical scale
    // Heels: the rear of the shoe rises (toes stay on the floor) and stands on a
    // block heel. Women's shoes are a little slimmer.
    const lift = heels ? 0.036 * H : 0;
    const slim = female ? 0.86 : 1;
    const frings = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.82, 0.92, 1].map((u) => {
      const uu = lerp(0.02, 0.98, u);
      const st = footS(uu);
      const z = L.heelZ * H + footLen * uu;
      const rise = lift * clamp((0.62 - u) / 0.42, 0, 1) ** 0.8;
      const k = heels ? 0.8 : 1;
      return {
        c: [s * legCX(1) + s * (st.cx - legS(1).cx) * H, st.cz * H * yScale * k + rise, z], u: [1, 0, 0], v: [0, 1, 0],
        rx: st.hw * H * 1.04 * slim, ry: st.hd * H * yScale * 1.04 * k, shape: s > 0 ? st.shape : mirrorShape(st.shape),
        w: weightsAlong(z, [[side + 'Foot', ballZ], [side + 'Toes', Infinity]], 0.012 * H),
      };
    });
    mb.mat = () => 'Shoes';
    surf.foot[side] = surface(frings);
    mb.tube(frings, D.foot, add(frings[0].c, [0, 0, -0.006 * H]), add(frings[frings.length - 1].c, [0, -0.004 * H, 0.008 * H]));
    if (heels) {
      const hz = L.heelZ * H + footLen * 0.1, hx = frings[1].c[0], bw = 0.011 * H;
      const block = [[0, 0.85], [lift + 0.012 * H, 1]].map(([y, kk]) => ({ c: [hx, y, hz], u: [1, 0, 0], v: [0, 0, 1], rx: bw * kk, ry: bw * kk * 1.1, w: { [side + 'Foot']: 1 } }));
      mb.tube(block, 4, add(block[0].c, [0, -0.001 * H, 0]), null);
    }
  }

  // ---------- parts (kit.js + parts/): belts, soles, collars, buttons, hair locks, glasses ----------
  const partReport = [];
  if (opts.parts?.length) {
    const land = {
      crotch: Y(L.crotch), hip: Y(L.hip), waist: Y(lerp(L.hip, L.chest, 0.35)), chest: Y(L.chest), armpit: Y(L.armpit),
      neck: pos.Neck[1], head: pos.Head[1], top: Y(1), hem: look.hemY, knee: Y(L.knee[1]), ankle: Y(L.ankle[1]),
      eye: surf.eyes?.y ?? Y(lerp(L.head, 1, 0.5)), skirt: skirtY,
    };
    const ctx = { mb, H, pos, surf, land, look, bodyType, hairStyle, topStyle, bottomStyle, heels, female, D, eyeX: surf.eyes?.x ?? 0.016 * H };
    opts.parts.forEach((p, i) => { mb.tag = `${p.part}#${i}`; partReport.push({ part: p.part, triangles: buildPart(ctx, p) }); });
    mb.tag = 'body';
  }

  // ---------- normalise: feet on y = 0, total height exactly H ----------
  let minY = Infinity, maxY = -Infinity;
  for (const t of mb.tris) for (const p of t.p) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const rawHeight = maxY - minY;
  const k = H / rawHeight;
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
    const color = opts.palette?.[m] || (m === 'Accent' ? look.accent || opts.accentColor : m === 'Eyes' ? look.eyes : m === 'Trim' ? look.trim : look[m.toLowerCase()]) || FIXED[m];
    if (count) groups.push({ material: m, color, start, count });
    start += count;
  }

  const bones = BONES.map((name) => ({ name, parent: PARENT[name] ? BI[PARENT[name]] : -1, pos: pos[name] }));
  // Resolved style names for reports: skirt, shorts (legs bare above the knee) or trousers.
  const resolvedBottom = skirtY != null ? (pencil ? 'pencil' : 'skirt') : bottomStyle === 'shorts' || (bottomStyle === 'auto' && look.trouserT < 0.6) ? 'shorts' : 'trousers';
  // tags: which part made each triangle ('body' or 'belt#2'...), for the pose audit; not exported.
  return { bones, bodyType, hairStyle, topStyle, heels, bottomStyle: resolvedBottom, mesh: { position, normal, joints, weights, triangles: N, groups, tags: order.map((t) => t.tag) }, spec, rawHeight, parts: partReport };
}
