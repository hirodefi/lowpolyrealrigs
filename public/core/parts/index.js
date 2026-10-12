// Parts catalog: named, parameterised character parts built with the kit.
// A character spec lists parts as { part: 'belt', ...params }; each part sits on
// the body surface the builder registered (ctx.surf) and reports its triangles.
import { clothes } from './clothes.js';
import { hair } from './hair.js';
import { accessories } from './accessories.js';
import { shoes } from './shoes.js';

export const CATALOG = { ...clothes, ...hair, ...accessories, ...shoes };

// Materials a part may use (the bake contract: per-person colours + fixed colours).
export const PART_MATERIALS = ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes', 'Accent', 'Trim', 'Eyes'];

/** Build one part; returns its triangle count. Throws on an unknown part or material. */
export function buildPart(ctx, p) {
  const def = CATALOG[p.part];
  if (!def) throw new Error(`Unknown part "${p.part}". Available: ${Object.keys(CATALOG).join(', ')}`);
  const params = { ...def.defaults, ...p };
  for (const k of Object.keys(params)) if (/material$/i.test(k) && !PART_MATERIALS.includes(params[k])) throw new Error(`Part "${p.part}": unknown material "${params[k]}" (use ${PART_MATERIALS.join(', ')})`);
  const n0 = ctx.mb.tris.length;
  def.build(ctx, params);
  return ctx.mb.tris.length - n0;
}

/** Catalog listing for docs and the skill: name, description, defaults, typical cost. */
export const describeCatalog = () => Object.entries(CATALOG).map(([name, d]) => ({ name, about: d.about, defaults: d.defaults, cost: d.cost }));
