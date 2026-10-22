import { time, uv, type Node, type TextureNode } from 'three/tsl';

/**
 * The colour socket of `testTslMat.material.json`: its `texture`, tiled twice and scrolling
 * diagonally (one tile every two seconds), tinted by `baseColor * gridScale + panelColor`. Each
 * input is a JSON value under `nodes.colorNode`, made into a uniform (`colorNode_baseColor`, …).
 */
export const colorNode = (inputs: {
  baseColor: Node;
  panelColor: Node;
  gridScale: Node;
  texture: TextureNode;
}) => {
  // fract keeps the offset in [0, 1), so the UVs never grow large enough to lose precision
  const scrolledUv = uv().mul(2.0).add(time.mul(0.5).fract());
  const tint = inputs.baseColor.mul(inputs.gridScale).add(inputs.panelColor);
  return tint.mul(inputs.texture.sample(scrolledUv).rgb);
};
