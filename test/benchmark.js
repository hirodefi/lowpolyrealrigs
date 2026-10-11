// Benchmark: measures how faithfully the pipeline reads images, in headless Chromium.
//
//   node test/benchmark.js            # all suites, writes out/benchmark/<case>/ + out/benchmark/report.json
//   node test/benchmark.js --only A3  # one case
//
// Suite A (synthetic ground truth) is graded: any metric over tolerance fails
// the run. External references have no ground truth; their silhouette metrics
// are reported against separate, looser tolerances and do not fail the run.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright'));
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

// Tolerances. Synthetic: controlled renders, tight. External: report only.
const TOL = {
  // IoU >= 0.85 as agreed in the plan; thin limbs make IoU very sensitive to
  // small placement offsets, so landmark and width errors carry the precision.
  synthetic: { landmark: 0.02, color: 25, iou: { front: 0.85, side: 0.85, back: 0.85 }, widthErr: { front: 0.02, side: 0.025, back: 0.02 } },
  external: { iou: { front: 0.8, side: 0.7, back: 0.8 }, widthErr: { front: 0.03, side: 0.05, back: 0.03 } },
};

const SYNTHETIC = [
  { name: 'A1-man-short-trousers', gen: { body: 'male', hair: 'short', bottom: 'trousers', colors: { top: [32, 44, 78], bottom: [196, 170, 120], hair: [40, 28, 20], shoes: [60, 40, 30] } }, bg: [236, 236, 236] },
  { name: 'A2-woman-long-skirt', gen: { body: 'female', hair: 'long', bottom: 'skirt', colors: { top: [190, 40, 50], bottom: [30, 30, 34], hair: [90, 56, 30] } }, bg: [205, 218, 236] },
  { name: 'A3-woman-ponytail-trousers', gen: { body: 'female', hair: 'ponytail', bottom: 'trousers', colors: { top: [60, 140, 90], bottom: [40, 44, 60], hair: [214, 180, 110] } }, bg: [232, 232, 226] },
  { name: 'A4-woman-bob-shorts', gen: { body: 'female', hair: 'bob', bottom: 'shorts', colors: { top: [235, 200, 60], bottom: [70, 100, 160], hair: [20, 20, 22] } }, bg: [240, 240, 240] },
  { name: 'A5-child-short', gen: { body: 'child', hair: 'short', bottom: 'trousers', colors: { top: [230, 120, 40], bottom: [50, 80, 140] } }, bg: [225, 235, 225] },
  { name: 'A6-man-bald-dark-skin', gen: { body: 'male', hair: 'bald', bottom: 'trousers', colors: { skin: [110, 72, 52], top: [240, 240, 236], bottom: [38, 38, 42] } }, bg: [170, 200, 230] },
];
const ADVERSARIAL = [
  { name: 'C1-gradient-backdrop', perturb: 'gradient', expect: 'background-gradient' },
  { name: 'C2-trousers-match-backdrop', perturb: 'none', gen: { bottom: 'trousers', colors: { bottom: [200, 200, 200] } }, bg: [200, 200, 200], expect: ['low-contrast', 'figure-broken'] },
  { name: 'C3-side-view-wrong-scale', perturb: 'scale', expect: 'scale-mismatch' },
  { name: 'C4-feet-cropped', perturb: 'crop', expect: 'cropped' },
  { name: 'C5-front-only', perturb: 'frontonly', expect: 'views' },
].map((c) => ({ gen: { body: 'male', hair: 'short', bottom: 'trousers', colors: { top: [32, 44, 78], bottom: [196, 170, 120] } }, bg: [236, 236, 236], ...c }));
const EXTERNAL = [
  { name: 'X0-woman-clean-views', views: { front: '/test/fixtures/woman/front.png', side: '/test/fixtures/woman/side.png', back: '/test/fixtures/woman/back.png' } },
  { name: 'X1-turnaround-sheet', sheet: '/test/fixtures/turnaround/sheet.webp' },
  { name: 'X2-turnaround-views', views: { front: '/test/fixtures/turnaround/front.png', side: '/test/fixtures/turnaround/side.png', back: '/test/fixtures/turnaround/back.png' } },
  { name: 'X3-walking-photo-front-only', views: { front: '/test/fixtures/photo/front.jpg' } },
];

const PORT = 5196;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`http://localhost:${PORT}/`);

const save = (dir, files) => { mkdirSync(dir, { recursive: true }); for (const [n, bytes] of Object.entries(files)) writeFileSync(`${dir}/${n}`, Buffer.from(bytes)); };
const report = { synthetic: [], adversarial: [], external: [], tolerances: TOL };
let failures = 0;
const flag = (ok) => (ok ? '  ' : '<<');

