import fs from 'fs';
import { listSourceFiles } from '../files';
import path from 'path';
import {
  getAtlasSlotTextureId,
  ImportedAssetSchema,
  TextureArrayAssetSchema,
  TextureAssetSchema,
  TextureAtlasAssetSchema,
  type ImportedAsset,
  type TextureArrayAsset,
  type TextureAsset,
  type TextureAtlasAsset,
} from '../../src/_engine/schemas';
import {
  resolveLodChainOptions,
  type ResolvedLodChainOptions,
} from '../../src/_engine/features/lod/LodChainOptions';
import type { PipelineAsset } from './pipeline';
import { createArraySource, resolveTextureArrayLayers, type TextureLookup } from './textureArrays';
import { createAtlasSlotSource, resolveTextureAtlas } from './textureAtlases';
import {
  createPackSource,
  resolveAssetSource,
  ROOT,
  SRC_DIR,
  toRepoPath,
  type AssetSource,
  type PackSource,
} from './sources';

/**
 * The pipeline's asset list (p300 Phase 2 step 7): every source file a `*.texture.json` or
 * `*.importedAsset.json` loads, its own and each scene's latest save entry's (step 2's decision:
 * a scene's file is optimized with the asset's one `optimize`), every `*.textureArray.json`
 * (p299 D2) and every slot of a `*.textureAtlas.json` (p299 D3). One {@link PipelineAsset} per
 * distinct encode, and a key both the run and the gatherer compute the same way, so the gatherer
 * finds each scene entry's output.
 */

export type PipelineAssetType = PipelineAsset['type'];

/** What decides an asset's source and encode: the JSON's keys, with a scene's entry merged over */
type AssetData = {
  fileName?: string;
  path?: string;
  pack?: TextureAsset['pack'];
  texOpts?: TextureAsset['texOpts'];
  importTextures?: ImportedAsset['importTextures'];
  lodChain?: ImportedAsset['lodChain'];
  __saveData?: Record<string, object[] | undefined>;
};

/** One use of an asset: the JSON as it is, or merged with a scene's latest save entry. */
type AssetUse = {
  source: AssetSource | PackSource;
  isSrgb: boolean;
  importTextures: boolean;
  /** An imported asset's `lodChain`, resolved (p347 Phase 3) */
  lodChain: ResolvedLodChainOptions | null;
};

/**
 * The source and the encode inputs of an asset's data, as the gatherer merges it for a scene
 * (`{ ...asset, ...latestEntry }`, shallow: an entry's `texOpts` replaces the JSON's). Returns
 * `{ error }` like `resolveAssetSource`, or null when there's no file at all.
 * @param jsonFile The asset JSON, absolute or relative to the repo root
 */
export const resolveAssetUse = (
  jsonFile: string,
  data: AssetData
): AssetUse | { error: string } | null => {
  const isSrgb = data.texOpts?.colorSpace === 'srgb';
  const importTextures = !!data.importTextures;
  const lodChain = data.lodChain
    ? resolveLodChainOptions(data.lodChain === true ? undefined : data.lodChain)
    : null;
  if (data.pack) {
    return { source: createPackSource(jsonFile, data.pack), isSrgb, importTextures, lodChain };
  }
  if (!data.fileName) return null;
  const source = resolveAssetSource({ jsonFile, fileName: data.fileName, path: data.path });
  return 'error' in source ? source : { source, isSrgb, importTextures, lodChain };
};

/**
 * The key of an encode: the JSON (its `optimize` applies), the source and, for a texture, its
 * colour space. A GLB's `importTextures` and `lodChain` aren't part of it: every use of a file
 * shares one output, with its textures when any use imports them (step 5), and with LOD chains
 * when any use asks for them (p347 Phase 3, the first use's options).
 */
export const getPipelineAssetKey = (type: PipelineAssetType, jsonFile: string, use: AssetUse) => {
  const source = use.source.kind === 'remote' ? use.source.url : use.source.repoPath;
  const kind = use.source.kind === 'pack' ? 'pack' : 'file';
  const colorSpace = type === 'texture' ? (use.isSrgb ? ':srgb' : ':linear') : '';
  return `${type}:${toRepoPath(path.resolve(ROOT, jsonFile))}:${kind}:${source}${colorSpace}`;
};

