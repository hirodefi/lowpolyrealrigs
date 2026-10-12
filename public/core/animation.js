// Procedural animation clips for the generated skeleton.
//
// Bind pose has identity rotations with world-aligned joint frames, so the same
// joint-angle curves work for every generated body. The walk and run use
// keyframed joint-angle curves shaped like human gait data (hip, knee, ankle,
// toe, pelvis, torso, arms). Forward kinematics then sets the hip height every
// frame so the lowest point of the feet sits exactly on the floor: no sinking,
// no floating, and the vertical bob falls out naturally. Each locomotion clip
// stores its ground speed (m/s) in `extras.speed` so a crowd can move the
// character at the matching speed and the feet don't slide.
//
// Sign conventions (rotations about the parent's world-aligned axes):
//   thigh forward / arm forward / toes up = negative X;  knee bend = positive X.

const DEG = Math.PI / 180;

// ---------- quaternion helpers ----------
const qAxis = (ax, ay, az, a) => { const s = Math.sin(a / 2); return [ax * s, ay * s, az * s, Math.cos(a / 2)]; };
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
// Applies z first, then y, then x (all about parent axes).
const qEuler = (x = 0, y = 0, z = 0) => qMul(qAxis(1, 0, 0, x), qMul(qAxis(0, 1, 0, y), qAxis(0, 0, 1, z)));

/** Periodic Catmull-Rom curve through [phase, value] keys (phase in [0,1)). */
function curve(keys) {
  const k = keys.slice().sort((a, b) => a[0] - b[0]);
  const n = k.length;
  return (phase) => {
    const p = ((phase % 1) + 1) % 1;
    let i = n - 1;
    for (let j = 0; j < n; j++) if (k[j][0] <= p) i = j;
    const k1 = k[i], k2 = k[(i + 1) % n], k0 = k[(i - 1 + n) % n], k3 = k[(i + 2) % n];
    const span = ((k2[0] - k1[0]) + 1) % 1 || 1;
    const t = (((p - k1[0]) + 1) % 1) / span;
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * k1[1]) + (-k0[1] + k2[1]) * t + (2 * k0[1] - 5 * k1[1] + 4 * k2[1] - k3[1]) * t2 + (-k0[1] + 3 * k1[1] - 3 * k2[1] + k3[1]) * t3);
  };
}

// Gait curves in degrees over one stride; phase 0 = this leg's heel strike.
const WALK = {
  hip: curve([[0, 26], [0.12, 22], [0.3, 6], [0.5, -11], [0.6, -6], [0.72, 14], [0.86, 30]]),
  knee: curve([[0, 4], [0.13, 18], [0.3, 6], [0.42, 5], [0.56, 30], [0.7, 58], [0.82, 38], [0.93, 6]]),
  ankle: curve([[0, 0], [0.07, -6], [0.3, 5], [0.46, 10], [0.6, -16], [0.7, -6], [0.82, 2]]),
  toe: curve([[0, 0], [0.42, 0], [0.55, 22], [0.62, 30], [0.68, 6], [0.75, 0]]),
};
const RUN = {
  hip: curve([[0, 32], [0.15, 18], [0.33, -10], [0.45, -6], [0.62, 30], [0.8, 50], [0.92, 40]]),
  knee: curve([[0, 22], [0.12, 40], [0.33, 22], [0.45, 60], [0.6, 105], [0.75, 90], [0.9, 40]]),
  ankle: curve([[0, 4], [0.12, 14], [0.33, -22], [0.45, -10], [0.7, 6], [0.9, 2]]),
  toe: curve([[0, 0], [0.24, 10], [0.33, 30], [0.42, 0]]),
};

/**
 * @param character result of buildCharacter (bones in bind pose + mesh)
 */
