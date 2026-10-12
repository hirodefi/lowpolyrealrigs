# Character spec

A spec is a JSON file. Only `body` is really needed; everything else has a sensible default. Unknown keys, values
and parts are rejected with the list of allowed ones.

```json
{
  "name": "casual_woman",
  "body": "female",
  "build": "average",
  "height": 1.7,
  "detail": "low",
  "hair": "long",
  "top": "tank",
  "neckline": "scoop",
  "bottom": "shorts",
  "shoes": "flat",
  "tie": false,
  "colors": {
    "Skin": [232, 190, 160], "Hair": [96, 70, 60], "Top": [236, 236, 232], "Bottom": [64, 66, 76],
    "Shoes": [240, 240, 240], "Accent": [120, 80, 50], "Trim": [250, 250, 250]
  },
  "parts": [
    { "part": "hairLocks" },
    { "part": "fringe", "count": 2 },
    { "part": "belt", "width": 0.018 },
    { "part": "soles" }
  ],
  "budget": 2700,
  "notes": "free text, ignored by the builder"
}
```

| Key | Values | Default | Notes |
|---|---|---|---|
| `name` | string | `character` | Output folder and file name. |
| `body` | `male`, `female`, `child` | from the reference, else `male` | Picks the body template (shoulders, waist, hips, bust, head size, neck). |
| `build` | `measured`, `slim`, `average`, `broad` | `measured` | Scales widths and limbs. With no reference `measured` = template proportions. |
| `height` | metres | 1.7 | The crowd may rescale; keep 1.7 unless told otherwise. |
| `detail` | `low`, `medium`, `high` | `medium` | Body ring density. `low` (~2,050 body tris) leaves the most room for parts; `medium` ~2,550. |
| `hair` | `short`, `bob`, `long`, `ponytail`, `bald` | from reference | The hair shell; add `hairLocks` / `fringe` parts for detail. |
| `top` | `tshirt`, `tank` | from reference | `tshirt` has sleeves and a collar band; `tank` has straps and bare shoulders. |
| `neckline` | `crew`, `scoop`, `v`, `auto` | `crew` (`scoop` for a tank); `auto` with a reference | `auto` measures it from the photo. A `tie` forces a closed collar. |
| `bottom` | `trousers`, `shorts`, `skirt` (A-line), `pencil` (straight knee skirt) | from reference | Skirts shorten the walk/run stride automatically. |
| `shortsLength` | `short`, `mid`, `long` | measured with a reference, else `mid` | Hot pants / mid-thigh / just above the knee. |
| `shoes` | `flat`, `heels` | from reference | Add `soles` for sneakers or boots. |
| `tie` | boolean | false | A tie in the Accent colour (shirt tops). |
| `colors` | `{Material: [r, g, b]}` | measured / defaults | `Skin`, `Hair`, `Top`, `Bottom`, `Shoes` are recoloured per person by the crowd; `Accent`, `Trim`, `Eyes` stay fixed. |
| `parts` | list of `{part, ...params}` | `[]` | See `parts.md`. Order doesn't matter. |
| `budget` | triangles | 2700 | The build fails above it and prints a per-part table. |

## Manual measurements (`measurements`)

When there are reference views, **measure them yourself** and put the numbers in the spec. This beats both the
automatic measurement (hair over the head, loose clothes and arms near the body confuse it) and the template (which
can't know a stylised character's long legs, narrow waist or big cranium). The builder then trusts these numbers:
more landmarks are mapped and the width/depth limits are much wider.

Measure with `character.mjs spans --ref <dir> --view front|side|back [--step 0.01] [--from 1 --to 0]`: per row, the
figure's spans (x from the centre) and each span's colour, so you can tell torso from arm, skin from hair, top from
shorts. Units everywhere: **h** = height from the floor as a fraction of the whole figure (0 = soles, 1 = top of the
hair); half-widths and depths are fractions of the same height.

