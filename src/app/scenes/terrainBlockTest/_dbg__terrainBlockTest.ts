import { getActiveCamera, llog } from 'aekasha';
import { createDebuggerTab } from 'aekasha/debug';
import { spawnTerrainBlock } from 'aekasha/terrain';
import { generateTerrainAsync, type TerrainAsyncOptions } from 'aekasha/toolkit/geometry';

// The terrain block scene's tab (debug env), p306 Phase 4's exit: the frames while a 257² block
// with AO generates, on the toolkit's terrain worker and on the main thread, and while the
// `terrainBlockTestLarge` block spawns (generation, mesh, collider and its first renders). Each
// run records every frame's delta from its start until `FRAMES_AFTER` frames after its work
// resolved, beside an idle stretch measured first. `window.__terrainBlockTest.measureAsync(run)`
// runs one from a script (`devTools/bench/` style) and resolves with its figures.

const TAB_ID = 'terrainBlockTest';
const SCENE_ID = 'terrainBlockTest';
const LARGE_BLOCK_ID = 'terrainBlockTestLarge';
/** Frames recorded after the work resolved: the result's first renders */
const FRAMES_AFTER = 20;
const IDLE_FRAMES = 60;
/** A frame this long dropped one at 60 Hz */
const LONG_FRAME_MS = 20;

/** `terrainBlockTestLarge`'s generation as `generateTerrainAsync` options (its JSON's params) */
const LARGE_OPTIONS: TerrainAsyncOptions = {
  width: 256,
  depth: 256,
  widthSegments: 256,
  depthSegments: 256,
  maxHeight: 24,
  noiseOctaves: [
    { frequency: 0.0125, amplitude: 1 },
    { frequency: 0.04, amplitude: 0.4 },
    { frequency: 0.125, amplitude: 0.1 },
  ],
  seed: 3,
  center: [0, -256],
  normals: 'HEIGHT_FN',
  ao: { radius: 16 },
  vertexColors: {
    layout: 'RGB_AO',
    rules: [
      { layer: 1, slope: { min: 25 } },
      { layer: 2, height: { min: 10 } },
      { layer: 3, slope: { min: 45 } },
    ],
  },
  collider: true,
};

/** The runs: generation alone on either thread, or the whole block spawned (then disposed) */
export type TerrainBlockTestRun = 'WORKER' | 'MAIN_THREAD' | 'SPAWN';

/** A run's figures, milliseconds */
export type TerrainBlockTestFrames = {
  run: TerrainBlockTestRun;
  /** From the start until the work resolved */
  workMs: number;
  /** The longest frame until the work resolved, and after it */
  longestBeforeMs: number;
  longestAfterMs: number;
  /** Frames over `LONG_FRAME_MS`, the whole run */
  longFrames: number;
  frames: number;
  /** The longest frame's index, and the first frame's after the work resolved */
  longestAt: number;
  resolvedAt: number;
  /** The idle stretch's longest frame, measured right before */
  idleLongestMs: number;
};

const nextFrameAsync = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** The frames' deltas while `work` runs and `FRAMES_AFTER` frames past it, and its own time */
const recordFramesAsync = async (work: () => Promise<unknown>) => {
  const deltas: number[] = [];
  let resolvedAt = -1;
  let last = await nextFrameAsync();
  const start = performance.now();
  let workMs = 0;
  const done = work().then(() => {
    workMs = performance.now() - start;
    resolvedAt = deltas.length;
  });
  while (resolvedAt < 0 || deltas.length < resolvedAt + FRAMES_AFTER) {
    const now = await nextFrameAsync();
    deltas.push(now - last);
    last = now;
  }
  await done;
  return { deltas, resolvedAt, workMs };
};

const measureIdleAsync = async () => {
  let longest = 0;
  let last = await nextFrameAsync();
  for (let i = 0; i < IDLE_FRAMES; i++) {
    const now = await nextFrameAsync();
    longest = Math.max(longest, now - last);
    last = now;
  }
  return longest;
};

const runWork = (run: TerrainBlockTestRun) => async () => {
  if (run !== 'SPAWN') {
    await generateTerrainAsync({
      ...LARGE_OPTIONS,
      workerTarget: run === 'WORKER' ? 'WORKER_THREAD' : 'MAIN_THREAD',
    });
    return;
  }
  const block = await spawnTerrainBlock(LARGE_BLOCK_ID);
  // Disposed after the run's frames: its first renders are part of it
  return block;
};

/** Runs one measurement and logs its figures. */
const measureAsync = async (run: TerrainBlockTestRun): Promise<TerrainBlockTestFrames> => {
  const idleLongestMs = await measureIdleAsync();
  let block: Awaited<ReturnType<typeof spawnTerrainBlock>> | undefined;
  const work = runWork(run);
  const { deltas, resolvedAt, workMs } = await recordFramesAsync(async () => {
    block = await work();
  });
  block?.dispose();
  const longest = (list: number[]) => list.reduce((max, d) => Math.max(max, d), 0);
  const frames: TerrainBlockTestFrames = {
    run,
    workMs,
    longestBeforeMs: longest(deltas.slice(0, resolvedAt + 1)),
    longestAfterMs: longest(deltas.slice(resolvedAt + 1)),
    longFrames: deltas.filter((d) => d > LONG_FRAME_MS).length,
    frames: deltas.length,
    longestAt: deltas.indexOf(longest(deltas)),
    resolvedAt,
    idleLongestMs,
  };
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  llog(
    `[terrainBlockTest] ${run}: work ${ms(workMs)}, longest frame ${ms(frames.longestBeforeMs)} before it resolved and ${ms(frames.longestAfterMs)} after, ${frames.longFrames} of ${frames.frames} frames over ${LONG_FRAME_MS} ms (idle: ${ms(idleLongestMs)})`
  );
  return frames;
};

/** The decal block's tracks (p309 Phase 3: grid (-4, 3), 32 m), seen low from its +z side */
const DECAL_VIEW = { position: [-122, 9, 118], target: [-128, 1.5, 98] } as const;

/** Moves the active camera to look at the decal block's tracks */
const lookAtDecalTracks = () => {
  const camera = getActiveCamera();
  if (!camera) return;
  camera.position.set(...DECAL_VIEW.position);
  camera.lookAt(...DECAL_VIEW.target);
};

/** Creates the scene's tab (removed on its exit) and the script's `measureAsync`. */
export const createTerrainBlockTestTab = (state: object) => {
  Object.assign(state, { measureAsync });
  const button = (title: string, run: TerrainBlockTestRun) => ({
    type: 'button' as const,
    title,
    onClick: () => void measureAsync(run),
  });
  createDebuggerTab({
    id: TAB_ID,
    title: 'Terrain blocks',
    icon: 'easel',
    sceneId: SCENE_ID,
    content: () => [
      {
        pane: true,
        content: [
          button('Generate 257² with AO: worker', 'WORKER'),
          button('Generate 257² with AO: main thread', 'MAIN_THREAD'),
          button('Spawn the large block (worker)', 'SPAWN'),
          {
            type: 'button' as const,
            title: 'Look at the decal tracks',
            onClick: lookAtDecalTracks,
          },
        ],
      },
    ],
  });
};
