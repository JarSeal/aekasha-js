// Texture set arrays (p303 D4): several texture sets of one packing as array textures, one per
// slot of the packing (layer `i` of each is `sets[i]`), so a terrain material binds two or three
// textures however many layers it blends. A thin layer over the kernel's `buildTextureArray` /
// `setTextureArrayLayer` (p299 D1: the assembly, the uncompressed fallback, the format checks and
// the layer swaps are theirs). The sets' physical facts and surface defaults are one uniform array
// of vec4s, four per layer (one binding: three makes each uniform array its own uniform buffer,
// and a stage has 12 by default), which `getTextureSetLayerParams` decodes in TSL.
import * as THREE from 'three/webgpu';
import { int, texture, uniformArray, vec2, vec3 } from 'three/tsl';
import { deleteTexture, getTexture, type TextureProps } from '../../kernel/assets/Texture';
import {
  type MaterialInputContext,
  type MaterialInputResolver,
  registerMaterialInputResolver,
  type ResolvedInputNode,
} from '../../kernel/assets/MaterialInputResolvers';
import { getGeneratedAppData, type SceneData } from '../../kernel/scene/Scene';
import { lerror, lwarn } from '../../utils/Logger';
import {
  buildTextureArray,
  setTextureArrayLayer,
  type TextureArray,
} from '../../kernel/assets/TextureArray';
import { findTextureDeclaration } from '../../kernel/assets/MaterialDependencies';
import { toThreeColor } from '../../kernel/render/ThreeMath';
import { hashStringFNV1a } from '../../utils/Hash';
// Types only: the schema module's values would bring zod into the chunk (the slots come from the
// gathered sets, in the schema's slot order)
import type {
  TEXTURE_SET_PACKINGS,
  TextureSetDef,
  TextureSetPacking,
} from '../../schemas/TextureSetSchema';
import {
  getTextureSetSlotTextures,
  isTextureSetArrayInputRef,
  type TextureSetArrayInputRef,
} from './TextureSetRefs';
import { getTextureSet } from './TextureSets';

/** The vec4s each layer takes in a set array's `layerParams`. */
const PARAMS_PER_LAYER = 4;

/**
 * A packing's slots mapped to a value each (the arrays of a {@link TextureSetArray}).
 * @template P the packing
 * @template T the value per slot
 */
export type TextureSetSlotMap<P extends TextureSetPacking, T> = P extends TextureSetPacking
  ? { [S in (typeof TEXTURE_SET_PACKINGS)[P][number]]: T }
  : never;

/**
 * The per-layer uniforms of a texture set array: four vec4s per layer, layer `i` from element
 * `4i` (see {@link getTextureSetLayerParams}, which reads them by name).
 */
export type TextureSetLayerParamsNode = THREE.UniformArrayNode<'vec4'>;

/**
 * Several texture sets of one packing as array textures (p303 D4), built by
 * {@link buildTextureSetArray}: one array per slot of the packing, layer `i` of each from
 * `sets[i]`, and the sets' physical facts and surface defaults per layer in one uniform array.
 * @template P the packing
 */
export type TextureSetArray<P extends TextureSetPacking = TextureSetPacking> = {
  /** The set array's id; each slot's array is registered as `<id>.<slot>`. */
  readonly id: string;
  /** The packing every layer is in. */
  readonly packing: P;
  /** The set in each layer (a swap, {@link setTextureSetArrayLayer}, changes its entry). */
  readonly sets: readonly string[];
  /** The registered array texture of each slot of the packing. */
  readonly arrays: TextureSetSlotMap<P, TextureArray>;
  /** The number of layers. */
  readonly layerCount: number;
  /** Each layer's `physicalSize`, `heightScale` and `surface` fields, four vec4s per layer: read
   * them with {@link getTextureSetLayerParams}. Shared by every material sampling the array, and
   * updated by a layer swap. */
  readonly layerParams: TextureSetLayerParamsNode;
  /** Whether {@link setTextureSetArrayLayer} can replace its layers (the arrays keep their CPU
   * copy). */
  readonly swappable: boolean;
};

