// Texture sets at runtime (p303 D1): a set is plain data from the gathered app data (the
// development data's `textureSets` section, else the first scene whose `textureSets` has it: a
// production build has only the scenes' data), and its textures are ordinary registered textures,
// owned and released as any other. The `textureSets()` feature registers the `{ textureSet }`
// material input resolver at its install, and the scene hooks that build a scene's set arrays
// (TextureSetArrays.ts, `import()`ed by the first scene that has some) and bake its procedural
// sets (TextureSetBakes.ts, likewise, p304 D3); the lookups and the load work without it.
import * as THREE from 'three/webgpu';
import { texture, uniform } from 'three/tsl';
import type { FeatureContext } from '../../kernel/init/Features';
import type {
  MaterialInputResolver,
  ResolvedInputNode,
} from '../../kernel/assets/MaterialInputResolvers';
import { getTexture, loadTextureAsync } from '../../kernel/assets/Texture';
import { findTextureDeclaration } from '../../kernel/assets/MaterialDependencies';
import { getAssetOwnerScope, retagAssetOwner } from '../../kernel/assets/AssetOwners';
import { getGeneratedAppData, type SceneData } from '../../kernel/scene/Scene';
import { toThreeColor } from '../../kernel/render/ThreeMath';
import {
  type DebugModuleRef,
  loadDebugModuleAsync,
  useDebug,
} from '../../kernel/config/DebugModules';
import type {
  TEXTURE_SET_PACKINGS,
  TextureSetDef,
  TextureSetPacking,
  TextureSetSurface,
} from '../../schemas/TextureSetSchema';
import {
  getTextureSetInputDependencies,
  getTextureSetSlotTextures,
  isTextureSetInputRef,
  type TextureSetInputRef,
} from './TextureSetRefs';

/**
 * A packing's textures by slot (`LITE`: `albedoRough` and `normalHeight`), as
 * {@link loadTextureSetAsync} and {@link getTextureSetPackingTextures} return them.
 * @template P the packing; for several (a set's default, unknown to the types), one of theirs
 */
export type TextureSetTextures<P extends TextureSetPacking = TextureSetPacking> =
  P extends TextureSetPacking
    ? { [S in (typeof TEXTURE_SET_PACKINGS)[P][number]]: THREE.Texture }
    : never;

/**
 * What a TSL function gets for a `{ "textureSet": id }` input: the packing's texture nodes by slot
 * (only the sampled packing's slots are there), and uniforms of the set's `physicalSize`,
 * `heightScale` and each `surface` field (`tint` a colour, linear; the rest floats), which the
 * material may change (`material.userData.uniforms`).
 */
export type TextureSetInput = {
  /** `FULL` and `MINIMAL`: RGB albedo (sRGB), A height. */
  albedoHeight?: THREE.TextureNode;
  /** `FULL`: the tangent-space normal (OpenGL, +Y). */
  normal?: THREE.TextureNode;
  /** `FULL`: R ambient occlusion, G roughness, B metalness. */
  orm?: THREE.TextureNode;
  /** `LITE`: RGB albedo × AO (sRGB), A roughness. */
  albedoRough?: THREE.TextureNode;
  /** `LITE`: RG the normal's X and Y (Z reconstructed), B height. */
  normalHeight?: THREE.TextureNode;
  /** The metres one tile covers. */
  physicalSize: THREE.UniformNode<'vec2'>;
  /** The metres of relief a height of 1 stands for. */
  heightScale: THREE.UniformNode<'float'>;
} & {
  [K in keyof TextureSetSurface]: K extends 'tint'
    ? THREE.UniformNode<'color'>
    : THREE.UniformNode<'float'>;
};

/**
 * The texture set with the id, as the gatherer wrote it (its `defaultPacking` and every `surface`
 * field filled in): from the development data's section, else the first scene's data that has it.
 * Read it, never write it: it's the generated data, which every later read gets.
 * @param id the set's id (its `*.textureSet.json`)
 * @returns the set, or undefined when no data has it (in a production build: no scene lists it
 * or names it in a material input)
 * @example
 * ```ts
 * import { getTextureSet } from 'aekasha/texturesets';
 *
 * const sand = getTextureSet('sand01');
 * if (sand) console.log(`One tile is ${sand.physicalSize[0]} m wide.`);
 * ```
 */
export const getTextureSet = (id: string): TextureSetDef | undefined => {
  const json = getGeneratedAppData();
  const section = json.textureSets as Record<string, TextureSetDef> | undefined;
  if (section?.[id]) return section[id];
  for (const scene of Object.values(json.scenes) as SceneData[]) {
    const found = scene.textureSets?.find((set) => set.id === id);
    if (found) return found;
  }
  return undefined;
};

