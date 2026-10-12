// Manual measurements -> body spec.
//
// The automatic measurement (measure.js) reads landmarks and widths from
// silhouettes with heuristics that hair, loose clothing or arms close to the
// body can confuse. Here a person (or Claude, in the character skill) measures
// the reference views instead and writes the numbers down; this module turns
// them into the same body spec the builder already consumes, flagged `manual`
// so the builder trusts them (wider limits, more landmarks).
//
// Units: heights `h` are fractions of the whole figure's height measured from
// the floor (0 = soles, 1 = top of the hair); half-widths and z positions are
// fractions of that same height. Front half-widths exclude the arms.
//
// Row formats (the longer, z-relative form is preferred):
//   torso [h, halfWidth, zFront, zBack]            legacy [h, halfWidth, depth]
//   legs  [h, centreOffset, halfWidth, zFront, zBack]   legacy [h, centreOffset, halfWidth, depth]
//   head  [h, halfWidth, zFront, zBack]            legacy [h, halfWidth, depth]
// z is the FORWARD distance from the ankle plumb line (the vertical through the
// ankle joint) read off the side view: the front edge of the body at that height
// is zFront (positive = in front of the plumb line), the back edge zBack (usually
// small or negative). This captures lean, bust, glutes and the back-shifting
// shin that a symmetric depth cannot.

const lerp = (a, b, t) => a + (b - a) * t;

/** Piecewise-linear lookup in a table of rows [h, ...values] sorted by h (any order accepted). */
function table(rows) {
  const r = rows.slice().sort((a, b) => a[0] - b[0]);
  return (h) => {
    if (h <= r[0][0]) return r[0].slice(1);
    if (h >= r[r.length - 1][0]) return r[r.length - 1].slice(1);
    let i = 0;
    while (r[i + 1][0] < h) i++;
    const t = (h - r[i][0]) / (r[i + 1][0] - r[i][0]);
    return r[i].slice(1).map((v, k) => lerp(v, r[i + 1][k + 1], t));
  };
}

/**
 * Adaptive ring stations: the fewest rows that reproduce the full table within
 * `tol` (fractions of the height) when interpolated linearly (greedy refinement:
 * start with the two ends, repeatedly add the row the current stations fit worst).
 * Triangles go where the silhouette actually turns (waist, knee, calf, chin).
 */
export function thinRows(rows, tol = 0.0012) {
  const r = rows.slice().sort((a, b) => a[0] - b[0]);
  if (r.length <= 2) return r;
  const keep = new Set([0, r.length - 1]);
  const at = (h) => {
    const idx = [...keep].sort((a, b) => a - b);
    let i = 0;
    while (i + 2 < idx.length && r[idx[i + 1]][0] < h) i++;
    const a = r[idx[i]], b = r[idx[i + 1]], t = (h - a[0]) / (b[0] - a[0] || 1);
    return a.slice(1).map((v, k) => lerp(v, b[k + 1], t));
  };
  for (let guard = 0; guard < r.length; guard++) {
    let worst = -1, we = 0;
    for (let i = 1; i < r.length - 1; i++) {
      if (keep.has(i)) continue;
      const est = at(r[i][0]), e = Math.max(...r[i].slice(1).map((v, k) => Math.abs(v - est[k])));
      if (e > we) { we = e; worst = i; }
    }
    if (worst < 0 || we <= tol) break;
    keep.add(worst);
  }
  return [...keep].sort((a, b) => a - b).map((i) => r[i]);
}

const REQUIRED = ['eye', 'chin', 'neck', 'shoulder', 'armpit', 'crotch', 'knee'];

