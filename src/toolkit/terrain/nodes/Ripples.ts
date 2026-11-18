// The rain ripples (p307 T4): a ripple atlas (`bakeRippleAtlas`, or the toolkit's `rippleAtlas`)
// sampled twice at the surface's XZ, at two scales and half a ring's lifetime apart (so the atlas's
// grid doesn't show), its rings decoded at the surface clock and turned into a world-space normal
// offset. Both fetches sit in a dynamic branch on the rain and the caller's weight (where water
// stands, near enough to see), so a dry frame or a pixel without standing water samples nothing.
// The branch is a TSL `If` inside a `Fn` returning a var (three's `normalView` pattern, as the
// slope gate's); everything it reads is a var assigned before it, and both taps take explicit
// gradients (WGSL refuses implicit derivatives in non-uniform control flow).
import { dFdx, dFdy, float, Fn, fract, If, step, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import { decodeRippleAtlas } from '../textures/RippleAtlas';
import { declareBranchInput as declare, toVar } from './BranchInputs';

/** The second sample's scale against the first's (an irrational-ish ratio: the grids don't line up) */
const SECOND_SCALE = 0.71;
/** The second sample's offset in tiles, and its time in ring lifetimes */
const SECOND_OFFSET = [0.37, 0.61] as const;
const SECOND_TIME = 0.5;
/** Spreads a cell's time offset (the atlas's A) into the hash a drop is kept by: under the rain */
const DENSITY_HASH = 7.31;

/** What {@link sampleRainRipples} reads. */
export type RainRippleInputs = {
  /** The ripple atlas's texture node (linear, `REPEAT`). */
  atlas: TextureNode;
  /** The surface's position: its XZ tiles the atlas, seen from above as the layers' world tiling. */
  position: Node<'vec3'>;
  /** The metres one atlas tile covers. */
  scale: Node<'float'>;
  /** The seconds a ring lives. */
  lifetime: Node<'float'>;
  /** The normal offset's strength. */
  strength: Node<'float'>;
  /** The rain's intensity, 0..1: none samples nothing, more keeps more drops. */
  rain: Node<'float'>;
  /** The surface clock in seconds (the surface conditions' `time`). */
  time: Node<'float'>;
  /** Where the ripples show, 0..1 (standing water × a distance fade): 0 samples nothing. */
  weight: Node<'float'>;
};

/**
 * The rain ripples' world-space normal offset (x and z; zero off the rings, where `rain` or
 * `weight` is 0): two samples of the ripple atlas at the position's `(x, −z)` over `scale` and at
 * another scale, half a ring's lifetime apart, decoded at `time / lifetime`, each drop kept with
 * the rain's chance (light rain, few rings), × `strength` × `weight`. Add it to a flat surface's
 * normal and normalize. The fetches are in a dynamic branch on `rain` and `weight`.
 * @internal
 * @param inputs the atlas, the position, the ripples' numbers, the rain, the clock and the weight
 * @returns the normal offset, a var
 */
export const sampleRainRipples = (inputs: RainRippleInputs): Node<'vec3'> => {
  const { atlas, position } = inputs;
  // Built outside the branch: the UV's gradients in uniform control flow
  const uv = vec2(position.x, position.z.negate()).div(inputs.scale) as unknown as Node<'vec2'>;
  const dx = dFdx(uv) as unknown as Node<'vec2'>;
  const dy = dFdy(uv) as unknown as Node<'vec2'>;
  const call = Fn(() => {
    const weight = declare(inputs.weight, 'float');
    const rain = declare(inputs.rain, 'float');
    const at = declare(uv, 'vec2');
    const atDx = declare(dx, 'vec2');
    const atDy = declare(dy, 'vec2');
    const time = declare(inputs.time.div(inputs.lifetime) as Node<'float'>, 'float');
    const strength = declare(inputs.strength, 'float');
    const out = toVar(vec3(0)) as unknown as Node<'vec3'> & { assign: (value: unknown) => void };
    If(weight.greaterThan(0).and(rain.greaterThan(0)), () => {
      const ringsAt = (
        tapUv: Node<'vec2'>,
        tapDx: Node<'vec2'>,
        tapDy: Node<'vec2'>,
        tapTime: Node<'float'>
      ) => {
        const sample = atlas.sample(tapUv).grad(tapDx, tapDy) as unknown as Node<'vec4'>;
        // A drop falls where its cell's hash is under the rain
        const kept = step(fract(sample.w.mul(DENSITY_HASH)), rain);
        return decodeRippleAtlas(sample, tapTime).normalXY.mul(kept) as Node<'vec2'>;
      };
      const second = 1 / SECOND_SCALE;
      const a = ringsAt(at, atDx, atDy, time);
      const b = ringsAt(
        at.mul(second).add(vec2(...SECOND_OFFSET)) as Node<'vec2'>,
        atDx.mul(second) as Node<'vec2'>,
        atDy.mul(second) as Node<'vec2'>,
        time.add(SECOND_TIME) as Node<'float'>
      );
      const xy = a.add(b).mul(strength).mul(weight) as Node<'vec2'>;
      // The atlas's +u is the world's +x, its +v the world's −z
      out.assign(vec3(xy.x, float(0), xy.y.negate()));
    });
    return out;
  }).once()();
  return toVar(call) as unknown as Node<'vec3'>;
};
