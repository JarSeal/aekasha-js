import * as THREE from 'three/webgpu';
import {
  ComponentType,
  ECSSystemStage,
  cameraLookAtPoint,
  deleteGeometry,
  getActiveCameraId,
  getCurrentSceneId,
  getGeometryRegistry,
  getRenderer,
  registerOnAllSceneExits,
  saveBufferGeometry,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { generateLodChain, resolveLodChainOptions, simplifyLodChain } from 'aekasha/lod';
import type { LodChainOptions } from 'aekasha/lod';
import {
  getSkyLightIds,
  pauseDayNight,
  setActiveSkyBox,
  setTimeOfDay,
  updateSkyBox,
} from 'aekasha/skybox';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { Flags } from 'meshoptimizer/simplifier';
import { createDrawsApi } from './_dbg__hlodSpikeDraws';
import type { SpikeFrame } from './_dbg__hlodSpikeDraws';

// p376 Phase 0's probe (docs/plans/p376_hlod-merged-cluster-proxies.md §3), `window.__aekHlod`,
// driven by `devTools/bench/hlodSpike.ts`. Shared by the scenes it measures (largeWorld,
// testDebugScene), each loading it in the debug env and prod test mode.
//
// Step 1, how far merged content simplifies: `simplifyAsync` simplifies every BAKED merge group's
// geometry in each variant (default, `permissive`, `prune`, `prune` + `permissive`) with the
// engine's own simplifier (`simplifyLodChain`, on the main thread, timed), and for the variants
// the engine has an option for, again through `generateLodChain` on a copy registered under a
// spike id (`hlodSpike:<group id>:<variant>`), for its time on the assets worker. `prune` isn't a
// `LodChainOptions` field yet (Phase 1, D4): the probe adds meshoptimizer's `Prune` flag to the
// engine's calls by wrapping this page's `MeshoptSimplifier` while it runs (the engine's main
// thread path imports the same module), and fails when no call went through the wrapper.
//
// Step 2, what drawing proxies saves: `prepareLevelsAsync` makes each group's proxy levels with
// the engine's simplifier (geometries sharing the group's vertex buffers, as a chain's levels do,
// never registered), `setLevel` swaps every group mesh's geometry by hand (`FULL`, the level a
// group's `AUTO` LOD would pick from the camera's pose now, or the coarsest), `view` moves the
// active camera, `measure` gives the next frames' CPU figures and the renderer's draws and
// triangles (every pass), and `passTriangles` the groups' triangles in the main camera's and each
// shadow-casting sky sun's frustum. `restore` (and a scene exit) puts the groups' geometries back.
//
// p377 Phase 0 (docs/plans/p377_hlod-streaming-cell-proxies.md) adds the far field's draws, cull,
// CPU split and rebuilds: `_dbg__hlodSpikeDraws.ts`, on this module's frame systems (`onFrame`).

/** A group's figures before any simplification. */
type HlodGroupInfo = {
  id: string;
  entityId: number;
  mode: string;
  members: number;
  material: string;
  vertices: number;
  triangles: number;
  /** The geometry's largest bounding box side (m): what a level's error is relative to */
  extent: number;
  /** The bounding sphere's radius (m) and its centre in the world */
  radius: number;
  center: [number, number, number];
};

/** One simplified level: its triangles and its error in metres (meshoptimizer's × the extent). */
type HlodLevel = { triangles: number; errorM: number };

/** A variant's chain for one group. */
type HlodVariantResult = {
  levels: HlodLevel[];
  /** `simplifyLodChain` on the main thread: the median of the runs (ms) */
  mainMs: number;
  /** `generateLodChain` on the assets worker, request to result (ms); null for a `prune` variant */
  workerMs: number | null;
  /** Where the worker path ran (`WORKER_THREAD`, or a fallback's `MAIN_THREAD`) */
  workerLoadedOn: string | null;
  /** The worker path's level triangles, which should be the main thread's */
  workerTriangles: number[] | null;
};

type VariantName = 'default' | 'permissive' | 'prune' | 'prunePermissive';
const VARIANTS: Record<VariantName, { permissive: boolean; prune: boolean }> = {
  default: { permissive: false, prune: false },
  permissive: { permissive: true, prune: false },
  prune: { permissive: false, prune: true },
  prunePermissive: { permissive: true, prune: true },
};

type SimplifyOptions = {
  variants?: VariantName[];
  /** The chain's ratios and maxError (the engine's defaults when left out) */
  ratios?: number[];
  maxError?: number;
  /** Main thread runs per variant, timed (median); the levels are the first run's */
  runs?: number;
  /** Also generate the non-`prune` variants' chains on the worker. Default true */
  worker?: boolean;
};

type MeshoptFns = Record<'simplify' | 'simplifyWithAttributes', (...args: unknown[]) => unknown>;

/** The `flags` argument's position in each wrapped call (meshoptimizer 1.1.1's signatures). */
const FLAGS_ARG = { simplify: 5, simplifyWithAttributes: 9 } as const;

/**
 * Runs `fn` with meshoptimizer's `Prune` flag added to every simplify call this page's
 * `MeshoptSimplifier` gets; throws when none got it (the engine used another instance).
 */
const withPruneAsync = async <T>(fn: () => Promise<T>): Promise<T> => {
  const simplifier = MeshoptSimplifier as unknown as MeshoptFns;
  const originals = {
    simplify: simplifier.simplify,
    simplifyWithAttributes: simplifier.simplifyWithAttributes,
  };
  let calls = 0;
  for (const name of Object.keys(originals) as (keyof typeof originals)[]) {
    simplifier[name] = (...args: unknown[]) => {
      calls++;
      const flags = (args[FLAGS_ARG[name]] as Flags[] | undefined) ?? [];
      args[FLAGS_ARG[name]] = [...flags, 'Prune'];
      return originals[name].apply(MeshoptSimplifier, args);
    };
  }
  try {
    const result = await fn();
    if (calls === 0) {
      throw new Error('The Prune wrapper saw no call: the engine has its own meshoptimizer.');
    }
    return result;
  } finally {
    Object.assign(simplifier, originals);
  }
};

/** The geometry as `simplifyLodChain` takes it: what `LodChains.ts` sends an indexed base (the
 * position, normal and uv, and the index), copied. */
const serializeForSimplify = (geometry: THREE.BufferGeometry) => {
  const attribute = (attr: THREE.BufferAttribute) => ({
    array: attr.array.slice(),
    itemSize: attr.itemSize,
    normalized: attr.normalized,
    name: attr.name,
  });
  const attributes: Record<string, ReturnType<typeof attribute>> = {};
  for (const name of ['position', 'normal', 'uv']) {
    const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attr) attributes[name] = attribute(attr);
  }
  const data: Parameters<typeof simplifyLodChain>[0] = {
    name: geometry.name,
    attributes,
    morphAttributes: {},
    morphTargetsRelative: false,
    index: geometry.index ? attribute(geometry.index) : null,
    groups: geometry.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
    drawRange: { start: 0, count: Infinity },
    boundingBox: null,
    boundingSphere: null,
    userData: {},
  };
  return data;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** The world's built BAKED merge groups, with their mesh. */
const getBakedGroups = (world: ECSWorld) => {
  const groups: { info: HlodGroupInfo; mesh: THREE.Mesh }[] = [];
  for (const [entityId, group] of world.getStorage(ComponentType.MERGE_GROUP)) {
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)?.value as
      | THREE.Mesh
      | undefined;
    if ((group.settings.mode ?? 'BAKED') !== 'BAKED' || !mesh?.isMesh) continue;
    const { geometry } = mesh;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const box = geometry.boundingBox!;
    const center = geometry.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
    groups.push({
      mesh,
      info: {
        id: group.id,
        entityId,
        mode: group.settings.mode ?? 'BAKED',
        members: group.members.length,
        material:
          (group._material?.userData.id as string | undefined) ||
          group._material?.name ||
          group._material?.type ||
          '?',
        vertices: geometry.getAttribute('position').count,
        triangles: (geometry.index?.count ?? geometry.getAttribute('position').count) / 3,
        extent: Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z),
        radius: geometry.boundingSphere!.radius,
        center: [center.x, center.y, center.z],
      },
    });
  }
  return groups.sort((a, b) => (a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0));
};

