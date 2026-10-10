# Low-Poly Rig Generator

Upload **front / side / back** images of a person and get a **rigged, animated, low-poly `.glb`**
that drops straight into Three.js, Blender, Godot, Unity (glTFast), Unreal, Babylon and others.

- **No external APIs, no AI models, no GPU.** Everything is classic geometry that runs in the browser in ~50–100 ms.
- **Human-shaped:** the body follows an averaged human template (sloped shoulders, chest/waist/hip curve, neck, skull with nose and ears, hair shell, mitten hands, heel-to-toe shoes, clothing hems and cuffs), sized and coloured from your photos.
- **Crowd-ready export:** one skinned mesh, a 21-bone humanoid skeleton, flat colour materials named `Skin`, `Hair`, `Top`, `Bottom`, `Shoes` (one primitive each, no textures, so a crowd can re-dress each person), and clips `idle`, `walk`, `run`, `sit`, `wave`.
- **Grounded motion:** walk and run follow human gait curves; the feet never sink into or float above the floor, and each locomotion clip stores its ground speed in `extras.speed` (m/s), so the character can be moved at the matching speed without foot sliding.
- **Validated output:** every GLB passes the official Khronos glTF validator with 0 errors and 0 warnings.

## Run it

```bash
npm install
npm start            # http://localhost:5173
```

Click **Load demo character** to try it without any images, or drop your own images into the three slots
(only the front view is required). **Compare to photo** overlays the front photo on a front view of the model,
so you can see where the measurement went wrong.

Ready-made files for a quick bake test are in `examples/` (the demo character as `male`, `female` and `child`).

## Tests

```bash
npm test             # Node: all detail levels and body types, Khronos validator, skinning + crowd-format checks
npm run test:e2e     # Browser (Playwright/Chromium): drives the real UI, saves screenshots to out/
```

## How it works

```
images ─► silhouette ─► measurements ─► template body ─► skeleton + rings ─► skin weights ─► region colours ─► animations ─► GLB
```

| Step | File | What it does |
|---|---|---|
| Silhouette | `public/core/silhouette.js` | Background removal: alpha if present, otherwise a smooth lighting model fitted to the image border and flood-filled in from the edges (copes with studio gradients and floor/wall shadows). Keeps the largest blob and extracts per-row spans. |
| Measure | `public/core/measure.js` | Detects the neck, shoulders, crotch, arm direction and thickness, and depth/facing from the side view. Samples one clean colour per region (face, hair, top, trousers, shoes) and finds the hem, sleeve and trouser length and the hairline. |
| Template | `public/core/template.js` | Averaged body proportions and cross-section shapes for men, women and children (see below). |
| Build | `public/core/builder.js` | Places 21 joints from the template's landmarks, then lofts torso, neck and head, arms, legs and feet from template rings, scaled ring by ring to the photo's measured widths and depths. Adds a nose, ears, a hair shell and clothing lips. Each ring knows its bone(s), so skin weights are exact and blend smoothly across joints, with extra rings at the elbows and knees. |
| Animate | `public/core/animation.js` | `walk` and `run` from keyframed gait curves (hip, knee, ankle, toe, pelvis turn/tilt/sway, torso twist, arm swing), with forward kinematics keeping the feet on the floor. Also a breathing `idle`, a held `sit` and a `wave`. |
| Export | `public/core/glb.js` | Hand-written glTF 2.0 binary writer. No dependencies. |

The `core/` modules are plain ES modules with no dependencies and no DOM use, so they also run in Node (see `test/selftest.js`).

### The body template

`tools/extract-template.mjs` slices rigged reference figures (in T-pose) at many heights and writes only
derived numbers to `public/core/template.js`: landmark heights and joint positions as a fraction of height,
and per-ring centre, half width/depth and a 24-sample shape ratio, averaged per body type. No reference
geometry is copied or shipped. The current template was measured from the 8 rigged figures in the
"Low Poly People Free Sample Pack" by Denys Almaral on Sketchfab (3 men, 4 women, 1 child); that asset itself is not
part of this repository.

```bash
node tools/extract-template.mjs path/to/reference.glb   # regenerate public/core/template.js
```

## Skeleton

`Hips > Spine > Chest > Neck > Head`, plus `Left/Right` `Shoulder > UpperArm > LowerArm > Hand` and
`UpperLeg > LowerLeg > Foot > Toes`. These names auto-map to Unity's Humanoid avatar and are easy to retarget in Blender
and other engines. The model faces +Z, Y is up, the units are metres (1.7 m tall by default) and the feet stand on y = 0.

**Body type** picks the template (auto-detected from the photo's proportions, or man / woman / child), and
**Build** (slim, average, broad) scales the measured widths.

## Tips for the best results

- Full body, head to toe, facing the camera, with the same framing in all three views.
- A plain or gradient background that contrasts with the subject (or a transparent PNG).
- An A-pose with the arms a little away from the body and a small gap between the legs.
- The side view should be a true profile with the feet visible.

## Limits

The result is a low-poly figure built from measured proportions and colours, not a photogrammetry scan.
Fingers, facial features beyond the nose and ears, and loose clothing (capes, wide skirts, long hair below the neck)
are simplified away. Three-quarter or mid-stride photos work but read the width less accurately than a straight front view.
