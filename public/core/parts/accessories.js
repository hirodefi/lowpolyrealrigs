// Accessories: glasses and a wrist watch.
import { add, sub, mul, norm, lerp } from '../mesh.js';
import { frame, loop, tube, box } from '../kit.js';

const FRONT = Math.PI / 2;

export const accessories = {
  glasses: {
    about: 'Glasses: two rims round the eyes, a bridge and temple arms back to the ears. style: round | square.',
    defaults: { style: 'round', material: 'Trim', size: 1 },
    cost: '~144',
    build(ctx, p) {
      const { mb, H, surf, land } = ctx;
      const Hd = surf.head, s = Hd.sAtY(land.eye), c = Hd.centre(s);
      // Front surface point of the head at |x| = eyeX.
      const frontAt = (x) => { let best = FRONT, d = Infinity; for (let t = 0; t <= Math.PI; t += 0.01) { const q = Hd.point(s, t); const e = Math.abs(q[0] - x); if (q[2] > c[2] && e < d) { d = e; best = t; } } return Hd.point(s, best); };
      const W = { Head: 1 }, r = 0.0016 * H;
      const rx = 0.015 * H * p.size, ry = (p.style === 'round' ? 0.013 : 0.011) * H * p.size;
      mb.mat = () => p.material;
      const rims = [];
      for (const sx of [1, -1]) {
        const eye = frontAt(sx * ctx.eyeX);
        const o = add(eye, [0, -0.002 * H, 0.009 * H]);
        // Round: an 8-gon; square: a rectangle with cut corners.
        const pts = p.style === 'round'
          ? Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2; return add(o, [Math.cos(a) * rx, Math.sin(a) * ry, 0]); })
          : [[1, 0.7], [0.75, 1], [-0.75, 1], [-1, 0.7], [-1, -0.7], [-0.75, -1], [0.75, -1], [1, -0.7]].map(([a, b]) => add(o, [a * rx, b * ry, 0]));
        loop(mb, pts, r, 3, W);
        rims.push({ o, sx });
      }
      // Bridge between the inner edges, temples from the outer edges back to the ears.
      const [L, R] = rims;
      const mid = add(mul(add(L.o, R.o), 0.5), [0, 0.006 * H, 0.002 * H]);
      tube(mb, [add(L.o, [-rx, 0.004 * H, 0]), mid, add(R.o, [rx, 0.004 * H, 0])], [r, r, r], 3, W, { caps: false });
      for (const { o, sx } of rims) {
        const side = Hd.point(s, sx > 0 ? 0 : Math.PI), out = norm(sub(side, c));
        const ear = add(add(side, mul(out, 0.012 * H)), [0, 0.002 * H, -0.01 * H]);
        const hinge = add(o, [sx * rx * 1.05, 0.002 * H, -0.003 * H]);
        tube(mb, [hinge, add(lerp3(hinge, ear, 0.5), mul(out, 0.006 * H)), ear], [r, r, r * 0.8], 3, W);
      }
    },
  },

  watch: {
    about: 'Wrist watch: a band round the left wrist and a small face.',
    defaults: { side: 'Left', material: 'Trim', faceMaterial: 'Accent' },
    cost: '~48',
    build(ctx, p) {
      const { mb, H, surf, pos } = ctx;
      const A = surf.arm[p.side];
      if (!A) return;
      // Wrist: the arm surface at the hand joint.
      const wrist = pos[p.side + 'Hand'];
      let best = 0, d = Infinity;
      for (let s = 0; s <= 1; s += 0.01) { const e = Math.hypot(...sub(A.centre(s), wrist)); if (e < d) { d = e; best = s; } }
      const s = Math.max(0, best - 0.03);
      const ring = A.ring(s), W = { [p.side + 'LowerArm']: 0.3, [p.side + 'Hand']: 0.7 };
      const band = (k, dy) => ({ ...ring, c: add(ring.c, mul(norm(sub(A.centre(Math.min(1, s + 0.02)), A.centre(s))), dy)), rx: ring.rx * k, ry: ring.ry * k, w: W, wf: undefined });
      mb.mat = () => p.material;
      mb.tube([band(1.0, -0.006 * H), band(1.12, -0.005 * H), band(1.12, 0.005 * H), band(1.0, 0.006 * H)], 6, null, null);
      // Face on the back of the wrist (the arm ring's +u side is the outside of a hanging arm).
      const top = add(ring.c, mul(ring.u, ring.rx * 1.12));
      mb.mat = () => p.faceMaterial;
      box(mb, frame(add(top, mul(ring.u, 0.002 * H)), ring.u, ring.v), [0.008 * H, 0.008 * H, 0.002 * H], W);
    },
  },
};

const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
