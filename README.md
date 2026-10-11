# Low-Poly Rig Generator

Upload **front / side / back** images of a person and get a **rigged, animated, low-poly `.glb`**
that drops straight into Three.js, Blender, Godot, Unity (glTFast), Unreal, Babylon and others.

- **No external APIs, no AI models, no GPU.** Everything is classic geometry that runs in the browser in ~50–100 ms.
- **Human-shaped:** the body follows an averaged human template (sloped shoulders, chest/waist/hip curve, a slim neck under a defined jaw, rounded skull with nose, eyes, brows and ears, mitten hands with a thumb, heel-to-toe shoes), sized and coloured from your photos. Men and women differ in shoulders, bust, waist, hips and neck.
- **Hair and clothes:** short, bob, long (down the back, framing the face) or ponytail hair; trousers, shorts, an A-line skirt (flares from the waist) or a straight knee-length skirt; T-shirt or tank top (straps over bare shoulders), scoop necklines, shirt collar, optional tie, sleeve cuffs and hems; flat shoes or heels. All auto-detected from the photos, or chosen by hand.
- **Crowd-ready export:** one skinned mesh, a 21-bone humanoid skeleton, flat colour materials named `Skin`, `Hair`, `Top`, `Bottom`, `Shoes` (one primitive each, no textures, so a crowd can re-dress each person), plus `Accent` (collar / tie, only when present) and `Eyes`, which a bake keeps as fixed colours; clips `idle`, `walk`, `run`, `sit`, `wave`.
- **Grounded motion:** walk and run follow human gait curves; the feet never sink into or float above the floor, and each locomotion clip stores its ground speed in `extras.speed` (m/s), so the character can be moved at the matching speed without foot sliding.
- **Validated output:** every GLB passes the official Khronos glTF validator with 0 errors and 0 warnings.

## Run it

```bash
npm install
npm start            # http://localhost:5173
```

Click **Load demo character** to try it without any images, or drop your own images into the three slots
(only the front view is required), or upload one **turnaround sheet** (front, side and back side by side), which is
split into the three slots automatically. An optional **mask** per view (white figure on black) replaces the
background removal for that view. **Compare to photo** overlays the front photo on a front view of the model,
so you can see where the measurement went wrong.

Before building, the **input checklist** tests the images against the input contract
([`docs/INPUT_GUIDE.md`](docs/INPUT_GUIDE.md)): which views are present, plain backdrop, contrast between figure and
backdrop, cropping, figure size, matching scale across views, arms and legs separated, a standing (not mid-stride)
profile, and a true back view. Failures block the build; warnings explain which part of the result to distrust.

Ready-made files for a quick bake test are in `examples/` (regenerate with `node tools/make-examples.mjs`): a man
with short hair, a man in a shirt and tie, a woman with long hair and an A-line skirt, a woman in a tank top, straight
knee skirt and heels, a woman with a ponytail and trousers, a woman with a bob and a skirt, a child, and
`woman_reference_tank_shorts.glb`, built from the three reference views in `test/fixtures/woman/`.

Triangle budget: Low ~2,050–2,200, Medium ~2,300–2,700 (every style combination stays at or under 2,700), High ~3,500.

## Tests

```bash
npm test             # Node: all detail levels, body types and clothing styles, Khronos validator, skinning, crowd format, triangle budget
npm run bench        # Browser: fidelity benchmark with ground truth (below), writes out/benchmark/
npm run test:e2e     # Browser (Playwright/Chromium): drives the real UI, saves screenshots to out/
```

### Fidelity benchmark (`test/benchmark.js`)

- **Suite A, ground truth (graded):** characters with known body type, hair, clothes and colours are rendered
  orthographically (front, side, back) on plain backdrops; the renders are fed back in as user images, and the
  recovered character is compared with the truth: styles must match, joint landmarks within 2 % of height, colours
  within 25 RGB, silhouette IoU at least 0.85 and mean width error at most 2–2.5 % per view, and the model must be
  watertight in silhouette (no see-through seams). Any miss fails the run.
- **Suite C, adversarial inputs:** a gradient backdrop, trousers the colour of the wall, a side view at the wrong
  scale, cropped feet and a front-only upload; the validator must flag each one.
- **External references (report only):** the clean three-view woman, a turnaround sheet and a real photo. A
  mismatch on a view the validator flagged is attributed to the input, not the model.

## How it works

```
images ─► silhouette ─► measurements ─► template body ─► skeleton + rings ─► skin weights ─► region colours ─► animations ─► GLB
```

| Step | File | What it does |
|---|---|---|
| Silhouette | `public/core/silhouette.js` | Background removal: an uploaded mask or alpha if present, otherwise a smooth lighting model fitted to the image border and flood-filled in from the edges (copes with studio gradients and floor/wall shadows). Keeps the largest blob (and reports how much was cut off) and extracts per-row spans. Also splits turnaround sheets. |
| Validate | `public/core/validate.js` | The input checklist: fidelity tier, backdrop noise and gradient, contrast, cropping, figure size, cross-view scale, pose (arms, legs, neck, stride) and back-view checks. |
| Measure | `public/core/measure.js` | Detects the neck, shoulders, crotch, arm direction and thickness, and depth/facing from the side view. Samples one clean colour per region (face, hair, top, trousers, shoes) and finds the hem, sleeve and trouser length (sleeveless = tank), the neckline and an accent colour (collar / tie trim), the hairline, hair length and width (short / bob / long / ponytail, from the back view), heels (a post under the heel in profile) and skirts (a step in width at the hem). |
| Template | `public/core/template.js` | Averaged body proportions and cross-section shapes for men, women and children (see below). |
| Build | `public/core/builder.js` | Places 21 joints from the template's landmarks, then lofts torso, neck and head, arms, legs and feet from template rings, scaled ring by ring to the photo's measured widths and depths (within human limits). Adds a nose, eyes, brows, ears, thumbs, a collar or tank straps, a tie, clothing lips, heels, the hair style and a skirt when needed. Clothing edges (necklines, armholes) get their own ring so colours change along a clean line. Each ring knows its bone(s), so skin weights are exact and blend smoothly across joints; skirt vertices follow both thighs so legs never cut through. |
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

**Body type** picks the template (auto-detected from the photo's proportions, or man / woman / child),
**Build** (slim, average, broad) scales the measured widths, and **Hair**, **Clothes (bottom)**, **Top**, **Shoes**
and **Tie** override the detected styles.

## Tips for the best results

See [`docs/INPUT_GUIDE.md`](docs/INPUT_GUIDE.md) for the full input contract. In short:

- Full body, head to toe, facing the camera, with the same framing and scale in all three views.
- A plain, evenly lit background that contrasts with hair, skin and clothes (or a transparent PNG / a mask).
- An A-pose with the arms a little away from the body and a small gap between the legs.
- The side view should be a true profile standing still (not mid-stride) with the feet visible; the back view a
  direct rear view showing the hair.

## Limits

The result is a low-poly figure built from measured proportions and colours, not a photogrammetry scan.
Separate fingers, mouths and detailed faces, jackets and lapels, and very loose clothing (capes, ball gowns) are
simplified away. Three-quarter or mid-stride photos work but read the width less accurately than a straight front view.
