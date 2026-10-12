# Parts catalog

`node .claude/skills/character/scripts/character.mjs catalog` prints the live list (it is generated from
`public/core/parts/`). This page adds when to use each part. Costs are triangles on the default settings.

| Part | Cost | Default material | Use it for | Parameters |
|---|---|---|---|---|
| `belt` | ~72 (+12 buckle) | Accent (buckle Trim) | Trousers, jeans, shorts and skirts where the waistband shows below the top. Reads well as a dark band between a light top and trousers. | `y` (landmark, default just under the top's hem), `width` (0.022 H), `buckle`, `material`, `buckleMaterial` |
| `soles` | ~72 (both feet) | Trim | Sneakers (white or gum soles), boots, trainers. Skip for dress shoes in one colour. With heels, only the forefoot gets a sole. | `thickness` (0.012 H), `flare`, `material` |
| `collar` | ~24 | Top | Shirts and polos: two collar points on the chest at the neck. Pairs with a `tshirt` top (which has a collar band). Use `Accent` for a contrasting collar. | `length` (0.038 H), `spread`, `material` |
| `buttons` | ~20 each (+~24 placket) | Trim | Shirts, cardigans, coats down the front. 3-5 buttons. `placket: true` adds the front strip. | `count`, `from`, `to`, `size`, `placket`, `material`, `placketMaterial` |
| `hairLocks` | ~40 per lock | Hair | Long hair worn forward over the front of the shoulders (very common in references; it changes the front silhouette). Use with `hair: long`. | `perSide` (1), `length` (0.16 H), `width` (0.02 H), `spread` |
| `fringe` | ~32 per lock | Hair | Side-swept fringe / bangs over the forehead; breaks the helmet look of a hair shell. | `count` (2), `side` (1 = towards the character's left, -1 right), `width` |
| `glasses` | ~144 | Trim | Glasses (round or square frames). Expensive: use when they are part of the identity. | `style` (`round`, `square`), `size`, `material` |
| `watch` | ~48 | Trim (face Accent) | Office / business characters, close-up shots. Small at crowd distance. | `side` (`Left`, `Right`), `material`, `faceMaterial` |

Body features that are options, not parts: `hair` styles (short, bob, long, ponytail, bald), `top` (tshirt, tank),
`neckline`, `bottom` (trousers, shorts, A-line skirt, straight knee skirt), `shoes` (flat, heels), `tie`.

## Materials parts may use

`Skin`, `Hair`, `Top`, `Bottom`, `Shoes` (recoloured per person by the crowd) and `Accent`, `Trim`, `Eyes` (fixed).
A part in a per-person material changes colour with that person (a collar in `Top` follows the shirt); a part in
`Accent` or `Trim` keeps its colour.

## Adding a part

Write it in `public/core/parts/` with `about`, `defaults`, `cost` and `build(ctx, params)`. Build from the kit
(`public/core/kit.js`): `lathe` (turned parts), `tube` (locks, straps, cables), `loop` (rims), `prism` (flat outlines:
collar points, soles, badges), `box`, `ball`. Place it from a body surface (`ctx.surf.torso/head/arm/leg/foot`:
`point(s, t)`, `normal(s, t)`, `weights(s, t)`, `sAtY(y)`, `ring(s)`) so it sits on the body and inherits its skin
weights, or give it one bone (`{ Head: 1 }`) if it is rigid. Then: `npm test` (builds it alone, validates, audits).
