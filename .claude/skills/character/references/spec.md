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
