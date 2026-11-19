// The terrain showcase tab's Weather section (p310 Phase 3): the scenarios (a rain shower that
// plays out within a few minutes, dry, a snowfall), the conditions now, and the weather's GPU
// cost: each block alone in a fixed pose, its frame dry, in the wettest state (soaked, full
// puddles, raining: the ripples' taps on standing water) and under full snow, on the shared
// sampler (`src/app/shared/_dbg__gpuFrameMeasure.ts`), the table copied with the machine.
import * as THREE from 'three/webgpu';
import { getActiveCamera, getMeshByAppId, getRootScene, isWebGPURenderer } from 'aekasha';
import { updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import {
  getSurfaceConditions,
  setSurfaceConditions,
  startRain,
  stopRain,
  type SurfaceConditionsInput,
} from 'aekasha/surface';
import {
  copyTable,
  getMeasureHeading,
  readBrowserVersionAsync,
  SAMPLE_FRAMES,
  sampleFrameGpuMsAsync,
  startMeasureConditions,
  WARM_UP_FRAMES,
  warnNoFrameTimes,
} from '../../shared/_dbg__gpuFrameMeasure';
import { pauseShowcaseFollowCamera } from './showcasePlayer';

/** The shower: up over 10 s, a minute at full rain, down over 10 s (seconds of the surface clock) */
const SHOWER = { intensity: 1, rampSec: 10, durationSec: 60 };
/**
 * The shower's drying: the default `dryingRate` (0.1 a minute in full sun, still air) takes a
 * quarter of an hour to dry a soaked block at 10:30; this and a breeze dry it within a few minutes
 */
const SHOWER_DRYING: SurfaceConditionsInput = { dryingRate: 0.6, wind: [3, 0] };
/** Dry: the scene's starting weather (its JSON's and the defaults) */
const DRY: SurfaceConditionsInput = {
  mode: 'SIMULATED',
  wetness: 0,
  rain: 0,
  puddleLevel: 0,
  snowCoverage: 0,
  temperature: 15,
  dryingRate: 0.1,
  wind: [0, 0],
};
const SNOWFALL = { temperature: -5, transitionSec: 30 };

/** The states measured, in the table's order */
const MEASURED_STATES: readonly {
  key: string;
  label: string;
  conditions: SurfaceConditionsInput;
}[] = [
  { key: 'dry', label: 'Dry', conditions: { ...DRY, mode: 'MANUAL' } },
  {
    key: 'wettest',
    label: 'Wettest',
    conditions: { ...DRY, mode: 'MANUAL', wetness: 1, rain: 1, puddleLevel: 1 },
  },
  {
    key: 'snow',
    label: 'Snow',
    conditions: { ...DRY, mode: 'MANUAL', snowCoverage: 1, temperature: SNOWFALL.temperature },
  },
];
/** A scene root child wider than this on the ground is the environment (the sky) */
const ENVIRONMENT_EXTENT = 200;

/** A block measured: its terrain block's app id, its grid place's centre, its edge */
export type WeatherBlock = { id: string; title: string; x: number; z: number; size: number };

/** Where the camera stands: over the block from the south, or a first person's eye on it */
type WeatherPose = 'OVERVIEW' | 'FIRST_PERSON';
const POSES: readonly { key: WeatherPose; label: string }[] = [
  { key: 'OVERVIEW', label: 'overview' },
  { key: 'FIRST_PERSON', label: 'first person' },
];
/** The first person's eye over the ground, its pitch (the gallery's preset) and its look distance */
const EYE_HEIGHT = 1.7;
const EYE_PITCH = (10 * Math.PI) / 180;
const LOOK_DISTANCE = 20;

type WeatherResult = {
  block: WeatherBlock;
  pose: WeatherPose;
  emptyMs: number;
  ms: Record<string, number>;
};

const figures = { status: '-' };
const results: WeatherResult[] = [];
let isMeasuring = false;
let visit = { isCurrent: false };

/** The conditions now, one line */
const getConditionsText = () => {
  const c = getSurfaceConditions();
  if (!c) return 'No surface conditions';
  const f = (value: number) => value.toFixed(2);
  return `wet ${f(c.wetness)} · rain ${f(c.rain)} · puddles ${f(c.puddleLevel)} · snow ${f(c.snowCoverage)} · ${c.temperature.toFixed(0)} °C`;
};

const startShower = () => {
  setSurfaceConditions({ mode: 'SIMULATED', snowCoverage: 0, temperature: 15, ...SHOWER_DRYING });
  startRain(SHOWER.intensity, { rampSec: SHOWER.rampSec, durationSec: SHOWER.durationSec });
};

const setDry = () => {
  stopRain();
  setSurfaceConditions(DRY);
};

const startSnowfall = () => {
  stopRain();
  setSurfaceConditions({ mode: 'SIMULATED', temperature: SNOWFALL.temperature });
  setSurfaceConditions({ snowCoverage: 1 }, { transitionSec: SNOWFALL.transitionSec });
};

const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Puts the camera in a pose on the block: `OVERVIEW` from the south (+z) and above, the 64 m block
 * filling a 50° view (past the ripples' 30 m fade); `FIRST_PERSON` an eye 1.7 m over the ground
 * 0.35 of the block in front of its centre, looking 10° down toward −z (the ripples within it)
 */
const poseCameraOn = (block: WeatherBlock, pose: WeatherPose) => {
  const camera = getActiveCamera();
  const mesh = getMeshByAppId(`terrainBlock/${block.id}`);
  if (!camera || !mesh) return;
  if (pose === 'OVERVIEW') {
    const box = new THREE.Box3().setFromObject(mesh);
    const y = (box.min.y + box.max.y) / 2;
    camera.position.set(block.x, y + block.size * 0.65, block.z + block.size * 0.9);
    camera.lookAt(block.x, y, block.z - block.size * 0.05);
    return;
  }
  const z = block.z + block.size * 0.35;
  raycaster.set(new THREE.Vector3(block.x, 500, z), DOWN);
  const ground = raycaster.intersectObject(mesh, false)[0]?.point.y ?? 0;
  const eye = ground + EYE_HEIGHT;
  camera.position.set(block.x, eye, z);
  camera.lookAt(block.x, eye - Math.tan(EYE_PITCH) * LOOK_DISTANCE, z - LOOK_DISTANCE);
};

/**
 * Hides the scene root's children that don't stand on the block's square (the other blocks, their
 * scatter and decals, the bunker, the sea, the player), the sky and lights kept
 * @returns the block's own children (its mesh hidden for the empty frame) and the function that
 * shows the others again
 */
const soloBlock = (block: WeatherBlock) => {
  const own: THREE.Object3D[] = [];
  const hidden: THREE.Object3D[] = [];
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const half = block.size / 2;
  for (const child of getRootScene()?.children ?? []) {
    box.setFromObject(child);
    if (box.isEmpty() || !child.visible) continue;
    box.getCenter(centre);
    if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) > ENVIRONMENT_EXTENT) continue;
    if (Math.abs(centre.x - block.x) <= half && Math.abs(centre.z - block.z) <= half) {
      own.push(child);
    } else {
      child.visible = false;
      hidden.push(child);
    }
  }
  return {
    own,
    showOthers: () => {
      for (const child of hidden) child.visible = true;
    },
  };
};

