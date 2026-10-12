// One-call pipeline: images -> silhouettes -> body spec -> rigged mesh -> animations -> GLB.
import { analyzeImage } from './silhouette.js';
import { measureBody } from './measure.js';
import { buildCharacter } from './builder.js';
import { makeAnimations } from './animation.js';
import { exportGLB } from './glb.js';
import { validateInputs, summarizeValidation } from './validate.js';

/**
 * @param {{front:ImageLike, side?:ImageLike|null, back?:ImageLike|null}} images RGBA {width,height,data}
 * @param {{height?:number, body?:'auto'|'male'|'female'|'child', preset?:string, hair?:string, bottom?:'auto'|'trousers'|'shorts'|'skirt'|'pencil', top?:'auto'|'tshirt'|'tank', shoes?:'auto'|'flat'|'heels', tie?:boolean, colors?:object, strict?:boolean, detail?:'low'|'medium'|'high', animations?:boolean, name?:string}} opts
 */
export function generateCharacter(images, opts = {}) {
  const t0 = now();
  if (!images.front) throw new Error('A front view is required.');
  const masks = images.masks || {};
  const sil = {
    front: analyzeImage(images.front, { maskImage: masks.front }),
    side: images.side ? analyzeImage(images.side, { maskImage: masks.side }) : null,
    back: images.back ? analyzeImage(images.back, { maskImage: masks.back }) : null,
  };
  const spec = measureBody(sil.front, sil.side, sil.back, { height: opts.height ?? 1.7 });
  // Optional colour overrides per material ({ top: [r,g,b], ... }), e.g. to re-dress a character.
  for (const [k, c] of Object.entries(opts.colors || {})) spec.look[k] = c;
  const validation = validateInputs(images, sil, spec);
  // strict: refuse to build from inputs that fail the contract (the app uses this).
  if (opts.strict && validation.some((c) => c.level === 'fail')) {
    const err = new Error('The reference images need fixing before a character can be built.');
    err.validation = validation;
    throw err;
  }
  return finish(spec, opts, t0, { silhouettes: sil, validation });
}

/** Build from a body spec that did not come from images (manual measurements, manual.js). */
export function generateFromBody(spec, opts = {}) {
  return finish(spec, opts, now(), { silhouettes: null, validation: [] });
}

function finish(spec, opts, t0, { silhouettes, validation }) {
  for (const [k, c] of Object.entries(opts.colors || {})) spec.look[k] = c;
  const character = buildCharacter(spec, { detail: opts.detail, body: opts.body, preset: opts.preset, hair: opts.hair, bottom: opts.bottom, top: opts.top, shoes: opts.shoes, tie: opts.tie, accentColor: opts.accentColor, proportions: opts.proportions, parts: opts.parts, palette: opts.palette, neckline: opts.neckline, shortsLength: opts.shortsLength });
  const animations = opts.animations === false ? [] : makeAnimations(character);
  const glb = exportGLB(character, animations, { name: opts.name });
  return {
    glb,
    character,
    animations,
    silhouettes,
    validation,
    stats: {
      triangles: character.mesh.triangles,
      bones: character.bones.length,
      body: character.bodyType,
      hair: character.hairStyle,
      bottom: character.bottomStyle,
      top: character.topStyle,
      heels: character.heels,
      materials: character.mesh.groups.map((g) => g.material),
      parts: character.parts,
      clips: animations.map((a) => a.name),
      bytes: glb.byteLength,
      ms: Math.round(now() - t0),
      notes: spec.notes,
      validation: summarizeValidation(validation),
    },
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