/** One variant's chain of one group, on the main thread and (unless `prune`) on the worker. */
const simplifyVariantAsync = async (
  groupId: string,
  geometry: THREE.BufferGeometry,
  variant: VariantName,
  options: SimplifyOptions
): Promise<HlodVariantResult> => {
  const { permissive, prune } = VARIANTS[variant];
  const chainOptions: LodChainOptions = {
    permissive,
    ...(options.ratios ? { ratios: options.ratios } : {}),
    ...(options.maxError !== undefined ? { maxError: options.maxError } : {}),
  };
  const resolved = resolveLodChainOptions(chainOptions);
  const times: number[] = [];
  let levels: HlodLevel[] = [];
  for (let run = 0; run < Math.max(1, options.runs ?? 3); run++) {
    const data = serializeForSimplify(geometry);
    const simplify = () => simplifyLodChain(data, resolved, new Set());
    const startedAt = performance.now();
    const chain = await (prune ? withPruneAsync(simplify) : simplify());
    times.push(performance.now() - startedAt);
    if (run === 0) {
      levels = chain.levels.map((level) => ({
        triangles: level.triangles,
        errorM: level.error * chain.extent,
      }));
    }
  }

  let workerMs: number | null = null;
  let workerLoadedOn: string | null = null;
  let workerTriangles: number[] | null = null;
  if (!prune && options.worker !== false) {
    const id = `hlodSpike:${groupId}:${variant}`;
    if (getGeometryRegistry()[id]) deleteGeometry(id);
    saveBufferGeometry(geometry.clone(), { id });
    try {
      const chain = await generateLodChain(id, chainOptions);
      workerMs = chain?.report?.durationMs ?? null;
      workerLoadedOn = chain?.report?.loadedOn ?? null;
      workerTriangles = chain ? chain.levels.slice(1).map((level) => level.triangles) : null;
    } finally {
      // Its chain's levels go with it
      deleteGeometry(id);
    }
  }
  return { levels, mainMs: median(times), workerMs, workerLoadedOn, workerTriangles };
};

