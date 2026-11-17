// The terrain material's colour map (p305 D7): a texture at the mesh's UV, a block's own colour
// (painted paths, burn marks, large-scale AO baked in), sampled once. With `DETAIL` it gives the
// albedo and the layers only their detail: each one's albedo's luminance over its set's average
// colour's (about 1 on average, so the colour map's colour comes through), blended by weight, faded
// to 1 (the colour map alone) over `detailDistance`. Grey, not per channel: a dark channel of the
// average (grass's blue) made a per-channel ratio swing, pink speckles wherever the colour map has
// that channel (p305 Phase 7, measured in the gallery). Its normal and roughness stay the layers'.
import { float, luminance, mix, smoothstep, uv, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';

/** The floor of an average colour's luminance a detail divides by: a black set stays finite */
const MIN_AVERAGE = 0.01;

/**
 * The colour map sampled once at the mesh's UV (block-local, as the splat maps)
 * @internal
 * @param colorMap the material's `colorMap` input, a texture node (sRGB: sampled linear)
 */
export const sampleColorMap = (colorMap: TextureNode) =>
  colorMap.sample(uv() as unknown as Node<'vec2'>).rgb as unknown as Node<'vec3'>;

/**
 * A layer's detail, grey: its albedo's luminance (as sampled, without tints: the colour map carries
 * the colour) over its set's average colour's, about 1 on average
 * @internal
 * @param albedo the layer's sampled albedo, linear
 * @param averageColor its set's average colour, linear
 */
export const getLayerDetail = (albedo: Node<'vec3'>, averageColor: Node<'vec3'>) => {
  const average = (luminance(averageColor) as unknown as Node<'float'>).max(float(MIN_AVERAGE));
  return vec3(
    (luminance(albedo) as unknown as Node<'float'>).div(average)
  ) as unknown as Node<'vec3'>;
};

/**
 * The albedo of a `DETAIL` colour map: the colour map × the layers' blended detail, the detail
 * faded to 1 over `detailDistance` when it has one
 * @internal
 * @param colorMap the colour map's sample
 * @param detail the layers' details blended by weight
 * @param fade the detail's fade, view distances in metres (`x` from, `y` to), and the view
 * distance; null for none
 */
export const applyColorMapDetail = (
  colorMap: Node<'vec3'>,
  detail: Node<'vec3'>,
  fade: { range: Node<'vec2'>; viewDistance: Node<'float'> } | null
): Node<'vec3'> => {
  const faded = fade
    ? (mix(
        detail,
        vec3(1),
        smoothstep(fade.range.x, fade.range.y, fade.viewDistance)
      ) as Node<'vec3'>)
    : detail;
  return colorMap.mul(faded) as Node<'vec3'>;
};
