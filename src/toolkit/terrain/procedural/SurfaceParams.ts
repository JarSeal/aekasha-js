// A surface generator's params (p304 D3, decided 2026-11-14): a plain spec per param instead of a
// zod schema (zod would come with every generator's chunk). Numbers and colours become uniforms, so
// a value changed later rebakes the same pipeline; static numbers and toggles are build-time values
// (an octave count, a feature switched on), fixed once the graph is built.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/** A number param: a float uniform, or with `isStatic` a build-time number. */
export type SurfaceNumberParam = {
  type?: 'number';
  /** The value a set or a call doesn't give. */
  default: number;
  /** The smallest value it takes (a smaller one throws). */
  min?: number;
  /** The largest value it takes (a larger one throws). */
  max?: number;
  /** A slider's step (the debug tools'); the values aren't rounded to it. */
  step?: number;
  /** A build-time number (the graph reads a plain number: an octave count, a whole number of
   * cells); changing it means building the graph again. Default false: a uniform. */
  isStatic?: boolean;
  /** Takes whole numbers only. Default false. */
  isInteger?: boolean;
  /** What the debug tools call it. Default: its name. */
  label?: string;
};

/** A colour param, written as sRGB `#rrggbb`: a linear colour uniform in the graph. */
export type SurfaceColorParam = {
  type: 'color';
  /** The colour a set or a call doesn't give, sRGB `#rrggbb`. */
  default: string;
  /** What the debug tools call it. Default: its name. */
  label?: string;
};

/** A toggle param: a build-time boolean (a feature of the surface on or off). */
export type SurfaceToggleParam = {
  type: 'boolean';
  /** The value a set or a call doesn't give. */
  default: boolean;
  /** What the debug tools call it. Default: its name. */
  label?: string;
};

/** One param's spec: a number, a colour or a toggle. */
export type SurfaceParamSpec = SurfaceNumberParam | SurfaceColorParam | SurfaceToggleParam;

/** A generator's params by name. */
export type SurfaceParamSpecs = Record<string, SurfaceParamSpec>;

/**
 * What a generator's `build` reads for a param: a colour's linear vec3 uniform, a toggle's
 * boolean, a static number's number, any other number's float uniform.
 * @template S the param's spec
 */
export type SurfaceParamNode<S extends SurfaceParamSpec> = S extends { type: 'color' }
  ? Node<'vec3'>
  : S extends { type: 'boolean' }
    ? boolean
    : S extends { isStatic: true }
      ? number
      : Node<'float'>;

/**
 * The params as a generator's `build` reads them, by name.
 * @template P the generator's param specs
 */
export type SurfaceParamNodes<P extends SurfaceParamSpecs> = {
  [K in keyof P]: SurfaceParamNode<P[K]>;
};

/**
 * Param values by name, as a set's JSON or a call gives them (each optional: the default fills in).
 * @template P the generator's param specs
 */
export type SurfaceParamValues<P extends SurfaceParamSpecs> = {
  [K in keyof P]?: P[K] extends { type: 'color' }
    ? string
    : P[K] extends { type: 'boolean' }
      ? boolean
      : number;
};

/**
 * A generator's params built for one graph: the nodes `build` reads, and the setter of the
 * uniforms' values.
 * @internal
 */
export type SurfaceParamsBuild<P extends SurfaceParamSpecs> = {
  nodes: SurfaceParamNodes<P>;
  /** The values in effect, defaults filled in. */
  values: Required<SurfaceParamValues<P>>;
  /** Sets uniform params (checked as at the build); a static one that changes throws. */
  set: (values: SurfaceParamValues<P>) => void;
};

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const isColor = (spec: SurfaceParamSpec): spec is SurfaceColorParam => spec.type === 'color';
const isToggle = (spec: SurfaceParamSpec): spec is SurfaceToggleParam => spec.type === 'boolean';