/** The asset's own data and each scene's latest save entry merged over it */
const listAssetUses = (data: AssetData) => [
  data,
  ...Object.values(data.__saveData ?? {}).flatMap((entries) =>
    entries?.[0] ? [{ ...data, ...entries[0] }] : []
  ),
];

/**
 * A texture array's key (p299 D2): its JSON. It has one use, with no scene entries.
 * @param jsonFile The array's JSON, absolute or relative to the repo root
 */
export const getTextureArrayAssetKey = (jsonFile: string) =>
  `textureArray:${toRepoPath(path.resolve(ROOT, jsonFile))}`;

/**
 * A texture atlas slot's key (p299 D3): its atlas's JSON and the slot's name. One use each, with
 * no scene entries.
 * @param jsonFile The atlas's JSON, absolute or relative to the repo root
 */
export const getTextureAtlasSlotAssetKey = (jsonFile: string, slot: string) =>
  `textureAtlas:${toRepoPath(path.resolve(ROOT, jsonFile))}:${slot}`;

type AssetJsonBase = {
  id: string;
  /** Absolute */
  jsonFile: string;
};

export type AssetJson =
  | (AssetJsonBase & { type: 'texture'; data: TextureAsset })
  | (AssetJsonBase & { type: 'importedAsset'; data: ImportedAsset })
  | (AssetJsonBase & { type: 'textureArray'; data: TextureArrayAsset })
  | (AssetJsonBase & { type: 'textureAtlas'; data: TextureAtlasAsset });

const ASSET_SCHEMAS = {
  texture: { suffix: '.texture.json', schema: TextureAssetSchema },
  importedAsset: { suffix: '.importedAsset.json', schema: ImportedAssetSchema },
  textureArray: { suffix: '.textureArray.json', schema: TextureArrayAssetSchema },
  textureAtlas: { suffix: '.textureAtlas.json', schema: TextureAtlasAssetSchema },
} as const;

/**
 * An asset JSON, or one of its uses, left out of the run: the run can't tell which outputs are
 * still its, so it must not prune (p619 §1.4 A2). The gatherer reports the same problems.
 */
export type DroppedAsset = {
  /** '/'-separated, relative to the repo root */
  jsonFile: string;
  reason: string;
};

/**
 * Reads every `*.texture.json`, `*.importedAsset.json`, `*.textureArray.json` and
 * `*.textureAtlas.json` under `src/` (not in the outputs' folders). An invalid one (not JSON, or failing its schema) is left
 * out and listed in `dropped`: the gatherer reports it.
 */
export const readAssetJsons = (
  srcDir = SRC_DIR
): { assetJsons: AssetJson[]; dropped: DroppedAsset[] } => {
  const files = listSourceFiles(srcDir).sort();
  const assets: AssetJson[] = [];
  const dropped: DroppedAsset[] = [];
  for (const type of ['texture', 'importedAsset', 'textureArray', 'textureAtlas'] as const) {
    const { suffix, schema } = ASSET_SCHEMAS[type];
    for (const file of files.filter((f) => f.endsWith(suffix))) {
      const jsonFile = path.join(srcDir, file);
      let json: unknown;
      try {
        json = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
      } catch (error) {
        dropped.push({ jsonFile: toRepoPath(jsonFile), reason: (error as Error).message });
        continue;
      }
      const validation = schema.safeParse(json);
      if (!validation.success) {
        const [issue] = validation.error.issues;
        const at = issue.path.length ? ` at ${issue.path.join('.')}` : '';
        dropped.push({ jsonFile: toRepoPath(jsonFile), reason: `${issue.message}${at}` });
        continue;
      }
      const data = validation.data;
      const id = data.id || path.basename(file, suffix);
      assets.push({ type, id, jsonFile, data } as AssetJson);
    }
  }
  return { assetJsons: assets, dropped };
};

/** An array's encode, or why its layers don't resolve (the gatherer reports it) */
const collectTextureArray = (
  { id, jsonFile, data }: Extract<AssetJson, { type: 'textureArray' }>,
  findTexture: TextureLookup
): PipelineAsset | { error: string } => {
  const isSrgb = data.texOpts?.colorSpace === 'srgb';
  const { layers, errors } = resolveTextureArrayLayers(jsonFile, data.layers, findTexture, {
    isSrgb,
  });
  if (errors.length) return { error: errors.join('; ') };
  return {
    type: 'textureArray',
    id,
    jsonFile: toRepoPath(jsonFile),
    source: createArraySource(jsonFile, layers, data.size),
    ...(data.optimize !== undefined ? { optimize: data.optimize } : {}),
    isSrgb,
  };
};

