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
// the floor (0 = soles, 1 = top of the hair); half-widths and depths are
// fractions of that same height. Front half-widths exclude the arms; depths are
// the full front-to-back thickness in the side view.

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

const REQUIRED = ['eye', 'chin', 'neck', 'shoulder', 'armpit', 'crotch', 'knee'];

/** Problems with a measurements block (empty = valid). */
export function checkMeasurements(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['measurements must be an object'];
  for (const k of REQUIRED) if (!(m.landmarks?.[k] > 0 && m.landmarks[k] < 1)) errs.push(`landmarks.${k} must be a height fraction in (0, 1)`);
  if (m.face && ['eyeX', 'eyeWidth', 'iris'].some((k) => m.face[k] != null && !(m.face[k] > 0 && m.face[k] < 0.1))) errs.push('face.eyeX / eyeWidth / iris are small height fractions');
  for (const [k, n] of [['torso', 3], ['legs', 4], ['head', 3]]) {
    if (!Array.isArray(m[k]) || m[k].length < 2) errs.push(`${k} needs at least 2 rows`);
    else if (m[k].some((r) => !Array.isArray(r) || r.length !== n || r.some((x) => typeof x !== 'number'))) errs.push(`${k} rows are [${n === 3 ? 'h, halfWidth, depth' : 'h, centreOffset, halfWidth, depth'}]`);
  }
  if (!(m.arms?.length > 0)) errs.push('arms.length is required');
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
  const torsoAt = at((h) => { const [hw, d] = torso(h); return { hx: hw * H, zf: (d / 2) * H, zb: (-d / 2) * H }; });
  const legAtY = at((h) => { const [off, hw, d] = legs(h); return { off: off * H, hx: hw * H, half: hw * H, zf: (d / 2) * H, zb: (-d / 2) * H }; });
  const headAt = at((h) => { const [hw, d] = head(h); return { hx: hw * H, zf: (d / 2) * H, zb: (-d / 2) * H }; });
  const A = m.arms;
  const fromVertical = (A.fromVertical ?? 12) * Math.PI / 180;
  const shoulderOuter = m.shoulderHalfWidth ?? torso(L.shoulder)[0];
  const C = m.clothes || {}, Hr = m.hair || {};
  const kneeH = L.knee, crotchH = L.crotch, ankleH = L.ankle ?? 0.06;
  const trouserT = C.bottomHem == null ? 1 : Math.max(0.03, Math.min(1, (crotchH - C.bottomHem) / (crotchH - ankleH)));
  const spec = {
    manual: true,
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
    arm: { length: A.length * H, angle: Math.PI / 2 - fromVertical, upper: (A.upper ?? 0.04) * H, fore: (A.fore ?? 0.034) * H, hand: (A.hand ?? 0.03) * H },
    foot: null, footHalf: legs(ankleH)[1] * 1.6 * H,
    shape: {},
    face: m.face ? { eyeX: m.face.eyeX, eyeWidth: m.face.eyeWidth, iris: m.face.iris } : null,
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
      accent: null,
      skirtY: C.skirtHem != null ? C.skirtHem * H : null,
      heels: opts.shoes === 'heels',
    },
  };
  return spec;
}
