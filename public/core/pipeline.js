// One-call pipeline: images -> silhouettes -> body spec -> rigged mesh -> animations -> GLB.
import { analyzeImage } from './silhouette.js';
import { measureBody } from './measure.js';
import { buildCharacter } from './builder.js';
import { makeAnimations } from './animation.js';
import { exportGLB } from './glb.js';

/**
 * @param {{front:ImageLike, side?:ImageLike|null, back?:ImageLike|null}} images RGBA {width,height,data}
 * @param {{height?:number, body?:'auto'|'male'|'female'|'child', preset?:string, detail?:'low'|'medium'|'high', animations?:boolean, name?:string}} opts
 */
export function generateCharacter(images, opts = {}) {
  const t0 = now();
  if (!images.front) throw new Error('A front view is required.');
  const sil = {
    front: analyzeImage(images.front),
    side: images.side ? analyzeImage(images.side) : null,
    back: images.back ? analyzeImage(images.back) : null,
  };
  const spec = measureBody(sil.front, sil.side, sil.back, { height: opts.height ?? 1.7 });
  const character = buildCharacter(spec, { detail: opts.detail, body: opts.body, preset: opts.preset, hair: opts.hair, bottom: opts.bottom });
  const animations = opts.animations === false ? [] : makeAnimations(character);
  const glb = exportGLB(character, animations, { name: opts.name });
  return {
    glb,
    character,
    animations,
    silhouettes: sil,
    stats: {
      triangles: character.mesh.triangles,
      bones: character.bones.length,
      body: character.bodyType,
      hair: character.hairStyle,
      bottom: character.bottomStyle,
      materials: character.mesh.groups.map((g) => g.material),
      clips: animations.map((a) => a.name),
      bytes: glb.byteLength,
      ms: Math.round(now() - t0),
      notes: spec.notes,
    },
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
