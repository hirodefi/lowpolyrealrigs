// Procedural looping animation clips for the generated skeleton.
// Bind pose has identity rotations with world-aligned joint frames, so
// rotating a limb about X swings it forward/back for every bone - one formula
// works for any body shape.

const DEG = Math.PI / 180;

function qAxis(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
// Applies rotations in order: z first, then y, then x (all world/parent axes).
const qEuler = (x = 0, y = 0, z = 0) => qMul(qAxis(1, 0, 0, x), qMul(qAxis(0, 1, 0, y), qAxis(0, 0, 1, z)));

/**
 * @param bones [{name, parent, pos}] from buildCharacter
 * @param spec body spec (for arm angle / height)
 */
export function makeAnimations(bones, spec) {
  const byName = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const H = spec.height;
  const hips = bones[byName.Hips].pos;
  // Arms are lowered to a relaxed ~72 deg for animation regardless of source pose.
  const lower = Math.max(0, 72 * DEG - spec.arm.angle);

  const clip = (name, duration, frames, pose) => {
    const tracks = {};
    for (let f = 0; f <= frames; f++) {
      const t = (f / frames) * duration;
      const p = (f / frames) * Math.PI * 2;
      const pz = pose(p);
      for (const [bone, val] of Object.entries(pz)) {
        if (bone === 'HipsT') {
          (tracks['Hips|translation'] ??= { times: [], values: [] }).values.push(...val);
          tracks['Hips|translation'].times.push(t);
          continue;
        }
        const key = `${bone}|rotation`;
        (tracks[key] ??= { times: [], values: [] }).values.push(...qEuler(...val));
        tracks[key].times.push(t);
      }
    }
    return {
      name, duration,
      channels: Object.entries(tracks).map(([k, v]) => {
        const [bone, path] = k.split('|');
        return { node: byName[bone], path, times: v.times, values: v.values };
      }),
    };
  };

  const arms = (swingL, swingR, elbow, spread = 0) => ({
    LeftUpperArm: [swingL, 0, -lower + spread],
    RightUpperArm: [swingR, 0, lower - spread],
    LeftLowerArm: [-elbow, 0, 0],
    RightLowerArm: [-elbow, 0, 0],
  });

  const gait = (A, K, armA, elbow, bob, lean, sway) => (p) => {
    const s = Math.sin(p), c = Math.cos(p);
    const kneeL = K * Math.max(0, -c) + 0.08, kneeR = K * Math.max(0, c) + 0.08;
    const thighL = -A * s, thighR = A * s;
    return {
      // Weight shifts over the stance leg (sway), and the pelvis drops on the swing side.
      HipsT: [hips[0] - sway * H * c, hips[1] - bob * H * (0.5 + 0.5 * Math.cos(2 * p)), hips[2]],
      Hips: [0, 6 * DEG * s, 3 * DEG * c],
      Spine: [lean, -4 * DEG * s, 0],
      Chest: [0, -5 * DEG * s, 0],
      Head: [-lean * 0.6, 3 * DEG * s, 0],
      LeftUpperLeg: [thighL, 0, 0], RightUpperLeg: [thighR, 0, 0],
      LeftLowerLeg: [kneeL, 0, 0], RightLowerLeg: [kneeR, 0, 0],
      LeftFoot: [-(thighL + kneeL) * 0.5 - 0.05, 0, 0], RightFoot: [-(thighR + kneeR) * 0.5 - 0.05, 0, 0],
      ...arms(armA * s, -armA * s, elbow + 0.1 * Math.abs(s)),
    };
  };

  return [
    clip('idle', 3, 30, (p) => ({
      HipsT: [hips[0], hips[1] - 0.003 * H * (0.5 + 0.5 * Math.cos(p)), hips[2]],
      Spine: [1.5 * DEG * Math.sin(p), 0, 0],
      Chest: [2 * DEG * Math.sin(p), 0, 0],
      Head: [-1.5 * DEG * Math.sin(p + 0.6), 2 * DEG * Math.sin(p * 0.5), 0],
      ...arms(2 * DEG * Math.sin(p), 2 * DEG * Math.sin(p), 0.15 + 0.03 * Math.sin(p), 3 * DEG * (1 + Math.sin(p))),
    })),
    clip('walk', 1.1, 24, gait(28 * DEG, 50 * DEG, 24 * DEG, 0.3, 0.012, 3 * DEG, 0.012)),
    clip('run', 0.7, 20, gait(45 * DEG, 95 * DEG, 50 * DEG, 1.4, 0.03, 12 * DEG, 0.008)),
    // Seated on a bench: thighs horizontal, shins vertical, so the hips drop to
    // knee height and the feet stay on the floor. Held pose (2 identical keys).
    clip('sit', 1, 1, () => ({
      HipsT: [hips[0], hips[1] - (spec.hipY - spec.kneeY), hips[2]],
      Spine: [-4 * DEG, 0, 0],
      LeftUpperLeg: [-90 * DEG, 0, 0], RightUpperLeg: [-90 * DEG, 0, 0],
      LeftLowerLeg: [90 * DEG, 0, 0], RightLowerLeg: [90 * DEG, 0, 0],
      ...arms(-25 * DEG, -25 * DEG, 0.9),
    })),
    clip('wave', 2, 30, (p) => ({
      ...arms(2 * DEG, 0, 0.15),
      // Raise the right arm overhead and wave the forearm.
      RightUpperArm: [-10 * DEG, 0, -(spec.arm.angle + 60 * DEG)],
      RightLowerArm: [0, 0, 25 * DEG * Math.sin(p * 2) - 20 * DEG],
      Head: [0, -6 * DEG, 4 * DEG * Math.sin(p)],
    })),
  ];
}