/** A set's texture ids by slot of a packing (its default without one); throws naming the set */
const getPackingSlots = (caller: string, id: string, packing: TextureSetPacking | undefined) => {
  const set = getTextureSet(id);
  if (!set) {
    throw new Error(
      `${caller}: no data has the texture set "${id}" (in a production build, a scene must list it in its textureSets or name it in a material input).`
    );
  }
  const name = packing ?? set.defaultPacking;
  const slots = getTextureSetSlotTextures(set, name);
  if (!slots) {
    throw new Error(
      `${caller}: the texture set "${id}" has no packing "${name}" (packings: ${Object.keys(set.packings).join(', ')}).`
    );
  }
  return slots;
};

/** A slot's texture, loaded from its declaration when it isn't registered, else re-tagged to the
 * caller's owner (a cache hit); rejects naming the set and the texture */
const ensureSlotTextureAsync = async (setId: string, textureId: string) => {
  const registered = getTexture(textureId);
  if (registered) {
    retagAssetOwner(registered);
    return registered;
  }
  const declaration = findTextureDeclaration(textureId);
  if (!declaration) {
    throw new Error(
      `loadTextureSetAsync: no data declares the texture "${textureId}" of the texture set "${setId}" (in a production build, a scene must list the set or the texture).`
    );
  }
  return loadTextureAsync({ ...declaration, throwOnError: true });
};

/**
 * Loads a texture set's textures of a packing (the set's `defaultPacking` without one) that
 * aren't registered, and re-tags the registered ones, all in the caller's owner scope: they're
 * the loading (or current) scene's and are released with it, as the scene load's are. A scene's
 * `textureSets` and its materials' `{ textureSet }` inputs load theirs with the scene: this is for
 * code that needs a set no scene loads, or another packing of one. A procedural set (p304 D3) is
 * baked by its generator instead, unless its textures are registered (a scene baked it).
 *
 * Calls may overlap: two loads of one texture register one. Re-check the scene after the await
 * before using the textures: a scene switch meanwhile releases what the left scene loaded.
 * @param id the set's id (its `*.textureSet.json`)
 * @param opts `packing`: the packing to load (`FULL`, `LITE` or `MINIMAL`)
 * @returns the packing's textures by slot
 * @throws (rejects) for a set no data has, a packing the set lacks, a texture no data declares
 * (in a production build, a texture no scene names) or one that fails to load
 * @example
 * ```ts
 * import { loadTextureSetAsync } from 'aekasha/texturesets';
 *
 * const { albedoRough, normalHeight } = await loadTextureSetAsync('sand01', { packing: 'LITE' });
 * ```
 */
export const loadTextureSetAsync = async <P extends TextureSetPacking = TextureSetPacking>(
  id: string,
  opts: { packing?: P } = {}
): Promise<TextureSetTextures<P>> => {
  const entries = Object.entries(getPackingSlots('loadTextureSetAsync', id, opts.packing));
  const set = getTextureSet(id);
  if (set?.procedural) {
    // Baked, not loaded (p304 D3), in the scope this call has before its first await
    const scope = getAssetOwnerScope();
    const bakes = await loadBakesModuleAsync();
    return (await bakes.loadProceduralTextureSetAsync(set, scope)) as TextureSetTextures<P>;
  }
  // Every load starts before the first await: each captures the caller's owner scope at its call
  const loaded = await Promise.all(
    entries.map(([, textureId]) => ensureSlotTextureAsync(id, textureId))
  );
  return Object.fromEntries(
    entries.map(([slot], i) => [slot, loaded[i]])
  ) as unknown as TextureSetTextures<P>;
};

/**
 * A texture set's registered textures of a packing (the set's `defaultPacking` without one), by
 * slot: loaded by a scene that lists the set or names it in a material, or by
 * {@link loadTextureSetAsync}.
 * @param id the set's id (its `*.textureSet.json`)
 * @param opts `packing`: the packing (`FULL`, `LITE` or `MINIMAL`)
 * @returns the textures by slot, or undefined when the set is unknown, lacks the packing or any of
 * its textures isn't registered
 * @example
 * ```ts
 * import { getTextureSetPackingTextures } from 'aekasha/texturesets';
 *
 * const textures = getTextureSetPackingTextures('sand01', { packing: 'LITE' });
 * if (textures) textures.albedoRough.anisotropy = 8;
 * ```
 */
export const getTextureSetPackingTextures = <P extends TextureSetPacking = TextureSetPacking>(
  id: string,
  opts: { packing?: P } = {}
): TextureSetTextures<P> | undefined => {
  const set = getTextureSet(id);
  const slots = set && getTextureSetSlotTextures(set, opts.packing ?? set.defaultPacking);
  if (!slots) return undefined;
  const textures: Record<string, THREE.Texture> = {};
  for (const [slot, textureId] of Object.entries(slots)) {
    const registered = getTexture(textureId);
    if (!registered) return undefined;
    textures[slot] = registered;
  }
  return textures as unknown as TextureSetTextures<P>;
};

/** A set input's place, for an error */
const describeInput = (value: TextureSetInputRef, key: string, group: string, id?: string) =>
  `The texture set "${value.textureSet}" of input "${key}" (${group}) in material "${id}"`;

