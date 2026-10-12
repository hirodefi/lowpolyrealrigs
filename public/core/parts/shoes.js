// Shoe parts: a contrasting sole under each shoe.
import { add, mul } from '../mesh.js';
import { prism } from '../kit.js';

export const shoes = {
  soles: {
    about: 'A sole under each shoe (sneaker / boot look), slightly wider than the upper. With heels: under the forefoot only.',
    defaults: { thickness: 0.012, material: 'Trim', flare: 1.06 },
    cost: '~36 per foot',
    build(ctx, p) {
      const { mb, H, surf } = ctx;
      mb.mat = () => p.material;
      for (const side of ['Left', 'Right']) {
        const S = surf.foot[side];
        if (!S) continue;
        const n = S.rings.length;
        // Outline from every other ring (heel -> toe), widest x of each ring.
        const idx = [];
        for (let i = 0; i < n; i += 2) idx.push(i);
        if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
        const use = ctx.heels ? idx.filter((i) => i / (n - 1) >= 0.5) : idx;
        let yMin = Infinity;
        const rows = use.map((i) => {
          const r = S.rings[i], s = i / (n - 1);
          const left = S.point(s, 0), right = S.point(s, Math.PI), bottom = S.point(s, -Math.PI / 2);
          yMin = Math.min(yMin, bottom[1]);
          const cx = (left[0] + right[0]) / 2, hw = Math.abs(left[0] - right[0]) / 2 * p.flare;
          return { z: r.c[2], cx, hw, s };
        });
        // Polygon in (x, z): down one side, back up the other.
        const poly = [...rows.map((q) => [q.cx + q.hw, q.z]), ...rows.slice().reverse().map((q) => [q.cx - q.hw, q.z])];
        // Frame: x = world x, y = world z, so the extrusion axis is -Y; a negative depth grows the sole upwards.
        const F = { o: [0, yMin - 0.003 * H, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };
        const zs = rows.map((q) => q.z), z0 = Math.min(...zs), z1 = Math.max(...zs);
        const w = (pt) => S.weights(Math.min(1, Math.max(0, (use.length > 1 ? (pt[2] - z0) / (z1 - z0) : 0) * (rows[rows.length - 1].s - rows[0].s) + rows[0].s)), -Math.PI / 2);
        prism(mb, F, poly, -(p.thickness * H + 0.003 * H), w);
      }
    },
  },
};
