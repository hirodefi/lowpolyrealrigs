#!/usr/bin/env node
// Character skill CLI. Run from the repository root.
//
//   node .claude/skills/character/scripts/character.mjs catalog
//       List the parts catalog (names, what they are, defaults, triangle cost).
//
//   node .claude/skills/character/scripts/character.mjs seed --ref <dir> | --sheet <file> | --front <f> [--side <f>] [--back <f>]  [--out spec.json]
//       Measure reference images and write a draft spec (body type, styles, colours).
//
//   node .claude/skills/character/scripts/character.mjs spans --ref <dir> [--view front|side|back] [--step 0.01] [--from 1] [--to 0]
//       Manual measuring aid: per row of a view, the figure's spans (x from the
//       centre and h from the floor, as fractions of the figure height) and the
//       colour of each span, to read off widths, depths and landmarks.
//
//   node .claude/skills/character/scripts/character.mjs fit <spec.json> --ref <dir> [--out <dir>] [--rows]
//       The "do it again" loop: builds the spec against the references and compares the silhouettes row by row
//       (aligned on the feet, the height and the ankle plumb line): IoU per view, mean/max edge error per body
//       band, flagged rows, red/cyan overlays (red = reference only, cyan = model only). Exit 1 if a gate fails.
//
//   node .claude/skills/character/scripts/character.mjs build <spec.json> [--ref <dir> | --sheet <file> | --front ...] [--out <dir>]
//       Build the spec (shaped by the references if given), then write to <dir>
//       (default out/characters/<name>/): model.glb, sheet.png (review sheet),
//       overlay_<view>.png (reference vs model silhouettes), report.json, report.txt.
//       Exit code 1 if the spec is invalid, over budget, fails the Khronos
//       validator or fails the pose audit.
//
// A reference <dir> holds front.*, side.* and/or back.* (png, jpg or webp).
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null; };

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const dataUrl = (file) => `data:${MIME[extname(file).toLowerCase()] || 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
function refArgs() {
  if (flag('sheet')) return { sheet: dataUrl(resolve(flag('sheet'))) };
  const ref = {};
  if (flag('ref')) {
    const dir = resolve(flag('ref'));
    for (const f of readdirSync(dir)) { const v = f.replace(/\.[^.]+$/, '').toLowerCase(); if (['front', 'side', 'back'].includes(v) && MIME[extname(f).toLowerCase()]) ref[v] = dataUrl(join(dir, f)); }
  }
  for (const v of ['front', 'side', 'back']) if (flag(v)) ref[v] = dataUrl(resolve(flag(v)));
  return Object.keys(ref).length ? ref : null;
}

async function withBrowser(fn) {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require(join(ROOT, 'node_modules/playwright'))); } catch {
    try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }
  }
  const PORT = 5200 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, [join(ROOT, 'server.js')], { env: { ...process.env, PORT }, stdio: 'pipe', cwd: ROOT });
  await new Promise((r) => server.stdout.once('data', r));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`http://localhost:${PORT}/`);
    return await fn(page);
  } finally { await browser.close(); server.kill(); }
}

