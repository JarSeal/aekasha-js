import type * as THREE from 'three/webgpu';
import {
  ComponentType,
  deleteGeometry,
  getCurrentSceneId,
  getGeometryRegistry,
  saveBufferGeometry,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { generateLodChain, resolveLodChainOptions, simplifyLodChain } from 'aekasha/lod';
import type { LodChainOptions } from 'aekasha/lod';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { Flags } from 'meshoptimizer/simplifier';

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

/** Installs `window.__aekHlod` for the current scene's world (replacing an earlier scene's). */
export const installHlodSpike = (world: ECSWorld) => {
  const api = {
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
