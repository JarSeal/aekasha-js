Status: draft | not-implemented
Category: Text, Rendering
Epic: p390_text-rendering-and-text-decals.md
Blocked by: p392_text-feature-msdf-renderer.md
Blocks: p394_labels-screen-text-and-debug-text.md
Related: `src/_engine/features/lines/CLAUDE.md` (`LinePulse.ts`: one time uniform for every pulse), p397_text-decals.md (reuses the outline and the field reads)

# Text Effects — Plan

Outline, glow, drop shadow, softness / blur, colour pulse and a gradient fill for p392's texts, and
the fade in / out when a text is added or removed. Each effect is a part of the graph built only
when a text asks for it (the epic's D4); its values are per text in the text table, so texts
sharing an effect set share a draw, and an effect no text uses costs nothing.

## Design

### D1. The options

```ts
createText({
  text: 'BOSS', font: 'plexSans', size: 0.8,
  effects: {
    outline: { width: 0.15, color: '#000000' },              // width: fraction of pxRange reach
    glow: { radius: 0.6, color: '#ff8800', intensity: 1.5 }, // reads the alpha SDF
    shadow: { offset: [0.04, -0.04], softness: 0.4, color: '#000000aa' },
    softness: 0.2,                                           // a blur of the fill's edge
    pulse: { color: '#ffffff', period: 1.2, mix: 0.6 },      // colour ↔ pulse colour
    gradient: { top: '#ffffff', bottom: '#88aaff' },
  },
  fadeIn: 300,                                               // ms
});
text.setEffect('glow', { intensity: 2 });  // a value: a row write
text.setEffect('glow', null);              // a set change: the text moves to another batch
removeText(text, { fade: 250 });           // deleted when the fade ends
```

- Widths, radii and offsets are in em (relative to the font size), so an effect scales with the
  text in both sizings.
- **Reach:** every distance is bounded by the atlas' `pxRange` (the epic's explainer). The setter
  clamps to the reach and warns once in debug, naming the font's `pxRange` and the larger range a
  wider effect needs.

### D2. The graph parts (`TextEffects.ts`)

In draw order inside one fragment, each a TSL function the variant adds:

- **Shadow:** a second atlas sample at the UV offset by `offset` (in atlas UV through the glyph's
  plane-to-atlas scale), the alpha SDF through `smoothstep` with `softness`; composited under the
  fill. The quad is grown by the max offset + softness (a vertex-stage margin, also a variant bit)
  so the shadow isn't cut at the glyph's box.
- **Glow:** the alpha SDF from the edge outwards over `radius`, an exponential falloff ×
  `intensity`, additive under the fill (with `BLEND`) or over it (an option). Same quad margin.
- **Outline:** the median's band between `0.5 − width` and `0.5`, its own colour; sharp (the
  median, not alpha) for widths within MSDF's clean range, the alpha beyond it.
- **Softness:** the coverage's ramp widened from one screen pixel to `softness` em: a blur of the
  edge, not of the image.
- **Pulse:** the colour mixed with the pulse colour by `0.5 + 0.5 sin(2π t / period)`, `t` the
  feature's one time uniform (as `LinePulse.ts`), a per-text phase in the table.
- **Gradient:** the fill colour by the glyph quad's vertical position in the text's box (the
  layout writes the box-relative y per glyph).

A text with any of shadow, glow, softness or fade is drawn `BLEND`; `AUTO` picks it.

### D3. Fades

`fadeIn` and `removeText({ fade })` animate the row's opacity on the CPU in the feature's system
(a list of fading texts, nothing per frame when it's empty). A fade isn't a variant: the text
stays in its batch. A removed text is deleted after its fade (its entity too), so a caller
re-checks its handle after it (`text.isDisposed`); scene exit deletes without fading. The fade's
curve is ease-out; `getMotionFactor() === 0` (the kit's reduced motion) makes fades instant.

### D4. The table and the variants

The text table grows from 4 texels a row to 4 + one per effect group in the batch's variant (so a
batch without effects keeps its 4). The variant key gains the effect bits. A text changing its
effect set moves to the batch with the new key: its range freed in one, written in the other.

## Phases

### Phase 1: Outline, softness, pulse and gradient

The median-only effects and the time uniform; the table's extra rows; tests on the variant keys
and the row layout; `textShowcase`'s effects station with each effect alone and all together.

### Phase 2: Shadow and glow

The alpha reads, the quad margin, the reach clamp and warning; the station's soft effects at near
and far, in both sizings.

### Phase 3: Fades

D3, the `isDisposed` flag, reduced motion; a station spawning and removing texts on a timer.

### Phase 4: Measure

Each effect's GPU cost against the fill alone on 1,000 texts (WebGPU, WebGL2), and the cost of a
batch with every effect; the table here and in the handbook. Expectation to check: the alpha-based
effects cost one extra sample each (shadow), the rest arithmetic.

### Phase 5: The Hub and the docs

The Text page's Effects section with a live example (the showcase's region), the reach table;
`features/text/CLAUDE.md`'s Effects section and its `aek:covers`.

### Phase 6: Versions and done

On the `p390-text` branch's bump. `CHANGELOG.md`; mark the plan done.

## Verification

`yarn test`; `yarn verify:scenes --only textShowcase` with the effects station in the baseline;
Phase 4's figures; a text with no effects draws the same graph as before this plan (its variant
key unchanged).

## Non-goals

A blur wider than the field's reach (PostFX's job), animated per-glyph effects (typewriter,
wave: a follow-up with a per-glyph attribute), textures inside the fill.
