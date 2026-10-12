// Clothing parts on the torso: belt with buckle, shirt collar points, buttons.
import { add, mul, sub, norm, cross } from '../mesh.js';
import { frame, at, box, prism, lathe, tube } from '../kit.js';

const FRONT = Math.PI / 2;

/** Height in metres from a landmark name, a fraction of H, or metres-from-landmark {at, dy}. */
export function heightOf(ctx, y, fallback) {
  if (y == null) return ctx.land[fallback];
  if (typeof y === 'number') return y * ctx.H;
  if (typeof y === 'string') { if (ctx.land[y] == null) throw new Error(`Unknown landmark "${y}" (use ${Object.keys(ctx.land).join(', ')})`); return ctx.land[y]; }
  return heightOf(ctx, y.at) + (y.dy ?? 0) * ctx.H;
}

export const clothes = {
  belt: {
    about: 'Band around the waist with an optional buckle. y: landmark (default just under the top\'s hem).',
    defaults: { y: 'hem', width: 0.022, material: 'Accent', buckle: true, buckleMaterial: 'Trim' },
    cost: '~72 (+12 buckle)',
    build(ctx, p) {
      const { mb, H, surf } = ctx;
      const T = surf.torso;
      const yc = (p.y === 'hem' ? ctx.land.hem - p.width * H * 0.55 : heightOf(ctx, p.y)) ;
      const y0 = yc - p.width * H / 2, y1 = yc + p.width * H / 2;
      const ringAt = (y, k) => { const r = T.ring(T.sAtY(y)); return { ...r, c: [r.c[0], y, r.c[2]], rx: r.rx * k, ry: r.ry * k }; };
      mb.mat = () => p.material;
      mb.tube([ringAt(y0, 1.0), ringAt(y0 + 0.002 * H, 1.06), ringAt(y1, 1.06), ringAt(y1 + 0.002 * H, 1.0)], ctx.D.torso, null, null);
      if (p.buckle) {
        const s = T.sAtY(yc), r = ringAt(yc, 1.06);
        const pt = add(r.c, mul(r.v, r.ry * r.f(FRONT)));
        const F = frame(add(pt, [0, 0, 0.002 * H]), [0, 0, 1]);
        mb.mat = () => p.buckleMaterial;
        box(mb, F, [0.014 * H, p.width * H * 0.62, 0.002 * H], T.weights(s, FRONT));
      }
    },
  },

  collar: {
    about: 'Shirt collar points lying on the upper chest either side of the neck (pairs with the collar band of a T-shirt/shirt top).',
    defaults: { material: 'Top', spread: 1, length: 0.038 },
    cost: '~24',
    build(ctx, p) {
      const { mb, H, surf, land } = ctx;
      const T = surf.torso;
      mb.mat = () => p.material;
      for (const sx of [1, -1]) {
        // Anchor on the chest just below the neck, a little to the side.
        const yA = land.neck - 0.006 * H;
        const s = T.sAtY(yA - p.length * H * 0.45), t = FRONT - sx * 0.42 * p.spread;
        const base = T.point(s, t), n = T.normal(s, t);
        const F = frame(add(base, mul(n, 0.007 * H)), n, [sx, 0, 0]);
        // Collar point in the tangent plane: top edge along the neckline, tip pointing down and in.
        const L = p.length * H;
        const poly = [[-0.4 * L * sx, 0.45 * L], [0.55 * L * sx, 0.5 * L], [0.3 * L * sx, -0.1 * L], [-0.15 * L * sx, -0.55 * L]];
        const w = T.weights(s, t);
        prism(mb, F, poly, 0.004 * H, w, { taper: 0.9 });
      }
    },
  },

  buttons: {
    about: 'Buttons down the centre front, optionally on a placket strip. from/to: landmarks or fractions of H.',
    defaults: { count: 4, from: { at: 'neck', dy: -0.035 }, to: { at: 'hem', dy: 0.03 }, size: 0.0045, material: 'Trim', placket: false, placketMaterial: 'Top' },
    cost: '~20 per button (+~24 placket)',
    build(ctx, p) {
      const { mb, H, surf } = ctx;
      const T = surf.torso;
      const ya = heightOf(ctx, p.from), yb = heightOf(ctx, p.to);
      const pts = [];
      for (let i = 0; i < p.count; i++) {
        const y = p.count === 1 ? ya : ya + (yb - ya) * (i / (p.count - 1));
        const s = T.sAtY(y);
        pts.push({ s, p: T.point(s, FRONT), n: T.normal(s, FRONT) });
      }
      if (p.placket) {
        const path = [], N = 5;
        for (let i = 0; i <= N; i++) { const y = ya + 0.02 * H + (yb - ya - 0.02 * H) * (i / N), s = T.sAtY(y); path.push(add(T.point(s, FRONT), mul(T.normal(s, FRONT), 0.002 * H))); }
        mb.mat = () => p.placketMaterial;
        tube(mb, path, path.map(() => [0.011 * H, 0.0015 * H]), 4, (q) => T.weights(T.sAtY(q[1]), FRONT), { up: [0, 0, 1] });
      }
      mb.mat = () => p.material;
      const r = p.size * H;
      for (const b of pts) {
        const F = frame(add(b.p, mul(b.n, p.placket ? 0.003 * H : 0.001 * H)), b.n);
        lathe(mb, F, [[0, r], [0.0025 * H, r * 0.85]], 5, T.weights(b.s, FRONT));
      }
    },
  },
};
