import {
  addDebugToast,
  createDebuggerTab,
  debuggerListCMP,
  type DebuggerListItem,
} from 'aekasha/debug';
import { getCountedGpuBytes } from '../../shared/verifyHarness';
import {
  ASSET_COMPARE_SCENE_ID,
  COMPARE_VARIANTS,
  compareConfig,
  getCompareSlots,
  rebuildCompareSlot,
  setCompareChangeListener,
  showCompareSlot,
  toggleCompareSlot,
  type CompareSlot,
  type CompareSlotId,
} from './assetCompare';
import {
  ASSET_COMPARE_TAB_ID,
  findReportModelBytes,
  findReportTexture,
  formatBytes,
  loadReportAsync,
  refreshAssetCompareTab,
  type ReportTexture,
} from './_dbg__assetCompareReport';
import {
  getColliderRows,
  isColliderCheckBusy,
  runColliderCheckAsync,
} from './_dbg__assetCompareColliders';
import {
  copyMeasureResultsAsync,
  getMeasureRows,
  hasMeasureResults,
  isMeasuring,
  measureAllVariants,
} from './_dbg__assetCompareMeasure';

// The asset compare scene's "Asset compare" tab: each slot's variant, its textures' file sizes,
// VRAM and quality metrics, and the measure and the collider check (their own modules).

const LS_KEY = 'AEK_debugAssetCompare';
/** The key before the AEK_debug prefix: its values move to LS_KEY once */
const OLD_LS_KEY = 'appDebugAssetCompare';

/** Moves the saved settings (and the tab's UI state, `<key>UI`) from the old key, unless the new
 * key has some already */
const moveOldSettings = () => {
  try {
    for (const suffix of ['', 'UI']) {
      const old = localStorage.getItem(OLD_LS_KEY + suffix);
      if (old === null) continue;
      if (localStorage.getItem(LS_KEY + suffix) === null) {
        localStorage.setItem(LS_KEY + suffix, old);
      }
      localStorage.removeItem(OLD_LS_KEY + suffix);
    }
  } catch {
    // No storage (blocked, private mode): nothing to move
  }
};

const formatMetrics = (entry?: ReportTexture) => {
  const metrics = entry?.metrics;
  if (!metrics) return '';
  const parts: string[] = [];
  if (metrics.psnr) {
    parts.push(
      `PSNR ${Object.entries(metrics.psnr)
        .map(([channels, db]) => `${channels} ${db.toFixed(1)}`)
        .join(', ')} dB`
    );
  }
  if (metrics.normalErrorDeg) {
    const { mean, p99 } = metrics.normalErrorDeg;
    parts.push(`normal ${mean.toFixed(1)}° mean, ${p99.toFixed(1)}° p99`);
  }
  return parts.join(' · ');
};

/** A slot's list rows: its messages, the totals, then one per texture */
const getSlotRows = (slot: CompareSlot): DebuggerListItem[] => {
  const isShown = compareConfig.shown === slot.id;
  const rows: DebuggerListItem[] = slot.messages.map((message, i) => ({
    itemId: `message${i}`,
    title: message,
    badge: '!',
  }));
  if (slot.isBuilding) rows.push({ itemId: 'building', title: 'Loading…', titlePlaceholder: true });
  if (!slot.built) return rows;

  let fileBytes = 0;
  let vramBytes = 0;
  let isVramComplete = true;
  const textureRows = slot.textures.map((t, i): DebuggerListItem => {
    const entry = findReportTexture(t);
    // What three counts for it: undefined until it was first drawn
    const vram = getCountedGpuBytes(t.texture);
    if (!t.reportKind) fileBytes += entry?.bytes ?? 0;
    if (vram === undefined) isVramComplete = false;
    else vramBytes += vram;
    const uncompressed = entry ? ` (RGBA8 ${formatBytes(entry.vramBytes.rgba8)})` : '';
    return {
      itemId: `texture${i}`,
      title: `${t.subject}: ${t.name}`,
      subTitle: t.file,
      suffix: vram === undefined ? 'not drawn' : formatBytes(vram),
      description: [`file ${formatBytes(entry?.bytes)}${uncompressed}`, formatMetrics(entry)]
        .filter(Boolean)
        .join(' · '),
      disabled: !isShown,
    };
  });
  const propBytes = findReportModelBytes(slot.propFile);
  return [
    ...rows,
    {
      itemId: 'total',
      title: `Total VRAM${isVramComplete ? '' : ' (drawn so far)'}`,
      badge: isShown ? 'shown' : undefined,
      suffix: formatBytes(vramBytes),
      description: `files: textures ${formatBytes(fileBytes)}${slot.propFile ? `, prop GLB ${formatBytes(propBytes)}` : ''}`,
      disabled: !isShown,
    },
    ...textureRows,
  ];
};