/**
 * `{ "textureSet": id, "packing"? }` (p303 D1, decision 2): a bundle of the packing's texture
 * nodes by slot, and uniforms of the set's `physicalSize`, `heightScale` and `surface` fields
 * (`TextureSetInput`). A texture that isn't registered samples the white texel, warned, as a bare
 * id does.
 */
const TEXTURE_SET_RESOLVER: MaterialInputResolver<TextureSetInputRef> = {
  kind: 'textureSet',
  match: isTextureSetInputRef,
  resolve: (value, ctx) => {
    const set = getTextureSet(value.textureSet);
    if (!set) {
      throw new Error(
        `${describeInput(value, ctx.key, ctx.group, ctx.materialId)} isn't in the app's data (a scene must list it or name it in a material input).`
      );
    }
    const packing = value.packing ?? set.defaultPacking;
    const slots = getTextureSetSlotTextures(set, packing);
    if (!slots) {
      throw new Error(
        `${describeInput(value, ctx.key, ctx.group, ctx.materialId)} has no packing "${packing}" (packings: ${Object.keys(set.packings).join(', ')}).`
      );
    }
    const bundle: Record<string, ResolvedInputNode> = {};
    // Sampler nodes, not uniform buffer allocations (three's types don't declare `isNode`)
    for (const [slot, textureId] of Object.entries(slots)) {
      bundle[slot] = texture(ctx.getTexture(textureId)) as unknown as ResolvedInputNode;
    }
    bundle.physicalSize = uniform(new THREE.Vector2(set.physicalSize[0], set.physicalSize[1]));
    bundle.heightScale = uniform(set.heightScale);
    for (const [field, fieldValue] of Object.entries(set.surface)) {
      bundle[field] =
        typeof fieldValue === 'number'
          ? uniform(fieldValue)
          : uniform(new THREE.Color(toThreeColor(fieldValue)));
    }
    return bundle;
  },
  dependencies: (value) => getTextureSetInputDependencies(value, getTextureSet),
};

/** The set arrays' module once loaded (`import()`: only a scene with set arrays loads it) */
let arraysModule: typeof import('./TextureSetArrays') | undefined;
/** The procedural sets' bakes once loaded (`import()`: only a procedural set loads it) */
let bakesModule: typeof import('./TextureSetBakes') | undefined;

const loadBakesModuleAsync = async () => {
  bakesModule ??= await import('./TextureSetBakes');
  return bakesModule;
};

/** Starts the bakes of a scene's procedural sets (p304 D3): synchronously once the module is
 * loaded, so a set the next scene shares is re-tagged before the previous scene's release */
const startSceneBakes = (sceneData: SceneData) => {
  if (!sceneData.textureSets?.some((set) => set.procedural)) return undefined;
  if (bakesModule) return bakesModule.bakeSceneProceduralTextureSetsAsync(sceneData);
  return loadBakesModuleAsync().then((loaded) =>
    loaded.bakeSceneProceduralTextureSetsAsync(sceneData)
  );
};

/** Starts the builds of a scene's set arrays: synchronously once the module is loaded, so a set
 * array the next scene shares is re-tagged before the previous scene's assets are released */
const startSceneArrayBuilds = (sceneData: SceneData) => {
  if (!sceneData.textureSetArrays?.length) return undefined;
  if (arraysModule) return arraysModule.buildSceneTextureSetArraysAsync(sceneData);
  return import('./TextureSetArrays').then((loaded) => {
    arraysModule = loaded;
    return loaded.buildSceneTextureSetArraysAsync(sceneData);
  });
};

type TextureSetsDebugModule = typeof import('./debug/_dbg__TextureSets');
let debugModule: DebugModuleRef<TextureSetsDebugModule> | null = null;

/**
 * Loads the texture sets' debug tools (the material editor's set array preparer): the
 * `textureSets()` feature's `onDebug` hook.
 * @internal
 */
export const registerTextureSetsDebug = async () => {
  debugModule = await loadDebugModuleAsync(() => import('./debug/_dbg__TextureSets'));
  useDebug(debugModule)?._registerTextureSetsDebug();
};

/**
 * The texture sets' install: registers the `{ textureSet }` material input resolver, and the
 * scene hooks that build a scene's set arrays (p303 D4) and bake its procedural sets (p304 D3)
 * before its materials: started when the world is cleared (the next scene's data, which owns what
 * registers from then on), awaited before its assets load. The `{ textureSetArray }` resolver
 * registers with the first build.
 * @internal
 */
export const installTextureSets = (ctx: FeatureContext) => {
  ctx.registerMaterialInputResolver(TEXTURE_SET_RESOLVER);
  let pending: Promise<void> | undefined;
  ctx.addSceneHooks({
    worldCleared: (_world, _prevSceneId, nextSceneData) => {
      const arrays = startSceneArrayBuilds(nextSceneData);
      const bakes = startSceneBakes(nextSceneData);
      pending = arrays && bakes ? Promise.all([arrays, bakes]).then(() => {}) : arrays ?? bakes;
    },
    beforeAssets: () => {
      const started = pending;
      pending = undefined;
      return started;
    },
  });
};
