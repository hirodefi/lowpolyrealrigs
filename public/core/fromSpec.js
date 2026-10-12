// Character spec -> rigged, animated GLB.
//
// A spec describes one character: body type and build, base clothing styles,
// colours per material and a list of parts from the catalog (parts/). It is
// written by hand or by Claude (the character skill) from an image or a
// description. With reference images, the measured photo proportions shape the
// body; without, realistic template proportions are used.
import { generateCharacter } from './pipeline.js';
import { sampleImages } from './samples.js';
import { CATALOG } from './parts/index.js';

const KEYS = {
  name: 'string', body: ['male', 'female', 'child'], height: 'number', build: ['measured', 'slim', 'average', 'broad'],
  detail: ['low', 'medium', 'high'], hair: ['short', 'bob', 'long', 'ponytail', 'bald', 'auto'],
  top: ['tshirt', 'tank', 'auto'], neckline: ['crew', 'scoop', 'v', 'auto'], bottom: ['trousers', 'shorts', 'skirt', 'pencil', 'auto'], shoes: ['flat', 'heels', 'auto'],
  shortsLength: ['short', 'mid', 'long'], tie: 'boolean', colors: 'object', parts: 'array', budget: 'number', notes: 'string', animations: 'boolean',
};
const COLOR_KEYS = ['Skin', 'Hair', 'Top', 'Bottom', 'Shoes', 'Accent', 'Trim', 'Eyes'];

/** Problems with a spec as a list of strings (empty = valid). */
export function checkSpec(spec) {
  const errs = [];
  for (const [k, v] of Object.entries(spec)) {
    const t = KEYS[k];
    if (!t) { errs.push(`unknown key "${k}" (allowed: ${Object.keys(KEYS).join(', ')})`); continue; }
    if (Array.isArray(t) ? !t.includes(v) : t === 'array' ? !Array.isArray(v) : typeof v !== t) errs.push(`"${k}" must be ${Array.isArray(t) ? t.join(' | ') : t} (got ${JSON.stringify(v)})`);
  }
  for (const [k, c] of Object.entries(spec.colors || {})) {
    if (!COLOR_KEYS.includes(k)) errs.push(`unknown colour "${k}" (use ${COLOR_KEYS.join(', ')})`);
    else if (!Array.isArray(c) || c.length !== 3 || c.some((x) => !(x >= 0 && x <= 255))) errs.push(`colour "${k}" must be [r, g, b] in 0..255`);
  }
  for (const [i, p] of (spec.parts || []).entries()) if (!p || !CATALOG[p.part]) errs.push(`parts[${i}]: unknown part "${p?.part}" (catalog: ${Object.keys(CATALOG).join(', ')})`);
  return errs;
}

/**
 * Build a character from a spec. images: optional {front, side?, back?} decoded
 * ImageData-like views (the browser/skill passes these); without them the body
 * uses template proportions.
 * Returns { glb, stats, character, budget: { limit, total, base, parts: [{part, triangles}] , ok } }.
 */
export function buildFromSpec(spec, images = null) {
  const errs = checkSpec(spec);
  if (errs.length) throw new Error('Invalid character spec:\n  - ' + errs.join('\n  - '));
  const C = spec.colors || {};
  const colors = Object.fromEntries(['Skin', 'Hair', 'Top', 'Bottom', 'Shoes'].filter((k) => C[k]).map((k) => [k.toLowerCase(), C[k]]));
  const palette = Object.fromEntries(['Accent', 'Trim', 'Eyes'].filter((k) => C[k]).map((k) => [k, C[k]]));
  const res = generateCharacter(images || sampleImages(), {
    name: spec.name, height: spec.height ?? 1.7, body: spec.body, preset: spec.build ?? 'measured', detail: spec.detail ?? 'medium',
    hair: spec.hair, top: spec.top, neckline: spec.neckline ?? (images ? 'auto' : spec.top === 'tank' ? 'scoop' : 'crew'), bottom: spec.bottom, shoes: spec.shoes, tie: spec.tie, shortsLength: { short: 0.08, mid: 0.2, long: 0.34 }[spec.shortsLength], animations: spec.animations,
    colors, palette, parts: spec.parts || [], proportions: images ? undefined : 'template',
  });
  const parts = res.stats.parts || [];
  const total = res.stats.triangles, partTris = parts.reduce((s, p) => s + p.triangles, 0);
  const limit = spec.budget ?? 2700;
  return { ...res, budget: { limit, total, base: total - partTris, parts, ok: total <= limit } };
}

/** Human-readable budget table. */
export function budgetTable(b) {
  const rows = [['body (base)', b.base], ...b.parts.map((p) => [p.part, p.triangles])];
  return rows.map(([n, t]) => `${n.padEnd(16)} ${String(t).padStart(5)}`).join('\n') + `\n${'total'.padEnd(16)} ${String(b.total).padStart(5)} / ${b.limit}${b.ok ? '' : '  OVER BUDGET'}`;
}
