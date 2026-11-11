import path from 'path';
import {
  getMergeMaterialSlotTextureId,
  isTextureArrayLayerFile,
  MERGE_MATERIAL_SLOTS,
  ORM_SOURCE_MAP_KEYS,
  type AssetOptimize,
  type MergeMaterialAsset,
  type MergeMaterialSlot,
  type TexturePack,
  type TextureSlot,
} from '../../src/_engine/schemas';
import { checkMergeMaterialClass, type MaterialLookup } from './mergeMaterialClass';
import { getMergeMaterialSlotLogicalPath } from './outputs';
import { createPackSource, resolveAssetSource } from './sources';
import {
  createArraySource,
  resolveTextureSourceRef,
  type ArraySource,
  type TextureArrayLayer,
  type TextureLookup,
} from './textureArrays';
import { PUBLIC_DIR } from '../paths';

/**
 * A merge material palette's arrays (p374 D2): each slot a member uses is one texture array job,
 * layer `i` built from member `i`'s map. A member without one gets a neutral layer (a pack of
 * constants at the slot's size: white, or a flat normal), which keeps its scalars as three does
 * without the map. `orm` takes a member's ORM texture as it is when its `aoMap`, `roughnessMap`
 * and `metalnessMap` are one texture, and else packs their r, g and b (a missing map's channel 1).
 * The class check (D1) runs first; the gatherer and the pipeline share this.
 */

/** What each slot's array is: its pipeline slot, colour space, and a missing map's layer */
const SLOT_BUILDS: Record<
  MergeMaterialSlot,
  { pipelineSlot: TextureSlot; isSrgb: boolean; neutral: TexturePack['channels'] }
> = {
  map: { pipelineSlot: 'baseColor', isSrgb: true, neutral: { rgb: 1 } },
  normalMap: { pipelineSlot: 'normal', isSrgb: false, neutral: { r: 0.5, g: 0.5, b: 1 } },
  orm: { pipelineSlot: 'orm', isSrgb: false, neutral: { rgb: 1 } },
  emissiveMap: { pipelineSlot: 'emissive', isSrgb: true, neutral: { rgb: 1 } },
};

/** The `orm` pack's channel for each source map, as three reads them */
const ORM_CHANNELS = { aoMap: 'r', roughnessMap: 'g', metalnessMap: 'b' } as const;

/** The sampler state an array has one of, with three's value when a texture leaves it out */
const SAMPLER_DEFAULTS = {
  mapping: 300,
  wrapS: 1001,
  wrapT: 1001,
  magFilter: 1006,
  minFilter: 1008,
  anisotropy: 1,
} as const;

type SamplerKey = keyof typeof SAMPLER_DEFAULTS;

/** One slot's array job */
export type MergeMaterialSlotBuild = {
  slot: MergeMaterialSlot;
  /** Its texture id, `<paletteId>.<slot>` */
  id: string;
  source: ArraySource;
  isSrgb: boolean;
  /** The palette's, with the slot's pipeline slot */
  optimize: AssetOptimize;
  /** The sampler state its members' textures agree on (only what one of them sets), and the
   * colour space */
  texOpts: Partial<Record<SamplerKey, number>> & { colorSpace?: 'srgb' };
  /** By palette index: the member has a map in the slot */
  has: boolean[];
};

/** A palette's arrays, or its problems (each naming the member and the property, or the slot) */
export type ResolvedMergeMaterial = {
  slots: MergeMaterialSlotBuild[];
  errors: string[];
  warnings: string[];
};

/** A file as a pack `src` of the palette's JSON: relative to it under `src/`, else its URL path */
const toPackSrc = (paletteJsonFile: string, file: string, kind: 'relative' | 'public') => {
  if (kind === 'public') {
    return encodeURI(`/${path.relative(PUBLIC_DIR, file).split(path.sep).join('/')}`);
  }
  const relative = path.relative(path.dirname(paletteJsonFile), file).split(path.sep).join('/');
  return relative.startsWith('../') ? relative : `./${relative}`;
};

type LayerContext = {
  jsonFile: string;
  palette: MergeMaterialAsset;
  findTexture: TextureLookup;
  errors: string[];
  /** The texture JSONs packed into the current slot's layers, for `ArraySource.jsonFiles` */
  packedJsonFiles: Set<string>;
};

const getNeutralLayer = (ctx: LayerContext, slot: MergeMaterialSlot, key: string) => {
  const size = ctx.palette.slots[slot]!.size;
  const pack: TexturePack = { size, channels: SLOT_BUILDS[slot].neutral };
  return { key, source: createPackSource(ctx.jsonFile, pack) } satisfies TextureArrayLayer;
};

