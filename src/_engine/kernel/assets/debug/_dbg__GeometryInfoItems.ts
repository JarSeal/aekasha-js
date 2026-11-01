// The asset info window's geometry items (p806 D10, D11: out of _dbg__Assets.ts): the geometry's
// file, load and buffer figures as info rows, its unique edges on demand, its LOD chain with the
// generate and release buttons, the pipeline, the import and its custom props.
import { lerror } from '../../../utils/Logger';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { getInfoRowItem } from '../../../debug/_dbg__DebugWindowGrid';
import { updateDraggableWindow } from '../../../ui/overlays/windows/DraggableWindow';
import { getGeometryRegistry } from '../Geometry';
import { getImportedAsset } from '../import/ImportRegistry';
import { getAssetLoadReport } from '../AssetsAPI';
import type { ImportedGeometryInfo } from '../import/ImportTypes';
import {
  generateLodChain,
  getLodChain,
  getLodChainOfLevel,
  isLodChainPending,
  releaseLodChain,
  type LodChain,
} from '../../../features/lod/LodChains';
import type { LodLevelVertices } from '../../../features/lod/LodChainOptions';
import {
  computeUniqueEdgeCount,
  formatBytes,
  formatNumber,
  getFileType,
  getGeometryByteSize,
  getTriangleCount,
  getVertexCount,
  UNIQUE_EDGES_MAX_ENTRIES,
} from './_dbg__AssetStats';
import {
  describeLoadReport,
  describeOwner,
  describePipelineFile,
  findDeclaration,
  toUrls,
} from './_dbg__AssetsData';
import {
  getFileSizeItems,
  getInfoFolder,
  getPipelineFolder,
  toInfoRows,
  type AssetInfoCtx,
} from './_dbg__AssetInfoParts';
import { refreshAssetsTab } from './_dbg__AssetsState';

const VERTICES_TEXT: Record<LodLevelVertices, string> = {
  BASE: "the base's",
  WELDED: 'the welded copy',
  OWN: 'own',
};

/** A level's own bytes: its index, plus its vertex arrays when it has its own. */
const getLodLevelBytes = (geometryId: string, vertices: LodLevelVertices) => {
  const geometry = getGeometryRegistry()[geometryId]?.resource;
  if (!geometry) return undefined;
  return vertices === 'OWN' ? getGeometryByteSize(geometry) : geometry.index?.array.byteLength;
};

const describeLodChain = (chain: LodChain): [string, string][] => {
  const base = chain.levels[0];
  const welded = chain.levels.find((l) => l.vertices === 'WELDED');
  const weldedGeometry = welded ? getGeometryRegistry()[welded.geometryId]?.resource : undefined;
  const levelRows = chain.levels.slice(1).map((level, i): [string, string] => {
    const bytes = getLodLevelBytes(level.geometryId, level.vertices);
    const percent = Math.round((level.triangles / base.triangles) * 100);
    return [
      `LOD${i + 1}`,
      `${formatNumber(level.triangles)} triangles (${percent}%), error ${level.error.toFixed(4)} (≤ ~${(level.error * chain.extent).toPrecision(2)} units), ${bytes === undefined ? '—' : formatBytes(bytes)}, vertices: ${VERTICES_TEXT[level.vertices]}`,
    ];
  });
  const { report, options } = chain;
  return [
    ['Levels', `${chain.levels.length} (base + ${chain.levels.length - 1})`],
    ...levelRows,
    ...(weldedGeometry
      ? [
          [
            'Welded vertices',
            `${formatBytes(getGeometryByteSize(weldedGeometry) - (weldedGeometry.index?.array.byteLength ?? 0))} (shared by the levels)`,
          ] as [string, string],
        ]
      : []),
    ['Extent / radius', `${chain.extent.toPrecision(3)} / ${chain.radius.toPrecision(3)}`],
    [
      'Generated on',
      report
        ? `${describeLoadReport(report).loadedOn}, ${report.durationMs.toFixed(1)} ms (main thread's own work ${report.mainThreadMs.toFixed(2)} ms)`
        : 'build time (asset pipeline), loaded with the GLB',
    ],
    [
      'Options',
      `ratios ${options.ratios.join(', ')}, maxError ${options.maxError}, weights normal ${options.attributeWeights.normal} / uv ${options.attributeWeights.uv}${options.permissive ? ', permissive' : ''}${options.compactVertices ? ', compactVertices' : ''}${options.lockBorder ? ', lockBorder' : ''}`,
    ],
  ];
};