/** What {@link buildTextureSetArray} builds a set array from, and how. */
export type BuildTextureSetArrayProps<P extends TextureSetPacking = TextureSetPacking> = {
  /** The set array's id. Default: derived from the packing and the sets (`tsa:<hash>`), so two
   * builds of one list share one array; a unique one for a swappable array. */
  id?: string;
  /** The texture sets' ids, layer `i` from `sets[i]`. Each must have the packing, and every slot's
   * textures the same size, mip count and codec. */
  sets: string[];
  /** The packing every layer is in (`FULL`, `LITE` or `MINIMAL`): one array per slot. */
  packing: P;
  /** Keeps the arrays' CPU copies, for {@link setTextureSetArrayLayer} (about their VRAM size
   * again in memory). Default false: the copies are dropped after the upload. */
  swappable?: boolean;
  /** Never released by its scene: only `deleteTexture` of its arrays removes it. */
  isPersistent?: boolean;
};

/** The registered set arrays by id: an entry goes when any of its arrays is disposed */
const setArrays = new Map<string, TextureSetArray>();
/** Layer swaps of one set array run in call order, so the last call's set ends up in the layer */
const swapQueues = new Map<string, Promise<void>>();

const getSlotArrayId = (id: string, slot: string) => `${id}.${slot}`;

/** The set with the id and its packing's texture ids by slot; throws naming the caller */
const getSetSlots = (caller: string, setId: string, packing: TextureSetPacking) => {
  const set = getTextureSet(setId);
  if (!set) {
    throw new Error(
      `${caller}: no data has the texture set "${setId}" (in a production build, a scene must list it in its textureSets or name it in a material input).`
    );
  }
  // Members are assembled on the CPU (KTX2 levels, an image's readback): a render target can't be
  if (set.procedural) {
    throw new Error(
      `${caller}: the texture set "${setId}" is procedural (baked by its generator "${set.procedural.generator}"), and a set array takes imported sets only: sample it through { textureSet }.`
    );
  }
  const slots = getTextureSetSlotTextures(set, packing);
  if (!slots) {
    throw new Error(
      `${caller}: the texture set "${setId}" has no packing "${packing}" (packings: ${Object.keys(set.packings).join(', ')}).`
    );
  }
  return { set, slots };
};

/** A set array member's declaration in a scene's `textureSetArrays` (`__textures`: the members
 * its `textures` doesn't declare, which the scene doesn't load on their own) */
const findArrayMemberDeclaration = (id: string) => {
  for (const scene of Object.values(getGeneratedAppData().scenes) as SceneData[]) {
    for (const entry of scene.textureSetArrays ?? []) {
      const found = entry.__textures?.find((declared) => declared.id === id);
      if (found) return found;
    }
  }
  return undefined;
};

/** A slot texture as an array member: the registered texture's id (borrowed), else its
 * declaration's props (loaded for the array alone, never registered nor uploaded) */
const getMember = (caller: string, setId: string, slot: string, textureId: string) => {
  if (getTexture(textureId)) return textureId;
  const declaration: TextureProps | undefined =
    findTextureDeclaration(textureId) ?? findArrayMemberDeclaration(textureId);
  if (!declaration) {
    throw new Error(
      `${caller}: no data declares the texture "${textureId}" (the ${slot} of the texture set "${setId}"; in a production build, a scene must name the set or the texture).`
    );
  }
  return declaration;
};

/** Writes a set's facts into its layer of the params' values */
const writeLayerParams = (values: THREE.Vector4[], layer: number, set: TextureSetDef) => {
  const { surface } = set;
  const tint = new THREE.Color(toThreeColor(surface.tint));
  const base = layer * PARAMS_PER_LAYER;
  values[base].set(
    set.physicalSize[0],
    set.physicalSize[1],
    set.heightScale,
    surface.heightContrast
  );
  values[base + 1].set(tint.r, tint.g, tint.b, surface.normalStrength);
  values[base + 2].set(
    surface.roughnessScale,
    surface.aoStrength,
    surface.porosity,
    surface.wetDarkening
  );
  values[base + 3].set(surface.wetRoughness, 0, 0, 0);
};

