// Headless self-test: generates the demo character in Node, then checks the GLB
// with the official Khronos glTF validator, our skinning sanity checks, and the
// crowd bake-tool contract (flat named materials, no textures, required clips).
import { writeFileSync, mkdirSync } from 'node:fs';
import validator from 'gltf-validator';
import { sampleImages } from '../public/core/samples.js';
import { generateCharacter } from '../public/core/pipeline.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

function readGLBJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

const imgs = sampleImages();
for (const detail of ['low', 'medium', 'high']) {
  const res = generateCharacter(imgs, { detail });
  const s = res.stats;
  console.log(`\n[${detail}] ${s.triangles} tris, ${s.bones} bones, materials ${s.materials.join('/')}, clips ${s.clips.join('/')}, ${(s.bytes / 1024).toFixed(1)} KB, ${s.ms} ms`);
  if (s.notes.length) console.log('  notes:', s.notes.join('; '));

  const report = await validator.validateBytes(res.glb);
  const { numErrors, numWarnings } = report.issues;
  check(numErrors === 0, `Khronos validator: ${numErrors} errors, ${numWarnings} warnings`);
  if (numErrors || numWarnings) for (const m of report.issues.messages.slice(0, 10)) console.log('   ', m.severity, m.code, m.message, m.pointer ?? '');

  // --- crowd bake-tool contract
  const g = readGLBJson(res.glb);
  check(!g.images && !g.textures && !g.samplers, 'no images / textures in the file');
  const matNames = g.materials.map((m) => m.name);
  check(['Skin', 'Hair', 'Top', 'Bottom', 'Shoes'].every((n) => matNames.includes(n)), `materials named Skin/Hair/Top/Bottom/Shoes (got ${matNames.join(',')})`);
  check(g.materials.every((m) => m.pbrMetallicRoughness?.baseColorFactor?.length === 4 && !m.pbrMetallicRoughness.baseColorTexture), 'every material is a flat baseColorFactor');
  check(g.meshes.length === 1 && g.skins.length === 1 && g.nodes.filter((n) => n.mesh != null).length === 1, 'exactly one skinned mesh + one skin');
  check(g.meshes[0].primitives.length === matNames.length && g.meshes[0].primitives.every((p) => !p.targets), 'one primitive per material, no morph targets');
  const clips = (g.animations || []).map((a) => a.name.toLowerCase());
  check(clips.includes('walk') && clips.includes('idle'), `required clips walk + idle (got ${clips.join(',')})`);
  check(['run', 'wave', 'sit'].every((c) => clips.includes(c)), 'optional clips run, wave, sit present');
  const walk = g.animations.find((a) => a.name === 'walk');
  check(walk.extras?.speed > 0.6 && walk.extras.speed < 1.8, `walk has a realistic ground speed in extras (${walk.extras?.speed} m/s)`);

  // --- skinning + scale
  const { joints, weights, position } = res.character.mesh;
  let badW = 0, badJ = 0;
  for (let v = 0; v < weights.length / 4; v++) {
    const sum = weights[v * 4] + weights[v * 4 + 1] + weights[v * 4 + 2] + weights[v * 4 + 3];
    if (Math.abs(sum - 1) > 1e-4) badW++;
    for (let k = 0; k < 4; k++) if (joints[v * 4 + k] >= s.bones) badJ++;
  }
  check(badW === 0, 'all vertex weights sum to 1');
  check(badJ === 0, 'all joint indices valid');
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.length; i += 3) {
    minY = Math.min(minY, position[i + 1]); maxY = Math.max(maxY, position[i + 1]);
    minZ = Math.min(minZ, position[i + 2]); maxZ = Math.max(maxZ, position[i + 2]);
  }
  check(Math.abs(minY) < 0.02 && Math.abs(maxY - 1.7) < 0.05, `feet on ground and height ~1.7 m (y ${minY.toFixed(3)}..${maxY.toFixed(3)})`);
  check(maxZ > -minZ, 'faces +Z (toes stick out further forward than the heels/back)');
  check(s.triangles < 6000, 'low-poly budget (< 6k tris)');

  if (detail === 'medium') {
    mkdirSync(new URL('../out', import.meta.url), { recursive: true });
    writeFileSync(new URL('../out/demo_character.glb', import.meta.url), res.glb);
  }
}

// Every body template builds a valid file.
for (const body of ['male', 'female', 'child']) {
  const res = generateCharacter(imgs, { body });
  const report = await validator.validateBytes(res.glb);
  check(report.issues.numErrors === 0 && res.stats.body === body, `${body} template: valid GLB, ${res.stats.triangles} tris`);
}

// Front-only input must still work (side/back optional).
const solo = generateCharacter({ front: imgs.front }, {});
check(solo.glb.byteLength > 0, 'front-only input works');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed. Demo written to out/demo_character.glb');
process.exit(failed ? 1 : 0);
