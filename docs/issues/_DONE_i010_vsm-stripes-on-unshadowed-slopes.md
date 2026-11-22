**Title:** The VSM shadow map draws stripes on a sloped receiver that nothing shadows

Status: fixed | 2026-11-20, a VSM floor on the shadow presets' depth bias (`VSM_PRESET_BIAS`)
Category: Rendering, Lights, Sky box
Found: 2026-11-13, p303 Phase 5 section 2 (the `terrainGallery` scene)
Our workaround: `terrainGallery`'s meshes neither cast nor receive shadows (`NO_SHADOWS`); kept after the fix as the gallery's measurement condition (p310: the handbook's GPU tables are measured without shadows)

## What happens

The engine's renderer uses three's `VSMShadowMap` (`renderer.shadowMap.type` 3). In the
`terrainGallery` scene (the DAY_NIGHT sky box at 10:00, its sun light the one shadow caster, the
`MEDIUM` preset: bias −0.0002, normal bias 0.04, 1024², the frustum following the camera), each
generated block's 35° ramp shows dark stripes running down the slope, about a grid cell apart, on
every texture set. The flat part of a block shows none.

Measured on WebGPU (Chrome, Apple GPU), one close-up of `grass01`'s ramp per change:

- **The block not casting** (`castShadow: false`): the stripes stay. This read as "not
  self-shadowing", but it isn't: under VSM three draws every mesh that receives shadows into the
  map whatever its `castShadow` (r187's `ShadowBaseNode.js`, `object.castShadow === true ||
  (object.receiveShadow && shadowType === VSMShadowMap)`), so the ramp was still in it.
- **The material rebuilt** (`needsUpdate`): the stripes stay.
- **The block not receiving**, or **the sun light not casting**: no stripes (the ramp isn't in
  the map, or there's no map).
- **The renderer on `PCFSoftShadowMap`**: no stripes (PCF draws the back faces, which the sun
  doesn't see on a heightfield).

## Cause

Self-shadowing, through the precision of three's VSM blur:

- The sky light stands `distance` (100 m) from the camera along the sun, its depth range 0.5 to
  `2 × distance`, so the camera lands at depth 0.5 and all the ground under it at 0.5..1.
- VSM's two blur passes write the depth's mean into half-float targets (`HalfFloatType`, hard-coded
  in r187's `ShadowNode.js`). At 0.5..1 a half float's step is 2⁻¹¹ ≈ 0.00049 (9.7 cm at the sky
  light's 199.5 m range), and the two passes round the mean by up to about that step.
- The margin was smaller: the bias −0.0002 plus the normal bias's share (0.04 × cos θ) ≈ 7.5 cm.
  The rounding error rises and falls with depth, so the dark bands follow lines of equal depth:
  on the ramp at 10:00 those run down the slope, every 2⁻¹¹ × 199.5 m / 0.496 ≈ 0.20 m.
- On a surface facing the light the depth hardly changes inside the blur, so its variance sits at
  the filter's floor (1e-7) and a few centimetres of error darken it. The flat ground at 10:00 and
  the ramp under a low sun spread more depth inside the blur, so their variance absorbs it.

The near plane doesn't clip the ramp (every receiver measured at depth 0.49..0.56).

## Measured (2026-11-20, WebGPU: Windows Chrome 157, AMD RDNA 3)

`grass01`'s ramp seen square on, shadows switched on in the page, each shot divided by the same
view without shadows (1.000 is a correct shadow on an unoccluded ramp):

| Variation | Ramp depth | Result |
|---|---|---|
| default (`MEDIUM`, far 200) | 0.516 | stripes: darkest column 0.946, period 0.19..0.24 m |
| far 210 / far 300 (same geometry, finer precision) | 0.492 / 0.344 | none |
| no blur (1 sample) | 0.516 | none |
| bias −0.0003 | 0.516 | faint (0.992) |
| bias −0.0004 / −0.0005 / normal bias 0.2 | 0.516 | none |
| camera at 15 m | 0.559 | stripes (0.978) |
| 14:00 (the sun mirrored in x) | 0.516 | stripes (0.940) |
| 08:00 (low sun, the ramp at 59° to it) | 0.509 | almost none (0.999) |

The far plane rows decide it: the geometry and its creases stay, only the depth's precision
changes, and the stripes go.

## The fix

`createLightEntity` and the sky lights take a preset's bias through `getShadowPresetBias`
(`kernel/light/Light.ts`): under `VSMShadowMap` at most `VSM_PRESET_BIAS` (−0.0005, one half-float
step at 0.5..1), else the preset's own. The error is a fixed amount of depth, so one floor covers
every frustum size and light distance. `MEDIUM` (−0.0002), `HIGH` (−0.0001) and `ULTRA` (−0.00005)
take −0.0005 under VSM, `LOW` had it; a light's own `shadowBias` isn't limited. Read when a light
is made (switching the shadow map type reloads the page). `Light.test.ts` covers it.

Checked on the same machine: the ramp at 1.000 with the default bias; the cliff wall's contact
shadow at 14:00 the same at −0.0002 and −0.0005 (the only pixels that changed were stripes on
another sun-facing ramp); `largeWorld` (its sun on `HIGH`) changes no more than two shots at the
same settings.