const createLayerParams = (sets: TextureSetDef[]) => {
  const values = Array.from({ length: sets.length * PARAMS_PER_LAYER }, () => new THREE.Vector4());
  sets.forEach((set, layer) => writeLayerParams(values, layer, set));
  return uniformArray(values, 'vec4') as TextureSetLayerParamsNode;
};

/**
 * A non-swappable set array's derived id: `tsa:<hash>` of the packing and the sets, so two builds
 * of one list share one (and a material's `{ textureSetArray: [...], packing }` finds the scene's).
 * @internal
 */
export const getTextureSetArrayId = (packing: string, sets: readonly string[]) =>
  `tsa:${hashStringFNV1a(JSON.stringify([packing, sets])).toString(36)}`;

const describeArray = (id: string, packing: string, sets: readonly string[]) =>
  `Texture set array "${id}" (${packing}: ${sets.map((set, i) => `${i} ${set}`).join(', ')})`;

/** The entry under the id when its arrays are still the registered ones, else undefined */
const getLiveEntry = (id: string) => {
  const entry = setArrays.get(id);
  if (!entry) return undefined;
  const arrays = Object.entries(entry.arrays) as [string, TextureArray][];
  if (arrays.every(([slot, array]) => getTexture(getSlotArrayId(id, slot)) === array)) {
    return entry;
  }
  setArrays.delete(id);
  return undefined;
};

/** Registers a new entry, dropped when any of its arrays is disposed (deleted or released) */
const registerEntry = (entry: TextureSetArray) => {
  setArrays.set(entry.id, entry);
  const onDispose = () => {
    if (setArrays.get(entry.id) === entry) setArrays.delete(entry.id);
  };
  for (const array of Object.values(entry.arrays) as TextureArray[]) {
    array.addEventListener('dispose', onDispose);
  }
};

/**
 * What a TSL function gets for a `{ "textureSetArray": … }` input: the packing's array textures by
 * slot (only the packing's slots are there), sampled as `.sample(uv).depth(layer)`, the layers'
 * params (read with {@link getTextureSetLayerParams}) and the layer count.
 */
export type TextureSetArrayInput = {
  /** `FULL` and `MINIMAL`: RGB albedo (sRGB), A height, per layer. */
  albedoHeight?: THREE.TextureNode;
  /** `FULL`: the tangent-space normal (OpenGL, +Y), per layer. */
  normal?: THREE.TextureNode;
  /** `FULL`: R ambient occlusion, G roughness, B metalness, per layer. */
  orm?: THREE.TextureNode;
  /** `LITE`: RGB albedo × AO (sRGB), A roughness, per layer. */
  albedoRough?: THREE.TextureNode;
  /** `LITE`: RG the normal's X and Y (Z reconstructed), B height, per layer. */
  normalHeight?: THREE.TextureNode;
  /** Each layer's `physicalSize`, `heightScale` and `surface` fields (the set array's, shared). */
  layerParams: TextureSetLayerParamsNode;
  /** The number of layers (an int). */
  layerCount: THREE.Node<'int'>;
};

/** The white array textures standing in for a set array that isn't built, by layer count */
const standIns = new Map<number, THREE.DataArrayTexture>();

const getStandIn = (layers: number) => {
  let standIn = standIns.get(layers);
  if (!standIn) {
    standIn = new THREE.DataArrayTexture(new Uint8Array(4 * layers).fill(255), 1, 1, layers);
    standIn.needsUpdate = true;
    standIns.set(layers, standIn);
  }
  return standIn;
};

/** The input's place, for an error or a warning */
const describeInput = (ctx: MaterialInputContext) =>
  `input "${ctx.key}" (${ctx.group}) in material "${ctx.materialId}"`;