/**
 * An atlas's slots, one encode each by its key, or why its cells don't resolve or don't fit (the
 * gatherer reports it)
 */
const collectTextureAtlas = (
  { id, jsonFile, data }: Extract<AssetJson, { type: 'textureAtlas' }>,
  findTexture: TextureLookup
): [string, PipelineAsset][] | { error: string } => {
  const { layout, errors } = resolveTextureAtlas(jsonFile, data, findTexture);
  if (!layout) return { error: errors.join('; ') || 'its layout failed' };
  return Object.entries(data.slots).map(([slot, { texOpts, fill, optimize }]) => [
    getTextureAtlasSlotAssetKey(jsonFile, slot),
    {
      type: 'textureAtlas',
      id: getAtlasSlotTextureId(id, slot),
      jsonFile: toRepoPath(jsonFile),
      source: createAtlasSlotSource(jsonFile, id, layout, slot, {
        fill,
        alphaCoverage: optimize?.alphaCoverage,
      }),
      ...(optimize !== undefined ? { optimize } : {}),
      isSrgb: texOpts?.colorSpace === 'srgb',
    },
  ]);
};

/**
 * Every encode the asset JSONs need, one per key ({@link getPipelineAssetKey},
 * {@link getTextureArrayAssetKey}, {@link getTextureAtlasSlotAssetKey}). A use whose source
 * doesn't resolve, an array whose layers don't and an atlas whose layout fails are left out and
 * listed in `dropped` (the gatherer reports them).
 */
export const collectPipelineAssets = (assetJsons: AssetJson[]) => {
  const assets = new Map<string, PipelineAsset>();
  const dropped: DroppedAsset[] = [];
  const drop = (jsonFile: string, reason: string) =>
    dropped.push({ jsonFile: toRepoPath(jsonFile), reason });
  const textures = new Map(
    assetJsons.flatMap((asset) => (asset.type === 'texture' ? [[asset.id, asset] as const] : []))
  );
  const findTexture: TextureLookup = (id) => textures.get(id);
  for (const assetJson of assetJsons) {
    if (assetJson.type === 'textureArray') {
      const asset = collectTextureArray(assetJson, findTexture);
      if ('error' in asset) drop(assetJson.jsonFile, asset.error);
      else assets.set(getTextureArrayAssetKey(assetJson.jsonFile), asset);
      continue;
    }
    if (assetJson.type === 'textureAtlas') {
      const slots = collectTextureAtlas(assetJson, findTexture);
      if ('error' in slots) drop(assetJson.jsonFile, slots.error);
      else for (const [key, asset] of slots) assets.set(key, asset);
      continue;
    }
    const { type, id, jsonFile, data } = assetJson;
    // The JSON's own (p341), for every use: a scene entry has no `optimize`
    const alphaCoverage =
      assetJson.type === 'texture' && assetJson.data.optimize
        ? assetJson.data.optimize.alphaCoverage
        : undefined;
    for (const useData of listAssetUses(data)) {
      const use = resolveAssetUse(jsonFile, useData);
      if (!use) continue;
      if ('error' in use) {
        drop(jsonFile, use.error);
        continue;
      }
      const key = getPipelineAssetKey(type, jsonFile, use);
      const existing = assets.get(key);
      if (existing) {
        if (use.importTextures) existing.importTextures = true;
        if (use.lodChain && !existing.lodChain) {
          existing.lodChain = use.lodChain;
        } else if (
          use.lodChain &&
          JSON.stringify(use.lodChain) !== JSON.stringify(existing.lodChain)
        ) {
          existing.hasLodChainConflict = true;
        }
        continue;
      }
      assets.set(key, {
        type,
        id,
        jsonFile: toRepoPath(jsonFile),
        source: use.source,
        ...(data.optimize !== undefined ? { optimize: data.optimize } : {}),
        ...(type === 'texture'
          ? { isSrgb: use.isSrgb, ...(alphaCoverage !== undefined ? { alphaCoverage } : {}) }
          : {
              importTextures: use.importTextures,
              ...(use.lodChain ? { lodChain: use.lodChain } : {}),
            }),
      });
    }
  }
  return { assets, dropped };
};
