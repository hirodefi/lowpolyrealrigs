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
  if (neckW > headMaxW * 0.9) { neckV = 0.14; neckW = headMaxW * 0.6; notes.push('neck not visible - using proportions'); detected.neck = false; }
  neckV = clamp(neckV, 0.1, 0.2);

  // --- Shoulders: first row where the body gets much wider than the neck.
  let shoulderTopV = neckV + 0.04;
  for (let v = neckV; v <= neckV + 0.1; v += 0.003) { if (centralHalf(v) > neckW * 2.2) { shoulderTopV = v; break; } }
  shoulderTopV = clamp(shoulderTopV, neckV + 0.015, neckV + 0.08);
  const shoulderV = shoulderTopV + 0.025; // joint sits a little below the top of the shoulder

  // --- Crotch: walk up from the shins while there is a gap between the legs.
  // A gap that only opens far below the hips is the hem of a skirt, not the crotch.
  let crotchV = 0.52, skirtHemV = null;
  const gapAt = (v) => { const y = F.rowAt(v); return !F.on(cx - 1, y) && !F.on(cx, y) && !F.on(cx + 1, y); };
  if (gapAt(0.88)) {
    let v = 0.88;
    while (v > 0.38 && gapAt(v - 0.003)) v -= 0.003;
    if (v > 0.6) { skirtHemV = v; detected.crotch = false; notes.push('skirt or dress detected'); }
    else crotchV = v;
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
    // Colour along the arm axis (used to find where the sleeve ends).
    const sample = (t) => F.sampleColor(sx + ux * len * t, sy + uy * len * t);
    arms.push({ len, angle, upper: thick(0.28), fore: thick(0.62), hand: thick(0.9), sample });
  }
  const good = arms.filter(Boolean);
  detected.arms = good.length;
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
  return spec;
}

// Average colour over a rectangle of masked pixels (image px). null if empty.
function regionColor(S, x0, y0, x1, y1) {
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
function measureLook({ F, cx, H, back, spec, neckV, shoulderV, crotchV, arms, shoulderHalf, neckW, skirtHemV }) {
  const Hp = F.heightPx;
  const px = (v) => F.rowAt(v);
  const headHalf = Math.max(4, (F.runNear(px(neckV * 0.5), cx) || [cx - 4, cx + 4]).reduce((a, b) => b - a) / 2);

  // Head landmarks relative to the detected neck (head sizes vary a lot).
  // Face: cheeks/mouth band in the lower half of the head. Hair: the crown.
  const hv = (f) => px(neckV * f);
  const skinFace = regionColor(F, cx - headHalf * 0.3, hv(0.62), cx + headHalf * 0.3, hv(0.8));
  const hair = regionColor(F, cx - headHalf * 0.5, hv(0.02), cx + headHalf * 0.5, hv(0.15)) || skinFace || [80, 60, 40];
  let skin = skinFace || [225, 180, 140];
  const hands = []; // hand colours are a second skin sample
  const top = regionColor(F, cx - shoulderHalf * 0.4, px(shoulderV + 0.05), cx + shoulderHalf * 0.4, px(shoulderV + 0.13)) || [120, 120, 130];
  const legMid = F.runNear(px(crotchV + 0.12), cx + shoulderHalf * 0.45);
  let bottom = (legMid && regionColor(F, legMid[0] + 2, px(crotchV + 0.08), legMid[1] - 2, px(crotchV + 0.2))) || [60, 70, 100];
  if (typeof skirtHemV === 'number') { // short skirt: sample between the hips and the hem
    const c = regionColor(F, cx - shoulderHalf * 0.4, px(Math.min(skirtHemV - 0.06, 0.55)), cx + shoulderHalf * 0.4, px(skirtHemV - 0.02));
    if (c) bottom = c;
  }
  const footRun = F.runNear(px(0.985), cx + shoulderHalf * 0.45);
  const shoes = (footRun && regionColor(F, footRun[0], px(0.965), footRun[1], px(0.998))) || [40, 40, 45];

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
    if (hit != null) sleeveT = Math.min(sleeveT, clamp(hit, 0.05, 1));
    const hc = a.sample(0.9);
    if (hc && cdist(hc, skin) < 70) hands.push(hc);
  }
  if (hands.length) skin = skin.map((c, i) => (c + hands.reduce((s, h) => s + h[i], 0) / hands.length) / 2);

  // Trouser length: walk down a leg from the crotch to the ankle.
  let trouserT = 1;
  if (skirtHemV == null) {
    let hit = null;
    for (let t = 0.2; t <= 0.9; t += 0.05) {
      const v = crotchV + (0.955 - crotchV) * t;
      const r = F.runNear(px(v), cx + shoulderHalf * 0.45);
      const c = r && regionColor(F, r[0] + 1, px(v), r[1] - 1, px(v + 0.01));
      if (!c) continue;
      const isSkin = cdist(c, skin) < cdist(c, bottom) - 15;
      if (isSkin && hit == null) hit = t;
      else if (!isSkin) hit = null;
    }
    if (hit != null) trouserT = clamp(hit, 0.1, 1);
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
    for (let v = neckV; v <= 0.55; v += 0.01) {
      let hairy;
      if (back) {
        const bcx = (back.bbox.x0 + back.bbox.x1) / 2, bw = headHalf * (back.heightPx / F.heightPx) * 0.5;
        hairy = isHairC(regionColor(back, bcx - bw, back.rowAt(v), bcx + bw, back.rowAt(v + 0.01)));
      } else {
        const inner = neckW + 2, outer = headHalf * 1.25;
        if (outer <= inner + 1) break;
        hairy = [-1, 1].some((sd) => isHairC(regionColor(F, cx + sd * inner, px(v), cx + sd * outer, px(v + 0.01))));
      }
      if (hairy) hairEndV = v + 0.01; else break;
    }
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

  const color = (c) => c.map((x) => Math.round(clamp(x, 0, 255)));
  return {
    skin: color(skin), hair: color(hair), top: color(top), bottom: color(bottom), shoes: color(shoes),
    hemY: H * (1 - hemV), sleeveT, trouserT,
    hasHair, hairlineY: H * (1 - hairlineV), hairBackY: H * (1 - hairBackV),
    hairEndY: hairEndV == null ? null : H * (1 - hairEndV),
    skirtY,
  };
}