/** The bundle of a set array that isn't built (its build failed, or the material was created
 * before it): white array stand-ins, the sets' own params, warned */
const getStandInBundle = (
  value: { textureSetArray: string[]; packing: TextureSetPacking },
  ctx: MaterialInputContext
) => {
  const { textureSetArray: setIds, packing } = value;
  const caller = `The texture set array of ${describeInput(ctx)}`;
  const sets = setIds.map((setId) => getSetSlots(caller, setId, packing));
  lwarn(
    `${caller} (${packing}: ${setIds.join(', ')}) isn't built: it samples white (the scene's load builds it, code awaits buildTextureSetArray first).`
  );
  const bundle: Record<string, ResolvedInputNode> = {};
  for (const slot of Object.keys(sets[0].slots)) {
    bundle[slot] = texture(getStandIn(sets.length)) as unknown as ResolvedInputNode;
  }
  bundle.layerParams = createLayerParams(
    sets.map(({ set }) => set)
  ) as unknown as ResolvedInputNode;
  bundle.layerCount = int(sets.length) as unknown as ResolvedInputNode;
  return bundle;
};

/**
 * `{ "textureSetArray": [ids], "packing" }` or `{ "textureSetArray": id }` (p303 D4): the set
 * array's bundle (`TextureSetArrayInput`). A list's array not built samples white, warned; an id
 * no set array has throws naming the input.
 */
const TEXTURE_SET_ARRAY_RESOLVER: MaterialInputResolver<TextureSetArrayInputRef> = {
  kind: 'textureSetArray',
  match: isTextureSetArrayInputRef,
  resolve: (value, ctx) => {
    const isList = Array.isArray(value.textureSetArray);
    const id = isList
      ? getTextureSetArrayId(
          (value as { packing: string }).packing,
          value.textureSetArray as string[]
        )
      : (value.textureSetArray as string);
    const entry = getLiveEntry(id);
    if (!entry) {
      if (isList) return getStandInBundle(value as Parameters<typeof getStandInBundle>[0], ctx);
      throw new Error(
        `The texture set array of ${describeInput(ctx)}: no set array "${id}" is built (list it in the scene's textureSetArrays, or await buildTextureSetArray first).`
      );
    }
    const bundle: Record<string, ResolvedInputNode> = {};
    for (const [slot, array] of Object.entries(entry.arrays) as [string, TextureArray][]) {
      // Sampler nodes, not uniform buffer allocations
      bundle[slot] = texture(array) as unknown as ResolvedInputNode;
    }
    bundle.layerParams = entry.layerParams as unknown as ResolvedInputNode;
    bundle.layerCount = int(entry.layerCount) as unknown as ResolvedInputNode;
    return bundle;
  },
  // The arrays aren't textures a load gets: the scene's load or buildTextureSetArray builds them
  dependencies: () => [],
};

/**
 * Builds a texture set array (p303 D4): one array texture per slot of the packing, layer `i` of
 * each from `sets[i]` (two for `LITE`), registered as `<id>.<slot>`, and the sets' physical facts
 * and surface defaults as one uniform array (`layerParams`, read with
 * {@link getTextureSetLayerParams}). A terrain material then binds the packing's arrays however
 * many layers it blends.
 *
 * A slot texture that's registered is copied into the array and kept; one that isn't is loaded
 * for the array alone from its declaration (never registered nor uploaded on its own). The arrays
 * are registered textures, owned by the scene that builds them (every build starts before the
 * first await, in the caller's owner scope) and released with it unless a material holds them. A
 * build of a registered id re-tags its arrays to the caller's scene and returns its set array (a
 * swappable one as its swaps left it: only its packing and layer count must match).
 *
 * Calls may overlap: two builds of one id share its arrays. When a slot fails, the arrays this
 * call registered are deleted. Re-check the scene after the await before using the arrays.
 * @param props {@link BuildTextureSetArrayProps}
 * @throws (rejects) for no sets, a set no data has or without the packing, a texture no data
 * declares, an id registered with other sets or packing, or a slot whose textures don't load or
 * don't match (size, mip count, codec, colour space): the error names the slot and each layer's
 * set
 * @example
 * ```ts
 * import { buildTextureSetArray } from 'aekasha/texturesets';
 *
 * // Four ground layers, two bindings (albedoRough, normalHeight)
 * const ground = await buildTextureSetArray({
 *   sets: ['sand01', 'grass01', 'rocks01', 'cliffs01'],
 *   packing: 'LITE',
 * });
 * ```
 */
