**Title:** The VSM shadow map draws stripes on a sloped receiver that nothing shadows

Status: open | measured, cause not found
Category: Rendering, Lights, Sky box
Found: 2026-11-13, p303 Phase 5 section 2 (the `terrainGallery` scene)
Our workaround: `terrainGallery`'s blocks and walls neither cast nor receive shadows

## What happens

The engine's renderer uses three's `VSMShadowMap` (`renderer.shadowMap.type` 3). In the
`terrainGallery` scene (the DAY_NIGHT sky box at 10:00, its sun light the one shadow caster, the
`MEDIUM` preset: bias −0.0002, normal bias 0.04, 1024², the frustum following the camera), each
generated block's 35° ramp shows dark stripes running down the slope, about a grid cell apart, on
every texture set. The flat part of a block shows none.

Measured on WebGPU (Chrome, Apple GPU), one close-up of `grass01`'s ramp per change:

- **The block not casting** (`castShadow: false`, so the only casters are two walls elsewhere and
  nothing stands between the sun and the ramp): the stripes stay. So it's not self-shadowing acne.
- **The material rebuilt** (`needsUpdate`): the stripes stay.
- **The block not receiving**, or **the sun light not casting**: no stripes.
- **The renderer on `PCFSoftShadowMap`** (shadow maps disposed, materials rebuilt): no stripes.

So VSM darkens a lit, unoccluded receiver on a slope facing the sun. The normal map isn't
involved (the stripes follow the mesh's grid, not the texture), nor `textureSetSurface`'s tangent
frame.

## Where to look

- VSM's moments over a texel with no caster (the clear value, and the blur pass at the frustum's
  edges) against the receiver's depth with the preset's normal bias: on a slope the normal offset
  moves the lookup across texels, which a cleared but blurred map may not hold as "far".
- Whether the shadow frustum's near plane clips the ramp's top (the frustum follows the camera,
  `shadowFollow: 'ACTIVE_CAMERA'`).
- Any other scene with sloped receivers under a sky sun light (largeWorld's terrain) to see whether
  it shows there too.

When it's fixed, `terrainGallery.ts` turns its blocks' and walls' shadows back on.
