// Measurement: reads landmarks and widths off the silhouettes and produces a
// "body spec" in metres. Vertical landmarks are detected where the silhouette
// makes them obvious (neck = narrowest point under the head, crotch = where the
// gap between the legs closes, ...) and fall back to classic figure-drawing
// proportions when it does not (hoods, dresses, odd poses).

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DEG = Math.PI / 180;

/**
 * @param {import('./silhouette.js').Silhouette} front required
 * @param {import('./silhouette.js').Silhouette|null} side optional (profile view)
 * @param {import('./silhouette.js').Silhouette|null} back optional
 * @param {{height?:number}} opts
 */
export function measureBody(front, side, back, opts = {}) {
  const H = opts.height ?? 1.7;
  const F = front;
  const Hp = F.heightPx;
  const mF = H / Hp; // metres per front pixel
  const notes = [];
  const detected = { neck: true, crotch: true, arms: 0 };

  // Head centre column = vertical axis of the body in the front view.
  let cx = 0, n = 0;
  for (let v = 0.01; v <= 0.07; v += 0.005) {
    const r = F.runNear(F.rowAt(v), (F.bbox.x0 + F.bbox.x1) / 2);
    if (r) { cx += (r[0] + r[1]) / 2; n++; }
  }
  cx = n ? cx / n : (F.bbox.x0 + F.bbox.x1) / 2;

  const centralRun = (v) => F.runNear(F.rowAt(v), cx);
  const centralHalf = (v) => { const r = centralRun(v); return r ? (r[1] - r[0] + 1) / 2 : 0; };

  // --- Neck: narrowest central width below the widest part of the head.
  let headMaxV = 0.06, headMaxW = 0;
  for (let v = 0.02; v <= 0.12; v += 0.004) { const w = centralHalf(v); if (w > headMaxW) { headMaxW = w; headMaxV = v; } }
  let neckV = 0.14, neckW = Infinity;
  for (let v = headMaxV; v <= 0.24; v += 0.004) { const w = centralHalf(v); if (w < neckW) { neckW = w; neckV = v; } }
  // The neck is a narrow stretch, not a point: take the middle of the rows
  // within a few % of the minimum.
  let neckHidden = false;
  {
    let a = neckV, b = neckV;
    while (a - 0.004 >= headMaxV && centralHalf(a - 0.004) <= neckW * 1.06) a -= 0.004;
    while (b + 0.004 <= 0.24 && centralHalf(b + 0.004) <= neckW * 1.06) b += 0.004;
    neckV = (a + b) / 2;
    // A real neck widens gradually into the jaw; a sharp step right above it
    // is the hem of hanging hair (a bob) hiding most of the neck.
    neckHidden = centralHalf(a - 0.008) > neckW * 1.45;
  }
  // A visible neck is clearly narrower than the head; otherwise hair (a bob)
  // or a collar hides it.
  if (neckW > headMaxW * 0.8 || neckHidden) { neckV = 0.14; neckW = headMaxW * 0.6; notes.push('neck not visible - using proportions'); detected.neck = false; }
  neckV = clamp(neckV, 0.1, 0.2);

  // --- Shoulders: first row where the body gets much wider than the neck.
  let shoulderTopV = neckV + 0.04;
  for (let v = neckV; v <= neckV + 0.1; v += 0.003) { if (centralHalf(v) > neckW * 2.2) { shoulderTopV = v; break; } }
  shoulderTopV = clamp(shoulderTopV, neckV + 0.015, neckV + 0.08);
  const shoulderV = shoulderTopV + 0.025; // joint sits a little below the top of the shoulder

  // --- Crotch: walk up from the shins while there is a gap between the legs.
  // A gap that only opens far below the hips is the hem of a skirt, not the crotch.
  // The gap is tracked row by row (it need not sit exactly under the head centre:
  // parted hair or a tilted head shift that column by a few pixels).
  let crotchV = 0.52, skirtHemV = null;
  const gapNear = (v, near) => {
    const row = F.runs[F.rowAt(v)];
    let best = null;
    for (let i = 0; i + 1 < row.length; i++) {
      const g0 = row[i][1] + 1, g1 = row[i + 1][0] - 1, gc = (g0 + g1) / 2;
      if (g1 < g0 || Math.abs(gc - near) > Hp * 0.03) continue;
      if (!best || Math.abs(gc - near) < Math.abs(best - near)) best = gc;
    }
    return best;
  };
  let gapX = gapNear(0.88, cx);
  if (gapX != null) {
    let v = 0.88;
    for (;;) {
      if (v <= 0.38) break;
      let g = gapNear(v - 0.003, gapX);
      if (g == null) {
        // Knees (or calves) touching close the gap briefly: look a little higher.
        let skip = 0.006;
        for (; skip <= 0.05 && g == null; skip += 0.003) g = gapNear(v - skip, gapX);
        if (g == null) break;
        v -= skip - 0.003;
      }
      gapX = g; v -= 0.003;
    }
    // Skirt or crotch? Below a skirt hem the legs sit well inside the hem's outer
    // edges (a step inwards); below shorts/trousers the legs' outer edges carry on.
    const above = F.runNear(F.rowAt(v - 0.012), gapX);
    const below = F.runs[F.rowAt(Math.min(v + 0.025, 0.97))];
    let left = null, right = null;
    for (const r of below) { if (r[1] < gapX && (!left || r[1] > left[1])) left = r; if (r[0] > gapX && (!right || r[0] < right[0])) right = r; }
    const step = above && left && right ? (right[1] - left[0] + 1) / (above[1] - above[0] + 1) : 1;
    detected.legStep = +step.toFixed(3); detected.gapTopV = +v.toFixed(3);
    if (step < 0.94 && v > 0.5) { skirtHemV = v; detected.crotch = false; notes.push('skirt or dress detected'); }
    // The visible gap opens a little below the true crotch where the thighs
    // meet; -0.01 of height is calibrated on the ground-truth benchmark.
    else crotchV = v - 0.01;
  } else { notes.push('no gap between legs - long skirt, dress or robe?'); detected.crotch = false; skirtHemV = 'long'; }
  crotchV = clamp(crotchV, 0.42, 0.62);

  // --- Pose: T-pose arms make the shoulder row extremely wide.
  const tpose = centralHalf(shoulderV + 0.01) * 2 > Hp * 0.55;
  if (tpose) notes.push('T-pose detected');

  let shoulderHalf = tpose ? centralHalf(shoulderV + 0.12) * 1.2 : centralHalf(shoulderV + 0.02);
  shoulderHalf = clamp(shoulderHalf, 0.08 * Hp, 0.17 * Hp);
  const torsoHalfPx = (v) => Math.min(centralHalf(v), shoulderHalf * 1.08);

  // --- Legs (per side; then symmetrised for a clean rig).
  const legRun = (v, s) => {
    const y = F.rowAt(v);
    const guess = cx + s * shoulderHalf * 0.45;
    const r = F.runNear(y, guess);
    if (!r) return null;
    // Merged legs / dress: split the run at the centre line.
    if (r[0] < cx && r[1] > cx) return s > 0 ? [cx, r[1]] : [r[0], cx];
    return r;
  };
  const legAt = (v) => {
    const out = { off: 0, half: 0 };
    let k = 0;
    for (const s of [-1, 1]) {
      const r = legRun(v, s);
      if (!r) continue;
      out.off += Math.abs((r[0] + r[1]) / 2 - cx); out.half += (r[1] - r[0] + 1) / 2; k++;
    }
    if (!k) return { off: shoulderHalf * 0.45, half: shoulderHalf * 0.35 };
    out.off /= k; out.half /= k;
    // Guard against legs swallowing a hand that touches the thigh.
    out.half = Math.min(out.half, shoulderHalf * 0.6);
    return out;
  };
  const hipOffPx = clamp(legAt(crotchV + 0.04).off, shoulderHalf * 0.25, shoulderHalf * 0.7);

  // --- Arms: farthest silhouette pixel from the shoulder on each side = fingertip.
  const arms = [];
  for (const s of [-1, 1]) {
    const sx = cx + s * shoulderHalf * 0.82, sy = F.rowAt(shoulderV);
    let tip = null, best = 0, count = 0;
    const rowSum = new Map(); // y -> [sum x, n] of arm pixels, for the axis fit
    const yEnd = F.rowAt(Math.min(crotchV + 0.3, 0.92));
    for (let y = F.rowAt(shoulderV - 0.03); y <= yEnd; y++) {
      const v = (y - F.bbox.y0) / (Hp - 1);
      let inner = torsoHalfPx(v) + 2;
      if (v > crotchV) { const r = legRun(v, s); if (r) inner = Math.max(inner, s > 0 ? r[1] - cx + 2 : cx - r[0] + 2); }
      // The body core at this height = every run overlapping the central zone
      // (torso, hips, legs). Arm pixels lie outside it - unless the core is so
      // wide that the arms have merged into it (T-pose, arms against the sides).
      let lo = Infinity, hi = -Infinity;
      for (const r of F.runs[y]) if (r[1] >= cx - shoulderHalf * 0.6 && r[0] <= cx + shoulderHalf * 0.6) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); }
      if (hi >= lo && (hi - lo + 1) / 2 <= shoulderHalf * 1.25) inner = Math.max(inner, s > 0 ? hi - cx + 2 : cx - lo + 2);
      for (const r of F.runs[y]) for (let x = r[0]; x <= r[1]; x++) {
        if (s * (x - cx) <= inner) continue;
        count++;
        const rs = rowSum.get(y) || [0, 0]; rs[0] += x; rs[1]++; rowSum.set(y, rs);
        const d = (x - sx) ** 2 + (y - sy) ** 2;
        if (d > best) { best = d; tip = [x, y]; }
      }
    }
    if (!tip || count < Hp * Hp * 0.002) { arms.push(null); continue; }
    const len = Math.sqrt(best);
    const dx = Math.abs(tip[0] - sx), dy = tip[1] - sy;
    let angle = Math.atan2(dy, dx); // below horizontal (shoulder estimate -> tip)
    // Better: fit a line through the arm's centre row by row (upper arm to wrist),
    // which does not depend on where we guessed the shoulder joint to be.
    // axisX(y): the arm's centre line in image pixels.
    let axisX = (y) => sx + (tip[0] - sx) * ((y - sy) / (tip[1] - sy || 1));
    {
      const pts = [];
      for (const [y, [sum, n]] of rowSum) if (n >= 2 && y > sy + Hp * 0.04 && y < tip[1] - Hp * 0.04) pts.push([y, sum / n]);
      if (pts.length >= 8) {
        const my = pts.reduce((a, p) => a + p[0], 0) / pts.length, mx = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        let num = 0, den = 0;
        for (const [y, x] of pts) { num += (y - my) * (x - mx); den += (y - my) ** 2; }
        const k = num / den; // dx per dy (signed)
        angle = Math.atan2(1, Math.abs(k));
        axisX = (y) => mx + k * (y - my);
      }
    }
    // Points along the axis: t = 0 at shoulder height, 1 at the fingertip row.
    const axisAt = (t) => { const y = sy + (tip[1] - sy) * t; return [axisX(y), y]; };
    const [ax0, ay0] = axisAt(0), [ax1, ay1] = axisAt(1);
    const alen = Math.hypot(ax1 - ax0, ay1 - ay0) || 1;
    // Thickness: march perpendicular to the arm axis.
    const ux = (ax1 - ax0) / alen, uy = (ay1 - ay0) / alen;
    const thick = (t) => {
      const [px, py] = axisAt(t);
      let a = 0, b = 0;
      while (a < Hp * 0.06 && F.on(px - uy * a, py + ux * a)) a++;
      while (b < Hp * 0.06 && F.on(px + uy * b, py - ux * b)) b++;
      // Arms often touch the torso on the inner side: trust the outer half.
      return 2 * Math.min(a, b);
    };
    // Colour along the arm axis (used to find where the sleeve ends).
    const sample = (t) => { const [x, y] = axisAt(t); return F.sampleColor(x, y); };
    (detected.armTips ??= []).push({ side: s, shoulder: [+((sx - cx) / Hp).toFixed(3), +((sy - F.bbox.y0) / Hp).toFixed(3)], tip: [+((tip[0] - cx) / Hp).toFixed(3), +((tip[1] - F.bbox.y0) / Hp).toFixed(3)] });
    const upper = thick(0.28), fore = thick(0.62);
    // Torso edge on this side at row y: walk from the arm's centre towards the
    // body; past the arm-torso gap the next body pixel is the torso. If the arm
    // touches the body there is no gap: use the arm's inner edge instead.
    const torsoEdge = (y) => {
      if (y < sy + Hp * 0.04 || y > tip[1] - Hp * 0.06) return null;
      let x = Math.round(axisX(y));
      const half = (y - sy) / (tip[1] - sy) < 0.45 ? upper / 2 : fore / 2;
      const step = -s;
      let i = 0;
      while (i < Hp * 0.12 && F.on(x, y)) { x += step; i++; } // through the arm
      const gapStart = x;
      while (i < Hp * 0.2 && !F.on(x, y)) { x += step; i++; }  // across the gap
      if (x === gapStart) return Math.abs(axisX(y) - cx) - half; // touching
      return Math.abs(x - cx);
    };
    arms.push({ len, angle, upper, fore, hand: thick(0.9), sample, axisAt, torsoEdge });
  }
  const good = arms.filter(Boolean);
  detected.arms = good.length;
  if (good.length < 2) notes.push(good.length ? 'one arm not found - mirrored the other' : 'arms not found - using default A-pose');
  const avg = (k, def) => good.length ? good.reduce((a, b) => a + b[k], 0) / good.length : def;
  const arm = {
    length: clamp(avg('len', Hp * 0.42), Hp * 0.3, Hp * 0.5) * mF,
    angle: clamp(avg('angle', 50 * DEG), 0, 88 * DEG),
    upper: clamp(avg('upper', Hp * 0.055), Hp * 0.03, Hp * 0.09) * mF,
    fore: clamp(avg('fore', Hp * 0.045), Hp * 0.025, Hp * 0.08) * mF,
    hand: clamp(avg('hand', Hp * 0.05), Hp * 0.03, Hp * 0.08) * mF,
  };

  // Torso half-width with the arms excluded: where an arm hangs close to the
  // body the central run includes it, so cap it at the torso edge found beside
  // each arm (median of both sides).
  const torsoHalf = (v) => {
    const base = torsoHalfPx(v), y = F.rowAt(v);
    const edges = good.map((a) => a.torsoEdge(y)).filter((e) => e != null && e > 0);
    if (!edges.length) return base;
    edges.sort((a, b) => a - b);
    return Math.min(base, edges[edges.length >> 1] + 1);
  };

  // --- Side view: depth profile. Feet point forward, which tells us facing.
  let sideInfo = null;
  if (side) {
    const S = side;
    const calf = S.runNear(S.rowAt(0.85), (S.bbox.x0 + S.bbox.x1) / 2);
    const ankle = S.runNear(S.rowAt(0.93), calf ? (calf[0] + calf[1]) / 2 : (S.bbox.x0 + S.bbox.x1) / 2);
    const foot = S.runNear(S.rowAt(0.99), ankle ? (ankle[0] + ankle[1]) / 2 : (S.bbox.x0 + S.bbox.x1) / 2);
    const zc = ankle ? (ankle[0] + ankle[1]) / 2 : (S.bbox.x0 + S.bbox.x1) / 2;
    const footC = foot ? (foot[0] + foot[1]) / 2 : zc;
    const sign = footC >= zc ? 1 : -1;
    const mS = H / S.heightPx;
    sideInfo = { S, zc, sign, mS };
    if (Math.abs(footC - zc) < 1) notes.push('could not tell side-view facing from the feet - assuming facing right');
  } else notes.push('no side view - depth estimated from width');

  // depth(v, x-hint px from centre line) -> {zf, zb} in metres, or null
  const depthAt = (v, hintZ = 0) => {
    if (!sideInfo) return null;
    const { S, zc, sign, mS } = sideInfo;
    const r = S.runNear(S.rowAt(v), zc + sign * hintZ / mS);
    if (!r) return null;
    const a = sign * (r[0] - zc) * mS, b = sign * (r[1] + 1 - zc) * mS;
    return { zf: Math.max(a, b), zb: Math.min(a, b) };
  };

  const Y = (v) => H * (1 - v);
  const V = (y) => 1 - y / H;

  // Torso cross-section at height y (metres): half width x, front z, back z.
  const torsoAt = (y) => {
    const v = V(y);
    const hx = torsoHalf(v) * mF;
    const d = depthAt(v);
    if (d && d.zf - d.zb > 0.02 * H) {
      // In profile, a hanging arm overlaps the chest; cap the depth to something sane.
      const depth = Math.min(d.zf - d.zb, hx * 1.6);
      const mid = (d.zf + d.zb) / 2;
      return { hx, zf: mid + depth / 2, zb: mid - depth / 2 };
    }
    return { hx, zf: hx * 0.65, zb: -hx * 0.65 };
  };
  const headAt = (y) => {
    const v = V(y);
    const hx = Math.max(centralHalf(v), 1) * mF;
    const d = depthAt(v, 0);
    if (d && d.zf - d.zb > 0.01 * H) return { hx, zf: d.zf, zb: d.zb };
    return { hx, zf: hx * 1.1, zb: -hx * 1.1 };
  };
  const legAtY = (y) => {
    const v = V(y);
    const l = legAt(v);
    const hx = l.half * mF;
    const d = depthAt(v);
    if (d) {
      const depth = clamp(d.zf - d.zb, hx * 1.2, hx * 2.6);
      const mid = (d.zf + d.zb) / 2;
      return { off: l.off * mF, hx, zf: mid + depth / 2, zb: mid - depth / 2 };
    }
    return { off: l.off * mF, hx, zf: hx, zb: -hx };
  };

  // Foot from the bottom rows of the side view.
  let foot = { heelZ: -0.04 * H, toeZ: 0.11 * H };
  const fd = depthAt(0.99);
  if (fd && fd.zf - fd.zb > 0.06 * H) foot = { heelZ: clamp(fd.zb, -0.08 * H, 0), toeZ: clamp(fd.zf, 0.05 * H, 0.18 * H) };

  const crotchY = Y(crotchV);
  const shoulderY = Y(shoulderV);
  // Shape features for classifying the body (normalised, pose-independent):
  // waist/hip width (front), chest/waist depth (side = bust), head height ratio.
  const shape = (() => {
    let waist = Infinity, waistV = shoulderV + 0.15, hip = 0;
    for (let v = shoulderV + 0.1; v <= crotchV - 0.06; v += 0.005) { const w = torsoHalf(v); if (w < waist) { waist = w; waistV = v; } }
    for (let v = waistV; v <= crotchV - 0.005; v += 0.005) hip = Math.max(hip, torsoHalf(v));
    let bust = null;
    if (sideInfo) {
      const dep = (v) => { const d = depthAt(v); return d ? d.zf - d.zb : null; };
      let chest = 0, wd = Infinity;
      for (let v = shoulderV + 0.03; v <= shoulderV + 0.12; v += 0.005) chest = Math.max(chest, dep(v) ?? 0);
      for (let v = waistV - 0.03; v <= waistV + 0.03; v += 0.005) { const d = dep(v); if (d) wd = Math.min(wd, d); }
      if (chest && isFinite(wd)) bust = chest / wd;
    }
    return { waistHip: waist / Math.max(hip, 1), hipShoulder: hip / shoulderHalf, bust, head: detected.neck ? neckV : null, headW: headMaxW / shoulderHalf };
  })();
  const spec = {
    shape,
    height: H,
    tpose,
    notes,
    detected,
    neckY: Y(neckV),
    shoulderY,
    chestY: shoulderY - (shoulderY - crotchY) * 0.28,
    waistY: shoulderY - (shoulderY - crotchY) * 0.62,
    crotchY,
    hipY: crotchY + 0.035 * H,
    kneeY: crotchY * 0.5 + 0.02 * H,
    ankleY: 0.045 * H,
    shoulderX: shoulderHalf * 0.82 * mF,
    hipX: hipOffPx * mF,
    arm,
    foot,
    footHalf: clamp(legAt(0.97).half * mF, 0.025 * H, 0.06 * H),
    torsoAt, headAt, legAtY,
  };

  // Flat colours per body part + clothing boundaries, read off the photos.
  spec.look = measureLook({ F, cx, mF, H, back, spec, neckV, shoulderV, crotchV, arms: good, shoulderHalf, neckW, skirtHemV });
  spec.look.heels = side ? detectHeels(side) : false;
  if (spec.look.heels) notes.push('heels detected');
  return spec;
}

