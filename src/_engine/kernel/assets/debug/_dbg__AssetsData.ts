// The Assets tab's data (p806 D11: out of _dbg__Assets.ts): the generated data's declarations, the
// list's rows and scope, and what a load report and the asset pipeline say about an asset, as
// plain text for the tab and the info windows.
import type * as THREE from 'three/webgpu';
import { getGeometryRegistry } from '../Geometry';
import { getTextureRegistry } from '../Texture';
import { getCurrentSceneId, getGeneratedAppData, getGeneratedSceneData } from '../../scene/Scene';
import { getImportedAsset } from '../import/ImportRegistry';
import { getAssetOwner } from '../AssetOwners';
import { isLoadingSourceFiles, toAppUrl } from '../AssetUrl';
import type { AssetLoadReport, AssetsWorkerTarget } from '../AssetsAPITypes';
import type { GeneratedAssetFields } from '../../../schemas/AssetsConfigSchema';
import type { TextureAtlasSlotInfo } from '../../../schemas/TextureAtlasSchema';
import { getTextureArrayInfo } from '../TextureArray';
import { getTextureAtlasInfo } from '../TextureAtlas';
import { formatBytes, getTextureDepth } from './_dbg__AssetStats';
import { assetsUIState, plural, rowKey, type AssetKind } from './_dbg__AssetsState';

export type AssetRow = {
  kind: AssetKind;
  id: string;
  name: string;
  description?: string;
  /** What kind of texture, when the id doesn't say (an array, an atlas slot) */
  variant?: string;
  /** Owner scene id (see AssetOwners). */
  owner?: string;
};

// --- Generated data (declared assets, baked file sizes) ---

export type DeclaredFile = {
  id?: string;
  fileName?: string | string[];
  path?: string;
  __fileSize?: number;
  /** The asset JSON's path (dev data) */
  __sourcePath?: string;
  /** A texture array asset's layer sources as its JSON lists them (dev data) */
  layers?: string[];
  /** A texture array asset's layer names */
  __layers?: string[];
  /** A texture atlas slot's layout and cell table */
  __atlas?: TextureAtlasSlotInfo;
} & GeneratedAssetFields;
type GeneratedData = {
  textures?: Record<string, DeclaredFile>;
  importedAssets?: Record<string, DeclaredFile>;
  scenes: Record<
    string,
    { textures?: (string | DeclaredFile)[]; importedAssets?: (string | DeclaredFile)[] }
  >;
};

export const getGeneratedData = () => getGeneratedAppData() as unknown as GeneratedData;

/** A texture's or import's declaration: the current scene's resolved entry (a scene's save
 * entry can point the asset at another file, with its own pipeline output), else the dev registry,
 * else any scene's entry (a production-gathered build only keeps the scenes). */
export const findDeclaration = (kind: 'textures' | 'importedAssets', id: string) => {
  const data = getGeneratedData();
  const findInScene = (scene?: GeneratedData['scenes'][string]) => {
    const found = scene?.[kind]?.find((entry) => typeof entry !== 'string' && entry.id === id);
    return found && typeof found !== 'string' ? found : undefined;
  };
  const sceneId = getCurrentSceneId();
  const inCurrentScene = sceneId ? findInScene(data.scenes[sceneId]) : undefined;
  if (inCurrentScene) return inCurrentScene;
  if (data[kind]?.[id]) return data[kind]![id];
  for (const scene of Object.values(data.scenes)) {
    const found = findInScene(scene);
    if (found) return found;
  }
  return undefined;
};

const toIds = (entries?: (string | { id?: string })[]) =>
  (entries || []).map((entry) => (typeof entry === 'string' ? entry : entry.id)).filter(Boolean);

/** Assets the current scene's JSON declares: its textures, geometries, and the
 * geometries/textures its imported assets registered. */
