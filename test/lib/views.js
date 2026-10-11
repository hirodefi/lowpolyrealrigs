// Browser-side helpers shared by the fidelity check and the benchmark:
// orthographic front/side/back renders of a GLB, masks, and comparison metrics.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { analyzeImage } from '/core/silhouette.js';

/**
 * Render the bind pose of a GLB with orthographic cameras.
 * @param {Uint8Array} glb
 * @param {{width?:number, height?:number, frame?:number, bg?:number[]|null, flat?:boolean, sideFacesLeft?:boolean}} o
 *   frame = metres of world height in view (feet at the bottom margin); bg = RGB backdrop or null for transparent;
 *   flat = even ambient light (colours equal material albedo) instead of shaded studio light.
 * @returns {{front, side, back}} RGBA ImageData-like objects
 */
export async function renderViews(glb, o = {}) {
  const W = o.width ?? 512, H = o.height ?? 768, frame = o.frame ?? 1.9, margin = (o.margin ?? 0.04) * frame;
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  if (o.flat) {
    scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  } else {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1, 3, 4); scene.add(sun);
    const back = new THREE.DirectionalLight(0xffffff, 0.8); back.position.set(-1, 2, -4); scene.add(back);
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (o.bg) renderer.setClearColor(new THREE.Color(o.bg[0] / 255, o.bg[1] / 255, o.bg[2] / 255).convertSRGBToLinear(), 1);
  else renderer.setClearColor(0, 0);
  const hw = (frame * W) / H / 2;
  const cam = new THREE.OrthographicCamera(-hw, hw, frame - margin, -margin, 0.01, 20);
  const shot = (x, z) => {
    cam.position.set(x, 0, z); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); // frustum is relative to the camera: y = 0
    renderer.render(scene, cam);
    const gl = renderer.getContext(), px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    return { width: W, height: H, data };
  };
  const out = { front: shot(0, 5), back: shot(0, -5), side: o.sideFacesLeft === false ? shot(-5, 0) : shot(5, 0) };
  renderer.dispose();
  return out;
}

/** Binary mask from a render with transparent background (alpha) as a Silhouette. */
export const silhouetteOf = (img) => analyzeImage(img);

/** IoU of two silhouettes after aligning both on feet, height and head-centre column. */
export function alignedIoU(a, b) {
  const N = 400;
  const sample = (S, x, y) => { // x in [-0.5, 0.5] * height around centre, y in [0,1] top->bottom
    const cx = (S.bbox.x0 + S.bbox.x1) / 2;
    return S.on(cx + x * S.heightPx, S.bbox.y0 + y * (S.heightPx - 1));
  };
  let inter = 0, uni = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N / 2; i++) {
    const x = (i / (N / 2) - 0.5) * 0.7, y = j / (N - 1);
    const p = sample(a, x, y), q = sample(b, x, y);
    if (p && q) inter++;
    if (p || q) uni++;
  }
  return uni ? inter / uni : 0;
}

/** Total silhouette width per height step, as fractions of figure height. */
export function widthProfile(S, step = 0.02) {
  const out = [];
  for (let v = 0; v <= 1.0001; v += step) {
    const row = S.runs[S.rowAt(v)];
    out.push(row.reduce((a, r) => a + r[1] - r[0] + 1, 0) / S.heightPx);
  }
  return out;
}

export const meanAbsDiff = (a, b) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length;

/** Encode an ImageData-like object as PNG bytes. */
export async function toPNG(img) {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** Overlay of two silhouettes (a = red, b = cyan, both = white), aligned like alignedIoU. */
export function overlay(a, b, W = 260, H = 440) {
  const data = new Uint8ClampedArray(W * H * 4);
  const scaleA = (H - 20) / a.heightPx, scaleB = (H - 20) / b.heightPx;
  const ca = (a.bbox.x0 + a.bbox.x1) / 2, cb = (b.bbox.x0 + b.bbox.x1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const p = a.on(ca + (x - W / 2) / scaleA, a.bbox.y0 + (y - 10) / scaleA);
    const q = b.on(cb + (x - W / 2) / scaleB, b.bbox.y0 + (y - 10) / scaleB);
    data[o] = p ? 255 : 0; data[o + 1] = q ? 255 : 0; data[o + 2] = q ? 255 : 0; data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}