/** A camera pose: where it is and the point it looks at. */
type HlodPose = { position: [number, number, number]; target: [number, number, number] };

/** Which geometry `setLevel` gives every group. */
type HlodLevelMode = 'FULL' | 'AUTO' | 'COARSEST';

/** A group's proxy levels (`prepareLevelsAsync`), drawn by swapping its mesh's geometry. */
type PreparedGroup = {
  mesh: THREE.Mesh;
  base: THREE.BufferGeometry;
  levels: { geometry: THREE.BufferGeometry; triangles: number; errorM: number }[];
};

/** `AUTO`'s reference viewport height (`LOD_AUTO_REFERENCE_HEIGHT`, `LodAuto.ts`). */
const AUTO_REFERENCE_HEIGHT = 1080;

/** One frame's figures (`measure`). */
type HlodFrame = { cpuMs: number; renderMs: number; drawCalls: number; triangles: number };
const FRAME_KEYS: (keyof HlodFrame)[] = ['cpuMs', 'renderMs', 'drawCalls', 'triangles'];
const SYSTEM_PREFIX = 'hlodSpike:';

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

/** A group's level as its own geometry: the level's index over the base's vertex buffers. */
const toLevelGeometry = (base: THREE.BufferGeometry, index: Uint16Array | Uint32Array) => {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) geometry.setAttribute(name, attr);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.boundingBox = base.boundingBox!.clone();
  geometry.boundingSphere = base.boundingSphere!.clone();
  return geometry;
};

/** The active camera's object, or undefined. */
const getActiveCamera = (world: ECSWorld) => {
  const id = getActiveCameraId();
  return id === null
    ? undefined
    : (world.getComponent(id, ComponentType.OBJECT3D)?.value as THREE.Camera | undefined);
};

