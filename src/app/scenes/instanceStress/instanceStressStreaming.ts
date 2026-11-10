import * as THREE from 'three/webgpu';
import type { InstanceRange, InstanceSet } from 'aekasha/instancing';
import { DEFAULT_LOD_HYSTERESIS, getLodBias } from 'aekasha/lod';
import { getConservativeGeometryRadius } from 'aekasha/spatial';
import {
  getStreamingCellKey,
  registerStreamingCellContent,
  setSceneStreamingSettings,
} from 'aekasha/streaming';

// `instanceStress`' streamed forest (docs/plans/_DONE_p354_gpu-driven-culling.md Phase 5 step 3,
// `?stressStream=<cellSize>`): the set path's trees cut into world streaming's cells, each cell
// one unit of code content (`NEAR_AND_FAR`) that adds its trees to the one instance set as a range
// in its `load` and removes the range in its `unload`, so the set holds only the cells around the
// focus (the main camera) and reuses the removed ranges' indices (its free list).
//
// The far ring is the set's own cull distance (the farthest a tree is drawn: its largest
// conservative radius at the main camera's field of view, against the cull screen size with the
// hysteresis), so a cell unloads only once its trees are LOD-culled and loads before they'd show:
// no tree pops, with no visibility fade on the ranges. `?stressStreamFar=<ring>` sets a smaller
// ring to see the pops. The scene measures them itself: at each load and unload, the cell's trees
// in the main camera's view that the set would draw (`pops`), and the time each takes, the live
// ranges' extent per orbit lap (the free list's reuse) and the add that found no room.

/** A tree as the scene places it */
export type StreamedTree = { position: THREE.Vector3; yaw: number; scale: number };

/** What the streamed forest measured since the scene's load (the probe's `stream()`) */
export const instanceStressStreamStats = {
  cellSize: 0,
  farRing: 0,
  /** The farthest a tree is drawn, in metres (the far ring's reason) */
  cullDistance: 0,
  cells: 0,
  loads: 0,
  unloads: 0,
  /** Adds that found no room in the set (none expected: it's sized for every tree) */
  failedAdds: 0,
  maxLoadMs: 0,
  maxUnloadMs: 0,
  totalLoadMs: 0,
  totalUnloadMs: 0,
  /** Loads and unloads once the scene was entered (its load's first cells aside) */
  playLoads: 0,
  playUnloads: 0,
  /** Trees in view the set would draw at once when their cell loaded during play */
  popsIn: 0,
  /** Trees in view the set still drew when their cell unloaded during play */
  popsOut: 0,
  /** Per orbit lap: the live ranges' highest end (the instances the set visits) */
  extentByLap: [] as number[],
  /** The trees in the set now */
  live: 0,
};

const resetStats = () => {
  Object.assign(instanceStressStreamStats, {
    cells: 0,
    loads: 0,
    unloads: 0,
    playLoads: 0,
    playUnloads: 0,
    failedAdds: 0,
    maxLoadMs: 0,
    maxUnloadMs: 0,
    totalLoadMs: 0,
    totalUnloadMs: 0,
    popsIn: 0,
    popsOut: 0,
    extentByLap: [],
    live: 0,
  });
};

/** What `startStreamedForest` takes */
export type StreamedForestOptions = {
  sceneId: string;
  set: InstanceSet;
  trees: StreamedTree[];
  cellSize: number;
  /** The far ring, in cells; undefined: the cull distance's */
  farRing: number | undefined;
  /** The levels' geometries: level 0's radius is the measure's, the largest the bounds' */
  levelGeometries: THREE.BufferGeometry[];
  cullScreenSize: number;
  /** The main camera now (the streaming focus and the LOD selection's camera) */
  getCamera: () => THREE.Camera | undefined;
  /** The orbit's lap now (for the extent per lap) */
  getLap: () => number;
  /** Runs a function once the scene is entered: its load's cells are the load's, not pops */
  onEnter: (fn: () => void) => void;
};

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _projScreen = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _cameraPosition = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Puts the scene's streaming back to its JSON's (none) for a load without the streamed forest:
 * the settings last across loads. */
export const stopStreamedForest = (sceneId: string) =>
  setSceneStreamingSettings(sceneId, undefined);

/**
 * Cuts the trees into cells of `cellSize` and registers each as a unit of the scene's streamed
 * content, adding and removing its range of `set`. Call from the scene code on every load, before
 * its cells load (the scene's `created` hook).
 */