try {
  console.log('Suite A - synthetic ground truth (graded)');
  for (const c of SYNTHETIC) {
    if (only && !c.name.startsWith(only)) continue;
    const r = await page.evaluate(async (c) => (await import('/test/lib/bench.js')).runSynthetic(c), c);
    save(`out/benchmark/${c.name}`, r.files); delete r.files;
    const T = TOL.synthetic, fails = [];
    for (const k of ['body', 'hair', 'bottom']) if (r.truth[k] !== r.got[k]) fails.push(`${k}: ${r.truth[k]} -> ${r.got[k]}`);
    for (const [k, e] of Object.entries(r.lmErr)) if (e > T.landmark) fails.push(`${k} off by ${(e * 100).toFixed(1)}% H`);
    for (const [k, e] of Object.entries(r.colorErr)) if (e > T.color) fails.push(`${k} colour off by ${e}`);
    for (const [v, m] of Object.entries(r.views)) {
      if (m.modelPieces !== 1) fails.push(`${v}: model silhouette in ${m.modelPieces} pieces (see-through seam)`);
      if (m.iou < T.iou[v]) fails.push(`${v} IoU ${m.iou}`);
      if (m.widthErr > T.widthErr[v]) fails.push(`${v} width err ${(m.widthErr * 100).toFixed(1)}% H`);
    }
    r.pass = !fails.length; r.fails = fails;
    if (!r.pass) failures++;
    report.synthetic.push(r);
    const vs = Object.entries(r.views).map(([v, m]) => `${v[0]} IoU ${m.iou.toFixed(3)} w ${(m.widthErr * 100).toFixed(1)}%`).join(' | ');
    const lmMax = Math.max(...Object.values(r.lmErr)), colMax = Math.max(...Object.values(r.colorErr));
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${c.name.padEnd(30)} styles ${r.got.body}/${r.got.hair}/${r.got.bottom}  lm max ${(lmMax * 100).toFixed(1)}%  colour max ${colMax}  ${vs}  ${r.triangles} tris`);
    for (const f of fails) console.log(`       - ${f}`);
    // Clean synthetic inputs must not raise input warnings (other than tier notes).
    const spurious = r.got.validation.issues.filter((i) => i.id !== 'views' && i.id !== 'neck');
    if (spurious.length) { console.log(`       ! validator flagged clean input: ${spurious.map((i) => i.view + ':' + i.id).join(', ')}`); }
  }

  console.log('\nSuite C - adversarial inputs (the validator must flag each one)');
  for (const c of ADVERSARIAL) {
    if (only && !c.name.startsWith(only)) continue;
    const r = await page.evaluate(async (c) => (await import('/test/lib/bench.js')).runAdversarial(c), c);
    save(`out/benchmark/${c.name}`, r.files); delete r.files;
    const expect = [].concat(c.expect);
    r.pass = r.issues.some((i) => expect.includes(i.id));
    if (!r.pass) failures++;
    report.adversarial.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${c.name.padEnd(30)} expects ${[].concat(c.expect).join('|').padEnd(26)} got: ${r.issues.map((i) => `${i.view}:${i.id}(${i.level})`).join(', ') || 'nothing'}`);
  }

  console.log('\nExternal references (report only)');
  for (const c of EXTERNAL) {
    if (only && !c.name.startsWith(only)) continue;
    const r = await page.evaluate(async (c) => (await import('/test/lib/bench.js')).runExternal(c), c);
    save(`out/benchmark/${c.name}`, { ...r.files, 'model.glb': r.glb }); delete r.files; delete r.glb;
    const T = TOL.external;
    r.flags = [];
    for (const [v, m] of Object.entries(r.views)) {
      if (m.iou < T.iou[v]) r.flags.push(`${v} IoU ${m.iou}`);
      if (m.widthErr > T.widthErr[v]) r.flags.push(`${v} width err ${(m.widthErr * 100).toFixed(1)}% H`);
    }
    report.external.push(r);
    const vs = Object.entries(r.views).map(([v, m]) => `${v[0]} IoU ${m.iou.toFixed(3)} w ${(m.widthErr * 100).toFixed(1)}%`).join(' | ');
    console.log(`${r.flags.length ? 'WARN' : 'OK  '} ${c.name.padEnd(30)} ${r.got.body}/${r.got.hair}/${r.got.bottom}  ${vs}`);
    console.log(`       notes: ${r.got.notes.join('; ') || '-'}`);
    // Attribute mismatches: a view the validator flagged is an INPUT problem.
    const inputIssues = r.validation.issues;
    for (const i of inputIssues) console.log(`       input ${i.level}: [${i.view}] ${i.id} - ${i.message}`);
    for (const f of r.flags) console.log(`       - ${f}`);
  }
} catch (e) { console.error(e); failures++; }
finally { await browser.close(); server.kill(); }

mkdirSync('out/benchmark', { recursive: true });
writeFileSync('out/benchmark/report.json', JSON.stringify(report, null, 1));
console.log(failures ? `\n${failures} synthetic case(s) failed - see out/benchmark/` : '\nAll synthetic cases within tolerance. Report: out/benchmark/report.json');
process.exit(failures ? 1 : 0);
