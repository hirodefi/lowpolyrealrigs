// Regenerates the example GLBs in examples/ from the built-in demo drawing.
//
//   node tools/make-examples.mjs
//
// The woman built from the photo-style reference views (test/fixtures/woman) needs
// image decoding, so it comes from the benchmark instead: `npm run bench` writes
// out/benchmark/X0-woman-clean-views/model.glb; copy it to
// examples/woman_reference_tank_shorts.glb.
import { writeFileSync, mkdirSync } from 'node:fs';
import { sampleImages } from '../public/core/samples.js';
import { generateCharacter } from '../public/core/pipeline.js';

const EXAMPLES = {
  man_short_hair: { body: 'male', hair: 'short', bottom: 'trousers', top: 'tshirt' },
  man_shirt_tie: { body: 'male', hair: 'short', bottom: 'trousers', top: 'tshirt', tie: true, colors: { top: [236, 238, 242], bottom: [40, 44, 56] } },
  woman_bob_skirt: { body: 'female', hair: 'bob', bottom: 'skirt' },
  woman_long_hair_skirt: { body: 'female', hair: 'long', bottom: 'skirt' },
  woman_tank_pencil_heels: { body: 'female', hair: 'long', top: 'tank', bottom: 'pencil', shoes: 'heels', colors: { top: [236, 236, 232], bottom: [36, 36, 42], shoes: [30, 30, 34] } },
  woman_ponytail_trousers: { body: 'female', hair: 'ponytail', bottom: 'trousers' },
  child: { body: 'child', hair: 'short', bottom: 'trousers' },
};

const dir = new URL('../examples/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [name, opts] of Object.entries(EXAMPLES)) {
  const { glb, stats } = generateCharacter(sampleImages(), { height: 1.7, name, ...opts });
  writeFileSync(new URL(`${name}.glb`, dir), glb);
  console.log(`${name}.glb  ${stats.body}/${stats.hair}/${stats.top}/${stats.bottom}${stats.heels ? '/heels' : ''}  ${stats.triangles} tris  ${stats.materials.join(',')}`);
}
