// The LOD tab's folders (p806 D11: out of _dbg__LOD.ts, each a builder): the last frame's
// figures, the selection's and the fades' overrides, the level overlay, the impostors with their
// Export, and the nearest entity's window.
import {
  addDebugToast,
  updateDebuggerTab,
  type DebuggerPaneItem,
} from '../../../debug/DebuggerGUI';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import type { ECSWorld } from '../../../kernel/ecs/ECS';
import { getConfig } from '../../../kernel/config/Config';
import type { ImpostorRecord } from '../impostors/ImpostorRegistry';
import { doesTextureExist, getTexture } from '../../../kernel/assets/Texture';
import {
  getLodBias,
  getLodDebugOptions,
  getLodFadeSeconds,
  getLodMaxSelectionsPerFrame,
  setLodBias,
  setLodDebugOptions,
  setLodFadeSeconds,
  setLodMaxSelectionsPerFrame,
  type LodFrameStats,
} from '../LodSettings';
import { findNearestLodEntityInView, toggleLodEntityWindow } from './_dbg__LodEntityWindow';
import {
  exportImpostorsAsync,
  getImpostorExportState,
  isImpostorExportRunning,
  isImpostorKindExported,
  type ImpostorExportState,
} from './_dbg__ImpostorExport';
import { LOD_OVERLAY_COLOR_NAMES, setLodOverlayEnabled } from './_dbg__LodOverlay';

type Item = DebuggerPaneItem<object>;

export const LOD_TAB_ID = 'lodControls';

/** The runtime values the Selection, Fades and Overlay folders' fields bind, synced on every
 * refresh (app code can change them too). */
export type LodControls = {
  overlay: boolean;
  bias: number;
  /** -1 for no cap (Infinity) */
  maxSelections: number;
  freeze: boolean;
  forceLevel: number;
  useActiveCamera: boolean;
  fadeSeconds: number;
  fadeTimeScale: number;
};

const formatInt = (v: number) => v.toFixed(0);
const formatMs = (v: number) => v.toFixed(3);
const getAppFadeSeconds = () => getConfig().lod?.fadeSeconds ?? 0.25;

/** The cap's choices; -1 stands for Infinity (no cap) in the list. */
const MAX_SELECTIONS_OPTIONS = [100, 250, 500, 1000, 2500, 5000, 10000];
/** The cap as the select's value: -1 for Infinity. */
export const toCapOption = (max: number) => (max === Infinity ? -1 : max);

/** "Last frame": the selection's and the fades' figures (a copy of the world's, synced on every
 * refresh), read on the tab's refresh. */
export const getLastFrameFolder = (stats: LodFrameStats): Item => {
  const figure = (key: keyof LodFrameStats, label: string, format = formatInt): Item => ({
    key,
    target: stats,
    label,
    readonly: true,
    format,
    interval: 'refresh',
  });
  return {
    type: 'folder',
    title: 'Last frame',
    content: [
      figure('selections', 'Selections'),
      figure('lapFrames', 'Frames per lap'),
      figure('applies', 'Level swaps'),
      figure('totalApplies', 'Swaps in total'),
      figure('selectionMs', 'Selection (ms)', formatMs),
      figure('fading', 'Fading'),
      figure('fadeMs', 'Fades (ms)', formatMs),
    ],
  };
};

/** "Selection": the global bias, the cap, freeze, a forced level and the camera, each with its
 * reset to the app's value. `levelCount` is the most levels an entity has. */
