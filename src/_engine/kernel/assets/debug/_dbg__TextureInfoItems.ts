// The asset info window's texture items (p806 D10, D11: out of _dbg__Assets.ts): the texture's file,
// load and GPU figures as info rows, its array's layers and its atlas slot's cells as tables, its
// preview, the pipeline and the import.
import type * as THREE from 'three/webgpu';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { createTable } from '../../../ui/data/Table';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import { getInfoRowItem, getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { textureMapKeys } from '../../../utils/Constants';
import { getTextureRegistry } from '../Texture';
import { getMaterialRegistry } from '../Material';
import { getImportedAsset } from '../import/ImportRegistry';
import { getAssetLoadReport } from '../AssetsAPI';
import { getTextureArrayInfo } from '../TextureArray';
import { getTextureAtlasInfo, type TextureAtlasInfo } from '../TextureAtlas';
import {
  describeTexture,
  formatBytes,
  getFileType,
  getTextureDepth,
  getTextureImageSrc,
} from './_dbg__AssetStats';
import { getTexturePreviewItems, hasTexturePreview } from './_dbg__AssetsPreview';
import {
  describeLoadReport,
  describeOwner,
  describePipelineFile,
  findDeclaration,
  getGeneratedData,
  toUrls,
  type DeclaredFile,
} from './_dbg__AssetsData';
import {
  getFileSizeItems,
  getInfoFolder,
  getPipelineFolder,
  toInfoRows,
  type AssetInfoCtx,
} from './_dbg__AssetInfoParts';
import { plural } from './_dbg__AssetsState';
import styles from './Assets.module.scss';

const getTextureMaterialUsers = (texture: THREE.Texture, id: string) => {
  let users = 0;
  for (const entry of Object.values(getMaterialRegistry())) {
    const material = entry.resource as unknown as Record<string, unknown>;
    const uses = textureMapKeys.some((key) => {
      const t = material[key] as THREE.Texture | undefined;
      return t && (t === texture || t.userData?.id === id);
    });
    if (uses) users++;
  }
  return users;
};

/** A custom item holding a static table (its caption names it). */
const getTableItem = (createCmp: () => CMPHandle): PropertyGridItem => ({
  type: 'custom',
  build: (container) => {
    container.add(createCmp());
  },
});

const ARRAY_ORIGIN_TEXT = {
  RUNTIME: 'runtime (buildTextureArray)',
  BUILD: 'build time (a texture array asset, *.textureArray.json)',
};

type LayerRow = { id: string; index: number; member: string; source: string };

/** The array folder (p299 D6): what it was built from and its layers' table.
 * @param registered the array asset's dev data registry entry (its JSON's layer list) */
const getTextureArrayFolder = (
  texture: THREE.Texture,
  registered?: DeclaredFile
): PropertyGridItem => {
  const info = getTextureArrayInfo(texture);
  if (!info) {
    return getInfoFolder('textureArray', 'Texture array', [
      getInfoRowItem('Layers', String(getTextureDepth(texture))),
      getNoteItem('No member list: neither built by buildTextureArray nor a texture array asset.'),
    ]);
  }
  const isCompressed = info.kind === 'COMPRESSED';
  // The JSON's layer list (a texture id or a file), in dev data
  const sources = info.origin === 'BUILD' ? registered?.layers : undefined;
  const cpuCopy = info.cpuDataReleased
    ? 'released after the upload (not swappable): its byte sizes come from its layer size'
    : info.swappable
      ? 'kept, for setTextureArrayLayer'
      : info.origin === 'BUILD'
        ? 'kept, like every loaded KTX2 texture'
        : 'kept until its first upload (not swappable)';
  const rows: LayerRow[] = info.members.map((member, index) => ({
    id: String(index),
    index,
    member,
    source: sources?.[index] ?? '—',
  }));
  return getInfoFolder('textureArray', 'Texture array', [
    ...toInfoRows([
      ['Origin', ARRAY_ORIGIN_TEXT[info.origin]],
      [
        'Kind',
        isCompressed
          ? 'KTX2 layers (CompressedArrayTexture)'
          : 'image layers (DataArrayTexture, mipmaps generated on the GPU)',
      ],
      ['Layers', String(info.members.length)],
      [
        'Layer size',
        `${info.width} × ${info.height}, ${isCompressed ? plural(info.levels, 'mip level') : 'mipmaps generated on the GPU'}`,
      ],
      [
        'Bytes per layer',
        `${formatBytes(info.layerBytes)}${isCompressed ? ', every level' : ', level 0'}`,
      ],
      [
        'Swappable',
        info.swappable
          ? 'yes (setTextureArrayLayer)'
          : info.origin === 'BUILD'
            ? 'no (its layers are in its file)'
            : 'no',
      ],
      ['CPU copy', cpuCopy],
    ]),
    getTableItem(
      () =>
        createTable<LayerRow>({
          caption: 'Layers',
          columns: [
            { key: 'index', label: '#' },
            {
              key: 'member',
              label: info.origin === 'BUILD' ? 'Layer' : 'Member',
              rowHeader: true,
            },
            { key: 'source', label: 'Source (JSON)', hidden: !sources },
          ],
          rows,
          class: styles.infoTable,
        }).cmp
    ),
  ]);
};

type CellRow = { id: string; at: string; size: string; uv: string; data: string };

const getAtlasCellRows = (info: TextureAtlasInfo): CellRow[] => {
  const [layoutW, layoutH] = info.size;
  return Object.entries(info.cells).map(([cellId, cell]) => {
    const [u0, , , v1] = cell.uv;
    const [w, h] = cell.size;
    // Image px from the top left, like the JSON's rects (the UVs are v up)
    const x = Math.round(u0 * layoutW);
    const y = Math.round((1 - v1) * layoutH);
    return {
      id: cellId,
      at: `${x}, ${y}`,
      size: `${w} × ${h}`,
      uv: cell.uv.map((n) => +n.toFixed(4)).join(', '),
      data: cell.data ? JSON.stringify(cell.data) : '',
    };
  });
};

/** The atlas folder (p299 D6): the layout and the cells' table. */
const getTextureAtlasFolder = (texture: THREE.Texture): PropertyGridItem[] => {
  const info = getTextureAtlasInfo(texture);
  if (!info) return [];
  const [layoutW, layoutH] = info.size;
  const dropped = Math.round(Math.log2(layoutW / info.width));
  const lastLevel = info.levels - 1;
  const loadedSlots = Object.values(getTextureRegistry())
    .map(({ resource }) => getTextureAtlasInfo(resource))
    .filter((slotInfo) => slotInfo?.id === info.id)
    .map((slotInfo) => slotInfo!.slot)
    .sort();
  const rows = getAtlasCellRows(info);
  return [
    getInfoFolder('textureAtlas', 'Texture atlas', [
      ...toInfoRows([
        ['Atlas', info.id],
        ['Slot', info.slot],
        ['Loaded slots', loadedSlots.join(', ')],
        [
          'Layout',
          `${layoutW} × ${layoutH} px, ${info.padding} px of padding (${info.fromImage ? 'a ready-made image' : 'edge extended'})`,
        ],
        [
          'Levels kept apart',
          `${info.levels}, down to ${layoutW >> lastLevel} × ${layoutH >> lastLevel}`,
        ],
        [
          'Mip chain',
          info.mipChain === 'FULL'
            ? 'full, down to 1 × 1: the levels past those kept apart mix neighbouring cells'
            : 'stops at the last level kept apart',
        ],
        [
          'File',
          `${info.width} × ${info.height}, ${plural(info.storedLevels, 'mip level')}${dropped ? ` (its maxSize dropped the top ${plural(dropped, 'level')})` : ''}`,
        ],
        ['Cells', String(rows.length)],
      ]),
      getTableItem(
        () =>
          createTable<CellRow>({
            caption: 'Cells',
            columns: [
              { key: 'id', label: 'Cell', rowHeader: true },
              { key: 'at', label: 'At (px)', align: 'end' },
              { key: 'size', label: 'Size (px)', align: 'end' },
              { key: 'uv', label: 'UV rect (v up)' },
              { key: 'data', label: 'Data', hidden: !rows.some((row) => row.data) },
            ],
            rows,
            class: styles.infoTable,
          }).cmp
      ),
      getNoteItem(
        "A cell's content in the layout: its padding surrounds it. UVs are what getAtlasCell and sampleAtlasCell use."
      ),
    ]),
  ];
};

/** The texture's file: what its declaration, its import or its image says, and the URLs a
 * Measure reads. */
const describeTextureFile = (
  texture: THREE.Texture,
  declared: DeclaredFile | undefined,
  registered: DeclaredFile | undefined,
  importFile: string | undefined,
  hasPipeline: boolean,
  reportUrl: string | undefined
) => {
  const arrayInfo = getTextureArrayInfo(texture);
  if (declared?.fileName) {
    return {
      file: [declared.path, [declared.fileName].flat().join(', ')].filter(Boolean).join(''),
      urls: toUrls(declared.fileName, declared.path),
    };
  }
  if (importFile) return { file: `embedded in ${importFile}`, urls: [] };
  if (declared?.__layers || declared?.__atlas) {
    // Production data has no JSON paths
    const built = declared.__layers ? 'a texture array' : 'an atlas slot';
    return {
      file: registered?.__sourcePath ?? `— (${built} built by the asset pipeline)`,
      urls: [],
    };
  }
  if (hasPipeline) return { file: '— (packed by the asset pipeline)', urls: [] };
  if (arrayInfo?.origin === 'RUNTIME') {
    return { file: '— (built at runtime by buildTextureArray)', urls: [] };
  }
  // An <img> knows its URL; an ImageBitmap (assets worker) or HDR data doesn't, but the load
  // report does
  const urls = getTextureImageSrc(texture) || (reportUrl ? [reportUrl] : []);
  return { file: urls.length ? urls.join(', ') : '—', urls };
};

/** A texture's info window items, after its Log button. */
export const getTextureInfoItems = (
  id: string,
  windowId: string,
  ctx: AssetInfoCtx
): PropertyGridItem[] => {
  const entry = getTextureRegistry()[id];
  const texture = entry.resource;
  const importId = texture.userData.importId as string | undefined;
  const declared = findDeclaration('textures', id);
  // Authoring fields a scene entry leaves out (the JSON's path, an array's layer sources): only
  // dev data's registry has them
  const registered = getGeneratedData().textures?.[id];
  const importDeclaration = importId ? findDeclaration('importedAssets', importId) : undefined;
  const importFile = importId ? getImportedAsset(importId)?.fileName : undefined;
  const report = getAssetLoadReport(importId ? `import:${importId}` : `texture:${id}`);
  const pipeline = describePipelineFile(
    importFile ? importDeclaration : declared,
    report,
    Boolean(importFile)
  );
  const isArray = Boolean(getTextureArrayInfo(texture)) || getTextureDepth(texture) > 1;
  const described = describeTextureFile(
    texture,
    declared,
    registered,
    importFile,
    Boolean(pipeline),
    report?.sourceUrl
  );
  // The loaded file (the pipeline's output or source), not the declared one
  const urls = pipeline?.loadedUrl && !importFile ? [pipeline.loadedUrl] : described.urls;
  const fileType = importFile
    ? (texture.userData.mimeType as string | undefined) ?? '—'
    : getFileType(urls[0] || described.file);
  const fileSizeLabel = importFile
    ? pipeline
      ? 'Loaded import size'
      : 'Source file size'
    : pipeline
      ? 'Loaded file size'
      : 'File size';
  const d = describeTexture(texture);
  const load = describeLoadReport(report);
  const users = getTextureMaterialUsers(texture, id);

  return [
    ...toInfoRows([
      ['Type', d.kind],
      ['Id', id],
      ['File', described.file],
      ...(pipeline
        ? [[importFile ? 'Loaded import' : 'Loaded file', pipeline.loadedText] as [string, string]]
        : []),
      ['File type', fileType],
    ]),
    ...getFileSizeItems(
      fileSizeLabel,
      pipeline
        ? pipeline.loadedBytes
        : declared?.__fileSize ?? (importFile ? importDeclaration?.__fileSize : undefined),
      pipeline?.loadedUrl ? [pipeline.loadedUrl] : importFile ? toUrls(importFile) : urls,
      ctx
    ),
    ...toInfoRows([
      ['Loaded on', load.loadedOn],
      [importId ? 'Load time (import)' : 'Load time', load.duration],
      ['Used by materials', `${users} (texture ref counts aren't tracked)`],
      ['Persistent', entry.persistent ? 'yes' : 'no'],
      ['Owner scene', describeOwner(texture)],
    ]),
    getInfoFolder(
      'texture',
      'Texture',
      toInfoRows([
        ['Dimensions', d.dimensions],
        ['Color space', d.colorSpace],
        ['Format / type', `${d.format} / ${d.type}`],
        ['Mipmaps', d.mipmaps],
        ['Filtering', d.filtering],
        ['Wrap', d.wrap],
        ['Anisotropy', d.anisotropy],
        ['flipY', d.flipY],
        ['Est. GPU memory', d.gpuMemory],
      ])
    ),
    ...(isArray ? [getTextureArrayFolder(texture, registered)] : []),
    ...getTextureAtlasFolder(texture),
    // An array's layers or an atlas slot's image (p299 D6)
    ...(hasTexturePreview(texture)
      ? [getInfoFolder('preview', 'Preview', getTexturePreviewItems(texture, windowId))]
      : []),
    ...getPipelineFolder(pipeline),
    ...(importId
      ? [
          getInfoFolder(
            'import',
            'Import',
            toInfoRows([
              ['Import id', importId],
              ['glTF slots', ((texture.userData.gltfSlots as string[]) || []).join(', ') || '—'],
            ])
          ),
        ]
      : []),
  ];
};