export function makeAnimations(character) {
  const { bones, mesh } = character;
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const B = (n) => bones[byName[n]].pos;
  const hips = B('Hips');
  const legLen = hips[1] - B('LeftFoot')[1];

  // Relax the arms to ~72 deg below horizontal whatever the source pose.
  const armDir = [B('LeftLowerArm')[0] - B('LeftUpperArm')[0], B('LeftLowerArm')[1] - B('LeftUpperArm')[1]];
  const armAngle = Math.atan2(-armDir[1], Math.abs(armDir[0]));
  const lower = Math.max(0, 72 * DEG - armAngle);

  // Sole contact points per foot (heel, ball, toe tip), attached to Foot/Toes bones.
  const soles = { Left: [], Right: [] };
  {
    let heel = Infinity, toe = -Infinity;
    for (let i = 0; i < mesh.position.length; i += 3) {
      if (mesh.position[i + 1] > 0.03) continue;
      heel = Math.min(heel, mesh.position[i + 2]); toe = Math.max(toe, mesh.position[i + 2]);
    }
    for (const side of ['Left', 'Right']) {
      const f = B(side + 'Foot'), t = B(side + 'Toes');
      soles[side] = [
        { bone: side + 'Foot', p: [f[0], 0, heel + 0.01] },
        { bone: side + 'Foot', p: [f[0], 0, t[2]] },
        { bone: side + 'Toes', p: [t[0], 0, toe - 0.005] },
      ];
    }
  }

  // Forward kinematics -> world positions of the sole points for a pose.
  function fk(rot, rootPos) {
    const R = [], P = [];
    bones.forEach((b, i) => { // parents precede children in BONES
      const q = rot[b.name] || [0, 0, 0, 1];
      if (b.parent < 0) { R[i] = q; P[i] = rootPos; return; }
      const pb = bones[b.parent].pos;
      const o = qRot(R[b.parent], [b.pos[0] - pb[0], b.pos[1] - pb[1], b.pos[2] - pb[2]]);
      P[i] = [P[b.parent][0] + o[0], P[b.parent][1] + o[1], P[b.parent][2] + o[2]];
      R[i] = qMul(R[b.parent], q);
    });
    const at = (bone, p) => { const i = byName[bone], o = qRot(R[i], [p[0] - bones[i].pos[0], p[1] - bones[i].pos[1], p[2] - bones[i].pos[2]]); return [P[i][0] + o[0], P[i][1] + o[1], P[i][2] + o[2]]; };
    return { foot: (side) => soles[side].map((s) => at(s.bone, s.p)), ankle: (side) => P[byName[side + 'Foot']] };
  }

  // Build a clip from pose(phase) -> {rot: {bone: [x,y,z] euler}, root, ground?: 'contact'|'flight', stance?}.
  function clip(name, duration, frames, pose, extras) {
    const times = [], rotTracks = {}, rootT = [], samples = [];
    for (let f = 0; f <= frames; f++) {
      const phase = (f % frames) / frames; // last key repeats the first: seamless loop
      const p = pose(phase);
      const rot = Object.fromEntries(Object.entries(p.rot).map(([b, e]) => [b, qEuler(...e)]));
      let root = p.root;
      if (p.ground) {
        // Lowest sole point on the floor during contact; in flight only prevent sinking.
        const k = fk(rot, root);
        const minY = Math.min(...k.foot('Left').map((v) => v[1]), ...k.foot('Right').map((v) => v[1]));
        if (p.ground === 'contact' || minY < 0) root = [root[0], root[1] - minY, root[2]];
      }
      times.push((f / frames) * duration);
      for (const [b, q] of Object.entries(rot)) (rotTracks[b] ??= []).push(...q);
      rootT.push(...root);
      samples.push({ phase, rot, root, p });
    }
    // Run flight phase: raise the hips on a ballistic arc between take-off and landing.
    if (extras?.flight) {
      const ys = samples.map((s) => s.root[1]);
      let i = 0;
      while (i < frames) {
        if (samples[i].p.ground !== 'flight') { i++; continue; }
        let j = i; while (j < frames && samples[j].p.ground === 'flight') j++;
        const a = ys[i - 1] ?? ys[frames - 1], b = ys[j % frames], n = j - i + 1;
        for (let k = i; k < j; k++) { const t = (k - i + 1) / n; ys[k] = Math.max(ys[k], a + (b - a) * t + 4 * extras.flight * t * (1 - t)); }
        i = j;
      }
      ys[frames] = ys[0];
      ys.forEach((y, k) => { rootT[k * 3 + 1] = y; samples[k].root = [samples[k].root[0], y, samples[k].root[2]]; });
      delete extras.flight;
    }
    // Ground speed: how fast the planted ankle moves backwards during stance.
    if (extras?.measureSpeed) {
      const zs = [];
      for (const s of samples.slice(0, -1)) if (s.p.stance?.Left) zs.push([s.phase * duration, fk(s.rot, s.root).ankle('Left')[2]]);
      if (zs.length > 2) {
        const n = zs.length, mt = zs.reduce((a, z) => a + z[0], 0) / n, mz = zs.reduce((a, z) => a + z[1], 0) / n;
        const slope = zs.reduce((a, z) => a + (z[0] - mt) * (z[1] - mz), 0) / zs.reduce((a, z) => a + (z[0] - mt) ** 2, 0);
        extras.speed = Math.round(-slope * 1000) / 1000;
      }
      delete extras.measureSpeed;
    }
    const channels = Object.entries(rotTracks).map(([bone, values]) => ({ node: byName[bone], path: 'rotation', times, values }));
    channels.push({ node: byName.Hips, path: 'translation', times, values: rootT });
    return { name, duration, channels, extras };
  }

  const arms = (swingL, swingR, elbowL, elbowR, spread = 0) => ({
    LeftUpperArm: [swingL, 0, -lower + spread],
    RightUpperArm: [swingR, 0, lower - spread],
    LeftLowerArm: [-elbowL, 0, 0],
    RightLowerArm: [-elbowR, 0, 0],
  });

  // Gait from curves: left leg uses phase, right leg phase + 0.5.
  const gait = (C, o) => (phase) => {
    const L = phase, R = (phase + 0.5) % 1;
    const legs = {};
    for (const [side, ph] of [['Left', L], ['Right', R]]) {
      legs[side + 'UpperLeg'] = [-C.hip(ph) * DEG * o.stride, 0, 0];
      legs[side + 'LowerLeg'] = [C.knee(ph) * DEG, 0, 0];
      legs[side + 'Foot'] = [-C.ankle(ph) * DEG, 0, 0];
      legs[side + 'Toes'] = [-C.toe(ph) * DEG, 0, 0];
    }
    const c = Math.cos(phase * 2 * Math.PI), s = Math.sin(phase * 2 * Math.PI);
    // Arms swing opposite to the same-side leg; elbows bend more on the forward swing.
    const armL = C.hip(R) * DEG * o.arm * o.stride, armR = C.hip(L) * DEG * o.arm * o.stride;
    const elbow = (sw) => o.elbow + Math.max(0, sw) * o.elbowGain;
    return {
      // Weight shifts over the stance leg; the pelvis turns with the forward leg and
      // drops on the swing side; the chest counter-rotates.
      root: [hips[0] + o.sway * legLen * s, hips[1], hips[2]],
      ground: o.flight && (phase % 0.5) > o.flight ? 'flight' : 'contact',
      stance: { Left: phase < o.stance },
      rot: {
        Hips: [o.lean * 0.3, -o.yaw * c, o.roll * s],
        Spine: [o.lean * 0.7, o.yaw * 0.5 * c, -o.roll * 0.5 * s],
        Chest: [0, o.yaw * 0.9 * c, -o.roll * 0.3 * s],
        Neck: [0, -o.yaw * 0.4 * c, 0],
        Head: [-o.lean * 0.8, -o.yaw * 0.4 * c, 0],
        ...legs,
        ...arms(-armL, -armR, elbow(armL), elbow(armR)),
      },
    };
  };

  // A skirt shortens the stride (the fabric limits how far a thigh swings); a
  // straight knee skirt more than an A-line. Ground speed is measured from the
  // result, so the feet still don't slide.
  const bottom = character.bottomStyle;
  const stride = (walk) => (bottom === 'pencil' ? (walk ? 0.78 : 0.5) : bottom === 'skirt' ? (walk ? 0.85 : 0.65) : 1);

  return [
    // Idle: slow breathing with a very small weight shift; feet stay planted.
    clip('idle', 3, 36, (phase) => {
      const p = phase * 2 * Math.PI, b = Math.sin(p);
      const shift = 0.008 * Math.sin(p) * legLen; // hips over one foot then the other
      const th = -Math.asin(shift / legLen);
      return {
        root: [hips[0] + shift, hips[1], hips[2]],
        ground: 'contact',
        rot: {
          Hips: [0, 0, 1.2 * DEG * Math.sin(p)],
          Spine: [1.2 * DEG * b, 0, -0.8 * DEG * Math.sin(p)],
          Chest: [1.8 * DEG * b, 0, -0.4 * DEG * Math.sin(p)],
          Neck: [-0.8 * DEG * b, 0, 0],
          Head: [-0.8 * DEG * b, 2 * DEG * Math.sin(p * 0.5), 0],
          LeftUpperLeg: [0, 0, th], RightUpperLeg: [0, 0, th],
          LeftFoot: [0, 0, -th], RightFoot: [0, 0, -th],
          LeftShoulder: [0, 0, 1.2 * DEG * (1 + b)], RightShoulder: [0, 0, -1.2 * DEG * (1 + b)],
          ...arms(2 * DEG * b, 2 * DEG * b, 0.18 + 0.03 * b, 0.18 + 0.03 * b, 2 * DEG),
        },
      };
    }),
    clip('walk', 1.1, 32, gait(WALK, { stride: stride(true), arm: 0.65, elbow: 0.32, elbowGain: 0.9, sway: 0.022, yaw: 5 * DEG, roll: 3.5 * DEG, lean: 3 * DEG, stance: 0.6 }), { loop: true, measureSpeed: true }),
    clip('run', 0.72, 24, gait(RUN, { stride: stride(false), arm: 0.9, elbow: 1.45, elbowGain: 0.4, sway: 0.012, yaw: 8 * DEG, roll: 3 * DEG, lean: 10 * DEG, stance: 0.36, flight: 0.36 }), { loop: true, measureSpeed: true, flight: 0.05 }),
    // Seated on a bench: thighs horizontal, shins vertical, feet on the floor. Held pose.
    clip('sit', 1, 1, () => ({
      ground: 'contact', // the soles on the floor whatever the thigh bone's own offset
      root: [hips[0], B('LeftLowerLeg')[1], hips[2]],
      rot: {
        Spine: [-4 * DEG, 0, 0], Head: [3 * DEG, 0, 0],
        LeftUpperLeg: [-90 * DEG, 0, -4 * DEG], RightUpperLeg: [-90 * DEG, 0, 4 * DEG],
        LeftLowerLeg: [90 * DEG, 0, 0], RightLowerLeg: [90 * DEG, 0, 0],
        ...arms(-22 * DEG, -22 * DEG, 0.75, 0.75), // hands resting towards the knees
      },
    })),
    clip('wave', 2, 30, (phase) => {
      const p = phase * 2 * Math.PI;
      return {
        root: hips,
        rot: {
          Head: [0, -6 * DEG, 4 * DEG * Math.sin(p)],
          ...arms(2 * DEG, 0, 0.15, 0),
          // Right arm raised overhead, forearm waving.
          RightUpperArm: [-10 * DEG, 0, -(armAngle + 60 * DEG)],
          RightLowerArm: [0, 0, 25 * DEG * Math.sin(p * 2) - 20 * DEG],
        },
      };
    }),
  ];
}
