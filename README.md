# Low-Poly Rig Generator

Upload **front / side / back** images of a character and get a **rigged, animated, low-poly `.glb`**
that drops straight into Three.js, Blender, Godot, Unity (glTFast), Unreal, Babylon and others.

- **No external APIs, no AI models, no GPU.** Everything is classic geometry that runs in the browser in ~50 ms.
- **Ready-to-use export:** one skinned mesh, 21-bone humanoid skeleton, embedded palette texture, 4 looping clips (Idle, Walk, Run, Wave).
- **Validated output:** every GLB passes the official Khronos glTF validator with 0 errors and 0 warnings.

## Run it

```bash
cd lowpolyrigmodelgen
npm install
npm start            # http://localhost:5173
```

Click **Load demo character** to try it without any images, or drop your own images into the three slots.

## Tests

```bash
npm test             # Node: generates at all detail levels, runs the Khronos validator + skinning checks
npm run test:e2e     # Browser (Playwright/Chromium): drives the real UI, saves screenshots to out/
```

## How it works

```
images ─► silhouette ─► measurements ─► skeleton + lofted mesh ─► skin weights ─► colours ─► animations ─► GLB
```

| Step | File | What it does |
|---|---|---|
| Silhouette | `public/core/silhouette.js` | Background removal (alpha, or the border colour), keeps the largest blob, extracts per-row spans. |
| Measure | `public/core/measure.js` | Detects the neck (narrowest point under the head), shoulders, crotch (where the gap between the legs closes), fingertips (farthest point from the shoulder), limb thickness, and depth/facing from the side view (the feet point forward). Falls back to standard figure proportions where detection isn't possible. |
| Build | `public/core/builder.js` | Places 21 joints, then lofts the body from elliptical rings (torso, head, arms, legs, feet). Each ring knows its bone(s), so skin weights are exact and blend smoothly across the elbows, knees, etc. |
| Colour | `measure.js` + `builder.js` | Projects each face onto the front, back or side photo, then k-means reduces the colours to a small palette texture (nearest filtering for crisp, flat low-poly colours). |
| Animate | `public/core/animation.js` | Procedural Idle, Walk, Run and Wave loops. These work on any generated body because the joint frames are world-aligned. |
| Export | `public/core/glb.js`, `png.js` | Hand-written glTF 2.0 binary writer and PNG encoder. No dependencies. |

The `core/` modules are plain ES modules with no dependencies and no DOM use, so they also run in Node (see `test/selftest.js`).

## Skeleton

`Hips > Spine > Chest > Neck > Head`, plus `Left/Right` `Shoulder > UpperArm > LowerArm > Hand` and
`UpperLeg > LowerLeg > Foot > Toes`. These names auto-map to Unity's Humanoid avatar and are easy to retarget in Blender
and other engines. The model faces +Z, Y is up, the units are metres and the feet stand on y = 0.

## Tips for the best results

- Full body, head to toe, with the same framing in all three views.
- A plain background that contrasts with the subject (or a transparent PNG).
- An A-pose or T-pose with the arms away from the body and a small gap between the legs.
- The side view should be a true profile with the feet visible.

## Limits (by design: simple, fast and robust)

The result is a stylised low-poly figure built from the measured proportions and colours, not a
photogrammetry scan. Fingers, the face and loose clothing (capes, wide skirts) are simplified away.
