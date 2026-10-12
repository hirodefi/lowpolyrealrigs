// Pose audit: proves the rigged character moves without parts passing through
// each other, the way Anatomy's audit.mjs proves a machine's parts never
// interpenetrate (github.com/wheresryan22/anatomy, MIT), adapted to a skinned mesh.
//
// The mesh is skinned on the CPU at sampled frames of every clip. Each body
// region gets a "core" from the bind pose (an elliptic core per torso slice,
// a capsule per limb segment, smaller than the visible surface), and a check
// fails when another region's vertices go deeper into a core than the
// tolerance. Light contact (an arm brushing the side) is allowed; a hand inside
// a thigh is not.
//
// Checks: arm-torso, arm-leg (hand through thigh), leg-leg (knee through knee),
// legs outside the skirt, feet below the floor, parts floating off the body.

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const REGION = {
  Hips: 'torso', Spine: 'torso', Chest: 'torso', Neck: 'head', Head: 'head',
  LeftShoulder: 'armL', LeftUpperArm: 'armL', LeftLowerArm: 'armL', LeftHand: 'armL',
  RightShoulder: 'armR', RightUpperArm: 'armR', RightLowerArm: 'armR', RightHand: 'armR',
  LeftUpperLeg: 'legL', LeftLowerLeg: 'legL', LeftFoot: 'legL', LeftToes: 'legL',
  RightUpperLeg: 'legR', RightLowerLeg: 'legR', RightFoot: 'legR', RightToes: 'legR',
};
const SEGMENTS = [
  ['LeftUpperArm', 'LeftLowerArm', 'armL'], ['LeftLowerArm', 'LeftHand', 'armL'],
  ['RightUpperArm', 'RightLowerArm', 'armR'], ['RightLowerArm', 'RightHand', 'armR'],
  ['LeftUpperLeg', 'LeftLowerLeg', 'legL'], ['LeftLowerLeg', 'LeftFoot', 'legL'],
  ['RightUpperLeg', 'RightLowerLeg', 'legR'], ['RightLowerLeg', 'RightFoot', 'legR'],
];

/** Unique skinned vertices of a character mesh, with material, part tag and region. */
function vertices(character) {
  const { position, joints, weights, groups, tags } = character.mesh;
  const names = character.bones.map((b) => b.name);
  const matOf = new Array(position.length / 9);
  for (const g of groups) for (let t = g.start; t < g.start + g.count; t++) matOf[t] = g.material;
  const map = new Map(), out = [];
  for (let v = 0; v < position.length / 3; v++) {
    const p = [position[v * 3], position[v * 3 + 1], position[v * 3 + 2]];
    const t = Math.floor(v / 3), tag = tags?.[t] ?? 'body';
    const key = p.map((x) => Math.round(x * 2000)).join(',') + '|' + tag;
    if (map.has(key)) continue;
    const w = [];
    for (let k = 0; k < 4; k++) if (weights[v * 4 + k] > 1e-4) w.push([joints[v * 4 + k], weights[v * 4 + k]]);
    w.sort((a, b) => b[1] - a[1]);
    const lead = names[w[0][0]];
    const legs = w.filter(([j]) => /UpperLeg/.test(names[j])).length;
    const region = matOf[t] === 'Bottom' && legs >= 2 ? 'skirt' : tag !== 'body' ? 'part' : matOf[t] === 'Hair' ? 'hair' : REGION[lead];
    map.set(key, out.length);
    out.push({ p, w, mat: matOf[t], tag, region, lead });
  }
  return out;
}

/** World transforms (rotation, position) of every bone for one clip frame. */
function poseOf(character, clip, f) {
  const bones = character.bones;
  const rot = {}, n = clip.channels[0]?.times.length ?? 1;
  let root = bones[0].pos;
  for (const ch of clip.channels) {
    const v = ch.values;
    if (ch.path === 'rotation') rot[ch.node] = [v[f * 4], v[f * 4 + 1], v[f * 4 + 2], v[f * 4 + 3]];
    else if (ch.path === 'translation') root = [v[f * 3], v[f * 3 + 1], v[f * 3 + 2]];
  }
  const R = [], P = [];
  bones.forEach((b, i) => {
    const q = rot[i] || [0, 0, 0, 1];
    if (b.parent < 0) { R[i] = q; P[i] = root; return; }
    const o = qRot(R[b.parent], sub(b.pos, bones[b.parent].pos));
    P[i] = add(P[b.parent], o);
    R[i] = qMul(R[b.parent], q);
  });
  return { R, P, frames: n };
}

