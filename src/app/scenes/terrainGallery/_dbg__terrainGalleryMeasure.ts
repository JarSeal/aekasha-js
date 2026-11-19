// The terrain gallery tab's measurement mode (p310 §2.3), which feeds the handbook's GPU tables:
// - **Solo:** the selected block (the presets' Block) alone in its measurement pose.
// - **Measure:** the frame's GPU ms from the engine's frame record (`onGpuFrameTime`), the mean of
//   `SAMPLE_FRAMES` frames after `WARM_UP_FRAMES`, first with the block hidden (the frame's floor:
//   the ground and the sky) and then shown at each quality tier its row takes (the tab's Quality),
//   or once at its own; a row's every block in turn.
// - **The conditions** every gallery measurement shares (the Procedural row's and the Live
//   block's too, on this sampler; both in `src/app/shared/_dbg__gpuFrameMeasure.ts`, which the
//   terrain showcase uses too): the pixel ratio 1, the day-night cycle paused, and a heading
//   naming the machine, the canvas and what's off (PostFX: the gallery has none; shadows: the
//   gallery casts none, `NO_SHADOWS`), with a warning when the canvas isn't 1920 × 1080.
// What a block is: the scene root's children whose world box's middle stands on the block's
// square, smaller than `ENVIRONMENT_EXTENT` (its mesh, wall, scatter, decals); the larger ones (the
// ground, the sky) stay in every frame, lights and cameras too, and the rest is hidden. The figures
// are WebGPU's: on WebGL2 three's timer pool times one context at a time and loses the queries
// opened while a resolve polls (about two frames in three get a figure), so the tab measures there
// only on request of a script and says why.
import * as THREE from 'three/webgpu';
import { getRootScene, isWebGPURenderer, lerror } from 'aekasha';
import { addDebugToast, updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import {
  copyTable,
  getMeasureHeading,
  readBrowserVersionAsync,
  SAMPLE_FRAMES,
  sampleFrameGpuMsAsync,
  startMeasureConditions,
  TABLE_CANVAS,
  WARM_UP_FRAMES,
  warnNoFrameTimes,
} from '../../shared/_dbg__gpuFrameMeasure';
import { holdGalleryCameraPose, getMeasurePose } from './_dbg__terrainGalleryCamera';
import { getPresetSelection } from './_dbg__terrainGalleryPresets';
import { getGalleryRow, type GalleryRow, type GalleryRowBlock } from './_dbg__terrainGalleryRows';
import type { GalleryQuality } from './galleryBlocks';

/** A scene root child wider than this on the ground is the environment (the ground, the sky) */
const ENVIRONMENT_EXTENT = 200;
/** The tiers a row that takes them is measured at, the materials' own first */
const TIERS: readonly GalleryQuality[] = ['OWN', 'LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

/** A block's measurement at a tier */
type MeasureResult = {
  row: GalleryRow;
  block: GalleryRowBlock;
  tier: GalleryQuality;
  packing: string;
  /** The frame without the block, and with it */
  emptyMs: number;
  frameMs: number;
};

/** What the main tab gives the section */
export type MeasureSectionOpts = {
  tabId: string;
  /** The tab's quality tier, and setting it (the materials swapped) */
  getQuality: () => GalleryQuality;
  setQuality: (quality: GalleryQuality) => void;
  /** The packing a block shows, or '' for none to name */
  getPacking: (rowId: string, blockKey: string) => string;
};

/** The section's state as its fields bind it, and the figures its monitors read */
const measureState = { solo: false };
const figures = { status: '-' };
const results: MeasureResult[] = [];
/** This visit's: false once the scene is left, so a run that ends later restores nothing */
let visit = { isCurrent: false };
let isMeasuring = false;
/** Solo's restore, while it's on */
let endSolo: (() => void) | null = null;

/** The scene root's children a block's measurement shows: the block's own, the environment */
const splitSceneForBlock = (block: GalleryRowBlock) => {
  const own: THREE.Object3D[] = [];
  const others: THREE.Object3D[] = [];
  const box = new THREE.Box3();
  const half = block.size / 2;
  for (const child of getRootScene()?.children ?? []) {
    const { isLight, isCamera } = child as { isLight?: boolean; isCamera?: boolean };
    if (isLight || isCamera || !child.visible) continue;
    box.setFromObject(child);
    if (box.isEmpty()) continue;
    const extent = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if (extent > ENVIRONMENT_EXTENT) continue;
    const x = (box.min.x + box.max.x) / 2;
    const z = (box.min.z + box.max.z) / 2;
    const isOwn = Math.abs(x - block.x) <= half && Math.abs(z - block.z) <= half;
    (isOwn ? own : others).push(child);
  }
  return { own, others };
};

const setVisible = (objects: THREE.Object3D[], visible: boolean) => {
  for (const object of objects) object.visible = visible;
};

/**
 * Shows the block alone (its own objects and the environment) in its measurement pose
 * @returns the function that shows the rest again and puts the camera back
 */
const soloBlock = (block: GalleryRowBlock) => {
  const { others } = splitSceneForBlock(block);
  setVisible(others, false);
  const restoreCamera = holdGalleryCameraPose(getMeasurePose(block));
  return () => {
    setVisible(others, true);
    restoreCamera?.();
  };
};

/** Turns solo on (the presets' block) or off */
const setSolo = (isOn: boolean) => {
  endSolo?.();
  endSolo = null;
  measureState.solo = isOn;
  if (!isOn) return;
  const { block } = getPresetSelection();
  if (block) endSolo = soloBlock(block);
};

/**
 * Measures blocks of a row in turn: each alone in its measurement pose, hidden (the frame's
 * floor) and then shown at each tier its row takes, the tab's quality put back after. Keeps the
 * results (a block measured again replaces its), copies the table of every result and toasts.
 * One run at a time (solo ends first); a run the scene's exit ends restores nothing.
 * @returns the table, or null when nothing was measured (a run in progress, no frame times)
 */
const measureBlocksAsync = async (row: GalleryRow, keys: string[], opts: MeasureSectionOpts) => {
  if (isMeasuring) return null;
  isMeasuring = true;
  setSolo(false);
  const startedOn = visit;
  const quality = opts.getQuality();
  const endConditions = startMeasureConditions();
  const blocks = row.getBlocks().filter((block) => keys.includes(block.key));
  const tiers = row.takesTiers ? TIERS : (['OWN'] as const);
  let restore: (() => void) | null = null;
  let hasFrameTimes = true;
  try {
    for (const [i, block] of blocks.entries()) {
      restore?.();
      const { own } = splitSceneForBlock(block);
      restore = soloBlock(block);
      figures.status = `${row.letter} ${block.label} (${i + 1} / ${blocks.length}): empty`;
      updateDebuggerTab(opts.tabId);
      setVisible(own, false);
      const emptyMs = await sampleFrameGpuMsAsync();
      setVisible(own, true);
      if (!startedOn.isCurrent) return null;
      if (emptyMs === null) {
        hasFrameTimes = false;
        break;
      }
      for (const tier of tiers) {
        figures.status = `${row.letter} ${block.label} (${i + 1} / ${blocks.length}): ${tier}`;
        updateDebuggerTab(opts.tabId);
        if (tier !== opts.getQuality()) opts.setQuality(tier);
        const frameMs = await sampleFrameGpuMsAsync();
        if (!startedOn.isCurrent) return null;
        if (frameMs === null) {
          hasFrameTimes = false;
          break;
        }
        const packing = opts.getPacking(row.id, block.key);
        const at = results.findIndex(
          (r) => r.row.id === row.id && r.block.key === block.key && r.tier === tier
        );
        const result = { row, block, tier, packing, emptyMs, frameMs };
        if (at >= 0) results[at] = result;
        else results.push(result);
      }
      if (!hasFrameTimes) break;
    }
  } finally {
    isMeasuring = false;
    if (startedOn.isCurrent) {
      restore?.();
      if (opts.getQuality() !== quality) opts.setQuality(quality);
      endConditions();
      figures.status = hasFrameTimes ? `${results.length} results` : 'no GPU frame times';
      updateDebuggerTab(opts.tabId);
    }
  }
  if (!hasFrameTimes) {
    warnNoFrameTimes();
    return null;
  }
  const table = buildTable();
  copyTable(table);
  addDebugToast({
    title: 'Measured',
    message: `${blocks.length} block${blocks.length === 1 ? '' : 's'} of ${row.letter} ${row.title}: every result is on the clipboard as a table.`,
  });
  return table;
};

/** Every result as a markdown table, the machine and the conditions in its heading */
const buildTable = () => {
  const lines = [
    ...getMeasureHeading('a block alone, its row’s tiers (Own: the material’s own fields)'),
    '',
    '| Row | Block | Tier | Packing | Frame | Empty frame | The block |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const { row, block, tier, packing, emptyMs, frameMs } of results) {
    const cells = [
      `${row.letter} ${row.title}`,
      block.label,
      tier === 'OWN' ? 'Own' : tier,
      packing || '—',
      frameMs.toFixed(2),
      emptyMs.toFixed(2),
      (frameMs - emptyMs).toFixed(2),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
};

/** The selected block's row, or null */
const getSelectedRow = () => {
  const { rowId } = getPresetSelection();
  return getGalleryRow(rowId) ?? null;
};

/** Why the buttons are off: '' when they aren't */
const getDisabledReason = () =>
  isWebGPURenderer()
    ? ''
    : 'WebGPU only: on WebGL2 three times one context at a time and loses the queries opened while a resolve polls, so about two frames in three get a figure';

/**
 * Starts the section for a visit: no results, solo off, and the scripts' handle
 * `window.__terrainGalleryMeasure` (`measureBlockAsync(rowId, key)` and `measureRowAsync(rowId)`
 * resolving with the table, `getTable()`, `results`), which measures on WebGL2 too
 * @param opts the tab's hooks
 * @returns the visit's cleanup (the scene's exit)
 */
export const startMeasureTab = (opts: MeasureSectionOpts) => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  isMeasuring = false;
  endSolo = null;
  measureState.solo = false;
  results.length = 0;
  figures.status = '-';
  void readBrowserVersionAsync();
  const measureRow = (rowId: string, keys?: string[]) => {
    const row = getGalleryRow(rowId);
    if (!row) {
      lerror(`[terrainGallery] No row "${rowId}".`);
      return Promise.resolve(null);
    }
    return measureBlocksAsync(row, keys ?? row.getBlocks().map((b) => b.key), opts);
  };
  (window as unknown as { __terrainGalleryMeasure: unknown }).__terrainGalleryMeasure = {
    results,
    getTable: buildTable,
    measureBlockAsync: (rowId: string, key: string) => measureRow(rowId, [key]),
    measureRowAsync: (rowId: string) => measureRow(rowId),
  };
  return () => {
    thisVisit.isCurrent = false;
    endSolo = null;
  };
};

/**
 * The tab's Measurement section: solo, measuring the presets' block or its row, the results
 * @param opts the tab's hooks
 * @returns the section
 */
export const getMeasureSections = (opts: MeasureSectionOpts): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Measurement',
    id: 'terrainGalleryMeasure',
    content: [
      {
        key: 'solo',
        target: measureState,
        label: 'Solo',
        kind: 'switch',
        hint: 'The presets’ Block alone (its mesh, wall, scatter and decals; the ground and the sky stay) in its measurement pose, the camera put back when off',
        onChange: (value) => setSolo(Boolean(value)),
      },
      {
        type: 'button',
        title: 'Measure block',
        disabled: () => getDisabledReason() !== '',
        onClick: () => {
          const { rowId, block } = getPresetSelection();
          const row = getGalleryRow(rowId);
          if (row && block) void measureBlocksAsync(row, [block.key], opts);
        },
      },
      {
        type: 'button',
        title: 'Measure row',
        disabled: () => getDisabledReason() !== '',
        onClick: () => {
          const row = getSelectedRow();
          if (row) {
            void measureBlocksAsync(
              row,
              row.getBlocks().map((block) => block.key),
              opts
            );
          }
        },
      },
      {
        type: 'button',
        title: 'Copy results',
        disabled: () => results.length === 0,
        onClick: () => {
          copyTable(buildTable());
          addDebugToast({ title: 'Copied', message: `${results.length} results, as a table.` });
        },
      },
      {
        type: 'button',
        title: 'Clear results',
        disabled: () => results.length === 0 || isMeasuring,
        onClick: () => {
          results.length = 0;
          figures.status = '-';
          updateDebuggerTab(opts.tabId);
        },
      },
      {
        key: 'status',
        target: figures,
        label: 'Status',
        readonly: true,
        hint: `A block: the frame with it hidden, then shown at each tier its row takes (the library, Packing, Splatting, Rules, Colour map and Live rows; the others their own), ${SAMPLE_FRAMES} frames after ${WARM_UP_FRAMES} each; a row: each block in turn. The table goes to the clipboard. The tables want a ${TABLE_CANVAS.width} × ${TABLE_CANVAS.height} canvas (the measurement sets the pixel ratio 1). The TAPS debug view gives a block's fetches`,
      },
      {
        label: 'Backend',
        get: () => getDisabledReason() || 'WebGPU: the tables’ figures',
        readonly: true,
      },
    ],
  },
];
