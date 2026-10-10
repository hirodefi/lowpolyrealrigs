import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateCharacter } from './core/pipeline.js';
import { analyzeImage } from './core/silhouette.js';
import { sampleImages } from './core/samples.js';

const MAX_PX = 400; // analysis resolution - plenty for silhouettes, keeps everything ~instant
const $ = (s) => document.querySelector(s);
const images = { front: null, side: null, back: null };
let lastGLB = null, lastFront = null;

// ---------- image slots ----------
for (const slot of document.querySelectorAll('.slot')) {
  const view = slot.dataset.view;
  const input = slot.querySelector('input');
  input.addEventListener('change', () => input.files[0] && loadFile(view, input.files[0]));
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('drag'));
  slot.addEventListener('drop', (e) => {
    e.preventDefault(); slot.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) loadFile(view, f);
  });
}

async function loadFile(view, file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    setImage(view, ctx.getImageData(0, 0, c.width, c.height));
  } catch (e) {
    status(`Could not read that image: ${e.message}`, true);
  }
}

function setImage(view, img) {
  images[view] = img;
  drawSlot(view);
  $('#generate').disabled = !images.front;
  status(images.front ? 'Ready - click Generate.' : 'Add a front view to start.');
}

function drawSlot(view) {
  const slot = document.querySelector(`.slot[data-view="${view}"]`);
  const img = images[view];
  const canvas = slot.querySelector('canvas');
  slot.classList.toggle('filled', !!img);
  if (!img) return;
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  if ($('#showMask').checked) {
    try {
      const sil = analyzeImage(img);
      const ov = ctx.getImageData(0, 0, img.width, img.height);
      for (let i = 0; i < sil.mask.length; i++) {
        const o = i * 4;
        if (sil.mask[i]) { ov.data[o] = ov.data[o] * 0.4 + 79 * 0.6; ov.data[o + 1] *= 0.4; ov.data[o + 2] = ov.data[o + 2] * 0.4 + 213 * 0.6; }
        else { ov.data[o] *= 0.35; ov.data[o + 1] *= 0.35; ov.data[o + 2] *= 0.35; }
      }
      ctx.putImageData(ov, 0, 0);
    } catch { /* no subject: leave the plain image */ }
  }
}
$('#showMask').addEventListener('change', () => Object.keys(images).forEach(drawSlot));

$('#sample').addEventListener('click', () => {
  const s = sampleImages();
  for (const v of ['front', 'side', 'back']) setImage(v, s[v]);
});