/** Step 2's controls, for `installHlodSpike`'s API. */
const createFrameApi = (world: ECSWorld) => {
  const prepared: PreparedGroup[] = [];
  const frame: HlodFrame = { cpuMs: 0, renderMs: 0, drawCalls: 0, triangles: 0 };
  const marks = { frameStart: 0, renderStart: 0 };
  let pending: { frames: HlodFrame[]; left: number; resolve: (f: HlodFrame[]) => void } | null =
    null;
  let hasSystems = false;
  const frameListeners = new Set<(frame: SpikeFrame) => void>();

  const restore = () => {
    for (const group of prepared) group.mesh.geometry = group.base;
  };
  const removeSystems = () => {
    if (!hasSystems) return;
    hasSystems = false;
    for (const id of ['frameStart', 'renderStart', 'frameEnd']) {
      world.removeSystem(SYSTEM_PREFIX + id);
    }
  };
  // The CPU frame: the first MAIN system to the first LATE_MAIN one; the render submit: the last
  // APP_RENDER_SYNC system to it (as the batchedMeshSpike probe)
  const addSystems = () => {
    if (hasSystems) return;
    hasSystems = true;
    world.addSystem(
      ECSSystemStage.MAIN,
      `${SYSTEM_PREFIX}frameStart`,
      () => (marks.frameStart = performance.now()),
      1e9
    );
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      `${SYSTEM_PREFIX}renderStart`,
      () => (marks.renderStart = performance.now()),
      -1e9
    );
    world.addSystem(
      ECSSystemStage.LATE_MAIN,
      `${SYSTEM_PREFIX}frameEnd`,
      () => {
        const now = performance.now();
        frame.cpuMs = now - marks.frameStart;
        frame.renderMs = now - marks.renderStart;
        const render = getRenderer()?.info.render;
        frame.drawCalls = render?.drawCalls ?? 0;
        frame.triangles = render?.triangles ?? 0;
        for (const listener of frameListeners) listener(frame);
        if (!pending) return;
        pending.frames.push({ ...frame });
        if (--pending.left <= 0) {
          pending.resolve(pending.frames);
          pending = null;
        }
      },
      1e9
    );
  };
  registerOnAllSceneExits('hlodSpike', () => {
    restore();
    prepared.length = 0;
    frameListeners.clear();
    removeSystems();
  });

  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  /** The groups' drawn triangles inside a camera's frustum (the casters only for a shadow). */
  const countInFrustum = (camera: THREE.Camera, castersOnly: boolean) => {
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem);
    let triangles = 0;
    let groups = 0;
    for (const { mesh } of prepared) {
      if (!mesh.visible || (castersOnly && !mesh.castShadow)) continue;
      sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
      if (!frustum.intersectsSphere(sphere)) continue;
      triangles += (mesh.geometry.index?.count ?? 0) / 3;
      groups++;
    }
    return { triangles, groups };
  };

  return {
    /** The day-night sky box, paused at `timeOfDay` (its sun's shadow follows the camera). */
    /** With `holdClouds` (p377), the clouds' drift speed 0: they stay where they start, so pages
     * that ran different frame counts shoot the same sky (the clouds still drawn). */
    setupSkyAsync: async (timeOfDay: number, holdClouds = false) => {
      await setActiveSkyBox('dayNight');
      pauseDayNight();
      setTimeOfDay(timeOfDay);
      if (holdClouds) await updateSkyBox('dayNight', { clouds: { speed: 0 } });
    },
    /** Moves the active camera to `pose`. */
    view: ({ position, target }: HlodPose) => {
      const id = getActiveCameraId();
      const transform = id === null ? undefined : world.getComponent(id, ComponentType.TRANSFORM);
      if (id === null || !transform) throw new Error('No active camera with a transform.');
      transform.position.set(...position);
      transform.setDirty();
      world.commitTransform(id, transform);
      cameraLookAtPoint(id, { x: target[0], y: target[1], z: target[2] }, world);
    },
    /** Every BAKED group's proxy levels with these chain options (and `prune`). */
    prepareLevelsAsync: async (options: LodChainOptions & { prune?: boolean } = {}) => {
      restore();
      prepared.length = 0;
      const { prune, ...chainOptions } = options;
      const resolved = resolveLodChainOptions(chainOptions);
      const startedAt = performance.now();
      for (const { mesh } of getBakedGroups(world)) {
        const base = mesh.geometry;
        const data = serializeForSimplify(base);
        const simplify = () => simplifyLodChain(data, resolved, new Set());
        const chain = await (prune ? withPruneAsync(simplify) : simplify());
        prepared.push({
          mesh,
          base,
          levels: chain.levels.map((level) => ({
            geometry: toLevelGeometry(base, level.index),
            triangles: level.triangles,
            errorM: level.error * chain.extent,
          })),
        });
      }
      return {
        options: resolved,
        prune: Boolean(prune),
        groups: prepared.length,
        withLevels: prepared.filter((g) => g.levels.length > 0).length,
        /** The simplifier's main thread time for every group, one after another */
        ms: performance.now() - startedAt,
      };
    },
    /**
     * Gives every prepared group its full geometry, its coarsest level, or the level its `AUTO`
     * LOD would pick from the active camera's pose now: the coarsest whose error projects to at
     * most `maxPixelError` pixels at 1080 px, from the camera to the group's centre (the
     * selection's hysteresis left out). Returns how many groups draw each level.
     */
    setLevel: (mode: HlodLevelMode, maxPixelError = 1) => {
      const camera = getActiveCamera(world) as THREE.PerspectiveCamera | undefined;
      if (!camera?.isPerspectiveCamera) throw new Error('No active perspective camera.');
      const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
      const pixelsPerMetreAtOne =
        AUTO_REFERENCE_HEIGHT / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const byLevel: number[] = [];
      for (const group of prepared) {
        let level = 0;
        if (mode === 'COARSEST') level = group.levels.length;
        else if (mode === 'AUTO') {
          sphere.copy(group.base.boundingSphere!).applyMatrix4(group.mesh.matrixWorld);
          const distance = Math.max(1e-6, sphere.center.distanceTo(cameraPosition));
          group.levels.forEach((l, i) => {
            if ((l.errorM * pixelsPerMetreAtOne) / distance <= maxPixelError) level = i + 1;
          });
        }
        group.mesh.geometry = level === 0 ? group.base : group.levels[level - 1].geometry;
        byLevel[level] = (byLevel[level] ?? 0) + 1;
      }
      return Array.from(byLevel, (n) => n ?? 0);
    },
    /** The groups' triangles drawn in the main camera's frustum and in each shadow-casting sky
     * sun's (its shadow camera's: the casters only), from the last render's matrices. */
    passTriangles: () => {
      const camera = getActiveCamera(world);
      const shadows: { triangles: number; groups: number }[] = [];
      for (const id of getSkyLightIds().suns) {
        if (id === null) continue;
        const light = world.getComponent(id, ComponentType.OBJECT3D)?.value as
          | THREE.DirectionalLight
          | undefined;
        if (light?.castShadow && light.shadow?.camera) {
          shadows.push(countInFrustum(light.shadow.camera, true));
        }
      }
      const all = prepared.reduce((sum, g) => sum + (g.mesh.geometry.index?.count ?? 0) / 3, 0);
      return { all, main: camera ? countInFrustum(camera, false) : null, shadows };
    },
    /** The medians and 90th percentiles of the next `frames` frames' figures. */
    measure: (frames: number) => {
      addSystems();
      return new Promise<Record<string, number>>((resolve) => {
        const startedAt = performance.now();
        pending = {
          frames: [],
          left: Math.max(1, frames),
          resolve: (list) => {
            const result: Record<string, number> = {
              frames: list.length,
              seconds: (performance.now() - startedAt) / 1000,
            };
            for (const key of FRAME_KEYS) {
              const values = list.map((f) => f[key]);
              result[key] = quantile(values, 0.5);
              result[`${key}P90`] = quantile(values, 0.9);
            }
            resolve(result);
          },
        };
      });
    },
    /**
     * WebGPU's GPU timing check: for `ms`, every render context's resolved durations (three's
     * render timestamp pool, polled every 50 ms; the stats panels' GPU panel must hold the timer)
     * by context id, with what it drew (its camera, target and scene, from the inspector's
     * `beginRender`). Returns each context's sample count and min / median / max ms.
     */
    gpuContextsAsync: async (ms: number) => {
      type Inspector = { beginRender: (uid: string, ...args: unknown[]) => void };
      type Pool = { timestamps: Map<string, number> };
      const renderer = getRenderer();
      const inspector = renderer?.inspector as unknown as Inspector | undefined;
      const pools = (renderer?.backend as unknown as { timestampQueryPool?: Record<string, Pool> })
        ?.timestampQueryPool;
      if (!renderer || !inspector || !pools?.render) {
        throw new Error('No render timestamp pool: is the GPU stats panel on?');
      }
      const contextKey = (uid: string) => uid.replace(/:f\d+$/, '');
      const described = new Map<string, string>();
      const durations = new Map<string, number[]>();
      const beginRender = inspector.beginRender;
      inspector.beginRender = function (uid: string, ...args: unknown[]) {
        const [scene, camera, target] = args as [
          THREE.Scene | undefined,
          THREE.Camera | undefined,
          THREE.RenderTarget | null | undefined,
        ];
        const key = contextKey(uid);
        if (!described.has(key)) {
          described.set(
            key,
            `${camera?.type ?? '?'} → ${target ? `${target.texture?.name || 'target'} ${target.width}×${target.height}` : 'canvas'} (${scene?.type ?? '?'}${scene?.name ? ` ${scene.name}` : ''})`
          );
        }
        return beginRender.call(this, uid, ...args);
      };
      // A uid is a context and a frame: each resolved frame's duration counted once
      const counted = new Set<string>();
      const timer = window.setInterval(() => {
        for (const [uid, duration] of pools.render.timestamps) {
          if (counted.has(uid)) continue;
          counted.add(uid);
          const key = contextKey(uid);
          const list = durations.get(key) ?? [];
          list.push(duration);
          durations.set(key, list);
        }
      }, 50);
      await new Promise((resolve) => window.setTimeout(resolve, ms));
      window.clearInterval(timer);
      inspector.beginRender = beginRender;
      return [...durations].map(([key, list]) => ({
        context: key,
        drew: described.get(key) ?? '(not seen beginning)',
        samples: list.length,
        minMs: Math.min(...list),
        medianMs: quantile(list, 0.5),
        maxMs: Math.max(...list),
      }));
    },
    /** The renderer's backend. */
    backend: () =>
      (getRenderer()?.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend
        ? 'WebGPU'
        : 'WebGL2',
    restore,
    /** Calls `listener` at every frame's end with its figures (adding the frame systems);
     * returns the remover. A scene exit removes them all. */
    onFrame: (listener: (frame: SpikeFrame) => void) => {
      addSystems();
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
  };
};

/** Installs `window.__aekHlod` for the current scene's world (replacing an earlier scene's). */
export const installHlodSpike = (world: ECSWorld) => {
  const frameApi = createFrameApi(world);
  const api = {
    ...frameApi,
    ...createDrawsApi(world, {
      onFrame: frameApi.onFrame,
      getActiveCamera: () => getActiveCamera(world),
    }),
    /** The scene and its built BAKED merge groups. */
    groups: () => ({
      sceneId: getCurrentSceneId(),
      groups: getBakedGroups(world).map(({ info }) => info),
    }),
    /**
     * Step 1: every BAKED group's chain in each variant, one group and variant at a time (a
     * warm-up chain first, so the first group's time has no meshoptimizer load in it).
     */
    simplifyAsync: async (options: SimplifyOptions = {}) => {
      const variants = options.variants ?? (Object.keys(VARIANTS) as VariantName[]);
      const groups = getBakedGroups(world);
      if (groups.length) {
        await simplifyVariantAsync('warmup', groups[0].mesh.geometry, 'default', {
          ...options,
          runs: 1,
        });
      }
      const results: (HlodGroupInfo & { variants: Partial<Record<VariantName, unknown>> })[] = [];
      for (const { info, mesh } of groups) {
        const byVariant: Partial<Record<VariantName, HlodVariantResult>> = {};
        for (const variant of variants) {
          byVariant[variant] = await simplifyVariantAsync(info.id, mesh.geometry, variant, options);
        }
        results.push({ ...info, variants: byVariant });
      }
      return {
        sceneId: getCurrentSceneId(),
        options: resolveLodChainOptions({ ratios: options.ratios, maxError: options.maxError }),
        groups: results,
      };
    },
  };
  (window as unknown as { __aekHlod?: typeof api }).__aekHlod = api;
};