// Average colour over a rectangle of masked pixels (image px). null if empty.
function regionColor(S, x0, y0, x1, y1) {
  const { data } = S.img;
  let r = 0, g = 0, b = 0, n = 0, edge = 0;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(S.h - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(S.w - 1, Math.ceil(x1)); x++) {
      if (!S.mask[y * S.w + x]) continue;
      // Skip edge pixels: anti-aliasing blends them with the backdrop.
      if (!S.on(x - 2, y) || !S.on(x + 2, y) || !S.on(x, y - 2) || !S.on(x, y + 2)) { edge++; continue; }
      const i = (y * S.w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  if (!n && edge) return regionColorAll(S, x0, y0, x1, y1); // thin region: use what there is
  return n ? [r / n, g / n, b / n] : null;
}
function regionColorInterior(S, x0, y0, x1, y1) {
  const { data } = S.img;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(S.h - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(S.w - 1, Math.ceil(x1)); x++) {
      if (!S.mask[y * S.w + x] || !S.on(x - 2, y) || !S.on(x + 2, y) || !S.on(x, y - 2) || !S.on(x, y + 2)) continue;
      const i = (y * S.w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return n ? [r / n, g / n, b / n] : null;
}
function regionColorAll(S, x0, y0, x1, y1) {
  const { data } = S.img;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(S.h - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(S.w - 1, Math.ceil(x1)); x++) {
      if (!S.mask[y * S.w + x]) continue;
      const i = (y * S.w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  return n ? [r / n, g / n, b / n] : null;
}
const cdist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/**
 * One clean colour per part (Skin, Hair, Top, Bottom, Shoes) and where the
 * clothes end: hem height, sleeve length, trouser length and hair coverage.
 */
/**
 * Heels: in profile, a heel is a narrow post standing under the back of the
 * shoe for several rows above the floor; flat shoes have a continuous sole.
 */
function detectHeels(S) {
  const maxW = Math.max(2, S.heightPx * 0.012);
  const posts = new Map(); // x bucket -> consecutive rows seen
  let best = 0;
  for (let v = 0.96; v <= 0.996; v += 0.004) {
    const row = S.runs[S.rowAt(v)];
    const seen = new Set();
    for (const r of row) {
      if (r[1] - r[0] + 1 > maxW) continue;
      const key = Math.round((r[0] + r[1]) / 2 / 3);
      const n = Math.max(posts.get(key) || 0, posts.get(key - 1) || 0, posts.get(key + 1) || 0) + 1;
      seen.add(key); posts.set(key, n); best = Math.max(best, n);
    }
    for (const k of [...posts.keys()]) if (!seen.has(k)) posts.delete(k);
  }
  return best >= 5;
}

function measureLook({ F, cx, H, back, spec, neckV, shoulderV, crotchV, arms, shoulderHalf, neckW, skirtHemV }) {
  const Hp = F.heightPx;
  const px = (v) => F.rowAt(v);
  const headHalf = Math.max(4, (F.runNear(px(neckV * 0.5), cx) || [cx - 4, cx + 4]).reduce((a, b) => b - a) / 2);

  // Head landmarks relative to the detected neck (head sizes vary a lot).
  // Face: cheeks/mouth band in the lower half of the head. Hair: the crown.
  const hv = (f) => px(neckV * f);
  const skinFace = regionColor(F, cx - headHalf * 0.3, hv(0.62), cx + headHalf * 0.3, hv(0.8));
  let hair = regionColor(F, cx - headHalf * 0.5, hv(0.02), cx + headHalf * 0.5, hv(0.15)) || skinFace || [80, 60, 40];
  let skin = skinFace || [225, 180, 140];
  const hands = []; // hand colours are a second skin sample
  let top = regionColor(F, cx - shoulderHalf * 0.4, px(shoulderV + 0.05), cx + shoulderHalf * 0.4, px(shoulderV + 0.13)) || [120, 120, 130];
  const legMid = F.runNear(px(crotchV + 0.12), cx + shoulderHalf * 0.45);
  let bottom = (legMid && regionColor(F, legMid[0] + 2, px(crotchV + 0.08), legMid[1] - 2, px(crotchV + 0.2))) || [60, 70, 100];
  // Prefer the hip band just above the crotch: it is the trousers/shorts/skirt
  // whatever their length (short shorts leave the thighs bare).
  {
    const hip = regionColor(F, cx - shoulderHalf * 0.45, px(crotchV - 0.035), cx + shoulderHalf * 0.45, px(crotchV - 0.008));
    if (hip && skirtHemV == null) bottom = hip;
  }
  if (typeof skirtHemV === 'number') { // short skirt: sample between the hips and the hem
    const c = regionColor(F, cx - shoulderHalf * 0.4, px(Math.min(skirtHemV - 0.06, 0.55)), cx + shoulderHalf * 0.4, px(skirtHemV - 0.02));
    if (c) bottom = c;
  }
  const footRun = F.runNear(px(0.985), cx + shoulderHalf * 0.45);
  let shoes = (footRun && regionColor(F, footRun[0], px(0.965), footRun[1], px(0.998))) || [40, 40, 45];

  // Hem: scanning the torso centre line downwards, the biggest colour jump
  // between chest and crotch is where the top ends. Default = hip.
  let hemV = 1 - spec.hipY / H;
  {
    let best = 0, bestV = hemV;
    const prev = [];
    for (let v = shoulderV + 0.14; v <= crotchV + 0.02; v += 0.01) {
      const c = regionColor(F, cx - shoulderHalf * 0.3, px(v), cx + shoulderHalf * 0.3, px(v + 0.01));
      if (!c) continue;
      prev.push([v, c]);
      if (prev.length > 3) {
        const [v0, c0] = prev[prev.length - 4];
        const d = cdist(c0, c);
        if (d > best) { best = d; bestV = (v0 + v) / 2; }
      }
    }
    if (best > 45) hemV = bestV;
    else hemV = Math.min(hemV, crotchV - 0.01);
  }

  // Sleeve length: walk along the arm; first point that looks like skin rather
  // than the top colour. t in [0,1] along shoulder->wrist. Long sleeve = 1.
  let sleeveT = 1;
  for (const a of arms) {
    let hit = null;
    for (let t = 0.15; t <= 0.8; t += 0.05) {
      const c = a.sample(t);
      if (!c) continue;
      const isSkin = cdist(c, skin) < cdist(c, top) - 15;
      if (isSkin && hit == null) hit = t;
      else if (!isSkin) hit = null; // must stay skin all the way to the wrist
    }
    // Skin from the very first sample on = sleeveless.
    if (hit != null) sleeveT = Math.min(sleeveT, hit <= 0.15 ? 0 : clamp(hit, 0.05, 1));
    // Hand colour from interior pixels only (a thin wrist is mostly anti-aliased edge).
    const [hx, hy] = a.axisAt(0.9);
    const hc = regionColorInterior(F, hx - 2, hy - 2, hx + 2, hy + 2);
    if (hc && cdist(hc, skin) < 70) hands.push(hc);
  }
  if (hands.length) skin = skin.map((c, i) => (c + hands.reduce((s, h) => s + h[i], 0) / hands.length) / 2);

  // Trouser length: walk down a leg from the crotch to the ankle.
  let trouserT = 1;
  if (skirtHemV == null) {
    let hit = null;
    for (let t = 0.04; t <= 0.9; t += 0.03) {
      const v = crotchV + (0.955 - crotchV) * t;
      const r = F.runNear(px(v), cx + shoulderHalf * 0.45);
      const c = r && regionColor(F, r[0] + 1, px(v), r[1] - 1, px(v + 0.01));
      if (!c) continue;
      const isSkin = cdist(c, skin) < cdist(c, bottom) - 15;
      if (isSkin && hit == null) hit = t;
      else if (!isSkin) hit = null;
    }
    if (hit != null) trouserT = clamp(hit, 0.03, 1);
  }

  // Hair coverage: for each head height, is the front of the head hair or
  // skin? And does hair cover the back of the head / neck (long hair)?
  const eyeV = neckV * 0.5;
  const frontHair = (v) => {
    const c = regionColor(F, cx - headHalf * 0.3, px(v), cx + headHalf * 0.3, px(v + 0.008));
    return c ? cdist(c, hair) < cdist(c, skin) : false;
  };
  let hairlineV = neckV * 0.2;
  for (let v = neckV * 0.05; v <= eyeV; v += 0.004) { if (frontHair(v)) hairlineV = v + 0.005; else break; }
  const backHair = (v) => {
    if (back) {
      const bcx = (back.bbox.x0 + back.bbox.x1) / 2;
      const r = back.runNear(back.rowAt(v), bcx);
      const c = r && regionColor(back, r[0], back.rowAt(v), r[1], back.rowAt(v + 0.01));
      return c ? cdist(c, hair) < cdist(c, skin) && cdist(c, hair) < cdist(c, top) : false;
    }
    // Front view fallback: the silhouette edge columns of the head.
    const r = F.runNear(px(v), cx);
    if (!r) return false;
    const c = regionColor(F, r[0], px(v), r[0] + Math.max(2, headHalf * 0.2), px(v + 0.008));
    return c ? cdist(c, hair) < cdist(c, skin) : false;
  };
  let hairBackV = neckV * 0.6;
  for (let v = neckV * 0.2; v <= Math.min(neckV + 0.08, 0.3); v += 0.01) { if (backHair(v)) hairBackV = v + 0.01; else break; }
  const hasHair = cdist(hair, skin) > 28;

  // Hair length below the neck. Back view: is the centre of the back still hair?
  // Front view: is there hair beside the neck, falling behind the shoulders?
  const isHairC = (c) => c && cdist(c, hair) < 0.75 * Math.min(cdist(c, skin), cdist(c, top));
  let hairEndV = null;
  if (hasHair) {
    let misses = 0; // dark hair in shadow can drop out of the mask for a row or two
    for (let v = neckV; v <= 0.55; v += 0.01) {
      let hairy;
      if (back) {
        const bcx = (back.bbox.x0 + back.bbox.x1) / 2, bw = headHalf * (back.heightPx / F.heightPx) * 0.5;
        const c = regionColor(back, bcx - bw, back.rowAt(v), bcx + bw, back.rowAt(v + 0.01));
        if (!c && ++misses <= 3) continue;
        hairy = isHairC(c);
      } else {
        const inner = neckW + 2, outer = headHalf * 1.25;
        if (outer <= inner + 1) break;
        hairy = [-1, 1].some((sd) => isHairC(regionColor(F, cx + sd * inner, px(v), cx + sd * outer, px(v + 0.01))));
      }
      if (hairy) { hairEndV = v + 0.01; misses = 0; } else break;
    }
  }
  // Hair style from length AND width (back view when available): a bob hangs as
  // wide as the head; short hair narrows to the nape; a ponytail is a narrow
  // band down the back; long hair is a wide curtain.
  let hairStyle = null;
  {
    const S = back || F;
    const sc = S.heightPx / F.heightPx;
    const scx = back ? (back.bbox.x0 + back.bbox.x1) / 2 : cx;
    const headW = headHalf * 2 * sc;
    const pixHair = (x, y) => { if (!S.on(x, y)) return false; const i = (Math.round(y) * S.w + Math.round(x)) * 4, d = S.img.data; return isHairC([d[i], d[i + 1], d[i + 2]]); };
    const hairWidth = (v) => { // contiguous hair span around the centre column, as a fraction of head width
      const y = S.rowAt(v);
      let l = scx, r = scx, miss = 0;
      if (!pixHair(scx, y)) return 0;
      while (l > 0 && miss < 2) { l--; miss = pixHair(l, y) ? 0 : miss + 1; }
      miss = 0;
      while (r < S.w - 1 && miss < 2) { r++; miss = pixHair(r, y) ? 0 : miss + 1; }
      return (r - l - 3) / headW;
    };
    if (!hasHair) hairStyle = 'bald';
    else if (back && hairEndV != null && hairEndV > shoulderV + 0.02) hairStyle = hairWidth(shoulderV + 0.03) < 0.45 ? 'ponytail' : 'long';
    else if (!back && hairEndV != null && hairEndV > shoulderV + 0.02) hairStyle = 'long';
    else if (back && hairEndV != null && hairWidth(neckV + 0.005) >= 0.7) hairStyle = 'bob';
    else if (!back && hairEndV != null && hairEndV > neckV + 0.035) hairStyle = 'bob';
    else hairStyle = 'short';
  }

  // Skirt hem: a short skirt's hem came from the leg gap; for a long one walk
  // down the centre line until the colour stops looking like the skirt.
  let skirtY = null;
  if (typeof skirtHemV === 'number') skirtY = H * (1 - skirtHemV);
  else if (skirtHemV === 'long') {
    let v = 0.6;
    for (; v < 0.97; v += 0.01) {
      const c = regionColor(F, cx - 2, px(v), cx + 2, px(v + 0.01));
      if (!c || cdist(c, bottom) > 0.75 * Math.min(cdist(c, skin), cdist(c, shoes)) + 25) break;
    }
    skirtY = H * (1 - clamp(v, 0.62, 0.95));
  }

  // Neckline: walking down the chest centre from the chin, where does the top
  // start? Deep = scoop/tank; at the neck = crew or collar. The most distinct
  // colour right at that edge (trim, collar, tie) becomes the accent.
  let necklineV = neckV, accent = null;
  {
    const pix = (v) => regionColor(F, cx - 1, px(v), cx + 1, px(v));
    // Top-coloured (not skin, not hanging hair) here and a little lower too, so a
    // stray strand or shadow under the chin doesn't count as the neckline.
    const isTop = (c) => c && cdist(c, top) < cdist(c, skin) - 10 && (!hasHair || cdist(c, top) < cdist(c, hair));
    for (let v = neckV; v <= shoulderV + 0.12; v += 0.004) {
      if (isTop(pix(v)) && isTop(pix(v + 0.008))) { necklineV = v; break; }
    }
    // The top's real colour: just below the neckline, away from skin and arms.
    const t2 = regionColor(F, cx - shoulderHalf * 0.3, px(necklineV + 0.03), cx + shoulderHalf * 0.3, px(necklineV + 0.09));
    if (t2) top = t2;
    // Accent: a colour distinct from skin and top that holds for two samples
    // (single bright pixels are highlights, not trim).
    let bestD = 0;
    for (let v = necklineV - 0.012; v <= necklineV + 0.02; v += 0.002) {
      const c = pix(v), n = [pix(v - 0.002), pix(v + 0.002)].filter((q) => q && cdist(c || q, q) <= 35)[0];
      if (!c || !n) continue;
      const d = Math.min(cdist(c, skin), cdist(c, top));
      if (d > bestD) { bestD = d; accent = c.map((x, i) => (x + n[i]) / 2); }
    }
    if (bestD < 80) accent = null;
  }

  // Material colours from the lit side: a reference render (or photo) is shaded,
  // so the plain average bakes shadow into the material and the renderer then
  // shades it again. Assign each interior pixel to its nearest material colour
  // and take the mean of a brightness band (flat-lit inputs
  // are unchanged: every percentile is the same colour).
  {
    const finals = { skin, hair, top, bottom, shoes };
    const groups = Object.fromEntries(Object.keys(finals).map((k) => [k, []]));
    const { data } = F.img;
    for (let y = F.bbox.y0; y <= F.bbox.y1; y += 2) for (let x = F.bbox.x0; x <= F.bbox.x1; x += 2) {
      if (!F.on(x, y) || !F.on(x - 2, y) || !F.on(x + 2, y) || !F.on(x, y - 2) || !F.on(x, y + 2)) continue;
      const i = (y * F.w + x) * 4, c = [data[i], data[i + 1], data[i + 2]];
      let best = null, bd = 70;
      const feet = y > F.bbox.y1 - F.heightPx * 0.05; // shoes only where shoes are
      for (const [k, f] of Object.entries(finals)) { if ((k === 'shoes') !== feet) continue; const d = cdist(c, f); if (d < bd) { bd = d; best = k; } }
      if (best) groups[best].push(c);
    }
    // Matte cloth and skin: the lit band. Glossy hair and shoes: the middle band
    // (their brightest pixels are highlights, not colour).
    const lit = (px, lo = 0.6, hi = 0.9) => {
      px.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
      const band = px.slice(Math.floor(px.length * lo), Math.max(Math.floor(px.length * lo) + 1, Math.floor(px.length * hi)));
      return [0, 1, 2].map((j) => band.reduce((s2, c) => s2 + c[j], 0) / band.length);
    };
    if (groups.skin.length > 30) skin = lit(groups.skin);
    if (groups.top.length > 30) top = lit(groups.top);
    if (groups.bottom.length > 30) bottom = lit(groups.bottom);
    if (groups.shoes.length > 12 && cdist(shoes, hair) > 30) shoes = lit(groups.shoes, 0.4, 0.7);
    if (groups.hair.length > 30 && hasHair) hair = lit(groups.hair, 0.4, 0.7);
  }
  const color = (c) => c.map((x) => Math.round(clamp(x, 0, 255)));
  return {
    skin: color(skin), hair: color(hair), top: color(top), bottom: color(bottom), shoes: color(shoes),
    hemY: H * (1 - hemV), sleeveT, trouserT,
    hasHair, hairlineY: H * (1 - hairlineV), hairBackY: H * (1 - hairBackV),
    hairEndY: hairEndV == null ? null : H * (1 - hairEndV),
    hairStyle,
    necklineY: H * (1 - necklineV),
    accent: accent ? color(accent) : null,
    skirtY,
  };
}