export const buildTextureSetArray = async <P extends TextureSetPacking>(
  props: BuildTextureSetArrayProps<P>
): Promise<TextureSetArray<P>> => {
  const caller = 'buildTextureSetArray';
  const { sets: setIds, packing } = props;
  if (!setIds.length) throw new Error(`${caller}: a texture set array needs at least one set.`);
  // Registered with the first build: a material can sample a set array once one exists
  registerMaterialInputResolver(TEXTURE_SET_ARRAY_RESOLVER);
  const id =
    props.id ||
    (props.swappable
      ? `tsa:${THREE.MathUtils.generateUUID()}`
      : getTextureSetArrayId(packing, setIds));
  const existing = getLiveEntry(id);
  // A swappable one's layers may have been swapped since: its packing and layer count must match
  const isOther =
    existing &&
    (existing.packing !== packing ||
      (existing.swappable
        ? existing.layerCount !== setIds.length
        : existing.sets.join() !== setIds.join()));
  if (existing && isOther) {
    throw new Error(
      `${caller}: ${describeArray(id, existing.packing, existing.sets)} is registered already: give these sets another id.`
    );
  }
  const sets = setIds.map((setId) => getSetSlots(caller, setId, packing));
  // The packing's slots, in the gathered order (the schema's): every set of it has the same
  const slots = Object.keys(sets[0].slots);
  // Every member before any build: a texture no data declares throws with nothing started
  const members = slots.map((slot) =>
    sets.map(({ set, slots: setSlots }) =>
      getMember(caller, set.id, slot, (setSlots as Record<string, string>)[slot])
    )
  );
  const registeredBefore = slots.map((slot) => getTexture(getSlotArrayId(id, slot)));
  // Every build starts before the first await: each captures the caller's owner scope
  const builds = slots.map((slot, i) =>
    buildTextureArray({
      id: getSlotArrayId(id, slot),
      members: members[i],
      swappable: props.swappable,
      isPersistent: props.isPersistent,
      debugData: { name: `${id} ${slot}`, description: `${packing}: ${setIds.join(', ')}` },
    })
  );
  const results = await Promise.allSettled(builds);
  const failedAt = results.findIndex((result) => result.status === 'rejected');
  if (failedAt !== -1) {
    results.forEach((result, i) => {
      const slotId = getSlotArrayId(id, slots[i]);
      if (result.status === 'fulfilled' && !registeredBefore[i] && getTexture(slotId)) {
        deleteTexture(slotId);
      }
    });
    const reason = (results[failedAt] as PromiseRejectedResult).reason as Error;
    throw new Error(
      `${caller}: ${describeArray(id, packing, setIds)}, slot ${slots[failedAt]}: ${reason.message}`
    );
  }
  const arrays = Object.fromEntries(
    slots.map((slot, i) => [slot, (results[i] as PromiseFulfilledResult<TextureArray>).value])
  ) as TextureSetSlotMap<P, TextureArray>;
  // A registered id (or an overlapping build of it): its entry, when the arrays are its own
  const live = getLiveEntry(id);
  if (
    live &&
    slots.every((slot) => (live.arrays as Record<string, unknown>)[slot] === arrays[slot as never])
  ) {
    return live as TextureSetArray<P>;
  }
  const entry: TextureSetArray<P> = {
    id,
    packing,
    sets: [...setIds],
    arrays,
    layerCount: setIds.length,
    layerParams: createLayerParams(sets.map(({ set }) => set)),
    swappable: Boolean(props.swappable),
  };
  registerEntry(entry);
  return entry;
};

