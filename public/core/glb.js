// Hand-written glTF 2.0 binary (GLB) exporter for the generated character:
// one skinned mesh (one primitive per body-region material, flat colours, no
// textures), one skeleton and N animation clips.

const FLOAT = 5126, UBYTE = 5121;
const ARRAY_BUFFER = 34962;

/**
 * @param character result of buildCharacter
 * @param animations result of makeAnimations (or [])
 * @param {{name?:string}} opts
 * @returns {Uint8Array} GLB bytes
 */
export function exportGLB(character, animations = [], opts = {}) {
  const { bones, mesh } = character;
  const name = opts.name || 'Character';
  const parts = []; // binary chunks
  let byteLength = 0;
  const bufferViews = [], accessors = [];

  const addView = (bytes, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); byteLength += pad; }
    const view = { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    parts.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    byteLength += bytes.byteLength;
    bufferViews.push(view);
    return bufferViews.length - 1;
  };
  const addAccessor = (arr, componentType, type, count, { target, minmax, normalized } = {}) => {
    const acc = { bufferView: addView(arr, target), componentType, count, type };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
      const min = new Array(n).fill(Infinity), max = new Array(n).fill(-Infinity);
      for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) {
        const v = arr[i * n + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
      }
      acc.min = min.map(Math.fround); acc.max = max.map(Math.fround);
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  // One primitive per material, each with its own slice of the vertex streams.
  const primitives = mesh.groups.map((g, mi) => {
    const v0 = g.start * 3, vc = g.count * 3;
    const slice = (arr, n) => arr.subarray(v0 * n, (v0 + vc) * n);
    return {
      attributes: {
        POSITION: addAccessor(slice(mesh.position, 3), FLOAT, 'VEC3', vc, { target: ARRAY_BUFFER, minmax: true }),
        NORMAL: addAccessor(slice(mesh.normal, 3), FLOAT, 'VEC3', vc, { target: ARRAY_BUFFER }),
        JOINTS_0: addAccessor(slice(mesh.joints, 4), UBYTE, 'VEC4', vc, { target: ARRAY_BUFFER }),
        WEIGHTS_0: addAccessor(slice(mesh.weights, 4), FLOAT, 'VEC4', vc, { target: ARRAY_BUFFER }),
      },
      material: mi,
      mode: 4,
    };
  });
  // glTF base colours are linear; the sampled photo colours are sRGB.
  const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const materials = mesh.groups.map((g) => ({
    name: g.material,
    pbrMetallicRoughness: { baseColorFactor: [...g.color.map((c) => Math.round(toLinear(c) * 1e4) / 1e4), 1], metallicFactor: 0, roughnessFactor: 0.9 },
  }));

  // Nodes: 0..B-1 = joints (same order as bones), B = skinned mesh node.
  const B = bones.length;
  const nodes = bones.map((b, i) => {
    const pp = b.parent >= 0 ? bones[b.parent].pos : [0, 0, 0];
    const node = { name: b.name, translation: [b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]] };
    const children = bones.map((c, j) => (c.parent === i ? j : -1)).filter((j) => j >= 0);
    if (children.length) node.children = children;
    return node;
  });
  nodes.push({ name, mesh: 0, skin: 0 });
  const rootJoint = bones.findIndex((b) => b.parent < 0);

  // Inverse bind matrices: bind rotation is identity, so it is just -worldPos.
  const ibm = new Float32Array(B * 16);
  bones.forEach((b, i) => {
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.pos[0], -b.pos[1], -b.pos[2], 1], i * 16);
  });
  const ibmAcc = addAccessor(ibm, FLOAT, 'MAT4', B);

  const gltfAnimations = animations.map((clip) => {
    const samplers = [], channels = [];
    for (const ch of clip.channels) {
      const times = new Float32Array(ch.times);
      const values = new Float32Array(ch.values);
      const input = addAccessor(times, FLOAT, 'SCALAR', times.length, { minmax: true });
      const output = addAccessor(values, FLOAT, ch.path === 'rotation' ? 'VEC4' : 'VEC3', times.length);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: ch.node, path: ch.path } });
    }
    const anim = { name: clip.name, samplers, channels };
    if (clip.extras && Object.keys(clip.extras).length) anim.extras = clip.extras;
    return anim;
  });

  const json = {
    asset: { version: '2.0', generator: 'lowpolyrigmodelgen' },
    scene: 0,
    scenes: [{ name, nodes: [rootJoint, B] }],
    nodes,
    meshes: [{ name, primitives }],
    skins: [{ name: 'Armature', joints: bones.map((_, i) => i), skeleton: rootJoint, inverseBindMatrices: ibmAcc }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
  };
  if (gltfAnimations.length) json.animations = gltfAnimations;

  // Final padding of BIN to 4 bytes.
  const binPad = (4 - (byteLength % 4)) % 4;
  if (binPad) { parts.push(new Uint8Array(binPad)); byteLength += binPad; }
  json.buffers[0].byteLength = byteLength;

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, byteLength, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  o += 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