/** Problems with a measurements block (empty = valid). */
export function checkMeasurements(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['measurements must be an object'];
  for (const k of REQUIRED) if (!(m.landmarks?.[k] > 0 && m.landmarks[k] < 1)) errs.push(`landmarks.${k} must be a height fraction in (0, 1)`);
  if (m.face && ['eyeX', 'eyeWidth', 'iris'].some((k) => m.face[k] != null && !(m.face[k] > 0 && m.face[k] < 0.1))) errs.push('face.eyeX / eyeWidth / iris are small height fractions');
  for (const [k, n] of [['torso', 3], ['legs', 4], ['head', 3]]) {
    if (!Array.isArray(m[k]) || m[k].length < 2) errs.push(`${k} needs at least 2 rows`);
    else if (m[k].some((r) => !Array.isArray(r) || (r.length !== n && r.length !== n + 1) || r.some((x) => typeof x !== 'number'))) errs.push(`${k} rows are [${k === 'legs' ? 'h, centreOffset, halfWidth, zFront, zBack' : 'h, halfWidth, zFront, zBack'}] (or the legacy depth form)`);
    else if (m[k].some((r) => r[0] <= 0 || r[0] >= 1.001)) errs.push(`${k}: row heights must be fractions in (0, 1]`);
    else if (m[k].some((r) => r.length === n + 1 && r[r.length - 2] < r[r.length - 1])) errs.push(`${k}: zFront must be >= zBack (forward positive)`);
  }
  if (!(m.arms?.length > 0)) errs.push('arms.length is required');
  if (m.arms?.rows && (!m.arms.shoulder || !m.arms.elbow || !m.arms.wrist || m.arms.rows.some((r) => r.length !== 5))) errs.push('arms.rows are [h, centreX, halfWidth, halfThickness, z] and need arms.shoulder / elbow / wrist heights');
  const L = m.landmarks || {};
  if (L.crotch && L.knee && L.knee >= L.crotch) errs.push('landmarks: knee must be below crotch');
  if (L.chin && L.eye && L.eye <= L.chin) errs.push('landmarks: eye must be above chin');
  return errs;
}

/**
 * Build a body spec (the shape measure.js produces) from manual measurements.
 * look: { skin, hair, top, bottom, shoes } colours; options: hair style, heels, top.
 */