/**
 * The registered texture set array with the id ({@link buildTextureSetArray}), or undefined (also
 * once any of its arrays is deleted or released).
 * @param id what the build was given, or derived (`tsa:<hash>`)
 * @example
 * ```ts
 * import { getTextureSetArray } from 'aekasha/texturesets';
 *
 * const ground = getTextureSetArray('ground');
 * if (ground) console.log(`${ground.layerCount} layers: ${ground.sets.join(', ')}`);
 * ```
 */
export const getTextureSetArray = (id: string): TextureSetArray | undefined => getLiveEntry(id);

/** Swaps every slot of the layer to the set's texture; on a failure, puts the previous set's back
 * in the slots that swapped (best effort) and rethrows naming the slot */
const swapLayerAsync = async (entry: TextureSetArray, layer: number, setId: string) => {
  // Deleted while an earlier swap ran: nothing to write into
  if (getLiveEntry(entry.id) !== entry) return;
  const caller = 'setTextureSetArrayLayer';
  const { set, slots } = getSetSlots(caller, setId, entry.packing);
  const previous = getSetSlots(caller, entry.sets[layer], entry.packing).slots as Record<
    string,
    string
  >;
  const slotNames = Object.keys(entry.arrays);
  // Every member before any swap: a texture no data declares rejects with nothing swapped
  const members = slotNames.map((slot) =>
    getMember(caller, setId, slot, (slots as Record<string, string>)[slot])
  );
  const swaps = slotNames.map((slot, i) =>
    setTextureArrayLayer(getSlotArrayId(entry.id, slot), layer, members[i])
  );
  const results = await Promise.allSettled(swaps);
  const failedAt = results.findIndex((result) => result.status === 'rejected');
  if (failedAt !== -1) {
    const restores = results.map((result, i) => {
      if (result.status !== 'fulfilled' || getLiveEntry(entry.id) !== entry) return undefined;
      const slot = slotNames[i];
      return setTextureArrayLayer(
        getSlotArrayId(entry.id, slot),
        layer,
        getMember(caller, entry.sets[layer], slot, previous[slot])
      ).catch(() => {});
    });
    await Promise.all(restores);
    const reason = (results[failedAt] as PromiseRejectedResult).reason as Error;
    throw new Error(
      `${caller}: ${describeArray(entry.id, entry.packing, entry.sets)}, layer ${layer} to "${setId}", slot ${slotNames[failedAt]}: ${reason.message}`
    );
  }
  // Deleted while the textures loaded: the arrays didn't take them (setTextureArrayLayer)
  if (getLiveEntry(entry.id) !== entry) return;
  (entry.sets as string[])[layer] = setId;
  writeLayerParams(entry.layerParams.array as THREE.Vector4[], layer, set);
};

/**
 * Replaces one layer of a swappable texture set array (built with `swappable: true`) with another
 * set: every slot's array re-uploads that layer only, and the layer's params (`layerParams`) take
 * the set's. The set must have the array's packing, its textures the arrays' size, mip count and
 * format. Swaps of one set array run in call order, so the last call's set ends up in the layer;
 * one whose arrays are deleted before it writes (eg. its scene's release) resolves without
 * writing. When a slot fails, the slots already swapped get the layer's previous set back.
 * @param id the set array's registry id (its `id`)
 * @param layer the index of the layer to replace, 0 to `layerCount - 1`
 * @param setId the texture set the layer takes (its `*.textureSet.json`)
 * @throws (at once) when no swappable set array is registered under `id`, `layer` is out of
 * range, or the set is unknown or lacks the packing; the promise rejects when a texture can't
 * load or doesn't fit, naming the slot
 * @example
 * ```ts
 * import { buildTextureSetArray, setTextureSetArrayLayer } from 'aekasha/texturesets';
 *
 * await buildTextureSetArray({ id: 'gallery', sets: ['sand01', 'mud01'], packing: 'LITE', swappable: true });
 * await setTextureSetArrayLayer('gallery', 1, 'mud02');
 * ```
 */
