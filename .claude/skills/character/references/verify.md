# Verify like a critic

The build prints `report.txt` and writes `sheet.png`. A character is done when the report says OK and you have read
every tile of the sheet and found nothing wrong.

## report.txt

- **Khronos validator**: must be 0 errors (warnings should be 0 too).
- **Triangle budget**: total within `budget` (2,700 by default). The table shows the body and each part: trade the
  most expensive part that reads least (usually `glasses` or `buttons`) first, or build the body at `detail: low`.
- **Pose audit**: CPU skinning at sampled frames of idle, walk, run, sit and wave. Each check, with what to do:

| Check | Meaning | Usual fix |
|---|---|---|
| `arm-through-torso` | A hand or forearm goes into the torso (the armpit, where the arm meets the body, is allowed). | Usually a very broad `build` with slim arms; try `average`. |
| `arm-through-leg` | A hand passes through a thigh in the arm swing. | Same; or a skirt flare too wide at the hands' height. |
| `leg-through-leg` | Knees or shins pass through each other. | Very wide thighs (`build: broad`); try `average`. |
| `leg-through-skirt` | A leg pokes out through the skirt in a clip. | A-line for a full skirt; for a straight knee skirt keep it at the knee. |
| `below-floor` | Feet sink into the floor in a frame. | Report it: animation bug, not a spec problem. |
| `part-floating` | A part is more than 3 cm off the body. | The part's parameters put it off the surface (e.g. `y` outside the torso); fix them. |

  Never silence the audit by moving a part away or dropping a clip.
- **Reference match** (with `--ref`): silhouette IoU and mean width error per view. Clean views: front/back IoU ~0.85+
  and width error under ~2 % of the height. A low score on a view the **input checks** flagged (low contrast, mid-stride
  side view, cropped) is an input problem; say so instead of bending the character to fit a bad input.

## sheet.png (read every tile)

Row 1 - reference vs model (front, side, back):
- Same person at a glance: body type, proportions, hair outline, clothing outline, colours.
- Side: posture, bust/belly depth, hair length down the back, shoe profile (heels).
- Back: hair shape, straps or collar, waistband.

Row 2 - close-ups:
- **Face**: eyes and brows level, hairline and fringe on the head (not floating), glasses on the nose bridge with arms
  to the ears.
- **Chest / collar**: neckline right (crew, scoop, tank straps), collar points on the chest, buttons on the centre line.
- **Hand**: watch on the wrist, sleeve end at the right length.
- **Feet**: shoe shape, sole visible and under the shoe, heel posts on heels.

Row 3 - motion (walk, walk, run, sit, wave):
- Feet on the floor, no sliding stance; skirt moving with the legs; hair locks and parts moving with the body; nothing
  through anything; the seated pose has thighs on the seat line.

## Overlays (overlay_<view>.png)

Reference silhouette vs model silhouette, aligned on height. Where the model is wider or narrower than the reference
is where to adjust: `build`, hair style, skirt type, or the reference itself (check the input checks first).

## Checklist before hand-over

- [ ] report.txt says OK (validator, budget, audit).
- [ ] With a reference: IoU front/back ~0.85+, or the difference is explained by an input check.
- [ ] Every sheet tile reviewed; nothing floats, sinks, pokes through or looks like the wrong person.
- [ ] The parts list is the shortest one that makes the character recognisable.
- [ ] Hand over: GLB path, sheet, triangle total, parts used, anything not matched and why.
