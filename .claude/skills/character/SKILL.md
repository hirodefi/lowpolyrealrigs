---
name: character
description: Build a realistic, rigged, animated low-poly character (GLB) for a crowd from any character image or description - a photo, a render, a turnaround sheet, concept art or a few words ("a woman in a tank top, knee skirt and heels, long dark hair"). Writes a character spec (body type, clothing styles, colours and a list of real parts such as belts, soles, collars, buttons, hair locks, glasses), builds it with this repository's parts kit, proves it with the pose audit (nothing passes through anything in walk, run, sit and wave), compares it with the reference and reviews a contact sheet before handing over the GLB. Use it whenever someone wants a character, person, NPC, crowd member, avatar or "low poly person" made from a picture or a description, even if they don't say "spec" or "GLB".
license: MIT
compatibility: Claude Code in the lowpolyrealrigs repository. Needs Node.js 20+, npm install done, and Chromium via Playwright for builds with reference images and for the review sheet.
---

# Character

This skill makes one crowd character the way a craftsman builds a small machine: a correct human body first, then the
real parts that make it read as a particular person - the sole of a sneaker, a belt and buckle, collar points and
buttons, locks of hair falling forward, glasses, a watch - each sitting on the body, each with a purpose. The method
comes from Anatomy (github.com/wheresryan22/anatomy, MIT): many small purposeful parts made from a few primitives,
then proved, then reviewed close up. Here the result is a rigged, animated GLB for a crowd, not a drawing.

You (Claude) supply the judgement: you read the image or description and write the spec. The kit builds, rigs,
animates, audits and renders. Nothing in the tool uses ML or external services.

## The one idea that matters

**A person reads by their parts, not by colours on a mannequin.** A white shirt is a collar band, two collar points,
a button line and a hem lip; a sneaker is an upper on a pale sole; long hair is a shell plus locks that fall forward
over the shoulders. Pick the few parts that make *this* character recognisable at crowd distance, then let the
silhouette and proportions (from the reference when there is one) do the rest.

Two ways this fails:

- **Mannequin.** Right body, right colours, no parts: every character looks like the same doll in different paint.
- **Clutter.** Many tiny parts nobody will see at crowd distance, blowing the triangle budget. A crowd character has
  roughly 2,700 triangles; spend them on what changes the silhouette or the first impression.

## Workflow

Work in this order. All commands run from the repository root.

1. **Read the input.** For an image, look at it carefully (open it with the Read tool) and note: body type and build,
   hair style and length, top (sleeves, neckline, collar), bottom (trousers, shorts, A-line or straight knee skirt),
   shoes (flat, heels, sneakers with pale soles), colours, and accessories. For a description, pin down the same list
   and ask only if something essential is missing.
2. **Seed from the reference (when there is one).** Three clean views (front, side, back) or a turnaround sheet give
   measured proportions and colours:
   `node .claude/skills/character/scripts/character.mjs seed --ref <dir> --out out/characters/<name>.json`
   (or `--sheet <file>`, or `--front <file>` alone). Read the input checks it prints: a warning names a view whose
   measurement you should not trust. A single photo or concept art seeds less reliably than clean views, so check its
   numbers against what you see. Without an image, write the spec by hand
   (`references/spec.md`, examples in `examples/specs/`).
   **Then measure the reference yourself** - this is what makes a character match its reference
   (`references/spec.md`, "Manual measurements"). Run
   `node .claude/skills/character/scripts/character.mjs spans --ref <dir> --view front` (and `--view side`,
   `--view back`), read the rows, decide what each span is (torso or arm, skin or hair, top or shorts), and write the
   `measurements` block: landmarks, torso widths and depths, legs, head and face (eye spacing!), arms, clothing edges.
   Write down any estimate you had to make (e.g. the skull under the hair) in `measurements.notes`.
3. **Write the parts list.** Run `node .claude/skills/character/scripts/character.mjs catalog` for the parts, their
   parameters and their triangle cost. Choose parts by what reads at crowd distance first (`references/craft.md`), set
   colours for every material you use, and keep a budget line in mind: body ~2,050 (low detail) to ~2,550 (medium), so
   parts get ~150-650 triangles.
