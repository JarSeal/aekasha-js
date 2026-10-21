/**
 * The gathered asset JSONs: their suffixes, the schema each is validated with, and that
 * validation as the dev file server runs it before a write (`validateGatheredJson`).
 */
import path from 'path';
import type z from 'zod';
import {
  CameraAssetSchema,
  GeoAssetSchema,
  ImportedAssetSchema,
  ImpostorAssetSchema,
  LightAssetSchema,
  MaterialAssetSchema,
  PostFxAssetSchema,
  SkyBoxAssetSchema,
  TextureArrayAssetSchema,
  TextureAssetSchema,
  TextureAtlasAssetSchema,
} from '../../src/_engine/schemas';
import { EngineMeshAssetSchema, EngineSceneAssetSchema } from './engineSchemas';

/** Each gathered type's file suffix, in the gather's pass order */
export const GATHERED_SUFFIXES = {
  scene: '.scene.json',
  camera: '.camera.json',
  light: '.light.json',
  geometry: '.geometry.json',
  texture: '.texture.json',
  textureArray: '.textureArray.json',
  textureAtlas: '.textureAtlas.json',
  impostor: '.impostor.json',
  material: '.material.json',
  mesh: '.mesh.json',
  importedAsset: '.importedAsset.json',
  skybox: '.skybox.json',
  postFx: '.postFx.json',
} as const;

/** A gathered JSON's type, by its suffix */
export type GatheredJsonType = keyof typeof GATHERED_SUFFIXES;

const GATHERED_TYPES = Object.keys(GATHERED_SUFFIXES) as GatheredJsonType[];

/** The schema each gathered type is validated with */
export const GATHERED_SCHEMAS: Record<GatheredJsonType, z.ZodType> = {
  scene: EngineSceneAssetSchema,
  camera: CameraAssetSchema,
  light: LightAssetSchema,
  geometry: GeoAssetSchema,
  texture: TextureAssetSchema,
  textureArray: TextureArrayAssetSchema,
  textureAtlas: TextureAtlasAssetSchema,
  impostor: ImpostorAssetSchema,
  material: MaterialAssetSchema,
  mesh: EngineMeshAssetSchema,
  importedAsset: ImportedAssetSchema,
  skybox: SkyBoxAssetSchema,
  postFx: PostFxAssetSchema,
};

// The gathered types without per-scene `__saveData`
const TYPES_WITHOUT_SAVE_DATA = new Set<GatheredJsonType>([
  'textureArray',
  'textureAtlas',
  'impostor',
]);

/** A file's gathered type by its name, or undefined when it isn't one */
export const getGatheredJsonType = (filePath: string) =>
  GATHERED_TYPES.find((type) => filePath.endsWith(GATHERED_SUFFIXES[type]));

/** Whether the file name is a gathered asset JSON's */
export const isGatheredJsonFile = (filePath: string) => !!getGatheredJsonType(filePath);

/** Whether the file name is a gathered type whose schema has `__saveData` (the dev file server's
 * save entry writes) */
export const hasGatheredSaveData = (filePath: string) => {
  const type = getGatheredJsonType(filePath);
  return !!type && !TYPES_WITHOUT_SAVE_DATA.has(type);
};

/** A gathered JSON's id when it gives none: its file name without the suffix */
export const getIdFromFileName = (filePath: string, type: GatheredJsonType) =>
  path.basename(filePath, GATHERED_SUFFIXES[type]);

type ZodIssue = z.ZodError['issues'][number];

/** A union's "Invalid input" says nothing: when exactly one branch got past its type check (eg.
 * `optimize`'s object, not its `false`), its own issues are the ones to show. Nor does a record's
 * "Invalid key in record": the key's own issues are shown instead. */
export const expandUnionIssues = (issues: ZodIssue[]): ZodIssue[] =>
  issues.flatMap((issue) => {
    if (issue.code === 'invalid_key') {
      return expandUnionIssues(
        issue.issues.map((keyIssue) => ({ ...keyIssue, path: [...issue.path, ...keyIssue.path] }))
      );
    }
    if (issue.code !== 'invalid_union') return [issue];
    const isTypeMismatch = (branchIssue: ZodIssue) =>
      !branchIssue.path.length &&
      (branchIssue.code === 'invalid_type' || branchIssue.code === 'invalid_value');
    const matching = issue.errors.filter((branch) => !branch.every(isTypeMismatch));
    if (matching.length !== 1) return [issue];
    return expandUnionIssues(
      matching[0].map((branchIssue) => ({
        ...branchIssue,
        path: [...issue.path, ...branchIssue.path],
      }))
    );
  });

/** A sky box's JSON with its id defaulted to the file name, as the gather validates it (the
 * schema requires one); any other value as it is */
export const withSkyBoxIdDefault = (filePath: string, value: unknown) =>
  value && typeof value === 'object' && !('id' in value && value.id)
    ? { ...value, id: getIdFromFileName(filePath, 'skybox') }
    : value;

/**
 * Validates a JSON value against the schema of the gathered type its file name says (the dev
 * file server's writes), as the gather would.
 * @returns null when it passes or the file isn't a gathered type, else the issues the gather would
 * log
 */
export const validateGatheredJson = (filePath: string, data: unknown) => {
  const type = getGatheredJsonType(filePath);
  if (!type) return null;
  const value = type === 'skybox' ? withSkyBoxIdDefault(filePath, data) : data;
  const validation = GATHERED_SCHEMAS[type].safeParse(value);
  if (validation.success) return null;
  return expandUnionIssues(validation.error.issues).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
};
