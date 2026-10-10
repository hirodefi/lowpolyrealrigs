// Built-in demo character drawn with a tiny rasterizer (front / side / back),
// so the app and the tests work without any user images. Works in browser and Node.

const W = 400, H = 520;
const BG = [228, 233, 240];
const C = {
  skin: [241, 194, 145], hair: [92, 58, 33], shirt: [214, 72, 66], stripe: [245, 245, 245],
  pants: [52, 84, 150], shoe: [45, 45, 52], eye: [30, 30, 40],
};

function canvas() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...BG, 255], i * 4);
  return { width: W, height: H, data };
}

function fill(img, [x0, y0, x1, y1], inside, color) {
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
      if (inside(x + 0.5, y + 0.5)) img.data.set([...color, 255], (y * W + x) * 4);
    }
  }
}
const ellipse = (img, cx, cy, rx, ry, col) =>
  fill(img, [cx - rx, cy - ry, cx + rx, cy + ry], (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, col);
const capsule = (img, ax, ay, bx, by, r, col) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  fill(img, [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r], (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r;
  }, col);
};
const polygon = (img, pts, col) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  fill(img, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }, col);
};

function frontOrBack(isBack) {
  const img = canvas();
  const cx = 200;
  // Arms (A-pose, ~50 deg below horizontal)
  for (const s of [-1, 1]) {
    const sx = cx + s * 46, sy = 140, a = 50 * Math.PI / 180, L = 200;
    const ex = sx + s * Math.cos(a) * L * 0.44, ey = sy + Math.sin(a) * L * 0.44;
    const wx = sx + s * Math.cos(a) * L * 0.8, wy = sy + Math.sin(a) * L * 0.8;
    capsule(img, ex, ey, wx, wy, 10, C.skin);
    capsule(img, sx, sy, ex, ey, 14, C.shirt);
    ellipse(img, sx + s * Math.cos(a) * L * 0.9, sy + Math.sin(a) * L * 0.9, 13, 13, C.skin);
  }
  // Legs, shoes
  for (const s of [-1, 1]) {
    capsule(img, cx + s * 23, 275, cx + s * 22, 468, 18, C.pants);
    ellipse(img, cx + s * 23, 486, 20, 13, C.shoe);
  }
  polygon(img, [[cx - 44, 248], [cx + 44, 248], [cx + 42, 290], [cx - 42, 290]], C.pants);
  // Torso + shoulders
  polygon(img, [[cx - 52, 130], [cx + 52, 130], [cx + 40, 252], [cx - 40, 252]], C.shirt);
  capsule(img, cx - 45, 138, cx + 45, 138, 12, C.shirt);
  if (isBack) polygon(img, [[cx - 8, 140], [cx + 8, 140], [cx + 8, 245], [cx - 8, 245]], C.stripe);
  // Neck, head, hair
  capsule(img, cx, 108, cx, 128, 11, C.skin);
  ellipse(img, cx, 72, 34, 42, isBack ? C.hair : C.skin);
  ellipse(img, cx, 48, 36, 22, C.hair);
  if (!isBack) {
    ellipse(img, cx - 12, 74, 4, 5, C.eye);
    ellipse(img, cx + 12, 74, 4, 5, C.eye);
    ellipse(img, cx, 96, 8, 3, [180, 90, 80]);
  }
  return img;
}

function side() {
  const img = canvas();
  const cz = 200; // facing right (+x = forward)
  capsule(img, cz - 1, 275, cz + 1, 468, 21, C.pants);
  ellipse(img, cz + 16, 486, 32, 13, C.shoe);
  polygon(img, [[cz - 30, 248], [cz + 28, 248], [cz + 25, 290], [cz - 26, 290]], C.pants);
  polygon(img, [[cz - 26, 130], [cz + 28, 130], [cz + 33, 185], [cz + 26, 252], [cz - 30, 252], [cz - 30, 185]], C.shirt);
  capsule(img, cz + 2, 108, cz + 2, 130, 11, C.skin);
  ellipse(img, cz + 4, 72, 38, 42, C.skin);
  ellipse(img, cz - 6, 58, 38, 34, C.hair);
  ellipse(img, cz + 40, 78, 5, 5, C.skin);
  // Near arm seen from the side
  capsule(img, cz, 140, cz + 3, 225, 13, C.shirt);
  capsule(img, cz + 3, 225, cz + 6, 300, 10, C.skin);
  ellipse(img, cz + 7, 318, 11, 13, C.skin);
  return img;
}

export function sampleImages() {
  return { front: frontOrBack(false), side: side(), back: frontOrBack(true) };
}
