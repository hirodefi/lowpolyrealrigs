// Headless self-test: generates the demo character in Node, then checks the GLB
// with the official Khronos glTF validator plus our own skinning sanity checks.
import { writeFileSync, mkdirSync } from 'node:fs';
import validator from 'gltf-validator';
import { sampleImages } from '../public/core/samples.js';
import { generateCharacter } from '../public/core/pipeline.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };

const imgs = sampleImages();
for (const detail of ['low', 'medium', 'high']) {
  const res = generateCharacter(imgs, { detail, colors: 16 });
  const s = res.stats;
  console.log(`\n[${detail}] ${s.triangles} tris, ${s.bones} bones, ${s.colors} colours, ${s.clips.join('/')}, ${(s.bytes / 1024).toFixed(1)} KB, ${s.ms} ms`);
  if (s.notes.length) console.log('  notes:', s.notes.join('; '));

  const report = await validator.validateBytes(res.glb);
  const { numErrors, numWarnings } = report.issues;
  check(numErrors === 0, `Khronos validator: ${numErrors} errors, ${numWarnings} warnings`);
  if (numErrors || numWarnings) for (const m of report.issues.messages.slice(0, 10)) console.log('   ', m.severity, m.code, m.message, m.pointer ?? '');

  const { joints, weights, position } = res.character.mesh;
  let badW = 0, badJ = 0;
  for (let v = 0; v < weights.length / 4; v++) {
    const sum = weights[v * 4] + weights[v * 4 + 1] + weights[v * 4 + 2] + weights[v * 4 + 3];
    if (Math.abs(sum - 1) > 1e-4) badW++;
    for (let k = 0; k < 4; k++) if (joints[v * 4 + k] >= s.bones) badJ++;
  }
  check(badW === 0, 'all vertex weights sum to 1');
  check(badJ === 0, 'all joint indices valid');
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < position.length; i += 3) { minY = Math.min(minY, position[i]); maxY = Math.max(maxY, position[i]); }
  check(Math.abs(minY) < 0.02 && Math.abs(maxY - 1.8) < 0.05, `feet on ground and height ~1.8 m (y ${minY.toFixed(3)}..${maxY.toFixed(3)})`);
  check(s.triangles < 6000, 'low-poly budget (< 6k tris)');

  if (detail === 'medium') {
    mkdirSync(new URL('../out', import.meta.url), { recursive: true });
    writeFileSync(new URL('../out/demo_character.glb', import.meta.url), res.glb);
  }
}

// Front-only input must still work (side/back optional).
const solo = generateCharacter({ front: imgs.front }, {});
check(solo.glb.byteLength > 0, 'front-only input works');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed. Demo written to out/demo_character.glb');
process.exit(failed ? 1 : 0);
