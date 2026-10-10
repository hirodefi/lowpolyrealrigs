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
  const H = opts.height ?? 1.8;
  const F = front;
  const Hp = F.heightPx;
  const mF = H / Hp; // metres per front pixel
  const notes = [];

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
  if (neckW > headMaxW * 0.9) { neckV = 0.14; neckW = headMaxW * 0.6; notes.push('neck not visible - using proportions'); }
  neckV = clamp(neckV, 0.1, 0.2);

  // --- Shoulders: first row where the body gets much wider than the neck.
  let shoulderTopV = neckV + 0.04;
  for (let v = neckV; v <= neckV + 0.1; v += 0.003) { if (centralHalf(v) > neckW * 2.2) { shoulderTopV = v; break; } }
  shoulderTopV = clamp(shoulderTopV, neckV + 0.015, neckV + 0.08);
  const shoulderV = shoulderTopV + 0.025; // joint sits a little below the top of the shoulder

  // --- Crotch: walk up from the shins while there is a gap between the legs.
  let crotchV = 0.52;
  const gapAt = (v) => { const y = F.rowAt(v); return !F.on(cx - 1, y) && !F.on(cx, y) && !F.on(cx + 1, y); };
  if (gapAt(0.88)) {
    let v = 0.88;
    while (v > 0.38 && gapAt(v - 0.003)) v -= 0.003;
    crotchV = v;
  } else notes.push('no gap between legs (dress/robe?) - using proportions');
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
    const yEnd = F.rowAt(Math.min(crotchV + 0.3, 0.92));
    for (let y = F.rowAt(shoulderV - 0.03); y <= yEnd; y++) {
      const v = (y - F.bbox.y0) / (Hp - 1);
      let inner = torsoHalfPx(v) + 2;
      if (v > crotchV) { const r = legRun(v, s); if (r) inner = Math.max(inner, s > 0 ? r[1] - cx + 2 : cx - r[0] + 2); }
      for (const r of F.runs[y]) for (let x = r[0]; x <= r[1]; x++) {
        if (s * (x - cx) <= inner) continue;
        count++;
        const d = (x - sx) ** 2 + (y - sy) ** 2;
        if (d > best) { best = d; tip = [x, y]; }
      }
    }
    if (!tip || count < Hp * Hp * 0.002) { arms.push(null); continue; }
    const len = Math.sqrt(best);
    const dx = Math.abs(tip[0] - sx), dy = tip[1] - sy;
    const angle = Math.atan2(dy, dx); // below horizontal
    // Thickness: march perpendicular to the arm axis.
    const ux = (tip[0] - sx) / len, uy = (tip[1] - sy) / len;
    const thick = (t) => {
      const px = sx + ux * len * t, py = sy + uy * len * t;
      let a = 0, b = 0;
      while (a < Hp * 0.06 && F.on(px - uy * a, py + ux * a)) a++;
      while (b < Hp * 0.06 && F.on(px + uy * b, py - ux * b)) b++;
      return a + b;
    };
    arms.push({ len, angle, upper: thick(0.28), fore: thick(0.62), hand: thick(0.9) });
  }
  const good = arms.filter(Boolean);
  if (good.length < 2) notes.push(good.length ? 'one arm not found - mirrored the other' : 'arms not found - using default A-pose');
  const avg = (k, def) => good.length ? good.reduce((a, b) => a + b[k], 0) / good.length : def;
  const arm = {
    length: clamp(avg('len', Hp * 0.42), Hp * 0.3, Hp * 0.5) * mF,
    angle: clamp(avg('angle', 50 * DEG), 0, 80 * DEG),
    upper: clamp(avg('upper', Hp * 0.055), Hp * 0.03, Hp * 0.09) * mF,
    fore: clamp(avg('fore', Hp * 0.045), Hp * 0.025, Hp * 0.08) * mF,
    hand: clamp(avg('hand', Hp * 0.05), Hp * 0.03, Hp * 0.08) * mF,
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
    const hx = torsoHalfPx(v) * mF;
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
  const spec = {
    height: H,
    tpose,
    notes,
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

  // Colour projection, used by the builder to paint each face.
  spec.colorAt = makeColorSampler({ F, cx, mF, H, back, sideInfo, shoulderY });
  return spec;
}

function makeColorSampler({ F, cx, mF, H, back, sideInfo, shoulderY }) {
  let bcx = 0, mB = 0;
  if (back) {
    let s = 0, k = 0;
    for (let v = 0.01; v <= 0.07; v += 0.005) {
      const r = back.runNear(back.rowAt(v), (back.bbox.x0 + back.bbox.x1) / 2);
      if (r) { s += (r[0] + r[1]) / 2; k++; }
    }
    bcx = k ? s / k : (back.bbox.x0 + back.bbox.x1) / 2;
    mB = H / back.heightPx;
  }
  const fromFront = (p) => F.sampleColor(cx + p[0] / mF, F.rowAt(1 - p[1] / H));
  const fromBack = (p) => back ? back.sampleColor(bcx - p[0] / mB, back.rowAt(1 - p[1] / H)) : null; // back view is mirrored
  const fromSide = (p) => {
    if (!sideInfo) return null;
    const { S, zc, sign, mS } = sideInfo;
    return S.sampleColor(zc + sign * p[2] / mS, S.rowAt(1 - p[1] / H));
  };

  // p = face centre, nrm = face normal. Blend views by how directly they see the face.
  // Below the shoulders the profile view is unreliable (the near arm hangs over the
  // torso and legs), so side-facing faces there use the silhouette edge of the
  // front/back views instead, which shows the body's true flank colour.
  return (p, nrm) => {
    const nx = Math.abs(nrm[0]);
    const sideOk = p[1] > shoulderY;
    const views = [
      [Math.max(nrm[2], 0) + 0.05 + (sideOk ? 0 : nx * 0.5), fromFront],
      [Math.max(-nrm[2], 0) + (sideOk ? 0 : nx * 0.5), fromBack],
      [sideOk ? nx * 0.9 : 0, fromSide],
    ];
    let r = 0, g = 0, b = 0, wsum = 0;
    for (const [w, fn] of views) {
      if (w <= 0.01) continue;
      const c = fn(p);
      if (!c) continue;
      r += c[0] * w; g += c[1] * w; b += c[2] * w; wsum += w;
    }
    if (!wsum) { const c = fromFront(p); return c || [160, 160, 160]; }
    return [r / wsum, g / wsum, b / wsum];
  };
}
