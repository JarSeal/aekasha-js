// The material input resolvers (p302 D4): new forms of a TSL material's input values (texture
// refs, texture sets, arrays) plug in here instead of into the built-in rules of MaterialTsl.ts'
// input wrapping, which asks these first, in registration order. The kernel registers the
// object-form texture ref from its install; a feature from its install (FeatureContext), app or
// toolkit code on its first call, never at module load.
import type * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import type { FeatureContext } from '../init/Features';
import {
  getBuiltInInputDependencies,
  getTextureInputDependencies,
  isTextureInputRef,
  type MaterialInputDependency,
  TEXTURE_INPUT_CHANNEL_RE,
  type TextureInputRef,
} from './MaterialInputRefs';
import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';

/** A TSL node, as a resolver returns it (any of three's nodes: `isNode` is true). */
export type ResolvedInputNode = { readonly isNode: boolean };

/**
 * What a resolver makes of an input value: one node, or a bundle (an object of nodes by field)
 * that the material's functions get as is. A node is kept at `userData.uniforms[<group>_<key>]`,
 * each node of a bundle at `<group>_<key>_<field>`.
 */
export type ResolvedInput = ResolvedInputNode | { readonly [field: string]: ResolvedInputNode };

/** What a resolver's `resolve` gets besides the value: where the input is, and helpers. */
export type MaterialInputContext = {
  /** The material's id. */
  materialId: string | undefined;
  /** `'setup'` for the material's `inputs`, else the socket the input is under (`colorNode`, …). */
  group: string;
  /** The input's key. */
  key: string;
  /** The material being built. */
  material: THREE.NodeMaterial;
  /** The registered texture of an id; one shared white texel when there's none, warned, as for a
   * bare texture id input. */
  getTexture: (id: string) => THREE.Texture;
};

/**
 * A material input resolver: makes the TSL input values it matches into a node or a bundle of
 * nodes. Registered with {@link registerMaterialInputResolver}.
 * @template T the values it matches
 */
export type MaterialInputResolver<T = unknown> = {
  /** Names it (unique: namespace an app's or a toolkit module's, `'myGame.gradient'`). */
  kind: string;
  /** Whether it resolves this input value. The first resolver matching a value resolves it. */
  match(value: unknown): boolean;
  /** The value's node or bundle. Throws for a value it matched but can't resolve. */
  resolve(value: T, ctx: MaterialInputContext): ResolvedInput;
  /** The assets the value needs loaded before the material is created (the textures it names). */
  dependencies?(value: T): MaterialInputDependency[];
};

/** The registered resolvers, in registration order */
const resolvers: MaterialInputResolver[] = [];

/** Whether two registrations of a kind hold the same functions */
const isSameResolver = (a: MaterialInputResolver, b: MaterialInputResolver) =>
  a === b || (a.match === b.match && a.resolve === b.resolve && a.dependencies === b.dependencies);

/**
 * Registers a material input resolver: a TSL material's input value (under `inputs`, or a
 * socket's under `nodes`) that its `match` accepts becomes what its `resolve` returns, a node or
 * a bundle of nodes, before the built-in rules (a texture id, a colour, a number, a vector) are
 * tried. The resolvers are asked in registration order. Register from a feature's `install`
 * (its context's `registerMaterialInputResolver`) or on the first call of the code that creates
 * the material, never at a module's load. A kind registered again with the same functions does
 * nothing; with other functions the first stay (the debug env warns).
 * @param resolver its kind, `match`, `resolve` and `dependencies`
 * @example
 * ```ts
 * import { registerMaterialInputResolver, type MaterialInputResolver } from 'aekasha';
 * import { color, uniform } from 'three/tsl';
 *
 * type GradientInput = { gradient: [string, string] };
 *
 * // `{ "gradient": ["#203040", "#f0e0c0"] }` → a bundle of two colour uniforms, which the TSL
 * // function gets as `inputs.<key>.from` and `inputs.<key>.to`
 * const gradientResolver: MaterialInputResolver<GradientInput> = {
 *   kind: 'myGame.gradient',
 *   match: (value) => typeof value === 'object' && value !== null && 'gradient' in value,
 *   resolve: ({ gradient }) => ({
 *     from: uniform(color(gradient[0])),
 *     to: uniform(color(gradient[1])),
 *   }),
 * };
 *
 * export const createSkyMaterial = () => {
 *   registerMaterialInputResolver(gradientResolver);
 *   // … createMaterial with an input `{ gradient: [...] }`
 * };
 * ```
 */
