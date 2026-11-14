// The terrain gallery tab's Procedural row sections (p304 Phase 6): the row's mode and bake size,
// the generators' list, the selected generator's values (a field per param from its spec, so a
// slider tunes the bake and the live surface together), its bake's stats, its export, and the GPU
// measurement: a block alone in the measurement pose, each mode in turn, the frame's GPU time
// averaged (p310 standardizes the canvas and the tiers; this is the figure for the handbook's
// baked against live rows).
import { getMeshByAppId, getRenderer, getTextureBakeStats, lerror } from 'aekasha';
import {
  addDebugToast,
  debuggerListCMP,
  onGpuFrameTime,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { exportBakeOutputsAsync } from '../../shared/_dbg__exportBake';
import { flyToGalleryBlock, holdMeasurePose } from './_dbg__terrainGalleryCamera';
import {
  applyProceduralValues,
  getProceduralBake,
  getProceduralBakeSettings,
  getProceduralMode,
  getProceduralValues,
  isProceduralParamStatic,
  PROCEDURAL_BAKE_SIZES,
  PROCEDURAL_BLOCKS,
  PROCEDURAL_MODES,
  resetProceduralValues,
  setProceduralBakeAsync,
  setProceduralBlockMode,
  setProceduralMode,
  type ProceduralBlock,
  type ProceduralMode,
} from './proceduralRow';

/** Where a generator's export goes by default: a texture set folder of its own in the app */
const EXPORT_DIR = 'src/app/textures/<generator>Baked/source';
const MODE_LABELS: Record<ProceduralMode, string> = {
  IMPORTED: 'Imported',
  BAKED: 'Baked',
  LIVE: 'Live',
  LIVE_TAPS: 'Live + taps',
};

/** What a measurement shows a block as: nothing (the frame's floor), then each mode */
const MEASURE_STEPS = ['EMPTY', ...PROCEDURAL_MODES] as const;
type MeasureStep = (typeof MEASURE_STEPS)[number];
/** The frames a step lets pass (a mode's compile, the frames of the step before it), then
 * averages: p310's figures */
const WARM_UP_FRAMES = 30;
const SAMPLE_FRAMES = 120;
/** How long a step waits for its first frame time, and for all of them, ms */
const FIRST_FRAME_TIMEOUT_MS = 4000;
const STEP_TIMEOUT_MS = 30000;

/** A block's measurement: the frame's mean GPU ms per step (null: no figure) */
export type BlockMeasurement = Partial<Record<MeasureStep, number | null>>;

/** What the main tab gives the row's sections */
export type ProceduralSectionsOpts = {
  /** The tab, refreshed and rebuilt from here */
  tabId: string;
  /** A generator was picked in the list (the main tab drops its own list's selection) */
  onSelect: () => void;
  /** The app ids of everything else the gallery draws (the library's blocks, walls and checkers,
   * the ground): hidden while a block is measured */
  getOtherAppIds: () => string[];
};

/** The row's settings as the tab's fields bind them (the scene's defaults on every visit) */
const rowState = { mode: 'BAKED' as ProceduralMode, size: 1024, exportDir: EXPORT_DIR };
/** The selected generator's read-only figures, written by `refreshProceduralFigures` */
const figures = { memory: '-', rowMemory: '-', bakes: '-', gpuMs: '-', cpuMs: '-', measure: '-' };
const measurements = new Map<string, BlockMeasurement>();
/** The generator the list selected last, whose values the tab shows */
let selectedGeneratorId: string | null = null;
/** This visit's: false once the scene is left, so a measurement that ends later restores nothing */
let visit = { isCurrent: false };
let isMeasuring = false;
/** The last measurement's table (markdown), also copied to the clipboard */
let lastTable = '';

const getBlock = (generatorId: string | null) =>
  PROCEDURAL_BLOCKS.find((block) => block.generator.id === generatorId);

const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const formatMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? 'n/a' : ms.toFixed(2);

const describeMeasurement = (measurement: BlockMeasurement | undefined) =>
  measurement
    ? MEASURE_STEPS.map(
        (step) =>
          `${step === 'EMPTY' ? 'empty' : MODE_LABELS[step].toLowerCase()} ${formatMs(measurement[step])}`
      ).join(', ')
    : '-';

/** The selected generator, or null */
export const getSelectedGeneratorId = () => selectedGeneratorId;

/** Drops the generators' selection (the main tab's list was clicked) */
export const clearGeneratorSelection = () => {
  selectedGeneratorId = null;
};

/** Reads the figures the row's monitors show: the tab's `onRefresh` */
export const refreshProceduralFigures = () => {
  // The row's settings as they are: a script or the packing switch may have changed them
  rowState.mode = getProceduralMode();
  rowState.size = getProceduralBakeSettings().size;
  let rowBytes = 0;
  for (const block of PROCEDURAL_BLOCKS) {
    rowBytes += getProceduralBake(block.generator.id)?.memoryBytes ?? 0;
  }
  figures.rowMemory = `${formatMb(rowBytes)} (${PROCEDURAL_BLOCKS.length} bakes)`;
  const bake = selectedGeneratorId ? getProceduralBake(selectedGeneratorId) : undefined;
  const stats = bake ? getTextureBakeStats(bake.id) : undefined;
  figures.memory = bake ? `${formatMb(bake.memoryBytes)}, ${bake.slots.join(' + ')}` : '-';
  figures.bakes = stats ? String(stats.bakes) : '-';
  figures.gpuMs = stats?.gpuMs ?? '-';
  figures.cpuMs = stats?.cpuMs ?? '-';
  figures.measure = isMeasuring
    ? 'measuring…'
    : describeMeasurement(measurements.get(selectedGeneratorId ?? ''));
};

/** The mean GPU ms of `SAMPLE_FRAMES` frames after `WARM_UP_FRAMES`, or null when no frame time
 * comes (no timer queries, a paused loop) */
const sampleFrameGpuMsAsync = () =>
  new Promise<number | null>((resolve) => {
    let seen = 0;
    let sum = 0;
    const end = (value: number | null) => {
      clearTimeout(firstFrameTimer);
      clearTimeout(stepTimer);
      stop();
      resolve(value);
    };
    const stop = onGpuFrameTime((gpuMs) => {
      if (seen++ === 0) clearTimeout(firstFrameTimer);
      if (seen <= WARM_UP_FRAMES) return;
      sum += gpuMs;
      if (seen === WARM_UP_FRAMES + SAMPLE_FRAMES) end(sum / SAMPLE_FRAMES);
    });
    const firstFrameTimer = setTimeout(() => end(null), FIRST_FRAME_TIMEOUT_MS);
    const stepTimer = setTimeout(() => end(null), STEP_TIMEOUT_MS);
  });

/** Hides the meshes of the app ids and returns the function that shows those it hid again */
const hideMeshes = (appIds: string[]) => {
  const hidden = appIds.flatMap((appId) => {
    const mesh = getMeshByAppId(appId);
    if (!mesh?.visible) return [];
    mesh.visible = false;
    return [mesh];
  });
  return () => {
    for (const mesh of hidden) mesh.visible = true;
  };
};

/** The measurements as a markdown table, the machine's part of its heading */
const buildTable = (generatorIds: string[]) => {
  const renderer = getRenderer();
  const canvas = renderer?.domElement;
  const backend = (renderer?.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend
    ? 'WebGPU'
    : 'WebGL2';
  const { packing, size } = getProceduralBakeSettings();
  const lines = [
    `Frame GPU ms, a block alone (${backend}, ${canvas?.width} × ${canvas?.height} px canvas, bakes ${size}² ${packing}, mean of ${SAMPLE_FRAMES} frames):`,
    '',
    '| Generator | Empty frame | Imported | Baked | Live | Live + taps |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const id of generatorIds) {
    const measurement = measurements.get(id) ?? {};
    const cells = MEASURE_STEPS.map((step) => formatMs(measurement[step]));
    cells[1] += ` (${getBlock(id)?.importedSetId})`;
    lines.push(`| \`${id}\` | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
};

/**
 * Measures blocks one by one: each alone in the measurement pose (everything else the gallery
 * draws hidden), shown as nothing and then in each mode, the frame's GPU ms averaged per step.
 * Puts the row, the other meshes and the camera back, keeps the results per generator and copies
 * them as a markdown table. One run at a time; a run the scene's exit ends restores nothing.
 * @param generatorIds the blocks to measure, in order
 * @param opts the tab's hooks
 * @returns the table, or null when nothing was measured (a run in progress, no frame times)
 */
export const measureBlocksAsync = async (generatorIds: string[], opts: ProceduralSectionsOpts) => {
  if (isMeasuring) return null;
  isMeasuring = true;
  const startedOn = visit;
  const showOthers = hideMeshes(opts.getOtherAppIds());
  for (const block of PROCEDURAL_BLOCKS) setProceduralBlockMode(block.generator.id, 'HIDDEN');
  let restoreCamera: (() => void) | null = null;
  let hasFrameTimes = true;
  try {
    for (const id of generatorIds) {
      const block = getBlock(id);
      if (!block) continue;
      restoreCamera?.();
      restoreCamera = holdMeasurePose(block);
      const measurement: BlockMeasurement = {};
      for (const step of MEASURE_STEPS) {
        setProceduralBlockMode(id, step === 'EMPTY' ? 'HIDDEN' : step);
        measurement[step] = await sampleFrameGpuMsAsync();
        if (!startedOn.isCurrent) return null;
        hasFrameTimes = measurement[step] !== null;
        if (!hasFrameTimes) break;
      }
      setProceduralBlockMode(id, 'HIDDEN');
      if (!hasFrameTimes) break;
      measurements.set(id, measurement);
      updateDebuggerTab(opts.tabId);
    }
  } finally {
    isMeasuring = false;
    if (startedOn.isCurrent) {
      for (const block of PROCEDURAL_BLOCKS) setProceduralBlockMode(block.generator.id, null);
      showOthers();
      restoreCamera?.();
      updateDebuggerTab(opts.tabId);
    }
  }
  if (!hasFrameTimes) {
    addDebugToast({
      type: 'warning',
      title: 'No GPU frame times',
      message:
        'The measurement needs GPU timer queries (WebGPU with timestamp-query) and a running main loop.',
      showingTime: 10000,
    });
    return null;
  }
  lastTable = buildTable(generatorIds);
  // Not awaited: a page without the focus may never settle it
  void navigator.clipboard?.writeText(lastTable).catch(() => undefined);
  addDebugToast({
    title: 'Measured',
    message: `${generatorIds.length} block${generatorIds.length === 1 ? '' : 's'}: the table is on the clipboard.`,
  });
  return lastTable;
};

/** The selected generator's values as a procedural set's `procedural` block (JSON): the params
 * that differ from their defaults, the seed and the row's bake settings */
const getProceduralJson = (block: ProceduralBlock) => {
  const values = getProceduralValues(block.generator.id);
  if (!values) return '';
  const changed = Object.entries(values.params).filter(
    ([name, value]) => block.generator.params[name]?.default !== value
  );
  const { packing, size } = getProceduralBakeSettings();
  return JSON.stringify(
    {
      procedural: {
        generator: block.generator.id,
        ...(changed.length ? { params: Object.fromEntries(changed) } : {}),
        seed: values.seed,
        size,
        packing,
      },
    },
    null,
    2
  );
};

/** A field per param of the generator, from its spec: a number's or a colour's change rebakes on
 * every write, a static number's or a toggle's builds the graphs again when its gesture ends */
const getParamItems = (block: ProceduralBlock): DebuggerPaneItem[] => {
  const { generator } = block;
  const values = getProceduralValues(generator.id);
  if (!values) return [];
  return Object.entries(generator.params).map(([name, spec]): DebuggerPaneItem => {
    const isStatic = isProceduralParamStatic(generator.id, name);
    const base = {
      key: name,
      target: values.params,
      label: `${spec.label ?? name}${isStatic ? ' (rebuilds)' : ''}`,
      onChange: (_value: unknown, change: { last?: boolean }) => {
        if (!isStatic) applyProceduralValues(generator.id);
        else if (change.last) applyProceduralValues(generator.id, true);
      },
    };
    if (spec.type === 'color') return { ...base, kind: 'color' };
    if (spec.type === 'boolean') return { ...base, kind: 'switch' };
    return {
      ...base,
      ...(spec.min !== undefined ? { min: spec.min } : {}),
      ...(spec.max !== undefined ? { max: spec.max } : {}),
      step: spec.step ?? (spec.isInteger ? 1 : undefined),
    };
  });
};

/** The selected generator's pane: its values, its bake's figures, its tools */
const getGeneratorItems = (
  block: ProceduralBlock,
  opts: ProceduralSectionsOpts
): DebuggerPaneItem[] => {
  const { generator } = block;
  const values = getProceduralValues(generator.id);
  if (!values) return [];
  const exportBake = () => {
    const bake = getProceduralBake(generator.id);
    if (!bake) return;
    void exportBakeOutputsAsync(
      bake.slots.map((slot) => ({
        id: bake.id,
        output: slot,
        fileName: `${generator.id}_${slot}.png`,
      })),
      rowState.exportDir.replaceAll('<generator>', generator.id)
    );
  };
  return [
    {
      key: 'seed',
      target: values,
      label: 'Seed',
      kind: 'number',
      min: 0,
      step: 1,
      onChange: () => applyProceduralValues(generator.id),
    },
    ...getParamItems(block),
    {
      type: 'button',
      title: 'Reset',
      label: "The generator's defaults",
      onClick: () => {
        resetProceduralValues(generator.id);
        updateDebuggerTab(opts.tabId, { rebuild: true });
      },
    },
    {
      type: 'button',
      title: 'Copy JSON',
      label: "These values as a set's procedural block",
      onClick: () => {
        void navigator.clipboard
          ?.writeText(getProceduralJson(block))
          .then(() => addDebugToast({ title: 'Copied', message: 'The procedural block (JSON).' }))
          .catch((error: unknown) => lerror('[terrainGallery] The copy failed:', error));
      },
    },
    { type: 'separator' },
    { key: 'memory', target: figures, label: 'Bake', readonly: true },
    { key: 'bakes', target: figures, label: 'Bakes', readonly: true },
    { key: 'gpuMs', target: figures, label: 'Last bake GPU ms', readonly: true },
    { key: 'cpuMs', target: figures, label: 'Last bake CPU ms', readonly: true },
    { type: 'separator' },
    {
      key: 'exportDir',
      target: rowState,
      label: 'Export folder',
      hint: "Where Export PNGs writes, from the repo's root (<generator>: its id)",
    },
    {
      type: 'button',
      title: 'Export PNGs',
      label: "The bake's slots, a texture set's sources",
      onClick: exportBake,
    },
    { type: 'separator' },
    {
      type: 'button',
      title: 'Measure block',
      label: 'Frame GPU ms, alone, per mode',
      onClick: () => void measureBlocksAsync([generator.id], opts),
    },
    { key: 'measure', target: figures, label: 'Frame GPU ms', readonly: true },
  ];
};

const getGeneratorRow = (block: ProceduralBlock) => {
  const { generator, importedSetId } = block;
  const mode = getProceduralMode();
  return {
    itemId: generator.id,
    title: generator.id,
    subTitle: `${generator.category.toLowerCase()}, ${generator.physicalSize[0]} × ${generator.physicalSize[1]} m a tile`,
    suffix: mode === 'IMPORTED' ? importedSetId : MODE_LABELS[mode],
    description: generator.description,
  };
};

/**
 * The Procedural row's sections of the gallery's tab: the row's pane (the mode, the bake size, the
 * bakes' memory, the row's measurement), the generators' list (a click flies the camera to the
 * block and shows its values) and the selected generator's pane.
 * @param opts the tab's hooks
 * @returns the sections, in order
 */
export const getProceduralSections = (opts: ProceduralSectionsOpts): DebuggerTabSection[] => {
  const selected = getBlock(selectedGeneratorId);
  refreshProceduralFigures();
  return [
    {
      pane: true,
      title: 'Procedural row',
      id: 'terrainGalleryProcedural',
      content: [
        {
          key: 'mode',
          target: rowState,
          label: 'Shows',
          kind: 'select',
          options: PROCEDURAL_MODES.map((mode) => ({ label: MODE_LABELS[mode], value: mode })),
          hint: "Each block's generator baked, live in the material (its normal a bump, or with a bake's taps for the normal and AO), or an imported set of its category",
          onChange: (value) => {
            setProceduralMode(value as ProceduralMode);
            updateDebuggerTab(opts.tabId);
          },
        },
        {
          key: 'size',
          target: rowState,
          label: 'Bake size',
          kind: 'select',
          options: PROCEDURAL_BAKE_SIZES.map((size) => ({ label: `${size}²`, value: size })),
          hint: 'Bakes every block again at this size (the packing above is theirs too)',
          onChange: (value) =>
            void setProceduralBakeAsync({ size: Number(value) }).then(() =>
              updateDebuggerTab(opts.tabId)
            ),
        },
        { key: 'rowMemory', target: figures, label: "Bakes' VRAM", readonly: true },
        {
          type: 'button',
          title: 'Measure row',
          label: 'Every block, per mode (about 2 min)',
          onClick: () =>
            void measureBlocksAsync(
              PROCEDURAL_BLOCKS.map((block) => block.generator.id),
              opts
            ),
        },
      ],
    },
    debuggerListCMP({
      id: 'terrainGalleryGenerators',
      heading: 'Procedural surfaces',
      perItemConfig: {
        onClick: (generatorId) => {
          const block = getBlock(generatorId);
          if (!block) return;
          selectedGeneratorId = generatorId;
          opts.onSelect();
          flyToGalleryBlock(block);
          updateDebuggerTab(opts.tabId, { rebuild: true });
        },
      },
      selectedItemId: () => selectedGeneratorId,
      data: () => PROCEDURAL_BLOCKS.map(getGeneratorRow),
    }),
    ...(selected
      ? [
          {
            pane: true as const,
            title: `Generator: ${selected.generator.id}`,
            id: 'terrainGalleryGenerator',
            content: getGeneratorItems(selected, opts),
          },
        ]
      : []),
  ];
};

/**
 * Starts the row's part of the tab for a visit: no selection, no measurements, and the scripts'
 * handle `window.__terrainGallery` (`measureAsync(generatorIds?)` resolving with the markdown
 * table, `measurements`, `setMode`).
 * @param opts the tab's hooks
 * @returns the visit's cleanup (the scene's exit)
 */
export const startProceduralTab = (opts: ProceduralSectionsOpts) => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  selectedGeneratorId = null;
  isMeasuring = false;
  measurements.clear();
  rowState.exportDir = EXPORT_DIR;
  (window as unknown as { __terrainGallery: unknown }).__terrainGallery = {
    measurements,
    getLastTable: () => lastTable,
    setMode: (mode: ProceduralMode) => {
      setProceduralMode(mode);
      updateDebuggerTab(opts.tabId);
    },
    measureAsync: (generatorIds?: string[]) =>
      measureBlocksAsync(
        generatorIds ?? PROCEDURAL_BLOCKS.map((block) => block.generator.id),
        opts
      ),
  };
  return () => {
    thisVisit.isCurrent = false;
  };
};