const setVisible = (objects: THREE.Object3D[], isVisible: boolean) => {
  for (const object of objects) object.visible = isVisible;
};

/** The results as a markdown table under the machine's heading */
const buildTable = () => {
  const head = `| Block | Pose | Empty frame | ${MEASURED_STATES.map(({ label }) => label).join(' | ')} | Wettest − dry | Snow − dry |`;
  const rule = `|${' --- |'.repeat(MEASURED_STATES.length + 5)}`;
  const f = (ms: number) => ms.toFixed(2);
  const rows = results.map(({ block, pose, emptyMs, ms }) =>
    [
      block.title,
      POSES.find(({ key }) => key === pose)?.label ?? pose,
      f(emptyMs),
      ...MEASURED_STATES.map(({ key }) => f(ms[key])),
      f(ms.wettest - ms.dry),
      f(ms.snow - ms.dry),
    ].join(' | ')
  );
  return [
    ...getMeasureHeading(
      'each showcase block alone from above and from a first person’s eye on it, its weather set by hand (MANUAL)',
      'the scene’s sun and shadows, no PostFX, the sky still'
    ),
    '',
    head,
    rule,
    ...rows.map((row) => `| ${row} |`),
  ].join('\n');
};

/**
 * Measures each block alone in each pose: the frame with its own objects hidden, then each weather
 * state. The follow camera, the conditions, the visibility, the pixel ratio and the day are put
 * back after, and the table is copied.
 * @returns the table, or null when no frame times came (or a measurement is running)
 */