const getSceneDeclaredKeys = () => {
  const keys = new Set<string>();
  const sceneId = getCurrentSceneId();
  const sceneData = sceneId ? getGeneratedSceneData(sceneId) : undefined;
  if (!sceneData) return keys;
  for (const id of toIds(sceneData.textures as (string | { id?: string })[])) {
    keys.add(rowKey('texture', id as string));
  }
  for (const id of toIds(sceneData.geometries as (string | { id?: string })[])) {
    keys.add(rowKey('geometry', id as string));
  }
  for (const importId of toIds(sceneData.importedAssets as (string | { id?: string })[])) {
    const manifest = getImportedAsset(importId as string);
    manifest?.geometries.forEach((g) => keys.add(rowKey('geometry', g.geometryId)));
    manifest?.textureIds.forEach((id) => keys.add(rowKey('texture', id)));
  }
  return keys;
};

// --- List ---

/** "array, 3 layers", "atlas slot, 6 cells": what a texture is when its id doesn't say. */
const getTextureVariant = (texture: THREE.Texture) => {
  const atlas = getTextureAtlasInfo(texture);
  if (atlas) return `atlas slot, ${plural(Object.keys(atlas.cells).length, 'cell')}`;
  const depth = getTextureDepth(texture);
  if (getTextureArrayInfo(texture) || depth > 1) return `array, ${plural(depth, 'layer')}`;
  return undefined;
};

export const getAllAssetRows = (): AssetRow[] => {
  const rows: AssetRow[] = [];
  for (const [id, entry] of Object.entries(getTextureRegistry())) {
    const t = entry.resource;
    rows.push({
      kind: 'texture',
      id,
      name: (t.userData.name as string) || t.name || id,
      description: t.userData.description as string | undefined,
      variant: getTextureVariant(t),
      owner: getAssetOwner(t),
    });
  }
  for (const [id, entry] of Object.entries(getGeometryRegistry())) {
    rows.push({
      kind: 'geometry',
      id,
      name: entry.debugData?.name || id,
      description: entry.debugData?.description,
      owner: getAssetOwner(entry.resource),
    });
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
};

/** The listed rows by the scope, and how many loaded assets aren't in this scene (declared by its
 * JSON, or owned by it: registered or reused by its code too). */
export const getAssetsListState = () => {
  const all = getAllAssetRows();
  const declared = getSceneDeclaredKeys();
  const sceneId = getCurrentSceneId();
  const inScene = all.filter(
    (row) => declared.has(rowKey(row.kind, row.id)) || (sceneId && row.owner === sceneId)
  );
  const rows = assetsUIState.scope === 'ALL' ? all : inScene;
  return { rows, notInSceneCount: all.length - inScene.length };
};

export const isAssetLoaded = ({ kind, id }: { kind: AssetKind; id: string }) =>
  kind === 'texture' ? Boolean(getTextureRegistry()[id]) : Boolean(getGeometryRegistry()[id]);

// --- Loads and the asset pipeline ---

export const THREAD_TEXT: Record<AssetsWorkerTarget, string> = {
  MAIN_THREAD: 'Main thread',
  WORKER_THREAD: 'Worker thread',
};

/** Where an asset was loaded, from its load report. */
export const describeLoadReport = (report?: AssetLoadReport) => {
  if (!report) return { loadedOn: '— (not loaded through the assets API)', duration: '—' };
  const loadedOn = report.fallbackCause
    ? `${THREAD_TEXT[report.loadedOn]} (worker fallback: ${report.fallbackCause}, ${report.fallbackDetail})`
    : THREAD_TEXT[report.loadedOn];
  return { loadedOn, duration: `${report.durationMs.toFixed(1)} ms` };
};

export const toUrls = (fileName?: string | string[], urlPath?: string) =>
  (Array.isArray(fileName) ? fileName : fileName ? [fileName] : []).map(
    (name) => new URL(`${urlPath || ''}${name}`, document.baseURI).href
  );

/** Sum of the content-length of HEAD requests to the URLs, or undefined if any is unknown. */
export const measureFileSizeAsync = async (urls: string[]) => {
  let total = 0;
  for (const url of urls) {
    const response = await fetch(url, { method: 'HEAD' });
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || !length) return undefined;
    total += length;
  }
  return total;
};