const VARIANT_OPTIONS = COMPARE_VARIANTS.map((v) => ({
  value: v,
  text: v === 'png' ? 'png (baseline)' : v,
}));

const slotFolder = (slotId: CompareSlotId) => ({
  type: 'folder' as const,
  title: `Slot ${slotId}`,
  content: [
    {
      key: `variant${slotId}` as const,
      label: 'Variant',
      options: VARIANT_OPTIONS,
      onChange: () => void rebuildCompareSlot(slotId),
    },
    {
      key: `normalMode${slotId}` as const,
      label: 'Normal mode',
      disabled: () => compareConfig[`variant${slotId}`] === 'png',
      onChange: () => void rebuildCompareSlot(slotId),
    },
  ],
});

/** The asset compare scene's "Asset compare" tab (a scene tab). Creating it restores the saved
 * slot settings into compareConfig, so the scene creates it before building the slots. */
export const createAssetCompareTab = () => {
  let lastShown = compareConfig.shown;
  setCompareChangeListener(() => {
    if (compareConfig.shown !== lastShown) {
      lastShown = compareConfig.shown;
      const variant = compareConfig[`variant${lastShown}`];
      addDebugToast({ title: `Slot ${lastShown}: ${variant}` });
    }
    refreshAssetCompareTab();
  });
  moveOldSettings();
  void loadReportAsync();

  createDebuggerTab({
    id: ASSET_COMPARE_TAB_ID,
    title: 'Asset compare',
    icon: 'texture',
    sceneId: ASSET_COMPARE_SCENE_ID,
    lsKey: LS_KEY,
    state: compareConfig,
    persistKeys: ['variantA', 'normalModeA', 'variantB', 'normalModeB', 'shown'],
    // VRAM appears once a texture is first drawn (the other slot's: when it is first shown)
    refreshIntervalMs: 500,
    content: () => [
      {
        pane: true,
        content: [
          slotFolder('A'),
          slotFolder('B'),
          {
            key: 'shown',
            label: 'Showing',
            options: [
              { value: 'A', text: 'A' },
              { value: 'B', text: 'B' },
            ],
            onChange: (value) => showCompareSlot(value as CompareSlotId),
          },
          { type: 'button', title: 'Toggle A / B', label: 'V key', onClick: toggleCompareSlot },
          {
            type: 'button',
            title: 'Run collider check',
            label: 'Copies vs source',
            disabled: isColliderCheckBusy,
            onClick: () => void runColliderCheckAsync(),
          },
          {
            type: 'button',
            title: 'Measure all variants',
            label: 'Slot B',
            disabled: isMeasuring,
            onClick: () => void measureAllVariants(),
          },
          {
            type: 'button',
            title: 'Copy results',
            label: 'JSON',
            disabled: () => !hasMeasureResults() || isMeasuring(),
            onClick: () => void copyMeasureResultsAsync(),
          },
        ],
      },
      ...(['A', 'B'] as const).map((slotId) => {
        const slot = getCompareSlots()[slotId];
        const built = slot.built;
        const title = built
          ? `${built.variant}${built.normalMode && built.variant !== 'png' ? ' (normal mode)' : ''}`
          : '…';
        return debuggerListCMP({
          id: `assetCompareSlot${slotId}`,
          heading: `Slot ${slotId}: ${title}`,
          data: () => getSlotRows(getCompareSlots()[slotId]),
        });
      }),
      debuggerListCMP({
        id: 'assetCompareMeasure',
        heading: 'Measured variants (this device)',
        emptyText: 'Not run yet.',
        data: getMeasureRows,
      }),
      debuggerListCMP({
        id: 'assetCompareColliders',
        heading: 'Collider check (each copy vs its source)',
        emptyText: 'Not run yet.',
        data: getColliderRows,
      }),
    ],
  });
};