/** Generates (or releases) the geometry's chain; the window is rebuilt when it starts (its
 * buttons disabled while pending) and when it ends. */
const runLodChainAction = async (
  id: string,
  windowId: string,
  action: 'release' | 'generate' | 'generatePermissive'
) => {
  if (isLodChainPending(id)) return;
  if (action === 'release') {
    releaseLodChain(id);
  } else {
    const pendingChain = generateLodChain(id, { permissive: action === 'generatePermissive' });
    updateDraggableWindow(windowId);
    try {
      await pendingChain;
    } catch (err) {
      // Not pending any more: the rebuild below shows the chain as it is
      lerror(`Generating the LOD chain of "${id}" failed`, err);
    }
  }
  updateDraggableWindow(windowId);
  refreshAssetsTab();
};

/** The LOD chain folder: the chain, or which chain a level belongs to, and the generate / release
 * buttons (p347 §2.5). */
const getLodChainFolder = (id: string, windowId: string): PropertyGridItem => {
  const ofLevel = getLodChainOfLevel(id);
  if (ofLevel) {
    return getInfoFolder('lodChain', 'LOD chain', [
      getInfoRowItem('LOD level', `LOD${ofLevel.level} of "${ofLevel.chain.baseId}"`),
    ]);
  }
  const chain = getLodChain(id);
  const isPending = isLodChainPending(id);
  const rows: [string, string][] = isPending
    ? [['Chain', 'Generating…']]
    : chain
      ? describeLodChain(chain)
      : [['Chain', 'none']];
  return getInfoFolder('lodChain', 'LOD chain', [
    ...toInfoRows(rows),
    {
      type: 'button',
      title: chain ? 'Regenerate' : 'Generate LOD chain',
      disabled: isPending,
      onClick: () => void runLodChainAction(id, windowId, 'generate'),
    },
    {
      // With `permissive: true`: collapses across attribute seams (flat-shaded geometry needs it)
      type: 'button',
      title: chain ? 'Regenerate (permissive)' : 'Generate (permissive)',
      disabled: isPending,
      onClick: () => void runLodChainAction(id, windowId, 'generatePermissive'),
    },
    ...(chain
      ? [
          {
            type: 'button' as const,
            title: 'Release chain',
            variant: 'danger' as const,
            disabled: isPending,
            onClick: () => void runLodChainAction(id, windowId, 'release'),
          },
        ]
      : []),
  ]);
};

/** The unique edges: computed on a press (a walk of the index), or why they can't be. */
const getUniqueEdgesItems = (
  geometry: Parameters<typeof computeUniqueEdgeCount>[0],
  ctx: AssetInfoCtx
): PropertyGridItem[] => {
  const label = 'Unique edges';
  if (!geometry.index) {
    return [getInfoRowItem(label, '— (not indexed: every triangle has its own edges)')];
  }
  if (geometry.index.count > UNIQUE_EDGES_MAX_ENTRIES) {
    return [
      getInfoRowItem(
        label,
        `too large to compute (over ${formatNumber(UNIQUE_EDGES_MAX_ENTRIES)} indices)`
      ),
    ];
  }
  let computed: string | null = null;
  return [
    {
      type: 'button',
      label,
      title: 'Compute',
      hidden: () => computed !== null,
      onClick: () => {
        computed = formatNumber(computeUniqueEdgeCount(geometry) ?? undefined);
        ctx.refresh();
      },
    },
    {
      label,
      get: () => computed ?? '',
      readonly: true,
      interval: 'refresh',
      hidden: () => computed === null,
    },
  ];
};