/** A member's map as a whole layer: a texture asset's file or pack */
const getTextureLayer = (
  ctx: LayerContext,
  slot: MergeMaterialSlot,
  label: string,
  textureId: string
): TextureArrayLayer | undefined => {
  if (isTextureArrayLayerFile(textureId) || !ctx.findTexture(textureId)) {
    ctx.errors.push(
      `${label}: "${textureId}" isn't a texture JSON's id (*.texture.json): a layer is a texture asset's source, never an array, an atlas slot or a file`
    );
    return undefined;
  }
  const layer = resolveTextureSourceRef(ctx.jsonFile, textureId, ctx.findTexture, {
    isSrgb: SLOT_BUILDS[slot].isSrgb,
    target: `slots.${slot}`,
  });
  if (typeof layer === 'string') {
    ctx.errors.push(`${label}: ${layer}`);
    return undefined;
  }
  return layer;
};

/** A packed `orm` channel's source: a texture asset's file (a pack can't be packed again) */
const getOrmChannelSrc = (ctx: LayerContext, label: string, textureId: string) => {
  const found = ctx.findTexture(textureId);
  if (!found || isTextureArrayLayerFile(textureId)) {
    ctx.errors.push(`${label}: "${textureId}" isn't a texture JSON's id (*.texture.json)`);
    return undefined;
  }
  const { jsonFile, data } = found;
  if (data.pack) {
    ctx.errors.push(
      `${label}: "${textureId}" is a packed texture, whose channels can't be packed again: give the member one ORM texture for its aoMap, roughnessMap and metalnessMap, or file-based maps`
    );
    return undefined;
  }
  if (typeof data.fileName !== 'string') {
    ctx.errors.push(`${label}: "${textureId}" has no single fileName (a cube texture, or none)`);
    return undefined;
  }
  const source = resolveAssetSource({ jsonFile, fileName: data.fileName, path: data.path });
  if ('error' in source || source.kind === 'remote') {
    ctx.errors.push(
      `${label}: "${textureId}": ${'error' in source ? source.error : "a remote file isn't read"}`
    );
    return undefined;
  }
  ctx.packedJsonFiles.add(path.resolve(jsonFile));
  return toPackSrc(ctx.jsonFile, source.file, source.kind);
};

/** A member's `orm` layer: its one ORM texture, or its maps' channels packed */
const getOrmLayer = (
  ctx: LayerContext,
  label: string,
  key: string,
  maps: Record<string, string>
): TextureArrayLayer | undefined => {
  const ids = ORM_SOURCE_MAP_KEYS.map((mapKey) => maps[mapKey]);
  if (ids[0] && ids.every((id) => id === ids[0])) {
    const layer = getTextureLayer(ctx, 'orm', `${label}: params.aoMap`, ids[0]);
    return layer && { ...layer, key };
  }
  const channels: TexturePack['channels'] = {};
  for (const mapKey of ORM_SOURCE_MAP_KEYS) {
    const channel = ORM_CHANNELS[mapKey];
    const textureId = maps[mapKey];
    if (!textureId) {
      channels[channel] = 1;
      continue;
    }
    const src = getOrmChannelSrc(ctx, `${label}: params.${mapKey}`, textureId);
    if (!src) return undefined;
    channels[channel] = { src, channel };
  }
  const pack: TexturePack = { size: ctx.palette.slots.orm!.size, channels };
  return { key, source: createPackSource(ctx.jsonFile, pack) };
};

/** The sampler state the slot's textures agree on, or an error for each key they don't */
const resolveSlotSampler = (
  ctx: LayerContext,
  slot: MergeMaterialSlot,
  used: { member: string; textureId: string }[]
) => {
  const texOpts: MergeMaterialSlotBuild['texOpts'] = SLOT_BUILDS[slot].isSrgb
    ? { colorSpace: 'srgb' }
    : {};
  for (const key of Object.keys(SAMPLER_DEFAULTS) as SamplerKey[]) {
    const byValue = new Map<number, string[]>();
    let isSet = false;
    for (const { member, textureId } of used) {
      const value = ctx.findTexture(textureId)?.data.texOpts?.[key];
      if (value !== undefined) isSet = true;
      const resolved = value ?? SAMPLER_DEFAULTS[key];
      byValue.set(resolved, [...(byValue.get(resolved) ?? []), `"${member}" (${textureId})`]);
    }
    if (byValue.size > 1) {
      const values = [...byValue].map(([value, names]) => `${value} in ${names.join(', ')}`);
      ctx.errors.push(
        `slots.${slot}: the members' textures differ in texOpts.${key}: ${values.join('; ')} (an array has one sampler; unset is three's ${SAMPLER_DEFAULTS[key]})`
      );
    } else if (isSet) {
      texOpts[key] = [...byValue.keys()][0];
    }
  }
  return texOpts;
};

