// The rain streaks (p307 T5): water running down a steep face in rivulets. One fetch of a noise
// texture's R (the macro noise's fbm) stretched along the fall line makes the rivulets: the
// horizontal coordinate runs along the face (the space's x or z, whichever the face's normal turns
// away from; on a rounded face the two cross-fade over a band around 45°, a second fetch there
// alone, so the switch shows no seam), the vertical one the height over `length` times the tile. A rivulet is damp while the surface is wet
// (its pores full, so it dries last) and runs while it rains (a film, pulsing down the face on the
// surface clock). The fetch sits in a dynamic branch on the caller's weight (a steep face that the
// rain reaches) and the rain or wetness, so a dry face or flat ground samples nothing; the branch
// follows the slope gate's rules (a TSL `If` inside a `Fn` returning a var, everything it reads a
// var assigned before it, the tap's gradients explicit).
import { abs, dFdx, dFdy, Fn, If, min, mix, select, sin, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import { declareBranchInput as declare, toVar } from './BranchInputs';

/** The noise's R over which a rivulet fades in: the fbm's upper part, about a quarter of a face */
const RIVULET_FROM = 0.55;
const RIVULET_TO = 0.7;
/** The running water's pulses: their spacing down the face (metres) and their depth */
const PULSE_SPACING = 0.6;
const PULSE_DEPTH = 0.4;
/** Spreads the rivulet's own noise into its pulses' phase, so neighbours don't pulse together */
const PULSE_PHASE = 12;
/**
 * The wetness under which a rivulet's dampness fades: it stays fully damp until the surface is
 * nearly dry, so it's the last to dry (the face's pores empty from about twice this)
 */
const DAMP_WETNESS = 0.15;
/**
 * The band over which the two axes cross-fade, in the normal's |x| share of |x| + |z| (0.5 at 45°):
 * about 40° to 50°
 */
const AXIS_BLEND_FROM = 0.42;
const AXIS_BLEND_TO = 0.58;

/** What {@link sampleRainStreaks} reads. */
export type RainStreakInputs = {
  /** The noise texture (the macro noise: its R an fbm around 0.5; linear, `REPEAT`). */
  texture: TextureNode;
  /** The surface's position, metres: its height is the fall line. */
  position: Node<'vec3'>;
  /** The geometry normal in the position's space: which horizontal axis runs along the face. */
  normal: Node<'vec3'>;
  /** The metres one noise tile covers across the face. */
  scale: Node<'float'>;
  /** How many times longer a tile is down the face than across it. */
  length: Node<'float'>;
  /** How fast the running water's pulses move down, metres a second. */
  speed: Node<'float'>;
  /** The rain's intensity, 0..1: how much runs. */
  rain: Node<'float'>;
  /** The overall wetness, 0..1: how damp the rivulets are. */
  wetness: Node<'float'>;
  /** The surface clock in seconds (the surface conditions' `time`). */
  time: Node<'float'>;
  /** Where the streaks show, 0..1 (a steep face the rain reaches): 0 samples nothing. */
  weight: Node<'float'>;
};

/**
 * The rain streaks at the pixel: x the damp rivulets (full down to a wetness of 0.15, × the weight), y
 * the running ones (the rain × a pulse moving down, × the weight); 0 off the rivulets and where
 * `weight` or both `rain` and `wetness` are 0. One fetch of the texture's R, in a dynamic branch on
 * them (two in the band around 45° where the face's axes cross-fade).
 * @internal
 * @param inputs the texture, the position and normal, the streaks' numbers, the weather, the clock
 * and the weight
 * @returns the damp and running rivulets, a var
 */
export const sampleRainStreaks = (inputs: RainStreakInputs): Node<'vec2'> => {
  const { texture, position, normal } = inputs;
  // Built outside the branch: the coordinates along the face and their gradients in uniform control
  // flow, each axis's own (the switch between them doesn't jump the gradients). The z axis's share:
  // 1 on a face turned toward ±x, 0 toward ±z; the main tap takes the larger axis, the second the
  // other by its share (0 outside the band)
  const ax = abs(normal.x) as Node<'float'>;
  const zShare = smoothstep(
    AXIS_BLEND_FROM,
    AXIS_BLEND_TO,
    ax.div(ax.add(abs(normal.z)).max(1e-4))
  ) as unknown as Node<'float'>;
  const isMainZ = zShare.greaterThan(0.5);
  const tile = vec2(inputs.scale, inputs.scale.mul(inputs.length)) as unknown as Node<'vec2'>;
  const pick = (p: Node<'vec3'>, isMain: boolean) =>
    vec2(isMain ? select(isMainZ, p.z, p.x) : select(isMainZ, p.x, p.z), p.y).div(
      tile
    ) as unknown as Node<'vec2'>;
  const dpx = dFdx(position) as unknown as Node<'vec3'>;
  const dpy = dFdy(position) as unknown as Node<'vec3'>;
  const call = Fn(() => {
    const weight = declare(inputs.weight, 'float');
    const rain = declare(inputs.rain, 'float');
    const wetness = declare(inputs.wetness, 'float');
    const at = declare(pick(position, true), 'vec2');
    const atDx = declare(pick(dpx, true), 'vec2');
    const atDy = declare(pick(dpy, true), 'vec2');
    const other = declare(pick(position, false), 'vec2');
    const otherDx = declare(pick(dpx, false), 'vec2');
    const otherDy = declare(pick(dpy, false), 'vec2');
    const otherShare = declare(min(zShare, zShare.oneMinus()) as Node<'float'>, 'float');
    // The pulses' phase: the height moving up the face over time is the water moving down
    const fall = declare(
      position.y.add(inputs.time.mul(inputs.speed)).div(PULSE_SPACING) as Node<'float'>,
      'float'
    );
    const out = toVar(vec2(0)) as unknown as Node<'vec2'> & { assign: (value: unknown) => void };
    If(weight.greaterThan(0).and(rain.add(wetness).greaterThan(0)), () => {
      const tap = (uv: Node<'vec2'>, dx: Node<'vec2'>, dy: Node<'vec2'>) =>
        (texture.sample(uv).grad(dx, dy) as unknown as Node<'vec4'>).x as Node<'float'>;
      const noise = toVar(tap(at, atDx, atDy)) as unknown as Node<'float'> & {
        assign: (value: unknown) => void;
      };
      // Near 45° the other axis's rivulets cross-fade in
      If(otherShare.greaterThan(0), () => {
        noise.assign(mix(noise, tap(other, otherDx, otherDy), otherShare));
      });
      const rivulet = smoothstep(RIVULET_FROM, RIVULET_TO, noise).mul(weight) as Node<'float'>;
      const damp = rivulet.mul(wetness.div(DAMP_WETNESS).saturate());
      const pulse = sin(fall.mul(Math.PI * 2).add(noise.mul(PULSE_PHASE)))
        .mul(0.5 * PULSE_DEPTH)
        .add(1 - 0.5 * PULSE_DEPTH);
      out.assign(vec2(damp, rivulet.mul(rain).mul(pulse)));
    });
    return out;
  }).once()();
  return toVar(call) as unknown as Node<'vec2'>;
};
