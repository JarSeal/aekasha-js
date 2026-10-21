import fs from 'fs';
import path from 'path';
import type z from 'zod';
import type {
  CameraAsset,
  GeoAsset,
  ImportedAsset,
  ImpostorAsset,
  LightAsset,
  MaterialAsset,
  PostFxAsset,
  SkyBoxAsset,
  TextureArrayAsset,
  TextureAsset,
  TextureAtlasSlotTexture,
} from '../../src/_engine/schemas';
import type { PipelineRun } from '../assetPipeline/run';
import type { createSettingsResolver } from '../assetPipeline/settings';
import type { GeneratedLoaders } from './output';
import type { EngineMeshAsset, EngineSceneAsset } from './engineSchemas';
import { GATHERED_SUFFIXES, hasGatheredSaveData, type GatheredJsonType } from './gatheredJson';
import type { GatherLog } from './log';
import { warnOnStaleSaveData, type SaveDataHolder } from './saveEntries';

/** What every step of one gather reads */
export type GatherContext = {
  /** A production build's data: debug scenes and debug data left out, the outputs checked */
  isProduction: boolean;
  /** The folder the asset JSONs are gathered from (`src/`) */
  srcDir: string;
  /** The folder `__sourcePath`s are relative to: `srcDir`'s parent (the repo root) */
  rootDir: string;
  /** The asset pipeline's run the textures and imports get their `__url`s from */
  pipeline?: PipelineRun;
  log: GatherLog;
  /** Resolves an asset's `optimize` settings (`assets.config.json`) */
  resolveSettings: ReturnType<typeof createSettingsResolver>;
  /** The asset JSONs by type, as paths from `srcDir`, in the walk's order */
  files: Record<GatheredJsonType, string[]>;
};

/** An asset JSON's file */
export type AssetFile = {
  /** From `srcDir`, as the log names it */
  file: string;
  fullPath: string;
  /** From `rootDir`: the gathered `__sourcePath` */
  sourcePath: string;
};

/** A scene JSON pass 1 registered: the scene pass resolves it */
export type GatheredScene = { id: string; data: EngineSceneAsset; file: AssetFile };

/** Pass 1's registries, each by id, in the walk's order */
export type Registries = {
  scenes: GatheredScene[];
  cameras: Record<string, CameraAsset>;
  lights: Record<string, LightAsset>;
  geometries: Record<string, GeoAsset>;
  textures: Record<string, TextureAsset>;
  textureArrays: Record<string, TextureArrayAsset>;
  atlasSlots: Record<string, TextureAtlasSlotTexture>;
  /** An atlas's slot ids in the JSON's order: what a scene listing the atlas id gets */
  atlasSlotIds: Record<string, string[]>;
  impostors: Record<string, ImpostorAsset>;
  materials: Record<string, MaterialAsset>;
  meshes: Record<string, EngineMeshAsset>;
  importedAssets: Record<string, ImportedAsset>;
  skyboxes: Record<string, SkyBoxAsset>;
  postFx: Record<string, PostFxAsset>;
  /** The files the generated code loads on demand, by id, as paths from `srcDir` */
  loaders: GeneratedLoaders;
};

/** The id spaces: textures, arrays, atlases and their slots share one */
export type IdSpace =
  | 'scenes'
  | 'cameras'
  | 'lights'
  | 'geometries'
  | 'textures'
  | 'impostors'
  | 'materials'
  | 'meshes'
  | 'importedAssets'
  | 'skyboxes'
  | 'postFx';

/** The ids taken in each space */
export type TakenIds = Record<IdSpace, Set<string>>;

/** Empty registries and id spaces for a gather */
export const createRegistries = (): { registries: Registries; taken: TakenIds } => ({
  registries: {
    scenes: [],
    cameras: {},
    lights: {},
    geometries: {},
    textures: {},
    textureArrays: {},
    atlasSlots: {},
    atlasSlotIds: {},
    impostors: {},
    materials: {},
    meshes: {},
    importedAssets: {},
    skyboxes: {},
    postFx: {},
    loaders: { scenes: {}, tslMaterials: {}, postFx: {} },
  },
  taken: {
    scenes: new Set(),
    cameras: new Set(),
    lights: new Set(),
    geometries: new Set(),
    textures: new Set(),
    impostors: new Set(),
    materials: new Set(),
    meshes: new Set(),
    importedAssets: new Set(),
    skyboxes: new Set(),
    postFx: new Set(),
  },
});

/** The walk's files bucketed by gathered type, once (paths from `srcDir`) */
export const listGatheredFiles = (srcDir: string): Record<GatheredJsonType, string[]> => {
  const types = Object.keys(GATHERED_SUFFIXES) as GatheredJsonType[];
  const files = Object.fromEntries(types.map((type) => [type, [] as string[]])) as Record<
    GatheredJsonType,
    string[]
  >;
  for (const file of fs.readdirSync(srcDir, { recursive: true }) as string[]) {
    const type = types.find((key) => file.endsWith(GATHERED_SUFFIXES[key]));
    if (type) files[type].push(file);
  }
  return files;
};

/**
 * Takes ids in a space for a file, or logs the first one already taken (the first file keeps it)
 * and fails the gather.
 * @returns whether they were all free
 */
export const claimIds = (
  ctx: GatherContext,
  space: Set<string>,
  label: string,
  file: string,
  ...ids: string[]
) => {
  const takenId = ids.find((id) => space.has(id));
  if (takenId !== undefined) {
    ctx.log.error(`Duplicate ${label} ID found: ${takenId} in file: ${file}`);
    return false;
  }
  for (const id of ids) space.add(id);
  return true;
};

// The validation messages' names of the types
const TYPE_LABELS: Record<GatheredJsonType, string> = {
  scene: 'scene',
  camera: 'camera',
  light: 'light',
  geometry: 'geometry',
  texture: 'texture',
  textureArray: 'texture array',
  textureAtlas: 'texture atlas',
  impostor: 'impostor',
  material: 'material',
  mesh: 'mesh',
  importedAsset: 'imported asset',
  skybox: 'skybox',
  postFx: 'PostFX',
};

/**
 * Pass 1's reader, one for every type: reads each of the type's files, parses and validates it
 * (after `prepare`), warns about its stale save entries, and hands it to `onValid`. A file that
 * isn't JSON (an editor's half-written save), fails its schema, or throws in `onValid` fails the
 * gather, so the dev server keeps the page as it was (p619 §1.4 G2).
 * @param opts.prepare changes the parsed JSON before it's validated (a sky box's default id)
 */
export const readAssetJsons = <S extends z.ZodType>(
  ctx: GatherContext,
  type: GatheredJsonType,
  schema: S,
  onValid: (data: z.output<S>, file: AssetFile) => void,
  opts: { prepare?: (parsed: unknown, file: string) => unknown } = {}
) => {
  for (const file of ctx.files[type]) {
    const fullPath = path.resolve(ctx.srcDir, file);
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      const validation = schema.safeParse(opts.prepare ? opts.prepare(parsed, file) : parsed);
      if (!validation.success) {
        ctx.log.validationError(
          `Validation error inside ${TYPE_LABELS[type]} file ${file}`,
          validation.error.issues
        );
        continue;
      }
      if (hasGatheredSaveData(file)) {
        warnOnStaleSaveData(ctx.log, file, validation.data as SaveDataHolder);
      }
      onValid(validation.data, {
        file,
        fullPath,
        sourcePath: path.relative(ctx.rootDir, fullPath),
      });
    } catch (e) {
      ctx.log.error(`${file} is invalid or empty: ${(e as Error).message}`);
    }
  }
};
