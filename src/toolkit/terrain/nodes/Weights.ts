// The terrain material's layer weights from a painted source (p305 D4): the mesh's vertex colour
// (`COLOR_0`) or one or two RGBA splat maps at the mesh's UV, a channel per layer past the base,
// and the base (layer 0) taking what the channels leave. The weights are raw: the height blend or
// the linear normalization (`HeightBlend.ts`) makes them sum to 1.
import { float, max, uv, vertexColor } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';

/** The vertex colour's channel layouts (p301 §4.4) */
export type VertexColorLayout = 'RGB_AO' | 'RGBA';

/**
 * Painted weights, one per layer from the base, the vertex colour's baked AO when it has one, and
 * the first splat map's A
 */
export type PaintedWeights = {
  weights: Node<'float'>[];
  /** `RGB_AO`'s A, 0..1; null for `RGBA` and splat maps */
  vertexAo: Node<'float'> | null;
  /**
   * The first splat map's A (a layer's weight, or with at most 4 painted layers free: p307's
   * regional wetness); null for the vertex colour
   */
  splatAlpha: Node<'float'> | null;
};

/** The channels' layers with the base in front: `max(0, 1 − Σ channels)` */
const withBase = (channels: Node<'float'>[]) => {
  const sum = channels.reduce((total, channel) => total.add(channel) as Node<'float'>);
  return [max(float(0), float(1).sub(sum)) as unknown as Node<'float'>, ...channels];
};

/** A vec4's channels, R to A */
const toChannels = (rgba: Node<'vec4'>) =>
  [rgba.r, rgba.g, rgba.b, rgba.a] as unknown as Node<'float'>[];

/**
 * The weights of the mesh's vertex colour: `RGB_AO` R, G and B weigh layers 1-3 and A is the baked
 * AO; `RGBA` the four weigh layers 1-4. Only the channels of the layers there are read. A mesh
 * without a colour attribute reads white (three's fallback): every channel's layer at once.
 * @internal
 * @param layerCount the layers, the base included (2 to 4 for `RGB_AO`, 2 to 5 for `RGBA`)
 * @param layout the colour's channels
 */
export const getVertexColorWeights = (
  layerCount: number,
  layout: VertexColorLayout
): PaintedWeights => {
  const color = vertexColor() as unknown as Node<'vec4'>;
  const channels = toChannels(color).slice(0, layerCount - 1);
  return {
    weights: withBase(channels),
    vertexAo: layout === 'RGB_AO' ? (color.a as unknown as Node<'float'>) : null,
    splatAlpha: null,
  };
};

/**
 * The weights of the splat maps, each sampled once at the mesh's UV: the first's RGBA weigh
 * layers 1-4, the second's 5-8. Only the channels of the layers there are read.
 * @internal
 * @param layerCount the layers, the base included (2 to 9)
 * @param splatMaps the splat maps' texture nodes, one per four layers past the base
 */
export const getSplatMapWeights = (
  layerCount: number,
  splatMaps: TextureNode[]
): PaintedWeights => {
  const meshUv = uv() as unknown as Node<'vec2'>;
  const all = splatMaps.flatMap((map) => toChannels(map.sample(meshUv) as unknown as Node<'vec4'>));
  return {
    weights: withBase(all.slice(0, layerCount - 1)),
    vertexAo: null,
    splatAlpha: all[3] ?? null,
  };
};
