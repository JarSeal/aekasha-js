// The terrain material's blend of painted weights (p305 D2, D4): `LINEAR` normalizes them, `HEIGHT`
// lets each layer's height decide the border (Mishkinis, "Advanced Terrain Texture Splatting"):
// `w'ᵢ = max(hᵢ + wᵢ − (maxⱼ(hⱼ + wⱼ) − depth), 0)`, then × `wᵢ` (Unity's terrain form, so a layer
// nobody painted never rises through a border on its height alone), normalized.
import { float, max } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/** Keeps a share alive where every height share is 0 (the top layer unpainted): linear there */
const SHARE_FLOOR = 1e-5;
/** The sum's floor for the divide: far under the fallback shares, so they keep their ratios */
const SUM_FLOOR = 1e-8;

const sumOf = (values: Node<'float'>[]) =>
  values.reduce((total, value) => total.add(value) as Node<'float'>);

/**
 * Weights over their sum (a safe divide): they sum to 1.
 * @internal
 */
export const normalizeWeights = (weights: Node<'float'>[]) => {
  const inverse = float(1).div(max(sumOf(weights), SUM_FLOOR)) as Node<'float'>;
  return weights.map((weight) => weight.mul(inverse) as Node<'float'>);
};

/**
 * A layer's height for the blend: its sampled height (0..1) with the contrast about its middle,
 * plus the offset: `(h − 0.5) · contrast + 0.5 + offset`. About the middle, so a contrast sharpens
 * the layer's own relief without lifting it over its neighbours (the offset does that).
 * @internal
 * @param height the layer's sampled height, 0..1 (the taps' blend with anti-tiling)
 * @param contrast the set's `heightContrast` × the layer's
 * @param offset the layer's `heightOffset`
 */
export const getBlendHeight = (
  height: Node<'float'>,
  contrast: Node<'float'>,
  offset: Node<'float'>
) => height.sub(0.5).mul(contrast).add(0.5).add(offset) as Node<'float'>;

/**
 * Painted weights blended by the layers' heights (Mishkinis, × the weight), normalized: where two
 * layers meet, the higher surface shows through within `depth` of the top.
 * @internal
 * @param weights the raw painted weights, one per layer
 * @param heights each layer's blend height ({@link getBlendHeight})
 * @param depth the transition, in the heights' units (`terrain_heightBlendDepth`)
 */
export const blendWeightsByHeight = (
  weights: Node<'float'>[],
  heights: Node<'float'>[],
  depth: Node<'float'>
) => {
  const peaks = weights.map((weight, i) => heights[i].add(weight) as Node<'float'>);
  const top = peaks
    .reduce((highest, peak) => max(highest, peak) as unknown as Node<'float'>)
    .sub(depth) as Node<'float'>;
  return normalizeWeights(
    peaks.map(
      (peak, i) =>
        max(peak.sub(top), float(0)).add(SHARE_FLOOR).mul(weights[i]) as unknown as Node<'float'>
    )
  );
};
