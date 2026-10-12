// Hair parts: locks that fall over the front of the shoulders, and fringe locks
// sweeping across the forehead. Both sit outside the hair shell.
import { add, sub, mul, norm, lerp, clamp } from '../mesh.js';
import { tube } from '../kit.js';

const FRONT = Math.PI / 2;

/** Head -> Chest weights by height (a lock follows the head above the neck). */
const headToChest = (ctx) => (q) => {
  const y = q[1], n = ctx.land.neck, b = 0.03 * ctx.H;
  const k = clamp((y - (n - b)) / (2 * b), 0, 1);
  return k >= 1 ? { Head: 1 } : k <= 0 ? { Chest: 1 } : { Head: k, Chest: 1 - k };
};

export const hair = {
  hairLocks: {
    about: 'Locks of long hair falling from behind the ears over the front of the shoulders onto the chest (like hair pulled forward).',
    defaults: { perSide: 1, length: 0.16, width: 0.012, material: 'Hair', spread: 0 }, // width = half-width
    cost: '~40 per lock',
    build(ctx, p) {
      const { mb, H, surf, land } = ctx;
      const Hd = surf.head, T = surf.torso;
      mb.mat = () => p.material;
      for (const sx of [1, -1]) for (let j = 0; j < p.perSide; j++) {
        const off = p.perSide === 1 ? 0 : (j / (p.perSide - 1) - 0.5) * 0.35; // spread of several locks
        const tH = FRONT - sx * (1.78 + off + p.spread);             // from behind the ear (the face stays clear)
        const sTop = Hd.sAtY(land.eye), cH = Hd.centre(sTop);
        const start = add(cH, mul(sub(Hd.point(sTop, tH), cH), 1.08));
        // Straight down beside the jaw, then onto the front of the chest at about
        // the head's half-width, then down the chest: hair falls, it doesn't wrap.
        const sJaw = Hd.sAtY(land.neck + 0.02 * H), cJ = Hd.centre(sJaw);
        const jaw = add(cJ, mul(sub(Hd.point(sJaw, FRONT - sx * 1.68), cJ), 1.12)); // just behind the jaw, never over the cheek
        const xLock = Math.abs(start[0]) * 1.22 * (1.0 + off * 0.5) * (1 + p.spread); // just outside the face and the straps
        const onChest = (y) => {
          const s = T.sAtY(y);
          let best = FRONT, d = Infinity;
          for (let t = FRONT; Math.abs(t - FRONT) < Math.PI / 2; t -= sx * 0.02) { const q = T.point(s, t); const e = Math.abs(Math.abs(q[0]) - xLock); if (e < d) { d = e; best = t; } }
          return add(T.point(s, best), mul(T.normal(s, best), p.width * H * 0.25 + 0.004 * H));
        };
        const yEnd = land.neck - p.length * H;
        const path = [start, jaw, onChest(land.neck - 0.035 * H), onChest(lerp(land.neck, yEnd, 0.6)), onChest(yEnd)];
        const r = p.width * H;
        tube(mb, path, [[r * 0.8, r * 0.35], [r, r * 0.35], [r, r * 0.3], [r * 0.75, r * 0.25], [r * 0.3, r * 0.15]], 4, headToChest(ctx), { up: [0, 0, 1] });
      }
    },
  },

  fringe: {
    about: 'Locks sweeping from the parting across the forehead to the temples (side-swept fringe). side: 1 = towards the character\'s left, -1 right.',
    defaults: { count: 2, side: 1, width: 0.015, material: 'Hair' },
    cost: '~32 per lock',
    build(ctx, p) {
      const { mb, H, surf, land } = ctx;
      const Hd = surf.head;
      mb.mat = () => p.material;
      const shell = (y, t, k) => { const s = Hd.sAtY(y), c = Hd.centre(s); return add(c, mul(sub(Hd.point(s, t), c), k)); };
      for (let i = 0; i < p.count; i++) {
        const f = p.count === 1 ? 0.5 : i / (p.count - 1);
        const yTop = land.top - 0.03 * H - f * 0.012 * H;
        const t0 = FRONT - p.side * 0.15, t1 = FRONT - p.side * (0.75 + 0.35 * f);
        const yEnd = land.eye + 0.03 * H + f * 0.012 * H;
        // The tip tucks back into the hair shell at the temple.
        const path = [0, 0.33, 0.66, 1].map((k) => shell(lerp(yTop, yEnd, k), lerp(t0, t1, k), lerp(1.13, 1.06, k * k) + 0.015 * Math.sin(k * Math.PI)));
        const r = p.width * H;
        tube(mb, path, [[r * 0.6, r * 0.25], [r, r * 0.3], [r * 0.85, r * 0.28], [r * 0.3, r * 0.15]], 4, { Head: 1 }, { up: norm(sub(path[1], Hd.centre(Hd.sAtY(path[1][1])))) });
      }
    },
  },
};