const skin = (bones, pose, v) => {
  let x = 0, y = 0, z = 0;
  for (const [j, wt] of v.w) {
    const q = qRot(pose.R[j], sub(v.p, bones[j].pos));
    x += (pose.P[j][0] + q[0]) * wt; y += (pose.P[j][1] + q[1]) * wt; z += (pose.P[j][2] + q[2]) * wt;
  }
  return [x, y, z];
};

/** How far point p lies outside a closed loop of points (projected onto the loop's plane); 0 if inside. */
function outsideLoop(p, P) {
  const n = P.length, c = P.reduce((a, q) => add(a, q), [0, 0, 0]).map((x) => x / n);
  let N = [0, 0, 0]; // Newell normal
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; N = add(N, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]); }
  const L = Math.hypot(...N) || 1; N = N.map((x) => x / L);
  let ex = sub(P[0], c); ex = sub(ex, N.map((x) => x * dot(ex, N))); const le = Math.hypot(...ex) || 1; ex = ex.map((x) => x / le);
  const ey = [N[1] * ex[2] - N[2] * ex[1], N[2] * ex[0] - N[0] * ex[2], N[0] * ex[1] - N[1] * ex[0]];
  const to2 = (q) => { const d = sub(q, c); return [dot(d, ex), dot(d, ey)]; };
  const poly = P.map(to2), q = to2(p);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], ab = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
    best = Math.min(best, Math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t));
  }
  return best;
}

/** Distance from point p to segment ab, and the segment parameter. */
function segDist(p, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  const q = add(a, [ab[0] * t, ab[1] * t, ab[2] * t]);
  return [Math.hypot(...sub(p, q)), t];
}

/**
 * Audit a built character against its clips.
 * opts: { core: 0.72 (core size vs surface), tol: 0.006 (H fraction), every: 2 (frame step), H }
 * Returns { ok, issues: [{check, clip, frame, depth, count, message}], clips }.
 */