/** One slot's job, or undefined when no member uses it (the class check warned) or it failed */
const resolveSlot = (
  ctx: LayerContext,
  paletteId: string,
  slot: MergeMaterialSlot,
  maps: Record<string, string>[],
  memberJsonFiles: string[]
): MergeMaterialSlotBuild | undefined => {
  const has = maps.map((entry) => Object.keys(entry).length > 0);
  if (!has.some(Boolean)) return undefined;
  const errorCount = ctx.errors.length;
  ctx.packedJsonFiles = new Set();
  const used: { member: string; textureId: string }[] = [];
  const layers = ctx.palette.materials.map((member, index): TextureArrayLayer | undefined => {
    const entry = maps[index];
    const label = `materials[${index}] "${member}"`;
    for (const textureId of new Set(Object.values(entry))) used.push({ member, textureId });
    if (!has[index]) return getNeutralLayer(ctx, slot, member);
    if (slot === 'orm') return getOrmLayer(ctx, label, member, entry);
    const [[mapKey, textureId]] = Object.entries(entry);
    const layer = getTextureLayer(ctx, slot, `${label}: params.${mapKey}`, textureId);
    return layer && { ...layer, key: member };
  });
  const texOpts = resolveSlotSampler(ctx, slot, used);
  if (ctx.errors.length > errorCount) return undefined;
  const textureJsonFiles = layers.flatMap((layer) =>
    layer?.texture ? [path.resolve(layer.texture.jsonFile)] : []
  );
  const { pipelineSlot, isSrgb } = SLOT_BUILDS[slot];
  return {
    slot,
    id: getMergeMaterialSlotTextureId(paletteId, slot),
    source: createArraySource(
      ctx.jsonFile,
      layers as TextureArrayLayer[],
      ctx.palette.slots[slot]!.size,
      {
        logicalPath: getMergeMaterialSlotLogicalPath(path.resolve(ctx.jsonFile), slot),
        jsonFiles: [...new Set([...memberJsonFiles, ...ctx.packedJsonFiles, ...textureJsonFiles])],
      }
    ),
    isSrgb,
    optimize: { ...ctx.palette.optimize, slot: pipelineSlot },
    texOpts,
    has,
  };
};

/**
 * Resolves a palette into one array job per slot a member uses: the class check (D1), then each
 * slot's layers (a member's map, its `orm` maps packed, or a neutral layer) and the sampler state
 * the members' textures agree on. Errors, each naming the member and the property (or the slot):
 * the class check's, a map that isn't a texture JSON's id or can't be a layer (see
 * `resolveTextureSourceRef`), a packed texture or one without a single file in a packed `orm`,
 * and a sampler setting the slot's textures don't agree on.
 * @param jsonFile The palette's JSON, absolute or relative to the repo root
 * @param paletteId Its id (the JSON's, else its file name): its slots' texture ids' prefix
 */
export const resolveMergeMaterial = (
  jsonFile: string,
  paletteId: string,
  palette: MergeMaterialAsset,
  findMaterial: MaterialLookup,
  findTexture: TextureLookup
): ResolvedMergeMaterial => {
  const { errors, warnings, members, maps } = checkMergeMaterialClass(palette, findMaterial);
  if (errors.length) return { slots: [], errors, warnings };
  const memberJsonFiles = members.flatMap((member) =>
    member ? [path.resolve(member.jsonFile)] : []
  );
  const ctx: LayerContext = {
    jsonFile: path.resolve(jsonFile),
    palette,
    findTexture,
    errors,
    packedJsonFiles: new Set(),
  };
  const slots: MergeMaterialSlotBuild[] = [];
  for (const slot of MERGE_MATERIAL_SLOTS) {
    const slotMaps = maps[slot];
    if (!slotMaps) continue;
    const build = resolveSlot(ctx, paletteId, slot, slotMaps, memberJsonFiles);
    if (build) slots.push(build);
  }
  return { slots: errors.length ? [] : slots, errors, warnings };
};
