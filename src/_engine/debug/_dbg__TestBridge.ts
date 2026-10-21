// The scene runner's test bridge (p601), `window.__AEK_TEST__`: public entry and types in
// `debug/TestBridge.ts`. Loads in the debug env and prod test mode, only with `?aekTest=true`.
// Console and page errors aren't collected here: the logger is the console, and the runner's
// browser listeners see everything from the first script on, before this can install.

import { NodeFrame } from 'three/webgpu';
import { IS_DEBUG_ENV } from '../kernel/config/Config';
import { getAllECSWorlds, getECSWorld } from '../kernel/ecs/ECS';
import { ECSSystemStage } from '../kernel/loop/SystemStages';
import { setFixedFrameDelta, toggleAppPlay, toggleMainPlay } from '../kernel/loop/MainLoop';
import { setPhysicsInterpolationPinnedToNewest } from '../features/physics/PhysicsInterpolation';
import { getRenderer } from '../kernel/render/Renderer';
import { getCurrentSceneId } from '../kernel/scene/Scene';
import { hasFirstSceneBeenLoaded, isCurrentlyLoading } from '../kernel/scene/SceneLoader';
import { pauseDayNight } from '../features/skybox/SkyDayNight';
import { takeSnapshotAsync } from '../kernel/render/Snapshot';
import {
  getPhysicsDeterminismProbeSteps,
  onPhysicsProbeReport,
} from '../features/physics/debug/_dbg__PhysicsDeterminism';
import type { PhysicsProbeReport } from '../features/physics/PhysicsProbeTypes';
import { encodeRGBA8PNG } from './_dbg__PNGEncoder';
import { getCharacterPaths, installTestInput } from './_dbg__TestBridgeInput';
import { TEST_BRIDGE_VERSION, type AekTestBridge, type TestBridgeSystemOrder } from './TestBridge';

const DEFAULT_TIMEOUT_MS = 60_000;
/** Every frame of a test page advances by this (the physics timestep: one step a frame) */
const TEST_FRAME_DELTA = 1 / 60;
/** Set by freeze(): TSL `time` stops too (three's own animation loop keeps calling update) */
let isTestClockFrozen = false;

/** The latest probe report per scene id (a page load probes one scene, a revisit replaces it) */
const probeReports = new Map<string, PhysicsProbeReport>();
/** whenProbeDone({ freeze: true }) is waiting: freeze in the report's own listener call */
let freezeOnProbeReport = false;
/** The freeze one whenProbeDone call started (never two for one report), until it's awaited */
let freezing: Promise<void> | null = null;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Resolves with `check()`'s first non-null value, checked every frame, or null at the timeout */
const pollFrames = async <T>(check: () => T | null, timeoutMs: number) => {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== null) return value;
    if (performance.now() >= end) return null;
    await nextFrame();
  }
};

const whenSceneReady: AekTestBridge['whenSceneReady'] = async (opts) => {
  const sceneId = await pollFrames(
    () => (hasFirstSceneBeenLoaded() && !isCurrentlyLoading() ? getCurrentSceneId() ?? null : null),
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (sceneId === null) {
    return { status: 'TIMEOUT', sceneId: getCurrentSceneId() ?? null };
  }
  // The scene's first frames: anything sampled from a render target has rendered into it
  await nextFrame();
  await nextFrame();
  const backend = getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined;
  return { status: 'READY', sceneId, backend: backend?.isWebGPUBackend ? 'WEBGPU' : 'WEBGL' };
};

const whenProbeDone: AekTestBridge['whenProbeDone'] = async (opts) => {
  if (getPhysicsDeterminismProbeSteps() === null) return { status: 'NOT_ARMED' };
  if (opts?.freeze) {
    const sceneId = getCurrentSceneId();
    // Already reported (a late call): freeze now, frames have run since
    if (sceneId && probeReports.has(sceneId)) freezing ??= freeze();
    else freezeOnProbeReport = true;
  }
  const report = await pollFrames(() => {
    const sceneId = getCurrentSceneId();
    return (sceneId && probeReports.get(sceneId)) || null;
  }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  freezeOnProbeReport = false;
  if (!report) {
    return { status: 'TIMEOUT', sceneId: getCurrentSceneId() ?? null };
  }
  if (freezing) {
    await freezing;
    // Done: a later whenProbeDone({ freeze: true }) (a later visit) freezes again
    freezing = null;
  }
  return { status: 'DONE', ...report };
};

const freeze: AekTestBridge['freeze'] = async () => {
  // Interpolation draws a pose between the last two steps that depends on frame timing: two
  // frames at the newest snapshot (the step the probe hashed) before the loops stop
  setPhysicsInterpolationPinnedToNewest(getECSWorld(), true);
  await nextFrame();
  await nextFrame();
  toggleAppPlay(false);
  pauseDayNight();
  toggleMainPlay(false);
  isTestClockFrozen = true;
};

// The test clock: what a frame draws depends on how many frames ran, not on how long they took
// (SwiftShader frames take anything from 20 ms to seconds). The main loop and physics take the
// fixed delta (and with it the sky box's clock: its clouds and bake schedules); three's TSL
// `time` (the stars' twinkle) advances in `NodeFrame.update()` from `performance.now()`, once per
// animation frame, so that method is replaced (three r186's fields, re-check on a three upgrade).
const useTestClock = () => {
  setFixedFrameDelta(TEST_FRAME_DELTA);
  NodeFrame.prototype.update = function (this: NodeFrame) {
    this.frameId++;
    this.deltaTime = isTestClockFrozen ? 0 : TEST_FRAME_DELTA;
    this.time += this.deltaTime;
  };
};

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

const snapshot: AekTestBridge['snapshot'] = async ({ width, height }) => {
  const shot = await takeSnapshotAsync({ width, height });
  const png = await encodeRGBA8PNG(shot.data, shot.width, shot.height);
  return {
    width: shot.width,
    height: shot.height,
    pngBase64: await toBase64(png),
    postFx: shot.postFx,
  };
};

const getSystemOrder: AekTestBridge['getSystemOrder'] = () => {
  const order: TestBridgeSystemOrder = {};
  for (const world of getAllECSWorlds()) {
    const stages: Record<string, string[]> = {};
    for (const stage of Object.values(ECSSystemStage)) {
      const systems = world.getSystemOrder(stage);
      if (systems.length) stages[stage] = systems.map(({ id, order }) => `${id}@${order}`);
    }
    order[world.id] = stages;
  }
  return order;
};

export const _installTestBridge = () => {
  if (window.__AEK_TEST__) return;
  useTestClock();
  installTestInput(window.__AEK_TEST_INPUT__ ?? null);
  onPhysicsProbeReport((report) => {
    probeReports.set(report.sceneId, report);
    if (freezeOnProbeReport && report.sceneId === getCurrentSceneId()) {
      freezeOnProbeReport = false;
      freezing ??= freeze();
    }
  });
  window.__AEK_TEST__ = {
    version: TEST_BRIDGE_VERSION,
    mode: IS_DEBUG_ENV ? 'DEBUG' : 'PROD_TEST',
    whenSceneReady,
    whenProbeDone,
    freeze,
    snapshot,
    getSystemOrder,
    getCharacterPaths,
  };
};
