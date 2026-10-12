# Craft: what makes a low-poly crowd character read as a real person

A crowd character is seen small, moving, among many others, usually from above eye level. It reads in this order:

1. **Silhouette and proportions**: body type (shoulders vs hips, bust, head size), height, the outline of the hair and
   of the clothes (skirt flare, shorts vs trousers, heels).
2. **Colour blocks**: skin, hair, top, bottom, shoes, and one or two accents.
3. **Motion**: a believable walk with grounded feet; a skirt that moves with the legs.
4. **Parts**: the few details that turn "woman in white and grey" into "woman in a white tank, belted grey shorts,
   white sneakers, hair forward over her shoulders".
5. **Close-up detail**: buttons, watch, glasses - only for characters seen near the camera.

Spend effort and triangles in that order.

## Proportions

- With clean reference views, trust the measured body (seed + build with `--ref`). Check the overlays: front/back IoU
  ~0.85+ means the outline matches.
- Without a reference, the templates give realistic adult male, adult female and child proportions; use `build` for
  slim / broad people rather than inventing numbers.
- Don't make a woman by colours alone: `body: female` gives the narrower waist, fuller hips, bust, slimmer neck and
  shoulders; `male` the broader chest and shoulders.

## Part priorities by archetype

| Archetype | Body options | Parts that make it (in order) |
|---|---|---|
| Office man | `tshirt` (shirt) + `trousers`, `tie` optional, `crew` | `collar`, `belt` (Accent dark leather, Trim buckle), `buttons` (3-4), `glasses` if part of the look, `watch` |
| Casual woman, summer | `tank` + `shorts`, `long` hair | `hairLocks`, `belt` (thin), `soles` (white), `fringe` |
| Woman, smart | `tshirt` or `tank` + `pencil`, `heels` | `hairLocks` or `fringe`, `belt` at the waist if visible |
| Student / teen | `tshirt` + `trousers` (jeans colour) | `soles` (white sneakers), `belt`, `fringe` |
| Older man | `tshirt` + `trousers`, `short` or `bald` | `glasses`, `collar`, `buttons`, `belt` |
| Child | `body: child`, simple clothes | `soles` (bright), at most one more part; keep it light |

## Colour

- Sample colours from the reference's lit (not shadowed) areas; seed does this for clean views.
- Keep skin, hair and clothes clearly apart in value, so the crowd's per-person recolouring keeps them readable.
- Accent: one colour shared by belt, tie and collar trim (dark leather brown, black, a strong red). Trim: one colour
  for soles, buttons, buckle and frames (white, cream, silver, black).

## Hair

- The hair style sets the shell (short, bob, long, ponytail, bald). Long hair in references often falls *forward*
  over the shoulders: add `hairLocks`, otherwise the front looks bald below the ears.
- A fringe breaks the helmet look of a shell: `fringe` with 1-3 locks, swept to one side.
- Men's short hair stops at the temples; a bob and long hair frame the face to the jaw.

## Clothes

- Tank tops get straps over bare shoulders and a scoop; shirts get a collar band, add `collar` points and `buttons`.
- Shorts end above the knee; A-line skirts flare from the waist; straight knee skirts are narrow to just above the
  knee. Both skirts shorten the stride automatically (the audit proves the legs stay inside).
- A belt shows only where the top ends above the waistband (tucked shirts, short tops); for a long untucked top, skip
  it.

## Anti-patterns (seen in review)

- A part in the same colour as what it sits on (invisible, wasted triangles).
- Glasses on a character that will only be seen at crowd distance (144 triangles for two dark dots).
- A deep V of skin on a shirt (set `neckline: crew` unless the reference shows an open neck).
- Long hair with no locks: the hair shell alone reads as a helmet from the front.
- Hand-placing a part off the body to silence the audit. Fix the part or drop it.