export const setTextureSetArrayLayer = (id: string, layer: number, setId: string) => {
  const caller = 'setTextureSetArrayLayer';
  const entry = getLiveEntry(id);
  if (!entry) throw new Error(`${caller}: no texture set array "${id}" is registered.`);
  if (!entry.swappable) {
    throw new Error(
      `${caller}: texture set array "${id}" isn't swappable: build it with \`swappable: true\` to replace its layers.`
    );
  }
  if (!Number.isInteger(layer) || layer < 0 || layer >= entry.layerCount) {
    throw new Error(
      `${caller}: texture set array "${id}" has layers 0-${entry.layerCount - 1}, not ${layer}.`
    );
  }
  getSetSlots(caller, setId, entry.packing);
  const queued = (swapQueues.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(() => swapLayerAsync(entry, layer, setId));
  swapQueues.set(id, queued);
  // The last swap of the id clears its queue
  const clear = () => {
    if (swapQueues.get(id) === queued) swapQueues.delete(id);
  };
  queued.then(clear, clear);
  return queued;
};

/**
 * One layer's params of a texture set array as TSL nodes, by name: the set's `physicalSize`
 * (vec2, metres per tile), `heightScale` (metres of relief), `tint` (vec3, linear) and each other
 * `surface` field (floats), read from the array's `layerParams`.
 * @param layerParams the set array's `layerParams` (the input bundle's, or
 * {@link TextureSetArray}'s)
 * @param layer the layer index, or an int node (eg. a splat map's dominant layer)
 * @example
 * ```ts
 * import { positionWorld, uv } from 'three/tsl';
 * import { getTextureSetArray, getTextureSetLayerParams } from 'aekasha/texturesets';
 *
 * const ground = getTextureSetArray('ground');
 * if (ground) {
 *   const rock = getTextureSetLayerParams(ground.layerParams, 2);
 *   const rockUv = positionWorld.xz.div(rock.physicalSize);
 * }
 * ```
 */
export const getTextureSetLayerParams = (
  layerParams: TextureSetLayerParamsNode,
  layer: number | THREE.Node
) => {
  const base =
    typeof layer === 'number'
      ? int(layer * PARAMS_PER_LAYER)
      : int(layer as THREE.Node<'int'>).mul(PARAMS_PER_LAYER);
  const at = (offset: number) => layerParams.element(offset ? base.add(offset) : base);
  const sizeHeight = at(0);
  const tintNormal = at(1);
  const roughAoWet = at(2);
  const wet = at(3);
  return {
    physicalSize: vec2(sizeHeight.x, sizeHeight.y),
    heightScale: sizeHeight.z,
    heightContrast: sizeHeight.w,
    tint: vec3(tintNormal.x, tintNormal.y, tintNormal.z),
    normalStrength: tintNormal.w,
    roughnessScale: roughAoWet.x,
    aoStrength: roughAoWet.y,
    porosity: roughAoWet.z,
    wetDarkening: roughAoWet.w,
    wetRoughness: wet.x,
  };
};

/**
 * Builds the set arrays a scene's data lists (`textureSetArrays`, the gatherer's: listed, and the
 * ones its materials name), all at once: the `textureSets()` feature's scene hooks start this
 * when the world is cleared (the next scene owns what registers) and await it before the scene's
 * assets. A failed build is logged, and its materials sample white: the load goes on.
 * @internal
 */
export const buildSceneTextureSetArraysAsync = async (sceneData: SceneData) => {
  const entries = sceneData.textureSetArrays ?? [];
  const results = await Promise.allSettled(
    entries.map(({ id, sets, packing, swappable }) =>
      buildTextureSetArray({ id, sets, packing, swappable })
    )
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      lerror(
        `Scene "${sceneData.id}": the texture set array ${entries[i].id ?? `(${entries[i].packing}: ${entries[i].sets.join(', ')})`} could not be built.`,
        result.reason
      );
    }
  });
};