// ---------- generation ----------
$('#generate').addEventListener('click', async () => {
  try {
    status('Generating...');
    await new Promise((r) => setTimeout(r, 20)); // let the status paint
    const res = generateCharacter(images, {
      height: Number($('#height').value) || 1.7,
      detail: $('#detail').value,
      body: $('#body').value,
      hair: $('#hair').value,
      bottom: $('#bottom').value,
      preset: $('#preset').value,
      animations: $('#anims').checked,
    });
    lastGLB = res.glb;
    lastFront = res.silhouettes.front;
    $('#compare').checked = false;
    $('#compare').disabled = false;
    await showModel(res.glb);
    setCompare(false);
    const s = res.stats;
    $('#stats').innerHTML = [
      ['Body', s.body], ['Hair', s.hair], ['Clothes', s.bottom === 'skirt' ? 'skirt / dress' : 'trousers'], ['Triangles', s.triangles], ['Bones', s.bones], ['Materials', s.materials.join(', ')],
      ['Clips', s.clips.length ? s.clips.join(', ') : 'none'], ['File size', `${(s.bytes / 1024).toFixed(1)} KB`], ['Time', `${s.ms} ms`],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    status(`Done.${s.notes.length ? '\nNotes: ' + s.notes.join('; ') : ''}`);
    $('#download').disabled = false;
  } catch (e) {
    console.error(e);
    status(e.message, true);
  }
});

$('#download').addEventListener('click', () => {
  if (!lastGLB) return;
  const url = URL.createObjectURL(new Blob([lastGLB], { type: 'model/gltf-binary' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'character.glb' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function status(msg, error = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', error);
}

// ---------- three.js preview ----------
const host = $('#view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0); // let the panel's CSS background show through
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
camera.position.set(2.2, 1.4, 3.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);
const grid = new THREE.GridHelper(4, 16, 0x8890a8, 0xb8bfcc);
grid.material.transparent = true; grid.material.opacity = 0.5;
scene.add(grid);

let model = null, mixer = null, helper = null, clips = [];
const clock = new THREE.Clock();

async function showModel(glb) {
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  if (model) scene.remove(model);
  if (helper) scene.remove(helper);
  if (!host.contains(renderer.domElement)) { host.querySelector('.empty')?.remove(); host.prepend(renderer.domElement); resize(); }
  model = gltf.scene;
  scene.add(model);
  helper = new THREE.SkeletonHelper(model);
  helper.visible = $('#bones').checked;
  scene.add(helper);
  applyWire();
  mixer = new THREE.AnimationMixer(model);
  clips = gltf.animations;
  const sel = $('#clip');
  sel.innerHTML = '<option value="">Bind pose</option>' + clips.map((c, i) => `<option value="${i}">${c.name}</option>`).join('');
  sel.disabled = !clips.length;
  const walk = clips.findIndex((c) => c.name === 'walk');
  sel.value = walk >= 0 ? String(walk) : '';
  playClip();
  const h = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y || 1.7;
  controls.target.set(0, h * 0.5, 0);
  camera.position.set(h * 1.2, h * 0.8, h * 2);
}

function playClip() {
  if (!mixer) return;
  mixer.stopAllAction();
  const i = $('#clip').value;
  if (i !== '' && !$('#compare').checked) mixer.clipAction(clips[Number(i)]).play();
}

// ---------- compare to photo: front camera + the source photo overlaid ----------
const overlay = $('#overlay');
const FIT = 1.15; // the model fills 1/FIT of the view height in compare mode
function setCompare(on) {
  overlay.hidden = !on;
  controls.enabled = !on;
  playClip();
  if (!on || !model || !lastFront) return;
  const h = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y || 1.7;
  const d = (h * FIT / 2) / Math.tan((camera.fov * Math.PI) / 360);
  controls.target.set(0, h / 2, 0);
  camera.position.set(0, h / 2, d);
  camera.lookAt(0, h / 2, 0);
  drawOverlay();
}
function drawOverlay() {
  if (overlay.hidden || !lastFront) return;
  const { clientWidth: W, clientHeight: H } = host;
  overlay.width = W; overlay.height = H;
  const S = lastFront, { x0, x1, y0, y1 } = S.bbox;
  // Head centre column = the body's vertical axis in the photo.
  const r = S.runNear(S.rowAt(0.04), (x0 + x1) / 2) || [x0, x1];
  const cx = (r[0] + r[1]) / 2;
  const k = (H / FIT) / (y1 - y0 + 1);
  const src = document.createElement('canvas');
  src.width = S.w; src.height = S.h;
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(S.img.data), S.w, S.h), 0, 0);
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(src, W / 2 - cx * k, (H - (y1 - y0 + 1) * k) / 2 - y0 * k, S.w * k, S.h * k);
}
$('#compare').addEventListener('change', () => setCompare($('#compare').checked));
function applyWire() {
  model?.traverse((o) => { if (o.isMesh) o.material.wireframe = $('#wire').checked; });
}
$('#clip').addEventListener('change', playClip);
$('#bones').addEventListener('change', () => { if (helper) helper.visible = $('#bones').checked; });
$('#wire').addEventListener('change', applyWire);

function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  drawOverlay();
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

renderer.setAnimationLoop(() => {
  mixer?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});

// Expose for automated tests.
window.__app = { images, setImage, get glb() { return lastGLB; } };