export function bodyFromMeasurements(m, H, look, opts = {}) {
  const L = m.landmarks, torso = table(m.torso), legs = table(m.legs), head = table(m.head);
  const at = (f) => (y) => f(y / H);
  // Rows in the z-relative form carry zFront/zBack; legacy rows a symmetric depth.
  const zRel = m.torso.every((r) => r.length === 4) && m.legs.every((r) => r.length === 5) && m.head.every((r) => r.length === 4);
  const zz = (a, b, legacy) => (legacy ? { zf: (a / 2) * H, zb: (-a / 2) * H } : { zf: a * H, zb: b * H });
  const torsoAt = at((h) => { const r = torso(h); return { hx: r[0] * H, ...zz(r[1], r[2], r.length === 2) }; });
  const legAtY = at((h) => { const r = legs(h); return { off: r[0] * H, hx: r[1] * H, half: r[1] * H, ...zz(r[2], r[3], r.length === 3) }; });
  const headAt = at((h) => { const r = head(h); return { hx: r[0] * H, ...zz(r[1], r[2], r.length === 2) }; });
  const A = m.arms;
  const fromVertical = (A.fromVertical ?? 12) * Math.PI / 180;
  const shoulderOuter = m.shoulderHalfWidth ?? torso(L.shoulder)[0];
  const C = m.clothes || {}, Hr = m.hair || {};
  const kneeH = L.knee, crotchH = L.crotch, ankleH = L.ankle ?? 0.06;
  const trouserT = C.bottomHem == null ? 1 : Math.max(0.03, Math.min(1, (crotchH - C.bottomHem) / (crotchH - ankleH)));
  const spec = {
    manual: true,
    zRel,
    rowY: { torso: thinRows(m.torso).map((r) => r[0] * H), legs: thinRows(m.legs).map((r) => r[0] * H), head: thinRows(m.head).map((r) => r[0] * H) },
    height: H,
    notes: ['manual measurements'],
    detected: { neck: true, crotch: true, arms: 2 },
    landmarks: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v * H])),
    neckY: L.neck * H, shoulderY: L.shoulder * H, crotchY: crotchH * H,
    chestY: (L.bust ?? lerp(L.armpit, L.crotch, 0.2)) * H, waistY: (L.waist ?? lerp(L.armpit, L.crotch, 0.55)) * H,
    hipY: (L.hip ?? crotchH + 0.03) * H, kneeY: kneeH * H, ankleY: ankleH * H,
    // measure.js convention: 0.82 x the outer shoulder half-width (deltoids included).
    shoulderX: shoulderOuter * 0.82 * H,
    hipX: legs(crotchH - 0.02)[0] * H,
    armRows: A.rows ? thinRows(A.rows, 0.0012).map(([h, cx, hw, hd, z]) => [h * H, cx * H, hw * H, hd * H, z * H]) : undefined,
    arm: { ...(A.rows ? { shoulderY: A.shoulder * H, elbowY: A.elbow * H, wristY: A.wrist * H } : {}), z: A.z != null ? A.z * H : null, length: A.length * H, angle: Math.PI / 2 - fromVertical, upper: (A.upper ?? 0.04) * H, fore: (A.fore ?? 0.034) * H, hand: (A.hand ?? 0.03) * H },
    foot: null, footHalf: legs(ankleH)[1] * 1.6 * H,
    shape: {},
    hair: m.hair ? {
      thickness: m.hair.thickness != null ? m.hair.thickness * H : undefined,
      temple: m.hair.temple != null ? m.hair.temple * H : undefined,
      sheet: m.hair.sheet ? thinRows(m.hair.sheet, 0.0025).map(([h, hw, zf, zb]) => [h * H, hw * H, zf * H, zb * H]) : undefined,
      locks: m.hair.locks ? m.hair.locks.map((l) => ({ x: l.x * H, hw: l.hw * H, hd: l.hd * H, z: l.z * H, y0: l.h0 * H, y1: l.h1 * H })) : undefined,
    } : null,
    face: m.face ? {
      ...m.face,
      noseY: m.face.noseY != null ? m.face.noseY * H : undefined, mouthY: m.face.mouthY != null ? m.face.mouthY * H : undefined, earY: m.face.earY != null ? m.face.earY * H : undefined,
    } : null,
    shoe: m.shoe ? {
      toeZ: m.shoe.toeZ != null ? m.shoe.toeZ * H : undefined, heelZ: m.shoe.heelZ != null ? m.shoe.heelZ * H : undefined, width: m.shoe.width,
      lift: m.shoe.lift != null ? m.shoe.lift * H : undefined, centreX: m.shoe.centreX != null ? m.shoe.centreX * H : undefined,
      heel: m.shoe.heel ? Object.fromEntries(Object.entries(m.shoe.heel).map(([k, v]) => [k, v * H])) : undefined,
    } : null,
    torsoAt, legAtY, headAt,
    look: {
      ...look,
      hemY: (C.topHem ?? lerp(L.crotch, L.armpit, 0.25)) * H,
      sleeveT: C.sleeve ?? (opts.top === 'tank' ? 0 : 0.45),
      trouserT,
      hasHair: opts.hair !== 'bald',
      hairlineY: (L.hairline ?? lerp(L.eye, 1, 0.55)) * H,
      hairBackY: (Hr.back ?? L.neck) * H,
      hairEndY: Hr.end != null ? Hr.end * H : null,
      hairStyle: opts.hair && opts.hair !== 'auto' ? opts.hair : null,
      necklineY: C.neckline != null ? C.neckline * H : null,
      hemV: C.topHemSide != null ? { side: C.topHemSide * H, xs: (C.topHemHalf ?? 0.078) * H } : null,
      shortsHem: C.shortsHem ? C.shortsHem.map((v) => v * H) : null,
      strapX: C.strapX != null ? C.strapX * H : null, strapW: C.strapWidth != null ? C.strapWidth * H / 2 : null,
      accent: null,
      skirtY: C.skirtHem != null ? C.skirtHem * H : null,
      heels: opts.shoes === 'heels',
    },
  };
  return spec;
}
