// End-to-end browser test: starts the server, loads the demo character in the
// real UI, generates, and screenshots the preview (bind pose + walk).
// Needs Playwright (local or global install): `npm i -D playwright` if missing.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright'));
}

const PORT = 5199;
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));
mkdirSync('out', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.click('#sample');
  await page.click('#showMask');
  await page.click('#generate');
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Done'), null, { timeout: 15000 });
  console.log('status:', await page.textContent('#status'));
  console.log('stats :', (await page.textContent('#stats')).replace(/\s+/g, ' '));
  await page.selectOption('#clip', '');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'out/ui_bind_pose.png' });
  await page.check('#bones');
  await page.selectOption('#clip', { label: 'Walk' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'out/ui_walk.png' });
  const bytes = await page.evaluate(() => window.__app.glb.byteLength);
  console.log('glb bytes:', bytes);
  if (errors.length) { console.log('page errors:', errors); code = 1; }
} catch (e) {
  console.error(e); code = 1;
} finally {
  await browser.close();
  server.kill();
}
console.log(code ? 'E2E FAILED' : 'E2E passed - screenshots in out/');
process.exit(code);