export function auditCharacter(character, animations, opts = {}) {
  const H = opts.H ?? 1.7, coreK = opts.core ?? 0.72, tol = (opts.tol ?? 0.006) * H, every = opts.every ?? 2;
  const bones = character.bones, idx = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const V = vertices(character);
  const issues = [];

  // --- Limb capsule cores (bind pose): radius from the segment's own vertices.
  const caps = SEGMENTS.map(([a, b, region]) => {
    const A = bones[idx[a]].pos, B = bones[idx[b]].pos;
    const ds = V.filter((v) => v.region === region && (v.lead === a)).map((v) => segDist(v.p, A, B)).filter(([, t]) => t > 0.1 && t < 0.9).map(([d]) => d).sort((x, y) => x - y);
    const r = ds.length ? ds[Math.floor(ds.length * 0.5)] * coreK : 0;
    return { a: idx[a], b: idx[b], region, r, A, B };
  }).filter((c) => c.r > 0);

  // --- Torso core: elliptic slices (bind pose), in the frame of the bone nearest each slice.
  const torsoV = V.filter((v) => v.region === 'torso' && v.mat !== 'Hair');
  const ys = torsoV.map((v) => v.p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), dy = 0.02 * H;
  const slices = [];
  for (let y = y0 + dy; y < y1 - dy; y += dy) {
    const s = torsoV.filter((v) => Math.abs(v.p[1] - y) < dy / 2);
    if (s.length < 6) continue;
    const xs = s.map((v) => v.p[0]), zs = s.map((v) => v.p[2]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const rx = (Math.max(...xs) - Math.min(...xs)) / 2 * coreK, rz = (Math.max(...zs) - Math.min(...zs)) / 2 * coreK;
    const bone = y < bones[idx.Spine].pos[1] ? idx.Hips : y < bones[idx.Chest].pos[1] ? idx.Spine : idx.Chest;
    slices.push({ y, cx, cz, rx, rz, bone });
  }
  // Arms are attached at the shoulder: the arm root and the armpit (the top 30 %
  // of the upper arm) meet the torso at the joint by design, like parts that sit
  // flush on each other. Everything below must stay out of the torso.
  const armpitT = (v) => { const side = v.lead.startsWith('Left') ? 'Left' : 'Right'; return segDist(v.p, bones[idx[side + 'UpperArm']].pos, bones[idx[side + 'LowerArm']].pos)[1]; };
  const armTest = (v) => (v.region === 'armL' || v.region === 'armR') && !/Shoulder/.test(v.lead) && !(v.lead.endsWith('UpperArm') && armpitT(v) < 0.3);
  const legTest = (v) => v.region === 'legL' || v.region === 'legR';

  // Skirt: legs above the hem must stay inside it.
  const skirtV = V.filter((v) => v.region === 'skirt');
  const hemY = skirtV.length ? Math.min(...skirtV.map((v) => v.p[1])) : null, skirtTop = skirtV.length ? Math.max(...skirtV.map((v) => v.p[1])) : null;
  const covered = hemY == null ? [] : V.filter((v) => legTest(v) && v.p[1] > hemY + 0.03 * H && v.p[1] < skirtTop - 0.03 * H);
  // Skirt rings: skirt vertices grouped by bind height, ordered round the ring.
  const skirtRings = [];
  for (const v of skirtV) {
    let r = skirtRings.find((q) => Math.abs(q.y - v.p[1]) < 0.003 * H);
    if (!r) skirtRings.push(r = { y: v.p[1], ids: [] });
    r.ids.push(V.indexOf(v));
  }
  for (const r of skirtRings) {
    const cx = r.ids.reduce((a, i) => a + V[i].p[0], 0) / r.ids.length, cz = r.ids.reduce((a, i) => a + V[i].p[2], 0) / r.ids.length;
    r.ids.sort((a, b) => Math.atan2(V[a].p[2] - cz, V[a].p[0] - cx) - Math.atan2(V[b].p[2] - cz, V[b].p[0] - cx));
  }
  if (skirtRings.length < 2) covered.length = 0;

  // --- Parts floating off the body (bind pose).
  const bodyV = V.filter((v) => v.tag === 'body');
  const partTags = [...new Set(V.filter((v) => v.tag !== 'body').map((v) => v.tag))];
  for (const tag of partTags) {
    const pv = V.filter((v) => v.tag === tag);
    let best = Infinity;
    for (const a of pv) for (const b of bodyV) { const d = Math.hypot(...sub(a.p, b.p)); if (d < best) best = d; }
    if (best > 0.03 * H) issues.push({ check: 'part-floating', clip: 'bind', frame: 0, depth: +(best / H).toFixed(4), count: pv.length, message: `${tag} is ${(best * 100).toFixed(1)} cm from the body` });
  }

  const record = (check, clip, frame, depth, count, message) => {
    const prev = issues.find((i) => i.check === check && i.clip === clip);
    if (!prev) issues.push({ check, clip, frame, depth: +(depth / H).toFixed(4), count, message });
    else if (depth / H > prev.depth) Object.assign(prev, { frame, depth: +(depth / H).toFixed(4), count, message });
  };

  // Penetration depth of every vertex in a pose (per check), so contact that is
  // already there in the bind pose (an arm root buried in the shoulder by design)
  // is not blamed on the motion: only extra depth counts.
  const bind = { R: bones.map(() => [0, 0, 0, 1]), P: bones.map((b) => b.pos) };
  const depthTorso = (pose, i, p) => {
    let d = 0;
    for (const sl of slices) {
      const b = sl.bone, local = add(qRot(qConj(pose.R[b]), sub(p, pose.P[b])), bones[b].pos);
      if (Math.abs(local[1] - sl.y) > 0.01 * H) continue;
      const e = Math.hypot((local[0] - sl.cx) / sl.rx, (local[2] - sl.cz) / sl.rz);
      if (e < 1) d = Math.max(d, (1 - e) * Math.min(sl.rx, sl.rz));
    }
    return d;
  };
  const depthCaps = (pose, p, into) => {
    let d = 0;
    for (const cap of caps) if (cap.region === into) { const [r] = segDist(p, pose.P[cap.a], pose.P[cap.b]); d = Math.max(d, cap.r - r); }
    return d;
  };
  const restTorso = V.map((v, i) => (armTest(v) ? depthTorso(bind, i, v.p) : 0));
  const restCaps = {};
  for (const into of ['armL', 'armR', 'legL', 'legR']) restCaps[into] = V.map((v) => depthCaps(bind, v.p, into));

  const clipStats = [];
  for (const clip of animations) {
    const n = clip.channels[0].times.length;
    let worst = 0;
    for (let f = 0; f < n; f += every) {
      const pose = poseOf(character, clip, f);
      const S = V.map((v) => skin(bones, pose, v));
      // Floor.
      const minY = Math.min(...S.map((p) => p[1]));
      if (minY < -tol) record('below-floor', clip.name, f, -minY, 1, `feet ${(-minY * 100).toFixed(1)} cm below the floor`);
      // Arms and legs vs torso core.
      let deep = 0, cnt = 0;
      for (let i = 0; i < V.length; i++) {
        if (!armTest(V[i])) continue;
        const d = depthTorso(pose, i, S[i]) - restTorso[i];
        if (d > tol) { cnt++; deep = Math.max(deep, d); if (opts.debug) opts.debug.push({ clip: clip.name, f, lead: V[i].lead, w: V[i].w.map(([j, x]) => bones[j].name + ':' + x.toFixed(2)).join(' '), rest: V[i].p.map((x) => +(x / H).toFixed(3)), now: S[i].map((x) => +(x / H).toFixed(3)), restD: +(restTorso[i] / H).toFixed(4), d: +(d / H).toFixed(4) }); }
      }
      if (cnt) record('arm-through-torso', clip.name, f, deep, cnt, `arm/hand ${(deep * 100).toFixed(1)} cm inside the torso`);
      // Limbs vs other limbs' capsule cores.
      const pairs = [['armL', 'legL', 'arm-through-leg'], ['armR', 'legR', 'arm-through-leg'], ['legL', 'legR', 'leg-through-leg'], ['legR', 'legL', 'leg-through-leg']];
      for (const [from, into, check] of pairs) {
        let dd = 0, c = 0;
        for (let i = 0; i < V.length; i++) {
          if (V[i].region !== from || (from.startsWith('arm') && !armTest(V[i]))) continue;
          const d = depthCaps(pose, S[i], into) - Math.max(0, restCaps[into][i]);
          if (d > tol) { c++; dd = Math.max(dd, d); }
        }
        if (c) record(check, clip.name, f, dd, c, `${from} ${(dd * 100).toFixed(1)} cm inside ${into}`);
      }
      // Legs outside the skirt: each covered leg vertex is tested against its own
      // skirt ring (the ring at its bind height), deformed with the pose: the
      // vertex projected onto the ring's plane must lie inside the ring.
      if (covered.length) {
        let dd = 0, c = 0;
        for (const v of covered) {
          // Covered if inside any skirt ring near its bind height (the fabric runs
          // between rings; the hem's inner lip ring is smaller than the fabric).
          const near = skirtRings.filter((r) => Math.abs(r.y - v.p[1]) < 0.04 * H);
          const rings = near.length ? near : [skirtRings.reduce((a, b) => (Math.abs(b.y - v.p[1]) < Math.abs(a.y - v.p[1]) ? b : a))];
          const out = Math.min(...rings.map((r) => outsideLoop(S[V.indexOf(v)], r.ids.map((i) => S[i]))));
          if (out > tol) { c++; dd = Math.max(dd, out); if (opts.debug) opts.debug.push({ check: 'skirt', clip: clip.name, f, lead: v.lead, rest: v.p.map((x) => +(x / H).toFixed(3)), now: S[V.indexOf(v)].map((x) => +(x / H).toFixed(3)), out: +(out / H).toFixed(4) }); }
        }
        if (c) record('leg-through-skirt', clip.name, f, dd, c, `leg ${(dd * 100).toFixed(1)} cm outside the skirt`);
      }
      worst = Math.max(worst, deep);
    }
    clipStats.push({ clip: clip.name, frames: n });
  }
  return { ok: issues.length === 0, issues, clips: clipStats, cores: { caps: caps.length, slices: slices.length } };
}

/** Text report. */
export function auditReport(a) {
  if (a.ok) return `pose audit passed (${a.clips.map((c) => c.clip).join(', ')}; ${a.cores.slices} torso slices, ${a.cores.caps} limb cores)`;
  return 'pose audit FAILED\n' + a.issues.map((i) => `  ${i.check.padEnd(18)} ${String(i.clip).padEnd(6)} frame ${String(i.frame).padStart(3)}  ${i.message} (${i.count} vertices)`).join('\n');
}
