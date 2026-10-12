// Builds character specs (JSON) into GLBs, validates them and prints the
// triangle budget per part.
//
//   node tools/build-specs.mjs                      # every examples/specs/*.json -> out/specs/
//   node tools/build-specs.mjs path/to/spec.json    # one spec
//
// Exit code 1 if a spec is invalid, over budget, fails the Khronos validator or
// fails the pose audit (parts passing through each other in any clip).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import validator from 'gltf-validator';
import { buildFromSpec, budgetTable } from '../public/core/fromSpec.js';
import { auditCharacter, auditReport } from '../public/core/audit.js';

const args = process.argv.slice(2);
const files = args.length ? args : readdirSync(new URL('../examples/specs/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => new URL(`../examples/specs/${f}`, import.meta.url).pathname);
const outDir = new URL('../out/specs/', import.meta.url);
mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const file of files) {
  let spec, r;
  try {
    spec = JSON.parse(readFileSync(file, 'utf8'));
    r = buildFromSpec(spec);
  } catch (e) { console.log(`FAIL ${file}\n  ${e.message}`); failed++; continue; }
  const name = spec.name || file.replace(/.*\//, '').replace('.json', '');
  writeFileSync(new URL(`${name}.glb`, outDir), r.glb);
  const rep = await validator.validateBytes(r.glb);
  const audit = auditCharacter(r.character, r.animations);
  const ok = r.budget.ok && rep.issues.numErrors === 0 && audit.ok;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}  ${r.stats.body}/${r.stats.hair}/${r.stats.top}/${r.stats.bottom}  validator ${rep.issues.numErrors} errors ${rep.issues.numWarnings} warnings  -> out/specs/${name}.glb`);
  console.log(budgetTable(r.budget).replace(/^/gm, '    '));
  console.log(auditReport(audit).replace(/^/gm, '    '));
}
process.exit(failed ? 1 : 0);
