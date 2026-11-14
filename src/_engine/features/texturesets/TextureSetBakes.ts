// Procedural texture sets at runtime (p304 D3): a set whose JSON gives `procedural` is baked by its
// generator into its one packing's textures, registered as `<setId>.<slot>` (the ids the gatherer
// wrote into its `packings`), so it then samples like any set. The generator's module comes from
// the gathered code (`AppData.textureSetGeneratorFiles`, `() => import(…)` by id), so the engine
// imports none. `import()`ed by the `textureSets()` feature the first time a scene has a procedural
// set or code loads one: an app without one never loads this module, nor the baker through it.
import type * as THREE from 'three/webgpu';
import { bakeTexture, type BakedTexture } from '../../kernel/render/TextureBaker';
import { getTexture } from '../../kernel/assets/Texture';
import {
  getAssetOwnerScope,
  retagAssetOwner,
  runInAssetOwnerScope,
} from '../../kernel/assets/AssetOwners';
import { getAppData } from '../../kernel/scene/AppData';
import type { SceneData } from '../../kernel/scene/Scene';
import { lerror } from '../../utils/Logger';
import type { TextureSetDef } from '../../schemas/TextureSetSchema';
import type { TextureSetGenerator } from './TextureSetGenerator';

/** The generators loaded, by id: a later bake of one starts synchronously */
const generators = new Map<string, TextureSetGenerator>();
/** The bakes running, by set id (until settled: the registered textures are the bake after) */
const pendingBakes = new Map<string, Promise<BakedTexture>>();

/** A procedural set's baked texture ids by slot (its one packing's, as the gatherer named them) */
const getBakedSlotIds = (set: TextureSetDef) => {
  const packing = set.procedural?.packing ?? set.defaultPacking;
  return Object.entries(set.packings[packing] ?? {});
};

/** The generator's module loaded and checked; throws naming the generator */
const loadGeneratorAsync = async (id: string): Promise<TextureSetGenerator> => {
  const cached = generators.get(id);
  if (cached) return cached;
  const load = getAppData().textureSetGeneratorFiles?.[id];
  if (!load) {
    throw new Error(
      `the gathered code has no generator "${id}" (a <id>.generator.ts module the gatherer found; run the gather).`
    );
  }
  const loaded = (await load()).generator as Partial<TextureSetGenerator> | undefined;
  if (typeof loaded?.buildPacking !== 'function' || loaded.id !== id) {
    throw new Error(
      `the module of the generator "${id}" doesn't export it as \`generator\` (defineSurfaceGenerator's, its id "${id}").`
    );
  }
  generators.set(id, loaded as TextureSetGenerator);
  return loaded as TextureSetGenerator;
};

/** Starts the set's bake through its generator: registers the slot textures before it returns */
const startBake = (set: TextureSetDef, generator: TextureSetGenerator) => {
  const { procedural } = set;
  if (!procedural) throw new Error('it has no procedural field.');
  const slots = getBakedSlotIds(set).map(([slot]) => slot);
  return bakeTexture({
    id: set.id,
    size: procedural.size,
    outputs: slots.map((name) => ({
      name,
      colorSpace: name.startsWith('albedo') ? 'SRGB' : 'LINEAR',
    })),
    build: (ctx) =>
      generator.buildPacking(ctx, {
        packing: procedural.packing,
        params: procedural.params,
        seed: procedural.seed,
        physicalSize: set.physicalSize,
        heightScale: set.heightScale,
      }),
  });
};

/**
 * Bakes a procedural texture set (its `procedural` field) into its packing's textures,
 * `<setId>.<slot>` in the texture registry, in the caller's owner scope (captured at the call, the
 * generator's module loaded first the first time). Its textures already registered are re-tagged
 * instead (a cache hit, as a loaded set's are), and a bake of the set running is shared.
 * @internal
 * @param set the gathered set
 * @returns resolves once baked
 * @throws (rejects) for a generator the gathered code lacks, a param or value it refuses, or what
 * `bakeTexture` refuses (its id's bake taken by other code), the message naming the set
 */
export const bakeProceduralTextureSetAsync = async (set: TextureSetDef): Promise<void> => {
  const registered = getBakedSlotIds(set).map(([, id]) => getTexture(id));
  const pending = pendingBakes.get(set.id);
  if (pending || registered.every(Boolean)) {
    for (const texture of registered) if (texture) retagAssetOwner(texture);
    await pending;
    return;
  }
  const generatorId = set.procedural?.generator ?? '';
  const scope = getAssetOwnerScope();
  const cached = generators.get(generatorId);
  const started = (async () => {
    try {
      if (cached) return await startBake(set, cached);
      const generator = await loadGeneratorAsync(generatorId);
      return await runInAssetOwnerScope(scope, () => startBake(set, generator));
    } catch (err) {
      throw new Error(
        `The procedural texture set "${set.id}" (generator "${generatorId}"): ${(err as Error).message}`
      );
    }
  })();
  pendingBakes.set(set.id, started);
  const clear = () => {
    if (pendingBakes.get(set.id) === started) pendingBakes.delete(set.id);
  };
  started.then(clear, clear);
  await started;
};

/**
 * `loadTextureSetAsync`'s procedural set: baked in the owner scope its call had (or re-tagged
 * there), its textures by slot.
 * @internal
 * @param set the gathered set
 * @param scope the caller's owner scope, captured before its first await
 * @returns the baked textures by slot
 * @throws (rejects) as {@link bakeProceduralTextureSetAsync}, or when the bake was disposed
 * before it ended
 */
export const loadProceduralTextureSetAsync = async (
  set: TextureSetDef,
  scope: string | null | undefined
) => {
  await runInAssetOwnerScope(scope, () => bakeProceduralTextureSetAsync(set));
  const baked = getBakedSlotIds(set).map(([slot, id]) => [slot, getTexture(id)] as const);
  if (baked.some(([, texture]) => !texture)) {
    throw new Error(
      `loadTextureSetAsync: the procedural texture set "${set.id}" was disposed while it baked.`
    );
  }
  return Object.fromEntries(baked) as Record<string, THREE.Texture>;
};

/**
 * Bakes a scene's procedural sets (its `textureSets` with `procedural`), all at once: the
 * `textureSets()` feature's scene hooks start this when the world is cleared (the next scene owns
 * what registers; a set the previous scene baked is re-tagged then, before its release) and await
 * it before the scene's assets, so its materials get the baked textures. A failed bake is logged,
 * and its materials sample white: the load goes on.
 * @internal
 * @returns undefined when the scene has no procedural set
 */
export const bakeSceneProceduralTextureSetsAsync = (sceneData: SceneData) => {
  const sets = (sceneData.textureSets ?? []).filter((set) => set.procedural);
  if (!sets.length) return undefined;
  return Promise.allSettled(sets.map(bakeProceduralTextureSetAsync)).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') {
        lerror(
          `Scene "${sceneData.id}": ${(result.reason as Error).message} Its materials sample white.`,
          result.reason
        );
      }
    });
  });
};