const formatInOut = (bytes?: { in: number; out: number }) => {
  if (!bytes) return undefined;
  const change = bytes.in ? Math.round((bytes.out / bytes.in - 1) * 100) : 0;
  return `${formatBytes(bytes.in)} → ${formatBytes(bytes.out)} (${change > 0 ? '+' : ''}${change}%)`;
};

/** What the info window shows of an asset's pipeline side: its folder's title and rows. */
export type PipelineDescription = {
  loadedUrl?: string;
  loadedText: string;
  loadedBytes?: number;
  title: string;
  rows: [string, string][];
};

/**
 * The asset pipeline's side of a declared asset (p300): the file this page load loaded (the
 * pipeline's output, or its source with the "Load source files" override or without an output)
 * and the pipeline's figures. Undefined for an asset without pipeline data.
 * @param declared the asset's generated data
 * @param report its load report, whose `sourceUrl` is the URL it was loaded from
 * @param isImport whether the figures are a whole import's (shown for one of its parts)
 */
export const describePipelineFile = (
  declared: DeclaredFile | undefined,
  report?: AssetLoadReport,
  isImport?: boolean
): PipelineDescription | undefined => {
  if (!declared?.__url && !declared?.__sourceUrl) return undefined;
  const { __url, __sourceUrl, __bytes, __vramBytes, __codec } = declared;
  const isPacked = !declared.fileName;
  // Built from many files: no single source stands in for it (p299)
  const composedText = declared.__layers
    ? `a texture array of ${plural(declared.__layers.length, 'layer')}`
    : declared.__atlas
      ? declared.__atlas.fromImage
        ? 'an atlas slot, from a ready-made image of its layout'
        : 'an atlas slot, composed from its cells'
      : undefined;
  const loadedUrl = report?.sourceUrl;
  const isOutput = Boolean(loadedUrl && __url && loadedUrl === toAppUrl(__url));
  const isSource =
    !isOutput && Boolean(loadedUrl && __sourceUrl && loadedUrl === toAppUrl(__sourceUrl));

  let loadedAs = 'not the pipeline’s output or source';
  if (isOutput) {
    loadedAs =
      __url === __sourceUrl
        ? 'the source, passed through as is'
        : isPacked && isLoadingSourceFiles()
          ? composedText
            ? 'pipeline output: no single source file'
            : 'pipeline output: packed, no source file'
          : 'pipeline output';
  } else if (isSource) {
    loadedAs = __url
      ? 'source file, "Load source files" override'
      : 'source file: no pipeline output';
  }
  const loadedText = loadedUrl
    ? `${new URL(loadedUrl).pathname} (${loadedAs})`
    : '— (no load report)';
  const loadedBytes = isOutput
    ? __bytes?.out
    : isSource
      ? __bytes?.in ?? declared.__fileSize
      : undefined;

  const rows: [string, string][] = [
    ['Output', __url ?? '— (none: encoder missing, the encode failed, or not built yet)'],
    [
      'Source',
      __sourceUrl ??
        (composedText
          ? `— (${composedText})`
          : isPacked
            ? '— (packed from several files)'
            : '— (not in production data)'),
    ],
    ...(__codec ? [['Codec', __codec] as [string, string]] : []),
    ['Download', formatInOut(__bytes) ?? '—'],
    [
      'Est. GPU memory',
      formatInOut(__vramBytes) ?? '— (not optimized: the pipeline doesn’t read the image)',
    ],
  ];
  return {
    loadedUrl,
    loadedText,
    loadedBytes,
    title: isImport ? 'Asset pipeline (whole import)' : 'Asset pipeline',
    rows,
  };
};

export const describeOwner = (asset: object) =>
  getAssetOwner(asset) ?? '— (registered before the first scene load)';
