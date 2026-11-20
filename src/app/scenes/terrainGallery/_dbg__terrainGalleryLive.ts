// The terrain gallery tab's Live block section (p305 Phase 8): the ripples live or baked, the
// camera's poses (above, a third person at the block's edge), the generator's live values
// (uniforms on whichever material the block shows) and the GPU measurement: the block alone in each
// pose, nothing then baked then live, the frame's GPU time averaged (the tab's Quality select sets
// the tier measured). Scripts drive it through `window.__terrainGalleryLive`.
import { addDebugToast, updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { getMeshByAppId } from 'aekasha';
import { sandRipples } from 'aekasha/toolkit/terrain';
import {
  flyGalleryCamera,
  holdGalleryCameraPose,
  type GalleryCameraPose,
} from './_dbg__terrainGalleryCamera';
import {
  getMeasureHeading,
  hideMeshes,
  sampleFrameGpuMsAsync,
  startMeasureConditions,
  warnNoFrameTimes,
} from '../../shared/_dbg__gpuFrameMeasure';
import {
  applyLiveValues,
  getDefaultLiveValues,
  getLiveInputs,
  getLiveMode,
  getLiveTerrain,
  getLiveValues,
  LIVE_APP_ID,
  LIVE_BLOCK,
  LIVE_BLOCK_SIZE,
  LIVE_MODES,
  LIVE_PARAMS,
  setLiveMode,
  setLiveView,
  type LiveMode,
} from './liveBlock';
import type { GalleryDebugView, GalleryQuality } from './galleryBlocks';

/** Where the camera stands */
const POSES = ['ABOVE', 'THIRD'] as const;
type LivePose = (typeof POSES)[number];
const POSE_LABELS: Record<LivePose, string> = { ABOVE: 'Above', THIRD: 'Third person' };
const MODE_LABELS: Record<LiveMode, string> = { LIVE: 'Live', BAKED: 'Baked' };

/** What a measurement shows the block as: nothing (the frame's floor), then each mode */
const MEASURE_STEPS = ['EMPTY', ...LIVE_MODES] as const;
type MeasureStep = (typeof MEASURE_STEPS)[number];
/** A pose's measurement: the frame's mean GPU ms per step (null: no figure) */
type PoseMeasurement = Partial<Record<MeasureStep, number | null>>;

/** What the main tab gives the section */
export type LiveSectionOpts = {
  /** The tab, refreshed and rebuilt from here */
  tabId: string;
  /** The app ids of everything else the gallery draws: hidden while the block is measured */
  getOtherAppIds: () => string[];
};

/** The section's own state: the pose, the mode shown; the figures the monitors read */
const tabState = { pose: 'ABOVE' as LivePose, mode: 'LIVE' as LiveMode };
const figures = { measure: '-' };
/** This visit's: false once the scene is left, so a measurement that ends later restores nothing */
let visit = { isCurrent: false };
let isMeasuring = false;
let lastTable = '';

/**
 * A pose over the block: straight down from 30 m over its top, or a third person 1.8 m over the
 * ground at its near edge (+z), looking across it
 */
const getPose = (pose: LivePose): GalleryCameraPose => {
  const { bottom, top } = getLiveTerrain();
  const half = LIVE_BLOCK_SIZE / 2;
  if (pose === 'THIRD') {
    return {
      pos: { x: LIVE_BLOCK.x - 4, y: bottom + 3.5, z: LIVE_BLOCK.z + half - 2 },
      look: { x: LIVE_BLOCK.x + 2, y: bottom + 1.5, z: LIVE_BLOCK.z - 6 },
    };
  }
  return {
    pos: { x: LIVE_BLOCK.x, y: top + 30, z: LIVE_BLOCK.z + 0.01 },
    look: { x: LIVE_BLOCK.x, y: bottom, z: LIVE_BLOCK.z },
  };
};

const formatMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? 'n/a' : ms.toFixed(2);

/** The measurements as a markdown table, the machine's part of its heading */
const buildTable = (results: Map<LivePose, PoseMeasurement>) => {
  const lines = [
    ...getMeasureHeading('the Live block alone'),
    '',
    `| Pose | ${MEASURE_STEPS.map((step) => (step === 'EMPTY' ? 'Empty frame' : MODE_LABELS[step])).join(' | ')} |`,
    '| --- | --- | --- | --- |',
  ];
  for (const [pose, measurement] of results) {
    const cells = MEASURE_STEPS.map((step) => formatMs(measurement[step]));
    lines.push(`| ${POSE_LABELS[pose]} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
};

/**
 * Measures the block alone (everything else the gallery draws hidden) in each pose: nothing, then
 * baked, then live, the frame's GPU ms averaged per step. Puts the mode, the other meshes and the
 * camera back and copies the table. One run at a time; a run the scene's exit ends restores
 * nothing.
 * @returns the table, or null when nothing was measured (a run in progress, no frame times)
 */
const measureAsync = async (opts: LiveSectionOpts) => {
  const block = getMeshByAppId(LIVE_APP_ID);
  if (isMeasuring || !block) return null;
  isMeasuring = true;
  figures.measure = 'measuring…';
  const startedOn = visit;
  const shownMode = getLiveMode();
  const endConditions = startMeasureConditions();
  const showOthers = hideMeshes(opts.getOtherAppIds());
  const results = new Map<LivePose, PoseMeasurement>();
  let restoreCamera: (() => void) | null = null;
  let hasFrameTimes = true;
  try {
    for (const pose of POSES) {
      restoreCamera?.();
      restoreCamera = holdGalleryCameraPose(getPose(pose));
      const measurement: PoseMeasurement = {};
      for (const step of MEASURE_STEPS) {
        block.visible = step !== 'EMPTY';
        if (step !== 'EMPTY') setLiveMode(step);
        measurement[step] = await sampleFrameGpuMsAsync();
        if (!startedOn.isCurrent) return null;
        hasFrameTimes = measurement[step] !== null;
        if (!hasFrameTimes) break;
      }
      if (!hasFrameTimes) break;
      results.set(pose, measurement);
    }
  } finally {
    isMeasuring = false;
    if (startedOn.isCurrent) {
      block.visible = true;
      setLiveMode(shownMode);
      showOthers();
      restoreCamera?.();
      endConditions();
    }
  }
  if (!hasFrameTimes) {
    figures.measure = '-';
    warnNoFrameTimes();
    return null;
  }
  lastTable = buildTable(results);
  figures.measure = [...results]
    .map(
      ([pose, m]) => `${POSE_LABELS[pose]}: baked ${formatMs(m.BAKED)}, live ${formatMs(m.LIVE)}`
    )
    .join('; ');
  updateDebuggerTab(opts.tabId);
  // Not awaited: a page without the focus may never settle it
  void navigator.clipboard?.writeText(lastTable).catch(() => undefined);
  return lastTable;
};

/**
 * The Live block's section of the gallery's tab: the mode, the camera pose (flying there), the
 * generator's live values, their reset and the measurement.
 * @param opts the tab's hooks
 * @returns the section
 */
export const getLiveSections = (opts: LiveSectionOpts): DebuggerTabSection[] => {
  tabState.mode = getLiveMode();
  return [
    {
      pane: true,
      title: 'Live block',
      id: 'terrainGalleryLive',
      content: [
        {
          key: 'mode',
          target: tabState,
          label: 'Ripples',
          kind: 'segmented',
          options: LIVE_MODES.map((mode) => ({ label: MODE_LABELS[mode], value: mode })),
          hint: `The hollows' sand ripples (a procedural set of sandRipples): its generator live in the terrain material (source PROCEDURAL_LIVE), or its bake sampled; inputs ${getLiveInputs('LIVE').join(', ')} (the imported sets in a set array, the procedural set beside it)`,
          onChange: (value) => setLiveMode(value as LiveMode),
        },
        {
          key: 'pose',
          target: tabState,
          label: 'Camera',
          kind: 'segmented',
          options: POSES.map((pose) => ({ label: POSE_LABELS[pose], value: pose })),
          hint: 'Flies the camera over the block, or to a third person at its near edge',
          onChange: () => flyGalleryCamera(getPose(tabState.pose)),
        },
        { type: 'separator' },
        ...LIVE_PARAMS.map((name) => {
          const spec = sandRipples.params[name];
          return {
            key: name,
            target: getLiveValues(),
            label: spec.label ?? name,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            hint: `The live layer's uniform terrain_l3_live_${name} (the bake keeps the set's)`,
            onChange: () => applyLiveValues(),
          };
        }),
        {
          key: 'seed',
          target: getLiveValues(),
          label: 'Seed',
          min: 0,
          step: 1,
          hint: "The live layer's uniform terrain_l3_live_seed",
          onChange: () => applyLiveValues(),
        },
        {
          type: 'button',
          title: 'Reset',
          label: "The set's values",
          onClick: () => {
            Object.assign(getLiveValues(), getDefaultLiveValues());
            applyLiveValues();
            updateDebuggerTab(opts.tabId, { rebuild: true });
          },
        },
        { type: 'separator' },
        {
          type: 'button',
          title: 'Measure',
          label: 'Frame GPU ms, the block alone, each pose: baked and live',
          onClick: () => {
            void measureAsync(opts).then((table) => {
              if (table)
                addDebugToast({ title: 'Measured', message: 'The table is on the clipboard.' });
            });
          },
        },
        { key: 'measure', target: figures, label: 'Frame GPU ms', readonly: true },
      ],
    },
  ];
};

/**
 * Starts the section for a visit: the first pose, no figures, and the scripts' handle
 * `window.__terrainGalleryLive` (`measureAsync()` resolving with the markdown table,
 * `setMode(mode)`, `getPose(pose)`, `flyTo(pose)`, `setView(debugView, quality)`: the block's
 * alone, the tab's selects untouched)
 * @param opts the tab's hooks
 * @returns the visit's cleanup (the scene's exit)
 */
export const startLiveTab = (opts: LiveSectionOpts) => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  isMeasuring = false;
  tabState.pose = 'ABOVE';
  figures.measure = '-';
  (window as unknown as { __terrainGalleryLive: unknown }).__terrainGalleryLive = {
    measureAsync: () => measureAsync(opts),
    getLastTable: () => lastTable,
    setMode: (mode: LiveMode) => {
      setLiveMode(mode);
      updateDebuggerTab(opts.tabId);
    },
    getPose,
    flyTo: (pose: LivePose) => flyGalleryCamera(getPose(pose)),
    setView: (view: GalleryDebugView, quality: GalleryQuality) => setLiveView(view, quality),
  };
  return () => {
    thisVisit.isCurrent = false;
  };
};
