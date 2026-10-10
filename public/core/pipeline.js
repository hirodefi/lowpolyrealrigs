// One-call pipeline: images -> silhouettes -> body spec -> rigged mesh -> animations -> GLB.
import { analyzeImage } from './silhouette.js';
import { measureBody } from './measure.js';
import { buildCharacter } from './builder.js';
import { makeAnimations } from './animation.js';
import { exportGLB } from './glb.js';

/**
 * @param {{front:ImageLike, side?:ImageLike|null, back?:ImageLike|null}} images RGBA {width,height,data}
 * @param {{height?:number, detail?:'low'|'medium'|'high', colors?:number, animations?:boolean, name?:string}} opts
 */
export function generateCharacter(images, opts = {}) {
  const t0 = now();
  if (!images.front) throw new Error('A front view is required.');
  const sil = {
    front: analyzeImage(images.front),
    side: images.side ? analyzeImage(images.side) : null,
    back: images.back ? analyzeImage(images.back) : null,
  };
  const spec = measureBody(sil.front, sil.side, sil.back, { height: opts.height ?? 1.8 });
  const character = buildCharacter(spec, { detail: opts.detail, colors: opts.colors });
  const animations = opts.animations === false ? [] : makeAnimations(character.bones, spec);
  const glb = exportGLB(character, animations, { name: opts.name });
  return {
    glb,
    character,
    animations,
    silhouettes: sil,
    stats: {
      triangles: character.mesh.triangles,
      bones: character.bones.length,
      colors: character.texture.palette.length,
      clips: animations.map((a) => a.name),
      bytes: glb.byteLength,
      ms: Math.round(now() - t0),
      notes: spec.notes,
    },
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