/** The import's folder and its custom props' (the raw JSON a text area). */
const getImportFolders = (importInfo: ImportedGeometryInfo): PropertyGridItem[] => {
  const p = importInfo.customProps;
  if (!p) return [];
  const t = importInfo.transform;
  const vec = (v: { x: number; y: number; z: number; w?: number }) =>
    [v.x, v.y, v.z, ...(v.w !== undefined ? [v.w] : [])].map((n) => +n.toFixed(3)).join(', ');
  const optional = (isShown: unknown, label: string, value: () => string): [string, string][] =>
    isShown ? [[label, value()]] : [];
  return [
    getInfoFolder(
      'import',
      'Import',
      toInfoRows([
        ['Import id', importInfo.importId],
        ['Node', [...importInfo.parentPath, importInfo.nodeName].join(' / ')],
        ['Position', vec(t.position)],
        ['Quaternion', vec(t.quaternion)],
        ['Scale', vec(t.scale)],
        ['DRACO-compressed', importInfo.isDracoCompressed ? 'yes' : 'no'],
        ...optional(
          importInfo.textureSlots,
          'Texture slots',
          () =>
            Object.entries(importInfo.textureSlots!)
              .map(([slot, texId]) => `${slot}: ${texId}`)
              .join(', ') || '—'
        ),
      ])
    ),
    getInfoFolder('customProps', 'Custom props', [
      ...toInfoRows([
        ['isPhysObj', String(p.isPhysObj)],
        ...optional(p.isPhysObj, 'keepMesh', () => String(p.keepMesh)),
        ...optional(p.rigidType, 'rigidType', () => String(p.rigidType)),
        ...optional(p.colliderParams, 'Collider', () => String(p.colliderParams!.type)),
        ...optional(p.index !== undefined, 'Compound index', () => String(p.index)),
        ...optional(p.id !== undefined, 'id', () => String(p.id)),
        ...optional(p.rigidBodyUserData, 'Rigid body userData', () =>
          JSON.stringify(p.rigidBodyUserData)
        ),
        ['Warnings', p.warnings.length ? p.warnings.join(' ') : 'none'],
      ]),
      {
        label: 'Raw',
        value: JSON.stringify(p.raw, null, 1),
        readonly: true,
        multiline: true,
        rows: 6,
        interval: 'refresh',
      },
    ]),
  ];
};

/** A geometry's info window items, after its Log button. */
export const getGeometryInfoItems = (
  id: string,
  windowId: string,
  ctx: AssetInfoCtx
): PropertyGridItem[] => {
  const entry = getGeometryRegistry()[id];
  const geometry = entry.resource;
  const importInfo = geometry.userData.importInfo as ImportedGeometryInfo | undefined;
  const manifest = importInfo ? getImportedAsset(importInfo.importId) : undefined;
  const importDeclaration = importInfo
    ? findDeclaration('importedAssets', importInfo.importId)
    : undefined;
  const generatorType = (geometry.userData.props as { type?: string } | undefined)?.type;
  const sourceFile = manifest?.fileName ?? importDeclaration?.fileName;
  const triangles = getTriangleCount(geometry);
  const report = importInfo ? getAssetLoadReport(`import:${importInfo.importId}`) : undefined;
  const load = importInfo ? describeLoadReport(report) : undefined;
  const pipeline = importInfo ? describePipelineFile(importDeclaration, report, true) : undefined;
  const loadedFile = pipeline?.loadedUrl ?? (typeof sourceFile === 'string' ? sourceFile : '');

  return [
    ...toInfoRows([
      [
        'Type',
        importInfo
          ? 'Imported geometry'
          : generatorType
            ? `${generatorType} (generated)`
            : geometry.type,
      ],
      ['Id', id],
      ['File', typeof sourceFile === 'string' ? sourceFile : '—'],
      ...(pipeline ? [['Loaded file', pipeline.loadedText] as [string, string]] : []),
      ['File type', loadedFile ? getFileType(loadedFile) : '—'],
    ]),
    ...getFileSizeItems(
      pipeline ? 'Loaded file size' : importInfo ? 'Source file size' : 'File size',
      pipeline ? pipeline.loadedBytes : importDeclaration?.__fileSize,
      pipeline?.loadedUrl
        ? [pipeline.loadedUrl]
        : typeof sourceFile === 'string'
          ? toUrls(sourceFile)
          : [],
      ctx
    ),
    ...toInfoRows([
      ...(load
        ? [
            ['Loaded on', load.loadedOn] as [string, string],
            ['Load time (import)', load.duration] as [string, string],
          ]
        : []),
      ['Ref count', String(entry.count)],
      ['Persistent', entry.persistent ? 'yes' : 'no'],
      ['Owner scene', describeOwner(geometry)],
    ]),
    getInfoFolder('geometry', 'Geometry', [
      ...toInfoRows([
        ['Vertices', formatNumber(getVertexCount(geometry))],
        ['Triangles', formatNumber(triangles)],
        ['Edge instances', `${formatNumber(triangles * 3)} (3 × triangles)`],
      ]),
      ...getUniqueEdgesItems(geometry, ctx),
      ...toInfoRows([
        ['Indexed', geometry.index ? 'yes' : 'no'],
        ['Attributes', Object.keys(geometry.attributes).join(', ')],
        ['Est. VRAM (buffers)', formatBytes(getGeometryByteSize(geometry))],
      ]),
    ]),
    getLodChainFolder(id, windowId),
    ...getPipelineFolder(pipeline),
    ...(importInfo ? getImportFolders(importInfo) : []),
  ];
};
