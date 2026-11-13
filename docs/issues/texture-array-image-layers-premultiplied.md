**Title:** An uncompressed texture array's layers go through a 2D canvas, which rounds the colour where the alpha is under 1

Status: open | for a texture array follow-up (`_DONE_p299_texture-arrays-and-atlases.md`'s code)
Category: Assets, Rendering, Bug
Found: 2026-11-13, p303 Phase 3 section 3 (the `textureSets` scene's PNG set array against its sets: up to 2 / 255 apart on 27-58 % of the pixels, on WebGPU and WebGL2; the KTX2 array matches exactly)
Our workaround: none needed yet. A shipped texture is KTX2 (`yarn assets`), so a shipped array is a `CompressedArrayTexture`, built from the members' blocks as they are; only a member without an output (a source image in development, "Load source files", an `optimize: false` texture) takes this path

## What happens

`buildTextureArray` (`src/_engine/kernel/assets/TextureArray.ts`) makes a `DataArrayTexture` from image members by drawing each one into an `OffscreenCanvas` 2D context and reading it back with `getImageData` (`drawLayer`). A 2D canvas stores its pixels premultiplied by the alpha, so the read-back colour is the drawn colour × alpha, rounded to 8 bits, ÷ alpha: off by up to one step wherever the alpha is under 1, more the lower the alpha. The alpha itself comes back exact.

For a colour texture with an opaque alpha nothing changes. A packed texture whose alpha is data does: a texture set's `LITE` `albedoRough` (roughness in A, 0.45-0.95 in the test set) and every `albedoHeight` (height in A, down to 0, where the colour can go entirely: the reason the scene's mortar has height 0). Measured on `p303TestSet_albedoRough`: drawing its decoded bitmap into a 2D canvas as `drawLayer` does changes the RGB of 41,899 of 65,536 texels by one step (alpha exact). Rendered through the `{ textureSetArray }` input against the same textures through `{ textureSet }`: at most 2 / 255 apart, on 27 % (bricks, roughness 0.7-0.95) to 58 % (cobbles, from 0.45) of the pixels.

## A way out

- Get a member's pixels for the array without a 2D canvas. The assets worker already decodes the bitmap unpremultiplied (`AssetsSwitchTexture.ts`, `premultiplyAlpha: 'none'`), but its pixels can only be read through a canvas, which has the same problem in the worker. So either decode the image to bytes some other way (not checked: which browser API keeps them straight), or assemble the array on the GPU from the members' uploaded textures (`copyTextureToTexture`, which p299's Phase 0 timed against concatenation for KTX2).
- A test then: an image member with an alpha under 1 survives into its layer byte for byte (the scene's PNG comparison goes to 0 too).