if (cmd === 'catalog') {
  const { describeCatalog } = await import(join(ROOT, 'public/core/parts/index.js'));
  for (const p of describeCatalog()) console.log(`${p.name}  (${p.cost} tris)\n  ${p.about}\n  defaults: ${JSON.stringify(p.defaults)}\n`);
} else if (cmd === 'seed') {
  const ref = refArgs();
  if (!ref) { console.error('seed needs --ref <dir>, --sheet <file> or --front <file>'); process.exit(2); }
  const r = await withBrowser((page) => page.evaluate(async (ref) => (await import('/test/lib/studio.js')).seed(ref), ref));
  const out = resolve(flag('out') || 'spec.json');
  writeFileSync(out, JSON.stringify(r.spec, null, 2) + '\n');
  console.log(`draft spec -> ${out}\n${JSON.stringify(r.spec, null, 2)}`);
  if (r.notes?.length) console.log('notes: ' + r.notes.join('; '));
  for (const i of r.validation?.issues || []) console.log(`input ${i.level}: [${i.view}] ${i.id} - ${i.message}`);
} else if (cmd === 'spans') {
  const ref = refArgs();
  if (!ref) { console.error('spans needs --ref <dir>, --sheet <file> or --front/--side/--back <file>'); process.exit(2); }
  const view = flag('view') || 'front', step = Number(flag('step') || 0.01), hi = Number(flag('from') ?? 1), lo = Number(flag('to') ?? 0);
  const r = await withBrowser((page) => page.evaluate(async ([ref, view, step]) => (await import('/test/lib/studio.js')).spans(ref, view, step), [ref, view, step]));
  console.log(`${view} view, figure ${r.heightPx}px tall. h = height from the floor, x = from the centre (fractions of the figure height); colour = span median`);
  for (const row of r.rows) if (row.h <= hi + 1e-9 && row.h >= lo - 1e-9) console.log(`h ${row.h.toFixed(2)} | ` + row.runs.map((q) => `${q.x0 >= 0 ? '+' : ''}${q.x0.toFixed(3)}..${q.x1 >= 0 ? '+' : ''}${q.x1.toFixed(3)} (${q.rgb.join(',')})`).join(' | '));
} else if (cmd === 'fit') {
  const file = argv[1];
  if (!file || !existsSync(file)) { console.error('usage: character.mjs fit <spec.json> --ref <dir> [--out <dir>] [--rows]'); process.exit(2); }
  const spec = JSON.parse(readFileSync(file, 'utf8')), ref = refArgs();
  if (!ref) { console.error('fit needs --ref <dir> (or --sheet / --front ...)'); process.exit(2); }
  const r = await withBrowser((page) => page.evaluate(async ([spec, ref]) => (await import('/test/lib/studio.js')).fit(spec, ref), [spec, ref]));
  const dir = resolve(flag('out') || join(ROOT, 'out/characters', spec.name || 'character'));
  mkdirSync(dir, { recursive: true });
  for (const [n, bytes] of Object.entries(r.files)) writeFileSync(join(dir, n), Uint8Array.from(bytes));
  writeFileSync(join(dir, 'fit.txt'), r.report.lines.join('\n') + '\n');
  writeFileSync(join(dir, 'fit.json'), JSON.stringify(r.report, null, 1));
  const show = argv.includes('--rows') ? r.report.lines : r.report.lines.filter((l) => !l.startsWith('   h ') || l.endsWith('<<'));
  console.log(show.join('\n'));
  console.log(`\n${r.report.pass ? 'FIT OK' : 'FIT: gates not met'}  (${r.triangles} triangles)   full table: ${dir}/fit.txt   overlays: ${dir}/fit_overlay_*.png`);
  process.exit(r.report.pass ? 0 : 1);
} else if (cmd === 'build') {
  const file = argv[1];
  if (!file || !existsSync(file)) { console.error('usage: character.mjs build <spec.json> [--ref <dir>] [--out <dir>]'); process.exit(2); }
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const ref = refArgs();
  let r;
  try { r = await withBrowser((page) => page.evaluate(async ([spec, ref]) => (await import('/test/lib/studio.js')).build(spec, ref), [spec, ref])); }
  catch (e) { console.error('FAIL ' + (e.message.split('\n').find((l) => /Invalid character spec|Unknown/.test(l)) ? e.message.slice(e.message.indexOf('Invalid')) : e.message)); process.exit(1); }
  const dir = resolve(flag('out') || join(ROOT, 'out/characters', spec.name || 'character'));
  mkdirSync(dir, { recursive: true });
  const glb = Uint8Array.from(r.glb);
  writeFileSync(join(dir, 'model.glb'), glb);
  for (const [n, bytes] of Object.entries(r.files)) writeFileSync(join(dir, n), Uint8Array.from(bytes));
  const validator = (await import(join(ROOT, 'node_modules/gltf-validator/index.js')).catch(() => import('gltf-validator'))).default;
  const khronos = await validator.validateBytes(glb);
  const ok = r.budget.ok && r.audit.ok && khronos.issues.numErrors === 0;
  const lines = [
    `${ok ? 'OK' : 'FAIL'}  ${spec.name || 'character'}  ${r.stats.body}/${r.stats.hair}/${r.stats.top}/${r.stats.bottom}${r.stats.heels ? '/heels' : ''}`,
    `materials: ${r.stats.materials.join(', ')}   clips: ${r.stats.clips.join(', ')}`,
    `Khronos validator: ${khronos.issues.numErrors} errors, ${khronos.issues.numWarnings} warnings`,
    'triangle budget:',
    `  body (base)      ${String(r.budget.base).padStart(5)}`,
    ...r.budget.parts.map((p) => `  ${p.part.padEnd(16)} ${String(p.triangles).padStart(5)}`),
    `  total            ${String(r.budget.total).padStart(5)} / ${r.budget.limit}${r.budget.ok ? '' : '  OVER BUDGET'}`,
    r.audit.ok ? `pose audit: passed (${r.audit.clips.map((c) => c.clip).join(', ')})` : 'pose audit: FAILED\n' + r.audit.issues.map((i) => `  ${i.check} ${i.clip} frame ${i.frame}: ${i.message}`).join('\n'),
    ...(r.compare ? ['reference match (silhouette IoU, mean width error % of height):', ...Object.entries(r.compare).map(([v, m]) => `  ${v.padEnd(5)} IoU ${m.iou}  width err ${(m.widthErr * 100).toFixed(1)}%${m.pieces !== 1 ? `  (${m.pieces} pieces)` : ''}`)] : []),
    ...(r.stats.validation?.issues?.length ? ['input checks:', ...r.stats.validation.issues.map((i) => `  ${i.level} [${i.view}] ${i.id} - ${i.message}`)] : []),
    `files: ${dir}/model.glb, sheet.png${r.compare ? ', overlay_*.png' : ''}, report.json`,
  ];
  writeFileSync(join(dir, 'report.txt'), lines.join('\n') + '\n');
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ spec, stats: r.stats, budget: r.budget, audit: r.audit, compare: r.compare, khronos: { errors: khronos.issues.numErrors, warnings: khronos.issues.numWarnings } }, null, 1));
  console.log(lines.join('\n'));
  process.exit(ok ? 0 : 1);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(cmd ? 2 : 0);
}
