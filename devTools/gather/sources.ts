/**
 * What an asset JSON points at on disk: its source files (checked, measured, and resolved into
 * the asset pipeline's outputs), and the code a scene, TSL material or PostFX pass loads.
 */
import fs from 'fs';
import path from 'path';
import type { AssetOptimize, TexturePack } from '../../src/_engine/schemas';
import { GENERATED_FIELD_KEYS, getGeneratedFields } from '../assetPipeline/generated';
import { listPackFiles } from '../assetPipeline/pack';
import {
  createPackSource,
  getAssetSourceFileSize,
  resolveAssetSource,
  resolvePackFile,
} from '../assetPipeline/sources';
import type { GatherContext } from './context';

/** Bytes on disk of an asset JSON's source file (relative to the JSON, or served from
 * src/public by its URL path, eg. '/debugger/assets/box.glb'), or undefined if it is missing.
 * Remote URLs have no size here (the debugger can measure them on demand). */
export const getSourceFileSize = (jsonFile: string, fileName?: string, urlPath?: string) => {
  if (!fileName) return undefined;
  const source = resolveAssetSource({ jsonFile, fileName, path: urlPath });
  return 'error' in source ? undefined : getAssetSourceFileSize(source);
};

type GeneratedFieldsTarget = Parameters<typeof getGeneratedFields>[3];

/** Replaces an asset's generated keys (`__url` and its figures) with its file's in the
 * pipeline's run */
export const setGeneratedFields = (
  ctx: GatherContext,
  data: GeneratedFieldsTarget,
  type: 'texture' | 'importedAsset',
  jsonFile: string
) => {
  for (const key of GENERATED_FIELD_KEYS) delete (data as Record<string, unknown>)[key];
  Object.assign(
    data,
    getGeneratedFields(ctx.pipeline, type, jsonFile, data, { isProduction: ctx.isProduction })
  );
};

type SourcedAsset = {
  fileName?: string;
  path?: string;
  optimize?: AssetOptimize;
  pack?: TexturePack;
  useHDRLoader?: boolean;
  __saveData?: Record<string, { fileName?: string; path?: string }[] | undefined>;
};

/** A texture's `pack` (p300 DD5): in place of `fileName`, and every source file must exist. */
const checkPackSources = (fullPath: string, data: SourcedAsset & { pack: TexturePack }) => {
  const errors: string[] = [];
  if (data.fileName || data.path) {
    errors.push('"pack" builds the texture: it can\'t be combined with "fileName" or "path"');
  }
  if (data.useHDRLoader) errors.push('"pack" writes an 8-bit image: remove "useHDRLoader"');
  for (const src of listPackFiles(data.pack)) {
    try {
      resolvePackFile(fullPath, src);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return errors;
};

/**
 * Checks an asset JSON's source files, its own and each scene's latest save entry's (p300 DD3),
 * and resolves its `optimize` settings for each (an unknown profile throws). Logs every problem.
 * @returns false if there was one
 */
export const checkAssetSources = (
  ctx: GatherContext,
  file: string,
  fullPath: string,
  data: SourcedAsset
) => {
  if (data.pack) {
    const { pack } = data;
    const errors = checkPackSources(fullPath, { ...data, pack });
    try {
      const { repoPath } = createPackSource(fullPath, pack);
      ctx.resolveSettings({ sourcePath: repoPath, optimize: data.optimize });
    } catch (e) {
      errors.push((e as Error).message);
    }
    for (const error of errors) ctx.log.error(`${file}: ${error}`);
    if (errors.length) return false;
  }
  const sources = [{ label: '', fileName: data.fileName, path: data.path }];
  for (const [sceneId, entries] of Object.entries(data.__saveData ?? {})) {
    const entry = entries?.[0];
    if (!entry?.fileName && !entry?.path) continue;
    sources.push({
      label: ` (save data of scene "${sceneId}")`,
      fileName: entry.fileName ?? data.fileName,
      path: entry.path ?? data.path,
    });
  }
  let isValid = true;
  for (const { label, fileName, path: urlPath } of sources) {
    if (!fileName) continue;
    const source = resolveAssetSource({ jsonFile: fullPath, fileName, path: urlPath });
    let error = 'error' in source ? source.error : undefined;
    if (!('error' in source) && data.optimize) {
      if (source.kind === 'remote') {
        error = `"optimize" is set, but a remote file ("${fileName}") can't be optimized`;
      } else {
        try {
          ctx.resolveSettings({ sourcePath: source.repoPath, optimize: data.optimize });
        } catch (e) {
          error = (e as Error).message;
        }
      }
    }
    if (error) {
      ctx.log.error(`${file}${label}: ${error}`);
      isValid = false;
    }
  }
  return isValid;
};

/** The first folder of a file under `srcDir` (`app`, `toolkit`): a `tslFile` is resolved from
 * it */
export const getTopFolder = (srcDir: string, fullPath: string) =>
  path.relative(srcDir, fullPath).split(path.sep)[0];

/**
 * A code file a JSON names (a `sceneFile` or a `tslFile`), resolved from `folder`, with `.ts`
 * added when the name has no extension and only that exists.
 * @returns the file, or `{ missing }` with the path it was looked for at
 */
export const resolveCodeFile = (folder: string, name: string): string | { missing: string } => {
  const file = path.resolve(folder, name);
  if (fs.existsSync(file)) return file;
  if (!path.extname(file) && fs.existsSync(`${file}.ts`)) return `${file}.ts`;
  return { missing: file };
};