export const startStreamedForest = (opts: StreamedForestOptions) => {
  const { set, trees, cellSize, levelGeometries, cullScreenSize } = opts;
  resetStats();
  const stats = instanceStressStreamStats;

  // The farthest a tree is drawn: its measure (level 0's radius, at its largest scale) at the
  // main camera's field of view, down to the cull size less the hysteresis (where a drawn tree,
  // or a new one's first selection, culls; a culled one comes back at the cull size)
  const radius = getConservativeGeometryRadius(levelGeometries[0]);
  const largestRadius = Math.max(...levelGeometries.map(getConservativeGeometryRadius));
  let maxScale = 0;
  for (const tree of trees) maxScale = Math.max(maxScale, tree.scale);
  const camera = opts.getCamera() as THREE.PerspectiveCamera | undefined;
  const fov = camera?.isPerspectiveCamera ? camera.fov : 55;
  const k = (1 / Math.tan(THREE.MathUtils.DEG2RAD * fov * 0.5)) * getLodBias();
  const keep = 1 - DEFAULT_LOD_HYSTERESIS;
  const drawnAt = cullScreenSize * keep;
  const cullDistance = (radius * maxScale * k) / drawnAt;
  // Every point within the cull distance is in a cell within this ring of the focus cell
  const farRing = Math.max(1, opts.farRing ?? Math.ceil(cullDistance / cellSize));
  Object.assign(stats, { cellSize, farRing, cullDistance });
  setSceneStreamingSettings(opts.sceneId, {
    cellSize,
    rings: { resident: Math.min(1, farRing), nearby: Math.min(2, farRing), far: farRing },
  });

  // The cells' trees: each cell's matrices made once, the measure's spheres from the trees
  const byCell = new Map<number, StreamedTree[]>();
  for (const tree of trees) {
    const cellKey = getStreamingCellKey(
      Math.floor(tree.position.x / cellSize),
      Math.floor(tree.position.z / cellSize)
    );
    let cell = byCell.get(cellKey);
    if (!cell) byCell.set(cellKey, (cell = []));
    cell.push(tree);
  }
  stats.cells = byCell.size;
  /** The live ranges, for the extent */
  const live = new Set<InstanceRange>();
  let isPlaying = false;
  opts.onEnter(() => {
    isPlaying = true;
  });

  /** The cell's trees in the main camera's view that the set draws (a screen size of at least the
   * cull's less the hysteresis: a tree drawn, or a new one's first selection) */
  const countShown = (cellTrees: StreamedTree[]) => {
    const view = opts.getCamera();
    if (!view) return 0;
    view.updateWorldMatrix(true, false);
    _cameraPosition.setFromMatrixPosition(view.matrixWorld);
    _projScreen.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen, view.coordinateSystem);
    let shown = 0;
    for (const tree of cellTrees) {
      const distance = tree.position.distanceTo(_cameraPosition);
      if ((radius * tree.scale * k) / Math.max(distance, 1e-6) < drawnAt) continue;
      _sphere.set(tree.position, largestRadius * tree.scale);
      if (_frustum.intersectsSphere(_sphere)) shown++;
    }
    return shown;
  };

  const noteExtent = () => {
    let extent = 0;
    for (const range of live) extent = Math.max(extent, range.start + range.count);
    const lap = opts.getLap();
    stats.extentByLap[lap] = Math.max(stats.extentByLap[lap] ?? 0, extent);
    stats.live = set.count;
  };

  for (const [cellKey, cellTrees] of byCell) {
    const matrices = new Float32Array(cellTrees.length * 16);
    cellTrees.forEach(({ position, yaw, scale }, i) => {
      _quaternion.setFromAxisAngle(UP, yaw);
      _matrix.compose(position, _quaternion, _scale.setScalar(scale)).toArray(matrices, i * 16);
    });
    let range: InstanceRange | null = null;
    registerStreamingCellContent({
      sceneId: opts.sceneId,
      cellKey,
      // From the far ring in: the set's own LOD draws the far trees
      loadedAt: 'NEAR_AND_FAR',
      load: () => {
        const startedAt = performance.now();
        range = set.addInstances(matrices);
        const ms = performance.now() - startedAt;
        stats.loads++;
        stats.totalLoadMs += ms;
        stats.maxLoadMs = Math.max(stats.maxLoadMs, ms);
        if (!range) stats.failedAdds++;
        else {
          live.add(range);
          if (isPlaying) {
            stats.playLoads++;
            stats.popsIn += countShown(cellTrees);
          }
        }
        noteExtent();
        // No entity of its own: the set's draws aren't the cell's to fade or delete
        return [];
      },
      unload: () => {
        if (!range) return;
        if (isPlaying) {
          stats.playUnloads++;
          stats.popsOut += countShown(cellTrees);
        }
        const startedAt = performance.now();
        set.removeInstances(range);
        const ms = performance.now() - startedAt;
        live.delete(range);
        range = null;
        stats.unloads++;
        stats.totalUnloadMs += ms;
        stats.maxUnloadMs = Math.max(stats.maxUnloadMs, ms);
        noteExtent();
      },
    });
  }
};