export const registerMaterialInputResolver = <T>(resolver: MaterialInputResolver<T>) => {
  const registered = resolvers.find((r) => r.kind === resolver.kind);
  if (!registered) {
    resolvers.push(resolver as MaterialInputResolver);
    return;
  }
  if (IS_DEBUG_ENV && !isSameResolver(registered, resolver as MaterialInputResolver)) {
    lwarn(
      `registerMaterialInputResolver: the kind "${resolver.kind}" is registered already with other functions, which stay (register these under another kind).`
    );
  }
};

/** The first registered resolver matching an input value */
const findResolver = (value: unknown) => resolvers.find((resolver) => resolver.match(value));

const isResolvedNode = (value: unknown): value is ResolvedInputNode =>
  typeof value === 'object' && value !== null && (value as ResolvedInputNode).isNode === true;

/**
 * An input value resolved by the first registered resolver matching it, as a node or a bundle
 * (its fields), or undefined when none matches (the built-in rules apply).
 * @internal
 * @throws for a result that's neither a node nor a non-empty object of nodes
 */
export const resolveRegisteredInput = (
  value: unknown,
  ctx: MaterialInputContext
):
  | { node: ResolvedInputNode; bundle?: undefined }
  | { node?: undefined; bundle: Record<string, ResolvedInputNode> }
  | undefined => {
  const resolver = findResolver(value);
  if (!resolver) return undefined;
  const result: unknown = resolver.resolve(value, ctx);
  if (isResolvedNode(result)) return { node: result };
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const bundle = result as Record<string, unknown>;
    const fields = Object.keys(bundle);
    if (fields.length && fields.every((field) => isResolvedNode(bundle[field]))) {
      return { bundle: bundle as Record<string, ResolvedInputNode> };
    }
  }
  throw new Error(
    `The material input resolver "${resolver.kind}" made neither a node nor an object of nodes of input "${ctx.key}" (${ctx.group}) in material "${ctx.materialId}".`
  );
};

/**
 * The assets a TSL input value needs loaded: the first resolver matching it names them (none
 * without `dependencies`), else the built-in forms' (a bare texture id, an object-form texture
 * ref, a texture array layer, an atlas cell: those two before their resolvers register, with the
 * first array or atlas slot loaded).
 * @internal
 */
export const getMaterialInputDependencies = (value: unknown): MaterialInputDependency[] => {
  const resolver = findResolver(value);
  if (!resolver) return getBuiltInInputDependencies(value);
  return resolver.dependencies?.(value) ?? [];
};

/**
 * The kernel's object-form texture ref: `{ "texture": "id" }` is the texture node (as the bare
 * id), `"channel"` its sample's channels.
 */
const TEXTURE_REF_RESOLVER: MaterialInputResolver<TextureInputRef> = {
  kind: 'texture',
  match: isTextureInputRef,
  resolve: (value, ctx) => {
    // A sampler node, not a uniform buffer allocation
    const node = texture(ctx.getTexture(value.texture));
    const { channel } = value;
    if (channel === undefined) return node;
    if (!TEXTURE_INPUT_CHANNEL_RE.test(channel)) {
      throw new Error(
        `The texture ref of input "${ctx.key}" (${ctx.group}) in material "${ctx.materialId}" has the channel "${channel}": one to four of r, g, b and a.`
      );
    }
    // TSL's swizzle (the node's proxy): the sample at the default uv, those channels
    return (node as unknown as Record<string, ResolvedInputNode>)[channel];
  },
  dependencies: getTextureInputDependencies,
};

/**
 * Registers the kernel's material input resolvers (the object-form texture ref), from
 * `installKernel`.
 * @internal
 */
export const installMaterialInputResolvers = (ctx: FeatureContext) => {
  ctx.registerMaterialInputResolver(TEXTURE_REF_RESOLVER);
};