const measureWeatherAsync = async (blocks: readonly WeatherBlock[], tabId: string) => {
  if (isMeasuring) return null;
  isMeasuring = true;
  const startedOn = visit;
  const saved = getSurfaceConditions();
  const resumeCamera = pauseShowcaseFollowCamera();
  const endConditions = startMeasureConditions();
  stopRain();
  results.length = 0;
  let isComplete = true;
  try {
    for (const block of blocks) {
      const { own, showOthers } = soloBlock(block);
      try {
        for (const { key: pose, label } of POSES) {
          if (!startedOn.isCurrent) return null;
          figures.status = `${block.title}, ${label}…`;
          updateDebuggerTab(tabId);
          poseCameraOn(block, pose);
          setSurfaceConditions(MEASURED_STATES[0].conditions);
          setVisible(own, false);
          const emptyMs = await sampleFrameGpuMsAsync();
          setVisible(own, true);
          const ms: Record<string, number> = {};
          for (const { key, conditions } of MEASURED_STATES) {
            setSurfaceConditions(conditions);
            const value = await sampleFrameGpuMsAsync();
            if (value === null) break;
            ms[key] = value;
          }
          if (emptyMs === null || Object.keys(ms).length < MEASURED_STATES.length) {
            isComplete = false;
            break;
          }
          results.push({ block, pose, emptyMs, ms });
        }
      } finally {
        setVisible(own, true);
        showOthers();
      }
      if (!isComplete) break;
    }
  } finally {
    if (saved) setSurfaceConditions({ ...saved, wind: [...saved.wind] });
    endConditions();
    resumeCamera();
    isMeasuring = false;
  }
  if (!isComplete) {
    figures.status = 'No GPU frame times';
    warnNoFrameTimes();
    updateDebuggerTab(tabId);
    return null;
  }
  const table = buildTable();
  copyTable(table);
  figures.status = `${results.length / POSES.length} blocks × ${POSES.length} poses, the table copied`;
  updateDebuggerTab(tabId);
  return table;
};

const getDisabledReason = () =>
  isWebGPURenderer()
    ? ''
    : 'WebGPU only: on WebGL2 three’s timer pool loses about a frame in three, so its tables aren’t comparable';

/**
 * Starts the section for a visit: its status cleared, the browser's version read for the heading,
 * and `window.__terrainShowcaseMeasure` (`measureWeatherAsync()`, `getTable()`) for a bench
 * @returns the visit's cleanup
 */
export const startWeatherTab = (blocks: readonly WeatherBlock[], tabId: string) => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  figures.status = '-';
  results.length = 0;
  void readBrowserVersionAsync();
  const handle = {
    measureWeatherAsync: () => measureWeatherAsync(blocks, tabId),
    getTable: () => (results.length ? buildTable() : null),
  };
  (window as { __terrainShowcaseMeasure?: typeof handle }).__terrainShowcaseMeasure = handle;
  return () => {
    thisVisit.isCurrent = false;
    delete (window as { __terrainShowcaseMeasure?: typeof handle }).__terrainShowcaseMeasure;
  };
};

/**
 * The tab's Weather section: the scenarios, the conditions now, and the weather's measurement
 * @param blocks the blocks measured
 * @param tabId the showcase's tab, refreshed from here
 */
export const getWeatherSections = (
  blocks: readonly WeatherBlock[],
  tabId: string
): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Weather',
    id: 'terrainShowcaseWeather',
    content: [
      {
        type: 'button',
        label: 'Scenarios',
        title: `Rain shower (${SHOWER.rampSec} s up, ${SHOWER.durationSec} s, ${SHOWER.rampSec} s down)`,
        onClick: startShower,
      },
      { type: 'button', label: '', title: 'Dry', onClick: setDry },
      {
        type: 'button',
        label: '',
        title: `Snowfall (${SNOWFALL.temperature} °C, cover over ${SNOWFALL.transitionSec} s)`,
        onClick: startSnowfall,
      },
      {
        label: 'Now',
        get: getConditionsText,
        readonly: true,
        hint: 'The surface conditions, simulated (the engine’s Surface conditions tab has every value). Rain shower: the rain wets everything in about a minute, the puddles follow, then the sun and a breeze dry it within a few minutes (the drying rate raised from 0.1 to 0.6 a minute). Dry: the scene’s starting weather at once (no rain, wetness, puddles or snow, 15 °C, still air, the drying rate back). Snowfall: every block’s material and the decal sets take the snow set; the scatter rocks stay bare (the rock material has no snow), sticking out of it',
      },
      {
        type: 'button',
        label: 'Measure',
        title: 'Measure the weather',
        disabled: () => Boolean(getDisabledReason()) || isMeasuring,
        onClick: () => void measureWeatherAsync(blocks, tabId),
      },
      {
        key: 'status',
        target: figures,
        label: 'Status',
        readonly: true,
        hint: `Measure: each block alone from above (past the ripples’ 30 m fade) and from a first person’s eye on it (within it), the frame without it, then dry, wettest (soaked, full puddles, raining) and under snow, ${SAMPLE_FRAMES} frames after ${WARM_UP_FRAMES} each, the weather set by hand and put back after. The table goes to the clipboard; the tables want a 1920 × 1080 canvas`,
      },
      {
        label: 'Backend',
        get: () => getDisabledReason() || 'WebGPU: the tables’ figures',
        readonly: true,
      },
    ],
  },
];
