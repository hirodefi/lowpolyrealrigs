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
  // Extra groups the bake keeps as fixed colours: Accent (collar / tie / belt), Trim (soles, buttons, frames), Eyes.
  check(matNames.every((n) => ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes', 'Accent', 'Trim', 'Eyes'].includes(n)), 'no materials outside Skin/Hair/Top/Bottom/Shoes/Accent/Trim/Eyes');
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

// Hair and clothing styles all build valid files.
for (const [hair, bottom] of [['long', 'skirt'], ['bob', 'trousers'], ['ponytail', 'shorts'], ['bald', 'skirt']]) {
  const res = generateCharacter(imgs, { body: 'female', hair, bottom });
  const report = await validator.validateBytes(res.glb);
  let badW = 0;
  const w = res.character.mesh.weights;
  for (let v = 0; v < w.length / 4; v++) if (Math.abs(w[v * 4] + w[v * 4 + 1] + w[v * 4 + 2] + w[v * 4 + 3] - 1) > 1e-4) badW++;
  check(report.issues.numErrors === 0 && badW === 0 && res.stats.hair === hair, `hair ${hair} + ${bottom}: valid GLB, weights ok, ${res.stats.triangles} tris`);
}

// Clothing options: tank top + heels + straight knee skirt, shirt + tie, A-line skirt.
for (const o of [{ top: 'tank', shoes: 'heels', bottom: 'pencil' }, { top: 'tshirt', tie: true, bottom: 'trousers' }, { top: 'tank', bottom: 'skirt', shoes: 'flat' }]) {
  const res = generateCharacter(imgs, { body: 'female', hair: 'long', ...o });
  const report = await validator.validateBytes(res.glb);
  const mats = res.stats.materials, s = res.stats;
  const ok = report.issues.numErrors === 0 && s.top === o.top && s.bottom === o.bottom && s.heels === (o.shoes === 'heels') && (!o.tie || mats.includes('Accent'));
  check(ok && s.triangles <= 2700, `${o.top}${o.tie ? '+tie' : ''} / ${o.bottom} / ${o.shoes || 'auto'}: valid GLB, styles applied, ${s.triangles} tris (${mats.join(',')})`);
}

// Character specs (the parts kit): every example spec builds a valid file within budget,
// and every catalog part builds on its own.
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { buildFromSpec, checkSpec } = await import('../public/core/fromSpec.js');
  const { CATALOG } = await import('../public/core/parts/index.js');
  const dir = new URL('../examples/specs/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const spec = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const r = buildFromSpec(spec);
    const report = await validator.validateBytes(r.glb);
    const g = readGLBJson(r.glb);
    const ok = report.issues.numErrors === 0 && r.budget.ok && g.meshes.length === 1 && g.meshes[0].primitives.length === g.materials.length;
    check(ok, `spec ${f}: valid GLB, one skinned mesh, ${r.budget.total}/${r.budget.limit} tris (${r.budget.parts.map((p) => `${p.part} ${p.triangles}`).join(', ')})`);
  }
  for (const part of Object.keys(CATALOG)) {
    const body = part === 'hairLocks' || part === 'fringe' ? 'female' : 'male';
    const r = buildFromSpec({ name: part, body, hair: part === 'hairLocks' ? 'long' : 'short', parts: [{ part }] });
    const report = await validator.validateBytes(r.glb);
    const n = r.budget.parts[0]?.triangles ?? 0;
    check(report.issues.numErrors === 0 && n > 0, `part ${part}: builds alone, ${n} tris, valid GLB`);
  }
  check(checkSpec({ body: 'robot', parts: [{ part: 'jetpack' }] }).length === 2, 'invalid specs are rejected with reasons');
}

// Pose audit: no limb through the body, no leg through a skirt, nothing below
// the floor, no part floating off the body, in sampled frames of every clip.
{
  const { auditCharacter, auditReport } = await import('../public/core/audit.js');
  const { readdirSync, readFileSync } = await import('node:fs');
  const { buildFromSpec } = await import('../public/core/fromSpec.js');
  const cases = [
    ['man / trousers', () => generateCharacter(imgs, { body: 'male', hair: 'short', bottom: 'trousers' })],
    ['woman / A-line skirt', () => generateCharacter(imgs, { body: 'female', hair: 'long', bottom: 'skirt' })],
    ['woman / knee skirt + heels', () => generateCharacter(imgs, { body: 'female', hair: 'long', bottom: 'pencil', top: 'tank', shoes: 'heels' })],
    ['woman / ponytail shorts', () => generateCharacter(imgs, { body: 'female', hair: 'ponytail', bottom: 'shorts' })],
    ['child', () => generateCharacter(imgs, { body: 'child' })],
    ...readdirSync(new URL('../examples/specs/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => [`spec ${f}`, () => buildFromSpec(JSON.parse(readFileSync(new URL(`../examples/specs/${f}`, import.meta.url), 'utf8')))]),
  ];
  for (const [name, make] of cases) {
    const r = make(), a = auditCharacter(r.character, r.animations);
    check(a.ok, `pose audit ${name}: ${a.ok ? 'clean in ' + a.clips.map((c) => c.clip).join('/') : auditReport(a)}`);
  }
  // The audit must catch a broken pose: force both upper arms into the body and
  // a part off the body (adversarial, like the benchmark's suite C).
  const r = generateCharacter(imgs, { body: 'male', hair: 'short', bottom: 'trousers' });
  const bad = JSON.parse(JSON.stringify(r.animations.filter((c) => c.name === 'idle')));
  const ix = Object.fromEntries(r.character.bones.map((b, i) => [b.name, i]));
  for (const [bone, sgn] of [['LeftUpperArm', -1], ['RightUpperArm', 1]]) {
    const ch = bad[0].channels.find((c) => c.node === ix[bone]);
    const a = sgn * 1.4, q = [0, 0, Math.sin(a / 2), Math.cos(a / 2)]; // swing the arm across the chest
    for (let f = 0; f < ch.times.length; f++) ch.values.splice(f * 4, 4, ...q);
  }
  const caught = auditCharacter(r.character, bad);
  check(caught.issues.some((i) => i.check.startsWith('arm-through')), `pose audit catches arms forced into the body (${caught.issues.map((i) => i.check).join(', ') || 'nothing'})`);
  const moved = { ...r.character, mesh: { ...r.character.mesh, position: r.character.mesh.position.slice(), tags: r.character.mesh.tags.slice() } };
  const t0 = moved.mesh.groups.find((g) => g.material === 'Hair').start; // pretend one hair triangle is a part and push it away
  moved.mesh.tags[t0] = 'test#0';
  for (let k = 0; k < 3; k++) moved.mesh.position[t0 * 9 + k * 3 + 2] += 0.3;
  check(auditCharacter(moved, []).issues.some((i) => i.check === 'part-floating'), 'pose audit catches a part floating off the body');
  // ...and a leg forced through a skirt (thigh raised 70 degrees: the skirt can only follow halfway).
  const sk = generateCharacter(imgs, { body: 'female', hair: 'long', bottom: 'skirt' });
  const skIx = Object.fromEntries(sk.character.bones.map((b, i) => [b.name, i]));
  const kick = JSON.parse(JSON.stringify(sk.animations.filter((c) => c.name === 'idle')));
  const leg = kick[0].channels.find((c) => c.node === skIx.LeftUpperLeg);
  for (let f = 0; f < leg.times.length; f++) leg.values.splice(f * 4, 4, Math.sin(-0.61), 0, 0, Math.cos(-0.61));
  const kicked = auditCharacter(sk.character, kick);
  check(kicked.issues.some((i) => i.check === 'leg-through-skirt'), `pose audit catches a leg forced through a skirt (${kicked.issues.map((i) => i.check).join(', ') || 'nothing'})`);
}

// Front-only input must still work (side/back optional).
const solo = generateCharacter({ front: imgs.front }, {});
check(solo.glb.byteLength > 0, 'front-only input works');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed. Demo written to out/demo_character.glb');
process.exit(failed ? 1 : 0);
