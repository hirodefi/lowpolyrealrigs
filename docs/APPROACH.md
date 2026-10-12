# Approach and strategies

This document explains how the low-poly rig generator works and, above all, **why** it works the way it does: the
goal and its constraints, the strategy for each stage, the decisions taken (and the alternatives rejected), the
quality gates that keep it honest, and the lessons learned building it. It is written for whoever extends the tool
next, human or Claude.

- [1. Goal and constraints](#1-goal-and-constraints)
- [2. The big picture](#2-the-big-picture)
- [3. Guiding principles](#3-guiding-principles)
- [4. Input contract and validator](#4-input-contract-and-validator)
- [5. Segmentation (silhouettes)](#5-segmentation-silhouettes)
- [6. Measurement (geometry and appearance)](#6-measurement-geometry-and-appearance)
- [7. The body template](#7-the-body-template)
- [8. The builder](#8-the-builder)
- [9. Animation](#9-animation)
- [10. Export and the bake contract](#10-export-and-the-bake-contract)
- [11. The parts kit (the Anatomy method)](#11-the-parts-kit-the-anatomy-method)
- [12. Character specs](#12-character-specs)
- [13. The pose audit](#13-the-pose-audit)
- [14. The fidelity benchmark](#14-the-fidelity-benchmark)
- [15. The Claude character skill](#15-the-claude-character-skill)
- [16. Quality gates and process](#16-quality-gates-and-process)
- [17. Lessons learned](#17-lessons-learned)
- [18. Limits and roadmap](#18-limits-and-roadmap)
- [19. Extending the tool](#19-extending-the-tool)
- [20. File map](#20-file-map)

---

## 1. Goal and constraints

**Goal:** realistic, rigged, animated low-poly people for a crowd, made either from reference images (front, side,
back) or, through Claude, from any image or description. "Realistic" means correct human proportions, clothes and hair
that read as a particular person at crowd distance, and motion that is grounded and never passes through itself.

**Hard constraints** (agreed with the crowd's bake tool):

| Constraint | Value |
|---|---|
| External services | None. No APIs, no ML models, no downloads; everything runs locally (browser or Node). |
| Compute | Minimal. A character builds in ~0.2-0.5 s on a CPU. |
| Mesh | One skinned mesh, no morph targets, flat-shaded low poly. |
| Triangles | ~1,900-2,700 per character (the heaviest variants must not grow). |
| Skeleton | 21-bone humanoid (`Hips > Spine > Chest > Neck > Head`, shoulders, arms, hands, legs, feet, toes). |
| Materials | Flat colours, one primitive each, no textures: `Skin`, `Hair`, `Top`, `Bottom`, `Shoes` (recoloured per person by the crowd) plus `Accent`, `Trim`, `Eyes` (kept as fixed colours by the bake). |
| Clips | `walk`, `idle` required; `run`, `wave`, `sit` provided; locomotion clips carry `extras.speed` (m/s). |
| Frame | ~1.7 m tall, feet on y = 0, facing +Z, metres. |
| Validity | Every GLB passes the Khronos glTF validator with 0 errors and 0 warnings. |

## 2. The big picture

There are two ways in, sharing one core:

```
                 ┌───────────────────── offline app (browser) ─────────────────────┐
images ──► validate ──► silhouette ──► measure ──┐                                  │
 (front/side/back,       (backdrop model,        │ spec: landmarks, widths,         │
  sheet, masks)           flood fill)            │ depths, look (colours, styles)   │
                                                 ▼                                  │
                                       builder (template body,                      │
                                       rings, skin weights)  ──► animation ──► GLB  │
                                                 ▲                                  │
 Claude (skill) ──► character spec ──► parts ────┘           pose audit ◄───────────┘
 (reads any image   (JSON: body, styles,   (kit primitives on        (every clip)
  or description)    colours, parts)        body surfaces)
```

- **Measurement path** (the browser app, `generateCharacter`): segment each view, measure landmarks and widths, read
  colours and clothing extents, build. Fully automatic, works on clean reference views.
- **Spec path** (the Claude skill, `buildFromSpec`): Claude reads any input, including concept art, a single photo or a
  description, and writes a JSON spec of body, styles, colours and real parts. With reference views, measurement
  still shapes the body; without them, realistic template proportions are used.

Both end in the same builder, animation, exporter and the same proofs (validator, pose audit).

## 3. Guiding principles

These decisions shaped everything else. Each was made deliberately, usually after something went wrong without it.

1. **Classical geometry, strict inputs, no ML.** Segmentation and landmarks are classical (a fitted backdrop model,
   flood fill, run analysis). Robustness comes from an explicit input contract, a validator that names what is wrong
   with an input, and optional per-view masks, not from a learned model. *Why:* the constraints forbid external
   services and heavy compute, and a classical pipeline is debuggable: every number has a reason.
2. **Templates for realism, photos for personalisation.** The body shape comes from an averaged human template
   measured from real rigged low-poly figures; photos scale it ring by ring *within human limits*. *Why:* raw
   silhouettes of drawings or loose clothes produce cartoon bodies; a template keeps anatomy correct.
3. **Geometry and appearance are measured separately.** Masks and landmarks first, then colours and clothing
   boundaries sampled inside landmark-defined regions. *Why:* mixing them made colour noise move landmarks and vice
   versa.
4. **Ground truth before tuning.** A benchmark renders characters with known parameters, feeds the renders back in and
   grades what comes out. *Why:* tuning against one reference image over-fitted it repeatedly, and the comparison
   harness itself once had a bug that made good models look wrong. Ground truth tells input errors from modelling
   errors.
5. **Prove it, don't eyeball it.** Every build is validated (Khronos), budgeted (triangles), audited (no
   interpenetration in any clip) and reviewed close up (review sheet). A finding is traced to a cause before it is
   fixed; checks are never loosened to make a result pass.
6. **A person reads by their parts** (from Anatomy). A white shirt is a collar band, collar points, buttons and a hem
   lip; long hair is a shell plus locks falling forward. Realism at crowd distance comes from a few purposeful parts
   placed on the body, not from more triangles everywhere.
7. **Spend triangles where they read.** Silhouette first (body, hair outline, skirt, heels), then colour blocks, then
   motion, then parts, then close-up detail.
8. **Judge, don't copy.** Suggestions from other tools or people (and reference images) are evaluated on merit; take a
   reference's type, proportions and colours, not its literal details.

## 4. Input contract and validator

**Contract** (`docs/INPUT_GUIDE.md`): three separate views (front required, side and back strongly recommended),
head to soles, same scale and framing, plain evenly lit backdrop that contrasts with hair, skin and clothes, A-pose
with arms off the body and a small leg gap, a true standing profile (not mid-stride), a direct rear view. A turnaround
sheet is split automatically (`splitTurnaround`); a white-on-black mask per view replaces background removal.

**Validator** (`public/core/validate.js`) runs on every input and returns `{view, id, level, message, value}` items,
shown as a checklist. `fail` blocks the build (strict mode), `warn` explains which part of the result to distrust.

| Check | Rule | Why |
|---|---|---|
| `views` | front only = basic mode, no back = rear inferred | Sets expectations (fidelity tier). |
| `background-noise` | backdrop residual noise > 10 | Textured backdrops break the flood fill. |
| `background-gradient` | corner vs centre backdrop distance > 25 | Strong vignettes. |
| `cropped` (fail) | figure touches an image edge | Head, hands or feet missing. |
| `figure-broken` | > 1 % of the figure cut off as separate pieces | Clothing the colour of the backdrop (e.g. grey shorts on a grey wall). |
| `small-figure` | figure < 50 % of image height | Too few pixels to measure. |
| `low-contrast` | > 22 % of outline pixels close to the backdrop colour | Calibrated: clean renders ~0.16, problem inputs >= 0.28. |
| `scale-mismatch` | view heights differ by > 3 % | Views must share framing. |
| `arms`, `legs`, `neck` | not separated / not visible | Landmarks inferred from proportions instead. |
| `stride` | side view shows two legs below the knee in > 50 % of rows | Mid-stride profile. |
| `back-shows-face` | skin where back hair should be | Not a real back view. |

Analysis runs at 640 px on the longest side (`public/image-input.js`): thin details (heel posts, hair strands,
arm-torso gaps) survive, and every pass costs milliseconds.

## 5. Segmentation (silhouettes)

`public/core/silhouette.js` turns an RGBA image into a body mask and per-row runs (horizontal spans of body pixels).

- **Backdrop model:** a quadratic surface per colour channel fitted to the image border, so studio gradients and
  vignettes are modelled, not just one background colour. Every pixel gets a distance from the model; the threshold
  adapts to border noise: `max(13, min(60, noise * 6 + 11))`.
- **Flood fill from the border:** background is what is *connected to the border* and close to the model; everything
  else is the subject. This keeps interior colours that match the backdrop (a white shirt on a white wall) inside the
  figure as long as an outline separates them.
- **Floor shadows:** in the bottom 12 % only, desaturated darker versions of the backdrop count as background (limited
  after it erased grey seams higher up and cut legs off).
- **Gap closing:** short vertical holes are closed only in the waist band (where hems create them), never across the
  arm-torso or leg gaps the measurement needs.
- **Largest component:** kept; the dropped fraction is recorded and drives the `figure-broken` check.
- **Overrides:** `alpha` channels and uploaded masks bypass the backdrop model.

## 6. Measurement (geometry and appearance)

`public/core/measure.js` reads one spec per character: landmarks (as fractions of height `v` from the top), width and
depth profiles, arm geometry and the "look".

**Landmarks and their strategies**

| Landmark | Strategy | Notes and calibrations |
|---|---|---|
| Head | widest central width in the top 12 % | Includes hair; the builder removes hair thickness later. |
| Neck | narrowest central width below the head, **middle of the rows within 6 % of the minimum** | A visible neck must be <= 0.8x the head width, else it is hidden (bob, collar) and inferred. The first-minimum rule landed on the top of a flat neck plateau. |
| Shoulders | first row wider than 2.2x the neck; joint 0.025 below | |
| Crotch | track the gap between the legs upwards from the shins, bridging short closures at the knees | Crotch = top of the gap - 0.01. A gap that only opens far below the hips with a width step < 0.94 is a skirt hem, not a crotch. |
| Arms | fingertip = farthest silhouette pixel from the shoulder outside the body core; angle from a fitted centre line | The raw tip-to-shoulder line was biased +6 degrees; the core exclusion stopped women's arm tips landing at the crotch. |
| Legs | per side offset and half-width, symmetrised | |
| Depth | side view: front/back extent per row; feet tell the facing | |
| Body type cues | `waistHip`, `hipShoulder`, `bust` (side), `head` (neck height), `headW` | Child: neck below 17 % of height, unless clearly female (waist/hip < 0.72 and bust > 1.1). Female: waist/hip < 0.78 or bust > 1.1. |

**Appearance ("look")** samples colours from interior pixels of landmark-defined regions (edge pixels are skipped
because anti-aliasing blends them with the backdrop): face, hair crown, the chest just below the neckline, the hip band
for the bottom, the shoes. Clothing extents: hem height, sleeve length (skin from the first arm sample = sleeveless),
trouser length (walk down a leg from the crotch), neckline depth and an accent colour at the neckline (collar or tie
trim; must hold over two samples and differ by >= 80), hairline, hair length down the back, hair style from length and
width (a ponytail is a narrow band, a bob as wide as the head), skirt hem and heels (a narrow post under the heel in
profile).

## 7. The body template

`public/core/template.js` is generated by `tools/extract-template.mjs` from rigged low-poly reference figures in
T-pose (the "Low Poly People Free Sample Pack" by Denys Almaral; the asset itself is not in the repository). It
slices each figure at many heights and stores only derived numbers, averaged per body type (male, female, child):

- landmark heights and joint positions as fractions of height;
- per-ring cross-sections for torso, neck and head, leg, arm and foot: centre, half width and depth, and a 24-sample
  shape ratio around the ellipse.

The template is what makes a body human: sloped shoulders, chest-waist-hip curve, skull shape, heel-to-toe feet.

## 8. The builder

`public/core/builder.js` turns a spec and options into bones and a skinned mesh. Each body part is a stack of rings
lofted into a tube (`MeshBuilder.tube`); every ring knows its bone(s), so skin weights are exact and blend smoothly
across joints. Key strategies:

**Vertical mapping.** Template heights map to metres through key pairs (crotch, neck) taken from the photo when
detected (bounded to +/-0.06 and +/-0.04 of the template), linear in between.

**Measurements in build space (two passes).** Photo landmarks are fractions of the *whole figure* (hair and soles
included), while the builder maps the skull top to H and rescales the finished model to exactly H. Every detected
landmark was shifted by the hair height (the child, with its big head, showed it most). The builder now builds once to
learn the raw-height ratio `r`, then rebuilds with every measured length scaled by `r` (`scaleSpec`).

**Widths and depths.** Per template ring, factor = measured width / template width, smoothed and clamped (torso
0.85-1.2, legs up to 1.35, head 0.9-1.1). The head's measured width includes hair, so it is divided by a hair
thickness of 1.1 first (otherwise hair is counted twice).

**Neck.** Template necks are about as wide as the jaw (the child's even wider), so the chin didn't read and the
narrowest point sat on the chin. The neck is capped at a fraction of the head width (female 0.66, child 0.64,
male 0.8) with a defined narrowest point; the photo's narrowest row maps onto the built neck's narrowest point,
computed the same way the measurement does (at the tube's actual vertex angles, because a template bulge between
vertices never shows).

**Shoulders and arms.** The shoulder joint is anchored to the torso actually built (`min(template x shoulder factor,
torso half-width at the armpit + 0.45 x arm radius)`), which removed see-through seams between arm and body. The
torso forms a shoulder cap over the arm root (0.7 x arm radius) with a trapezius profile: a quick rounded corner over
the deltoid, then a slope that rises steeply only near the neck. The buried arm root runs inward into the torso, not
up along a hanging arm, so it cannot poke out above the shoulder.

**Clothing edges get their own ring.** Necklines, tank armholes and hems are rings, so the colour change runs along a
clean line instead of zig-zagging across triangles. Material is decided per face from its normal (both triangles of a
quad agree), so front panels have straight sides. Tank tops get strap ribbons lying on the torso surface, from the
front panel over the shoulder to the back.

**Skirts.** A-line (flares from the waist, hem >= 1.18x the top) or straight to the knee. Skin weights: above the hip
joints the skirt rides on the hips, then hands over to the thighs (smoothstep to 0.9) by just below the crotch; each
side follows its own thigh more. Linear skinning can only move the front of the skirt with the *average* of both
thighs, so the skirt carries ease at the front (A-line 0.55, straight 0.24, growing towards the hem), has at least 10
sides (a flat front panel let thighs through), and the animation shortens the stride (section 9). Every one of these
came from a pose-audit finding.

**Hair.** A shell over the skull (short, bob, long, ponytail, bald), the hairline rising at a centre part and sweeping
down: long hair and bobs frame the face to the jaw, short hair stops at the temples. Long hair adds a curtain down the
back following the torso; ponytails a tapered tube.

**Face.** Rounded crown, nose wedge sunk into the face, almond eyes nearly flush with the surface, brows, ears when the
hair does not hide them.

**Feet.** Template foot sections from heel to toe; heels lift the rear of the shoe and add a block heel; women's shoes
are slimmer.

**Budget management.** Ring counts per detail level (low / medium / high) and part-level trims keep every style
combination at or under 2,700 triangles on medium.

## 9. Animation

`public/core/animation.js` builds clips procedurally for any generated body (identity bind rotations with
world-aligned joint frames make the same joint curves valid for every body).

- **Walk and run** from keyframed gait curves shaped like human gait data (hip, knee, ankle, toe; pelvis turn, tilt
  and sway; torso counter-twist; arm swing opposite to the legs; elbows bending more on the forward swing).
- **Grounding by forward kinematics:** every frame, the hip height is set so the lowest sole point sits exactly on the
  floor (no sinking, no floating; the vertical bob falls out). Runs get a ballistic flight phase.
- **Ground speed:** measured from how fast the planted ankle moves during stance and stored in `extras.speed`, so the
  crowd moves the character at the speed its feet imply (no foot sliding).
- **Clothing-aware stride:** a skirt limits how far a thigh can swing, so skirted characters take shorter steps
  (A-line: walk 0.85, run 0.65; straight knee skirt: walk 0.78, run 0.5). Speeds are re-measured automatically.
- **Idle** (breathing and a small weight shift), **sit** (thighs horizontal, feet on the floor), **wave**.

## 10. Export and the bake contract

`public/core/glb.js` is a dependency-free glTF 2.0 binary writer: one mesh with one primitive per material, one skin,
21 joints, animations with linear rotation tracks and the hips translation, `extras` per clip. Triangles are grouped
by material in a fixed order; empty groups are left out. Every file is checked with the official Khronos validator
in `npm test`.

## 11. The parts kit (the Anatomy method)

[Anatomy](https://github.com/wheresryan22/anatomy) (MIT) explains ideas by building them as real machines in
isometric SVG. Its output does not apply to rigged characters, but its **method** does:

1. Break the object into many small, purposeful parts.
2. Build each from a handful of primitives.
3. Sit each part on another, with real measurements.
4. Prove it with an audit (nothing passes through anything).
5. Review close-ups like a critic.

We kept the method and replaced the renderer: our parts are mesh geometry in the skinned GLB.

**Primitives** (`public/core/kit.js`), each adding skinned triangles to the shared `MeshBuilder` and returning its
triangle count:

| Primitive | Use |
|---|---|
| `lathe(frame, profile, segs, w)` | Turned parts: buttons, buckles, heels, buns, earrings. |
| `tube(path, radii, segs, w, opts)` | Locks, straps, laces, cables (parallel-transport frames, flat cross-sections via `[rx, ry]`). |
| `loop(path, r, segs, w)` | Closed rims (glasses). |
| `prism(frame, polygon, depth, w)` | Flat outlines extruded: collar points, soles, badges (ear-clipping, concave outlines allowed). |
| `box`, `ball` | Watch faces, blocks, small round parts. |

**Body surfaces.** The builder registers its ring stacks (`surf.torso`, `.head`, `.arm[side]`, `.leg[side]`,
`.foot[side]`). `surface(rings)` gives `point(s, t)`, `normal(s, t)`, `weights(s, t)`, `sAtY(y)` and the whole
`ring(s)`. Parts are placed *from* these, so they sit on the body and inherit its skin weights; rigid parts get one
bone (`{ Head: 1 }` for glasses).

**Catalog** (`public/core/parts/`): `belt`, `soles`, `collar`, `buttons`, `hairLocks`, `fringe`, `glasses`, `watch`.
Each declares `about`, `defaults`, `cost` and a contract material, so the skill can list and budget them.

**Triangles are tagged** with the part that made them, which lets the audit check every part separately.

## 12. Character specs

A spec is plain JSON (`public/core/fromSpec.js`, format in `.claude/skills/character/references/spec.md`):
body type and build, height, detail level, hair, top, neckline, bottom, shorts length, shoes, tie, colours per
material, a list of parts and a triangle budget. Unknown keys, values and parts are rejected with the allowed lists, so
mistakes surface immediately. `buildFromSpec(spec, images?)` builds it (template proportions without images, measured
ones with) and returns the GLB, stats and a per-part budget table; over budget is a failure, not a warning.

Defaults are chosen so text-only specs look right: a crew neck unless stated (the demo drawing's deep neckline gave
shirts a V of bare skin), a scoop for tank tops, mid-thigh shorts.

## 13. The pose audit

`public/core/audit.js` proves the character moves without passing through itself, adapting Anatomy's `audit.mjs`
(signed-distance clearance between solids) to a skinned mesh.

**How it works**

1. Collect unique vertices with their weights, material, part tag and body region (torso, head, each arm and leg,
   skirt, hair, part).
2. Build **cores** from the bind pose, smaller than the visible surface (0.72x): elliptic torso slices every 2 % of
   height (in the frame of the nearest spine bone) and a capsule per limb segment (radius from that segment's own
   vertices).
3. For sampled frames of every clip (every 2nd frame), compute bone transforms by forward kinematics from the clip's
   channels and skin every vertex on the CPU.
4. Measure penetration of other regions' vertices into each core; a finding needs more than 1 cm (0.006 H) of depth
   **beyond what the same vertex already had in the bind pose**.

**Checks:** `arm-through-torso`, `arm-through-leg`, `leg-through-leg`, `leg-through-skirt`, `below-floor`,
`part-floating` (a part more than 3 cm from the body).

**Allowances, each justified by a traced finding:** contact that exists in the bind pose (the arm root is buried in
the shoulder by design) and the armpit (the top 30 % of the upper arm meeting the torso is joint compression, the
same contact Anatomy allows where parts meet flush).

**The skirt check** projects each covered leg vertex onto the plane of the skirt rings near its bind height (deformed
with the pose) and tests whether it lies inside the ring. An earlier version compared at equal heights, which fails
once the skirt turns horizontal (sitting), and one compared against the hem's inner lip ring; both were audit bugs and
were fixed in the audit, not hidden.

**The audit is itself tested** with adversarial poses it must catch: arms forced across the chest, a part pushed off
the body, a thigh forced 70 degrees forward in an A-line skirt.

**What it found** in the existing models (all verified on renders before fixing): thighs passing through the front of
an A-line skirt when seated and when walking, knees breaking the hem when running, and pencil-skirt pokes with
realistic template proportions. Fixes: skirt weight hand-over, front ease, minimum skirt sides, shorter strides.

## 14. The fidelity benchmark

`test/benchmark.js` (Playwright + headless Chromium; `npm run bench`) measures how faithfully the pipeline reads
images.

- **Suite A - synthetic ground truth (graded).** Six characters with known body type, hair, bottom and colours are
  rendered orthographically (front, side, back, flat lit) on plain backdrops. The renders are fed back in as user
  images and the recovered character is compared with the truth. Tolerances: styles must match; joint landmarks
  within 2 % of height; colours within 25 RGB; silhouette IoU >= 0.85 and mean width error <= 2-2.5 % of height per
  view; the model silhouette in one piece (no see-through seams). Truth characters use template proportions (realistic
  humans), not the cartoon demo drawing's.
- **Suite C - adversarial inputs.** Gradient backdrop, trousers the colour of the wall, a side view at the wrong
  scale, cropped feet, front only: the validator must flag each.
- **External references (report only).** The clean three-view woman, the turnaround sheet (as a sheet and split), a
  real walking photo. A mismatch on a view the validator flagged is attributed to the **input**, not the model.

**Stage attribution.** When an external reference mismatched, a per-height comparison of the reference mask, the
measured widths and the model's widths located the failing stage (segmentation, measurement or builder) before any
change. For the woman reference, the builder was at fault (leg spacing, shoulder clamp), not the inputs.

## 15. The Claude character skill

`.claude/skills/character/` packages the spec path as a Claude Code skill, structured like Anatomy's: `SKILL.md`
(when to use, workflow, contract, craft rules), `references/` (spec, parts, craft, verify), `scripts/character.mjs`
and `evals/evals.json`.

**Workflow:** read the input (image or description) → seed a draft spec from reference views if any
(`character.mjs seed`) → choose parts by what reads at crowd distance within the budget (`character.mjs catalog`) →
build (`character.mjs build`) → read `report.txt` (validator, budget, pose audit, silhouette IoU vs the reference,
input checks) → review `sheet.png` tile by tile → iterate → hand over the GLB, sheet and notes.

**The review sheet** (`test/lib/studio.js`) puts the reference views next to the model (front, side, back), then
close-ups (face, face 3/4, chest/collar, hand, feet), then motion frames (walk, walk, run, sit, wave). It exists
because the most useful bugs were found by looking: the knee-length shorts on the reference woman (an explicit style
overriding the measured length), men's short hair framed like a bob, "claw" hair locks, invisible white-on-white
soles.

**Division of labour:** Claude supplies judgement (what this person is, which parts make them recognisable); the
tools supply geometry, rigging, animation and proofs. Nothing in the tool calls a model or a service.

## 16. Quality gates and process

| Command | What it proves |
|---|---|
| `npm test` | All detail levels, body types, hair and clothing styles, every example spec and every catalog part build; Khronos validator; skin weights sum to 1; joint indices valid; bake contract (materials, primitives, clips, speed); scale and facing; triangle budget; pose audit on every style and spec; the audit catches adversarial poses. |
| `npm run bench` | Suite A within tolerance, suite C flagged, external references reported with input attribution. |
| `npm run test:e2e` | The real UI in Chromium: uploads, sheet split, checklist, generation, export. |
| `node tools/build-specs.mjs` | Every example spec: validator, budget, pose audit. |

**Process rules** followed throughout:

- Commit and push only when every suite passes and every example GLB validates.
- A finding is traced to a root cause (measurement, builder, animation, audit, or input) before anything changes,
  usually on a render of the exact failing frame.
- Never loosen a tolerance or move a part away to make a check pass. When a check itself was wrong (the skirt check
  at equal heights, the hem lip ring), the check was fixed and an adversarial test added to prove it still catches the
  real failure.
- Calibrate thresholds on data (clean vs problem inputs), and write the calibration next to the constant.

## 17. Lessons learned

| Symptom | Root cause | Fix |
|---|---|---|
| Good model looked wrong in comparisons | Orthographic frustum relative to the camera at y = 0.85 cropped it | Camera at y = 0 |
| Legs cut off on some inputs | Floor-shadow rule applied too high | Bottom 12 % only |
| Shorts and children read as skirts | Skirt detected from a late leg gap alone | Hem width-step test (< 0.94) |
| Crotch found at the knees | Touching knees close the gap | Bridge short closures |
| Women's arm tips at the crotch | Search included the body core | Exclude the core span |
| Arm angle +6 degrees | Tip-to-shoulder line | Fitted centre line |
| See-through arm-torso seams | Template shoulder joint outside the built torso | Anchor the joint to the torso |
| Floating nose in profile | Wedge base on the surface | Sink the base |
| Hair counted twice in head width | Photo head width includes hair | Divide by hair thickness |
| Landmarks shifted on big-headed figures | Photo fractions include hair, builder fractions don't | Two-pass build in build space |
| Neck found on the chin or the plateau top | Template neck as wide as the jaw; first-minimum rule | Anatomical neck cap; plateau middle; same rule on both sides |
| A bob classified as a child | Hidden neck pushed the measured neck down | Visible-neck test; clearly-female rule |
| Shirts with a V of skin | Demo drawing's deep neckline in text specs | Explicit `neckline`, crew by default |
| Knee-length shorts on a short-shorts reference | Explicit style overrode the measured length | Measured length wins with a reference |
| Thighs through skirts in sit/walk/run | Linear skinning follows the average thigh | Weight hand-over, ease, 10+ sides, shorter stride |
| Skirt audit false alarms when seated | Compared at equal heights | Ring-plane projection |

## 18. Limits and roadmap

**Limits today**

- Faces are simple (no mouth, single-colour eyes); hands are mittens with a thumb.
- The fringe part reads well at crowd distance but is clumsy close up.
- The skill needs Claude Code; the offline browser app is measurement-only.
- Loose clothing beyond skirts (coats, capes, gowns) is not modelled; jackets, hoodies and hats are not yet parts.
- Measurement is tuned for clean renders; photos work within the validator's warnings, with looser tolerances.

**Roadmap**

- **K4 - wider catalog** as characters need them: jacket panels and lapels, hoodie, cap/hat, bag and strap, backpack,
  beard, bun, braid, laces, finger blocks.
- **M2 - landmark confidence and source** in the spec and reports (measured vs inferred, cross-view agreement).
- **Appearance module** split out of `measure.js`, with landmark-constrained clothing boundaries.

## 19. Extending the tool

**A new part:** add it to a file in `public/core/parts/` with `about`, `defaults`, `cost` and `build(ctx, params)`.
Build from the kit primitives, place it from a body surface, choose a contract material, and give it weights from
the surface (or one bone if rigid). `npm test` builds every catalog part alone, validates it and audits it; add it to
`.claude/skills/character/references/parts.md`.

**A new clothing or hair style:** add the option to `builder.js` (and `fromSpec.js` `KEYS`), keep it under the
budget, add it to the self-test style list, and run the pose audit; if it changes how the body moves (like skirts),
adjust the animation and let the audit prove it.

**A new audit check:** add it to `audit.js`, calibrate on renders of the exact frames it flags, and add an adversarial
case to `test/selftest.js` that it must catch.

**A new measurement rule:** add a ground-truth case to `test/benchmark.js` that exercises it, make the benchmark pass
without loosening tolerances, and check the external references still report as before.

## 20. File map

| Path | Role |
|---|---|
| `public/core/silhouette.js` | Backdrop model, flood fill, components, turnaround split |
| `public/core/measure.js` | Landmarks, widths, depths, look (colours, clothing extents, styles) |
| `public/core/validate.js` | Input checks |
| `public/core/template.js` | Body templates (generated) |
| `public/core/mesh.js` | Vector helpers, ring helpers, `MeshBuilder` |
| `public/core/builder.js` | Skeleton, lofted body, clothing, hair, face, feet, materials |
| `public/core/kit.js` | Part primitives and body surfaces |
| `public/core/parts/` | Parts catalog |
| `public/core/fromSpec.js` | Character spec -> GLB with budget |
| `public/core/animation.js` | Clips (gait curves, FK grounding, speeds) |
| `public/core/audit.js` | Pose audit |
| `public/core/glb.js` | GLB writer |
| `public/core/pipeline.js` | Images -> validated, measured, built, animated GLB |
| `public/app.js`, `index.html` | Browser app |
| `test/selftest.js` | Node test suite (`npm test`) |
| `test/benchmark.js`, `test/lib/bench.js`, `test/lib/views.js` | Fidelity benchmark |
| `test/e2e.js` | UI test |
| `test/lib/studio.js` | Skill's browser side: seed, build, compare, review sheet |
| `test/fixtures/` | Reference views, turnaround sheet, photo |
| `tools/extract-template.mjs` | Template extraction from reference figures |
| `tools/make-examples.mjs`, `tools/build-specs.mjs` | Example GLBs |
| `.claude/skills/character/` | The Claude character skill |
| `examples/`, `examples/specs/` | Example GLBs and specs |
| `docs/INPUT_GUIDE.md` | How to shoot or render reference views |
