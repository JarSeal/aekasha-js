// The terrain material's macro variation (p305 D7): one fetch of a macro noise texture (the
// toolkit's `macroNoise`, or a bake of it) at the world's XZ over a large scale, which varies every
// layer's surface at once: R its brightness, G its hue and its roughness. B (the patches) goes to
// `DUAL_SCALE`'s share (`AntiTiling.ts`). World coordinates, so the variation runs on across
// blocks (p301 §7).
import { float, hue, positionWorld, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';

/** The macro variation's uniforms */
export type MacroNodes = {
  /** Metres a macro tile covers */
  scale: Node<'float'>;
  /** How far R lightens and darkens the albedo, 0..1 */
  brightness: Node<'float'>;
  /** How far G turns the albedo's hue, degrees either way */
  hue: Node<'float'>;
  /** How far G scales the roughness, 0..1 */
  roughness: Node<'float'>;
};

/** What the macro variation changes of the surface */
export type MacroSurface = {
  albedo: Node<'vec3'>;
  roughness: Node<'float'>;
};

const DEG_TO_RAD = Math.PI / 180;

/**
 * The macro texture sampled once at the world's `(x, −z)` over its scale (seen from above, as the
 * layers' world tiling)
 * @internal
 * @param macroTexture the material's `macro` input, a texture node
 * @param scale the metres a macro tile covers
 */
export const sampleMacroTexture = (macroTexture: TextureNode, scale: Node<'float'>) =>
  macroTexture.sample(
    vec2(positionWorld.x, positionWorld.z.negate()).div(scale)
  ) as unknown as Node<'vec4'>;

/** A channel around macroNoise's neutral 0.5 as −1..1 */
const toSigned = (channel: Node<'float'>) => channel.sub(0.5).mul(2) as Node<'float'>;

/**
 * The surface varied by a macro sample: the albedo × `1 + R′ · brightness` (R′ the channel as
 * −1..1), turned about the grey axis by `G′ · hue` degrees (three's `hue`), and the roughness ×
 * `1 + G′ · roughness`, capped at 1
 * @internal
 * @param surface the blended albedo and roughness
 * @param macro the macro texture's sample ({@link sampleMacroTexture})
 * @param nodes the variation's uniforms
 */
export const applyMacroVariation = (
  surface: MacroSurface,
  macro: Node<'vec4'>,
  nodes: MacroNodes
): MacroSurface => {
  const r = toSigned(macro.r as Node<'float'>);
  const g = toSigned(macro.g as Node<'float'>);
  const brightened = surface.albedo.mul(float(1).add(r.mul(nodes.brightness))) as Node<'vec3'>;
  const turned = hue(brightened, g.mul(nodes.hue).mul(DEG_TO_RAD)) as unknown as Node<'vec3'>;
  return {
    albedo: turned,
    roughness: surface.roughness.mul(float(1).add(g.mul(nodes.roughness))).min(1) as Node<'float'>,
  };
};