/** A value's problem against its spec, or null. */
const getValueError = (spec: SurfaceParamSpec, value: unknown): string | null => {
  if (isColor(spec)) {
    return typeof value === 'string' && COLOR_PATTERN.test(value)
      ? null
      : `${JSON.stringify(value)} isn't an sRGB colour "#rrggbb"`;
  }
  if (isToggle(spec)) {
    return typeof value === 'boolean' ? null : `${JSON.stringify(value)} isn't true or false`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${JSON.stringify(value)} isn't a number`;
  }
  if (spec.isInteger && !Number.isInteger(value)) return `${value} isn't a whole number`;
  if (spec.min !== undefined && value < spec.min) return `${value} is below its min ${spec.min}`;
  if (spec.max !== undefined && value > spec.max) return `${value} is above its max ${spec.max}`;
  return null;
};

/** The checked value of each param (the given one, or the default), throwing for an unknown
 * name or a refused value. */
const resolveValues = <P extends SurfaceParamSpecs>(
  generatorId: string,
  specs: P,
  values: Record<string, unknown>
) => {
  for (const name of Object.keys(values)) {
    if (!(name in specs)) {
      throw new Error(
        `[${generatorId}] has no param "${name}" (params: ${Object.keys(specs).join(', ') || 'none'}).`
      );
    }
  }
  const resolved: Record<string, number | string | boolean> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = values[name] ?? spec.default;
    const error = getValueError(spec, value);
    if (error) throw new Error(`[${generatorId}] The param "${name}": ${error}.`);
    resolved[name] = value as number | string | boolean;
  }
  return resolved as Required<SurfaceParamValues<P>>;
};

/**
 * Checks a generator's param specs (the generator's id names it in the error): each default must
 * be a value its own spec takes.
 * @internal
 */
export const checkSurfaceParamSpecs = (generatorId: string, specs: SurfaceParamSpecs) => {
  for (const [name, spec] of Object.entries(specs)) {
    const error = getValueError(spec, spec.default);
    if (error) throw new Error(`[${generatorId}] The param "${name}"'s default: ${error}.`);
  }
};

/**
 * Builds a generator's params for one graph: a uniform per number and colour (its value the given
 * one, else the default), a plain value per static number and toggle.
 * @internal
 * @param generatorId the generator, which the errors name
 * @param specs what each param takes
 * @param values the values given (the rest take their defaults)
 * @returns the nodes, the values in effect and their setter
 * @throws for a name the specs don't have, or a value its spec refuses
 */
export const buildSurfaceParams = <P extends SurfaceParamSpecs>(
  generatorId: string,
  specs: P,
  values: SurfaceParamValues<P> = {}
): SurfaceParamsBuild<P> => {
  const resolved = resolveValues(generatorId, specs, values);
  const nodes: Record<string, unknown> = {};
  const uniforms = new Map<string, THREE.UniformNode<'float' | 'color', number | THREE.Color>>();
  for (const [name, spec] of Object.entries(specs)) {
    const value = (resolved as Record<string, number | string | boolean>)[name];
    if (isToggle(spec) || (!isColor(spec) && spec.isStatic)) {
      nodes[name] = value;
      continue;
    }
    // THREE.Color reads a hex string as sRGB and keeps it linear (three's colour management)
    const node = isColor(spec)
      ? uniform(new THREE.Color(value as string))
      : uniform(value as number);
    uniforms.set(
      name,
      node as unknown as THREE.UniformNode<'float' | 'color', number | THREE.Color>
    );
    nodes[name] = node;
  }
  const build: SurfaceParamsBuild<P> = {
    nodes: nodes as SurfaceParamNodes<P>,
    values: resolved,
    set: (next) => {
      const merged = resolveValues(generatorId, specs, { ...build.values, ...next });
      for (const [name, spec] of Object.entries(specs)) {
        const value = (merged as Record<string, number | string | boolean>)[name];
        const node = uniforms.get(name);
        if (!node) {
          if (value !== (build.values as Record<string, unknown>)[name]) {
            throw new Error(
              `[${generatorId}] The param "${name}" is fixed when the graph is built: bake it again to change it.`
            );
          }
          continue;
        }
        if (isColor(spec)) (node.value as THREE.Color).set(value as string);
        else node.value = value as number;
      }
      build.values = merged;
    },
  };
  return build;
};