```json
"measurements": {
  "landmarks": { "hairline": 0.955, "eye": 0.915, "chin": 0.857, "neck": 0.842, "shoulder": 0.79, "armpit": 0.745,
                 "bust": 0.69, "waist": 0.65, "hip": 0.53, "crotch": 0.515, "knee": 0.325, "ankle": 0.09 },
  "shoulderHalfWidth": 0.097,
  "torso": [[0.53, 0.099, 0.107], [0.65, 0.052, 0.088], [0.69, 0.070, 0.106], [0.745, 0.078, 0.100]],
  "legs":  [[0.50, 0.053, 0.046, 0.105], [0.325, 0.046, 0.026, 0.069], [0.25, 0.0535, 0.0325, 0.074], [0.11, 0.0505, 0.0125, 0.039]],
  "head":  [[0.845, 0.020, 0.046], [0.87, 0.033, 0.095], [0.90, 0.043, 0.115], [0.94, 0.049, 0.12], [0.98, 0.040, 0.10]],
  "face":  { "eyeX": 0.024, "eyeWidth": 0.027, "iris": 0.0068 },
  "arms":  { "fromVertical": 15, "length": 0.35, "upper": 0.041, "fore": 0.034, "hand": 0.031 },
  "clothes": { "topHem": 0.59, "neckline": 0.725, "bottomHem": 0.508, "sleeve": 0 },
  "hair": { "end": 0.67 }
}
```

| Field | What to measure | How |
|---|---|---|
| `landmarks` (required: eye, chin, neck, shoulder, armpit, crotch, knee) | Heights of the features | Eye = iris centre row; chin = where the front profile (side view) steps back to the neck; neck = narrowest neck row; shoulder = widest deltoid row (about the joint); armpit = where the arm separates from the torso; crotch = top of the leg gap; knee = narrowest point between thigh and calf. |
| `shoulderHalfWidth` | Outer shoulder half-width, deltoids included | Front view, widest row at the shoulders. |
| `torso` rows `[h, halfWidth, depth]` | Torso **without the arms** (front) and its full thickness (side) | Front: the central span (where the arm has separated). Side: front-to-back extent; ignore a hanging arm and the hair behind. 6-12 rows from the hips to the shoulders, including the waist and bust. |
| `legs` rows `[h, centreOffset, halfWidth, depth]` | One leg: centre distance from the body centre, half-width, thickness | Front: one leg's span; side: the leg's extent. Rows at upper thigh, mid thigh, knee, calf, ankle. |
| `head` rows `[h, halfWidth, depth]` | Skull/face widths, **not the hair** | Use the skin/hair colour split: face width at cheeks and jaw, the neck; under hair, estimate the skull (hair outline minus the hair's thickness, ~0.01). At jaw height use the jaw width even when the hair hides the jaw corners (the visible V of the face is narrower). |
| `face` | Eye spacing, eye width, iris radius | Iris centres (x), eye white extent, iris size, front view. Close-set eyes are the strongest "something is off" cue. |
| `arms` | Angle from vertical, shoulder-to-fingertip length, upper arm / forearm / hand widths (full widths) | Front view: shoulder joint to wrist line for the angle. |
| `clothes` | Top hem, neckline (front centre), bottom hem (shorts) or `skirtHem`, sleeve (0 = sleeveless, fraction of arm otherwise) | Colour changes in `spans`. |
| `hair` | `end`: where the hair ends down the back (back view) | |

Build with the same `--ref` to get the overlays and IoU against the reference, and compare with the reference on the
review sheet. If a region is off, re-measure that region; don't tune unrelated numbers.

## Heights (landmarks)

Parts that take a height (`belt.y`, `buttons.from` / `.to`) accept:

- a landmark name: `crotch`, `hip`, `waist`, `chest`, `armpit`, `neck`, `head`, `top`, `hem` (where the top ends),
  `knee`, `ankle`, `eye`, `skirt` (skirt hem, if any);
- a fraction of the height: `0.6`;
- an offset from a landmark: `{ "at": "neck", "dy": -0.035 }` (dy in fractions of the height, negative = down).

## With a reference

`character.mjs seed` writes a draft spec with the measured body type, styles and colours. Keep its values unless you
can see they are wrong (input checks flagged a view, or the image contradicts them), then add parts. Build with the
same `--ref` so the body takes the measured proportions (shoulders, waist, hips, legs, head) instead of the template.