export const getSelectionFolder = (controls: LodControls, levelCount: number): Item => {
  // A forced level past every entity's last stays listed while it is set
  const forceOptionCount = Math.max(levelCount, controls.forceLevel + 1);
  // A cap the app set that isn't one of the choices is listed too
  const capOptions = MAX_SELECTIONS_OPTIONS.includes(controls.maxSelections)
    ? MAX_SELECTIONS_OPTIONS
    : [...MAX_SELECTIONS_OPTIONS, controls.maxSelections]
        .filter((v) => v > 0)
        .sort((a, b) => a - b);
  return {
    type: 'folder',
    title: 'Selection',
    content: [
      {
        key: 'bias',
        target: controls,
        label: 'Global bias',
        min: 0.1,
        max: 4,
        step: 0.05,
        onChange: (value) => setLodBias(Number(value)),
      },
      {
        type: 'button',
        title: "Reset to the app's bias",
        disabled: () => getLodBias() === (getConfig().lod?.bias ?? 1),
        onClick: () => {
          setLodBias(getConfig().lod?.bias ?? 1);
          updateDebuggerTab(LOD_TAB_ID);
        },
      },
      {
        key: 'maxSelections',
        target: controls,
        label: 'Max selections / frame',
        options: [
          { value: -1, text: 'No cap' },
          ...capOptions.map((value) => ({ value, text: String(value) })),
        ],
        onChange: (value) => {
          const max = Number(value);
          setLodMaxSelectionsPerFrame(max < 0 ? Infinity : max);
        },
      },
      {
        type: 'button',
        title: "Reset to the app's cap",
        disabled: () =>
          getLodMaxSelectionsPerFrame() === (getConfig().lod?.maxSelectionsPerFrame ?? Infinity),
        onClick: () => {
          setLodMaxSelectionsPerFrame(getConfig().lod?.maxSelectionsPerFrame ?? Infinity);
          updateDebuggerTab(LOD_TAB_ID, { rebuild: true });
        },
      },
      {
        key: 'freeze',
        target: controls,
        label: 'Freeze',
        // A forced level wins over freeze
        disabled: () => controls.forceLevel >= 0,
        onChange: (value) => setLodDebugOptions({ freeze: Boolean(value) }),
      },
      {
        key: 'forceLevel',
        target: controls,
        label: 'Force level',
        options: [
          { value: -1, text: 'Off' },
          ...Array.from({ length: forceOptionCount }, (_, i) => ({
            value: i,
            text: `Level ${i}`,
          })),
        ],
        onChange: (value) => {
          setLodDebugOptions({ forceLevel: Number(value) });
          // Freeze's disabled state follows
          updateDebuggerTab(LOD_TAB_ID);
        },
      },
      {
        key: 'useActiveCamera',
        target: controls,
        label: 'Use active camera',
        onChange: (value) => setLodDebugOptions({ useActiveCamera: Boolean(value) }),
      },
    ],
  };
};

/** "Fades": the global fade seconds (a LOD's own wins: its window shows which) and the time
 * scale, each with its reset. */
export const getFadesFolder = (controls: LodControls): Item => ({
  type: 'folder',
  title: 'Fades',
  content: [
    {
      key: 'fadeSeconds',
      target: controls,
      label: 'Fade seconds (0 = pop)',
      min: 0,
      max: 2,
      step: 0.05,
      onChange: (value) => setLodFadeSeconds(Number(value)),
    },
    {
      type: 'button',
      title: "Reset to the app's fade",
      disabled: () => getLodFadeSeconds() === getAppFadeSeconds(),
      onClick: () => {
        setLodFadeSeconds(getAppFadeSeconds());
        updateDebuggerTab(LOD_TAB_ID);
      },
    },
    {
      key: 'fadeTimeScale',
      target: controls,
      label: 'Time scale (0 = hold)',
      min: 0,
      max: 1,
      step: 0.01,
      onChange: (value) => setLodDebugOptions({ fadeTimeScale: Number(value) }),
    },
    {
      type: 'button',
      title: 'Real time',
      disabled: () => getLodDebugOptions().fadeTimeScale === 1,
      onClick: () => {
        setLodDebugOptions({ fadeTimeScale: 1 });
        updateDebuggerTab(LOD_TAB_ID);
      },
    },
  ],
});

/** The overlay's colour per level, as legend lines. */
const formatLegend = (levelCount: number) =>
  Array.from({ length: levelCount }, (_, i) => {
    const name = LOD_OVERLAY_COLOR_NAMES[Math.min(i, LOD_OVERLAY_COLOR_NAMES.length - 1)];
    return `${`Level ${i}`.padEnd(12)}${name}`;
  }).join('\n');

/** "Overlay": the level boxes and their colours, `levelCount` lines. */
export const getOverlayFolder = (controls: LodControls, levelCount: number): Item => ({
  type: 'folder',
  title: 'Overlay',
  content: [
    {
      key: 'overlay',
      target: controls,
      label: 'Level boxes',
      onChange: (value) => setLodOverlayEnabled(Boolean(value)),
    },
    {
      value: formatLegend(levelCount),
      label: 'Colours',
      readonly: true,
      multiline: true,
      rows: levelCount,
      interval: 'refresh',
    },
  ],
});

