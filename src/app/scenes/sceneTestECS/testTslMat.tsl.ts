import { float, mix, smoothstep, time, uv, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';
// The shim's texture node: its sample takes the shim's uv()
import type { TextureNode } from 'three/tsl';

/**
 * The graph of `testTslMat.material.json`, the app's reference `setup` material (p302 D2): one
 * sample of its `texture`, tiled twice and scrolling diagonally (one tile every two seconds),
 * drives three sockets, so the texture is sampled once:
 * - colour: the sample tinted by `baseColor * gridScale + panelColor`;
 * - roughness: rough where the texture is dark, glossy where it's bright;
 * - emissive: `panelColor` times `glow` where the texture is brightest.
 *
 * The rust texture's luminance spans only about 0.28-0.45 (median 0.34; `testTexture` has no
 * colour space, so the sample is its stored sRGB values), so the graph remaps its 10th to 97th
 * percentile (0.31-0.38) to 0-1 for the roughness, and the emissive takes the top few percent
 * (0.375-0.41).
 *
 * Each input is a JSON value under `inputs`, made into a uniform (`setup_baseColor`, …) the
 * material editor's Params tab edits. `setup` runs before any `nodes` socket function, which may
 * set a socket again.
 */
export const setup = (
  inputs: {
    baseColor: Node<'color'>;
    panelColor: Node<'color'>;
    gridScale: Node<'float'>;
    glow: Node<'float'>;
    texture: TextureNode;
  },
  material: MeshStandardNodeMaterial
) => {
  // fract keeps the offset in [0, 1), so the UVs never grow large enough to lose precision
  const scrolledUv = uv().mul(2.0).add(time.mul(0.5).fract());
  const sample = inputs.texture.sample(scrolledUv).rgb;
  const luminance = sample.dot(vec3(0.2126, 0.7152, 0.0722));
  const brightness = smoothstep(0.31, 0.38, luminance);
  const tint = inputs.baseColor.mul(inputs.gridScale).add(inputs.panelColor);

  material.colorNode = tint.mul(sample);
  material.roughnessNode = mix(float(0.9), float(0.35), brightness);
  // Only the brightest specks glow (about the top 3 %)
  material.emissiveNode = inputs.panelColor
    .mul(inputs.glow)
    .mul(smoothstep(0.375, 0.41, luminance));
};
