# Reference image guide

The generator measures the body from silhouettes and reads clothing, hair and skin from colours.
It is only as accurate as its input, so images should follow this contract. The in-app validator
checks it and lists every problem it finds (failures block generation, warnings are reported).

## Fidelity tiers

| Input | What you get |
|---|---|
| Front + side + back | Full reconstruction: widths from the front, depths from the side, hair and rear clothing from the back. |
| Front + side | Rear hair and clothing are inferred. |
| Front only | Basic mode: depth, hair length and rear clothing are inferred from proportions. |

## All views

- The same character in the same outfit, at the **same scale and framing** in every view.
- Full body from the top of the hair to the shoe soles, centred, nothing cropped.
- PNG, at least 1024 px tall (1024 x 1536 is ideal).
- **Background:** one flat colour that contrasts with hair, skin and every piece of clothing.
  Do not use a grey backdrop for grey clothes or a dark one for dark hair. No gradients,
  vignettes, textures, floor or wall shadows.
- **Camera:** orthographic, or a long lens from far away (no wide-angle distortion).
- **Lighting:** even and neutral.

## Front

- Facing the camera, symmetrical relaxed A-pose.
- Arms a little away from the torso so a gap shows between arm and body.
- Legs straight and slightly apart.
- Hair, neckline, straps, cuffs and hems clearly visible.

## Side

- An exact 90° profile (not three-quarter), facing left or right.
- Standing, not mid-stride: legs together, feet flat.
- Arms relaxed and distinguishable from the torso where possible.

## Back

- A direct rear view aligned with the front; no face visible.
- Shows how far the hair falls and its width, plus the back of the clothes.

## Masks (optional)

For a background that cannot meet the rules above, add a mask per view: a white figure on black
(or a PNG with transparency), the same framing as the image. The mask then defines the silhouette
and the image is used only for colours.

## Turnaround sheets

A single image with front, side and back side by side can be loaded with
*Load a turnaround sheet*; it is split automatically. Check the three slots afterwards.

## What the validator checks

| Check | Meaning |
|---|---|
| `views` | Which tier the input falls in. |
| `cropped` (fail) | The figure touches the image edge. |
| `background-noise`, `background-gradient` | The backdrop is not plain and flat. |
| `low-contrast`, `figure-broken` | Parts of the figure are close to the backdrop colour or were cut off from the body. |
| `small-figure` | The figure is too small in the frame. |
| `scale-mismatch` | A view is at a different scale from the front. |
| `arms`, `legs`, `neck` | Pose problems: arms against the body, legs not visible, neck hidden (inferred). |
| `stride` | The side view is mid-stride. |
| `back-shows-face` | The back view shows a face. |