4. **Build:**
   `node .claude/skills/character/scripts/character.mjs build out/characters/<name>.json [--ref <dir>]`
   It writes `out/characters/<name>/model.glb`, `sheet.png` (review sheet), `overlay_<view>.png` (with a reference)
   and `report.txt`, and fails on an invalid spec, an over-budget build, a Khronos validator error or a failed pose
   audit.
5. **Verify like a critic** (`references/verify.md`). Read `report.txt`, then open `sheet.png` and look at every tile:
   the reference next to the model, the face, chest, hand and feet close-ups and the walk, run, sit and wave frames.
   Ask: is it instantly this person? Does every part sit on the body (no floating, no sinking), read clearly, and move
   with the body? With a reference, the front and back silhouette IoU should be at least ~0.85 for clean views; a lower
   score on a view the input checks flagged is an input problem, not a modelling one.
6. **Iterate**: adjust the spec (styles, colours, part parameters, parts added or dropped for budget) and rebuild until
   the sheet is right and the audit passes. Never quiet the audit by moving a part off the body or deleting motion:
   fix the geometry or the choice of parts.
7. **Hand over** the GLB path, the sheet and a short note: what the character is made of, the triangle total, and
   anything you could not match (and why).

## Bake contract (must hold for every character)

- One skinned mesh, 21-bone humanoid skeleton (`Hips > Spine > Chest > Neck > Head`, arms, legs, toes), facing +Z,
  1.7 m tall by default, feet on y = 0.
- Flat materials, one primitive each, no textures: `Skin`, `Hair`, `Top`, `Bottom`, `Shoes` (the crowd recolours these
  per person) plus `Accent`, `Trim` and `Eyes` (kept as fixed colours). Parts may only use these eight.
- Clips `idle`, `walk`, `run`, `sit`, `wave`; walk and run carry their ground speed in `extras.speed`.
- About 1,900-2,700 triangles; the spec's `budget` (default 2,700) is enforced.

## Craft rules (short form)

`references/craft.md` gives the reasoning.

- **Body first, then parts.** Get body type, build, hair style and clothing styles right before adding a single part.
- **Silhouette parts beat surface parts.** Hair locks, a skirt's flare, heels, a ponytail change the outline and read
  from far away; buttons and a watch only read close up. Spend triangles in that order.
- **Contrast makes a part exist.** A belt in the trouser colour is invisible; soles in the shoe colour are invisible.
  Give a part a material whose colour differs from what it sits on (Accent / Trim), or leave it out.
- **One idea per material.** Accent is one colour (belt, tie, collar trim) and Trim is one colour (soles, buttons,
  buckle, glasses). Choose parts that can share them.
- **Parts sit on the body.** Every part is placed from the body's own surface; the audit fails a part that floats more
  than 3 cm off it.
- **Motion is part of the character.** Skirts shorten the stride automatically; the audit proves legs stay inside
  skirts, arms out of the torso and knees apart in every clip.
- **Measure, don't guess.** With a reference, the body, the face (eye spacing, jaw, eye height) and the clothing edges
  come from your measurements. Most "it looks odd" problems were wrong proportions: a waist the template could not
  narrow, close-set eyes, a face made narrow by measuring the visible V instead of the jaw.
- **Never copy a reference image's details literally;** take its type, proportions, colours and the parts that make it
  recognisable.

## References

- `references/spec.md`: the character spec format, every key, landmarks, colours and the manual `measurements` block.
- `references/parts.md`: the parts catalog with parameters, materials, costs and when to use each part.
- `references/craft.md`: what makes a low-poly crowd character read as a real person; part priorities by archetype.
- `references/verify.md`: the report, the review sheet checklist, the audit checks and what to do when one fails.
- `evals/evals.json`: test prompts with the traits a good result must have.

## Extending the kit

New parts go in `public/core/parts/` (see how `belt`, `soles` and `hairLocks` use the kit primitives in
`public/core/kit.js`: `lathe`, `tube`, `loop`, `prism`, `box`, `ball`, and the body surfaces `ctx.surf.torso`,
`.head`, `.arm[side]`, `.leg[side]`, `.foot[side]`). Each part declares `about`, `defaults` and `cost`, picks a
contract material, and gets skin weights from the surface it sits on (or one bone for rigid parts). Add it to the
self-test (`npm test` builds every catalog part alone) and run the pose audit.
