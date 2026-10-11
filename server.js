// Zero-dependency static server. All generation runs in the browser, so this
// only serves files: public/ and the locally installed three.js (no CDN).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MOUNTS = [
  ['/vendor/three/', resolve(ROOT, 'node_modules/three')],
  ['/test/', resolve(ROOT, 'test')], // browser-side test helpers + fixtures
  ['/', resolve(ROOT, 'public')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};
const PORT = Number(process.env.PORT) || 5173;

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const [prefix, dir] = MOUNTS.find(([p]) => path.startsWith(p));
    let file = normalize(join(dir, path.slice(prefix.length)));
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, () => console.log(`Low-poly rig generator running at http://localhost:${PORT}`));