const IMPOSTOR_KIND_NAMES: Record<ImpostorRecord['kind'], string> = {
  OCTAHEDRAL: 'Octahedral',
  CROSS_QUADS: 'Cross-quads',
};

const IMPOSTOR_EXPORT_STATE_NAMES: Record<ImpostorExportState, string> = {
  NO_SOURCE: 'No source to export',
  NOT_EXPORTED: 'Not exported',
  EXPORTED: 'Up to date',
  STALE: 'Stale',
  OTHER_FORMAT: 'In another format',
};

/** Whether the impostor can be exported now: it has a source and its kind exports */
const isImpostorExportable = (record: ImpostorRecord) =>
  Boolean(record.source) && isImpostorKindExported(record.kind);

const getExportText = (record: ImpostorRecord) =>
  isImpostorKindExported(record.kind)
    ? IMPOSTOR_EXPORT_STATE_NAMES[getImpostorExportState(record)]
    : 'No export for its kind yet';

const getAtlasText = (record: ImpostorRecord) => {
  const albedoId = `${record.id}.albedo`;
  const albedo = doesTextureExist(albedoId) ? getTexture(albedoId) : undefined;
  const image = albedo?.image as { width?: number; height?: number } | undefined;
  return image?.width ? `${image.width} × ${image.height}` : 'None';
};

/** An impostor's rows, read on the tab's refresh: its kind, where it came from, its export, its
 * atlas and bake time, then its Export. */
const getImpostorFolder = (record: ImpostorRecord): Item => {
  const row = (label: string, get: () => string): Item => ({
    get,
    label,
    readonly: true,
    interval: 'refresh',
  });
  return {
    type: 'folder',
    title: record.id,
    content: [
      row('Kind', () => IMPOSTOR_KIND_NAMES[record.kind]),
      row('Source', () => (record.origin === 'BAKED' ? 'Baked' : 'Loaded from its export')),
      row('Export', () => getExportText(record)),
      row('Atlas', () => getAtlasText(record)),
      row('Bake', () => (record.bakeMs === null ? 'None' : `${record.bakeMs.toFixed(0)} ms`)),
      {
        type: 'button',
        title:
          isImpostorKindExported(record.kind) && getImpostorExportState(record) !== 'NOT_EXPORTED'
            ? 'Re-export'
            : 'Export',
        disabled: () => isImpostorExportRunning() || !isImpostorExportable(record),
        onClick: () => {
          exportImpostorsAsync([record.id]).then(() => updateDebuggerTab(LOD_TAB_ID));
          updateDebuggerTab(LOD_TAB_ID);
        },
      },
    ],
  };
};

/**
 * "Impostors": what Export does with the dev files (`getDevFilesNote`, read on every refresh), a
 * folder per impostor generated in this scene (`records`, the tab rebuilt when they change) and
 * Export all.
 */
export const getImpostorsFolder = (
  records: readonly ImpostorRecord[],
  getDevFilesNote: () => string
): Item => ({
  type: 'folder',
  title: 'Impostors',
  content: [
    getNoteItem(getDevFilesNote),
    ...records.map(getImpostorFolder),
    ...(records.length
      ? [
          {
            type: 'button' as const,
            title: 'Export all',
            disabled: () => isImpostorExportRunning() || !records.some(isImpostorExportable),
            onClick: () => {
              const ids = records.filter(isImpostorExportable).map((record) => record.id);
              exportImpostorsAsync(ids).then(() => updateDebuggerTab(LOD_TAB_ID));
              updateDebuggerTab(LOD_TAB_ID);
            },
          },
        ]
      : [getNoteItem('No impostors generated in this scene.')]),
  ],
});

/** "Inspect": the LOD window of the nearest LOD entity in view. */
export const getInspectFolder = (world: ECSWorld): Item => ({
  type: 'folder',
  title: 'Inspect',
  content: [
    {
      type: 'button',
      title: 'Nearest in view',
      onClick: () => {
        const entityId = findNearestLodEntityInView(world);
        if (entityId === undefined) {
          addDebugToast({ message: 'No LOD entity in view.' });
          return;
        }
        toggleLodEntityWindow(entityId);
        updateDebuggerTab(LOD_TAB_ID);
      },
    },
  ],
});
