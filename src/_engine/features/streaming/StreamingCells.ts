// The streaming cells (p353 §4.1): `decideStreamingCells` sets each cell's level from the focus
// (every N frames), `pumpStreamingCells` does the loading and unloading under the budgets (every
// frame), `loadStreamingCellsNowAsync` loads the wanted cells at once (inside a scene load) and
// `dropStreamingCells` takes everything down (the scene's exit). A cell's content is in three
// layers (StreamingLayers.ts, p353 Phase 5 D1), each its own UNLOADED → LOADING → PRIMING →
// LOADED → UNLOADING machine: the kept content (`NEAR_AND_FAR`), the near (`RESIDENT`, `NEARBY`)
// and the far (`FAR`), so `NEARBY` ↔ `FAR` loads one layer and unloads the other, the leaving
// one drawn until the other is shown (D2). A layer's units run in its owner key, and its finished
// unload frees what it alone held (§4.2). No engine state: Streaming.ts holds the runtime and
// calls these, and the tests drive them with their own clock. A layer streamed in during play is
// primed before it's drawn (§5, StreamingPriming.ts). A layer that starts unloading hands the
// bodies that moved into another loaded cell to that cell's layer (p353 Phase 4 D1).
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import type { StreamingBodies } from './StreamingBodies';
import type { StreamingCellContent, StreamingContentRange } from './StreamingContent';
import {
  type StreamingLayer,
  beginStreamingLayerLoad,
  cancelStreamingPrime,
  createStreamingLayers,
  deleteAdoptedBodies,
  finishStreamingLayerLoadIfDone,
  finishStreamingLayerUnload,
  getStreamingLayerEntityIds,
  isLayerHolding,
  isLayerWanted,
  isNextStreamingUnitWaiting,
  isStreamingLayerLoading,
  isStreamingUnitDone,
  notifyStreamingCell,
  pumpStreamingLayerFade,
  pumpStreamingLayerPrime,
  releaseLeavingLayers,
  runNextStreamingUnit,
  unloadStreamingUnit,
  updateStreamingCellPhase,
} from './StreamingLayers';
import {
  DEEPEST_LOADED_LEVEL,
  decideStreamingLevel,
  getCellEdgeDistance,
  isLoadedLevel,
  StreamingLevel,
} from './StreamingRings';
import type { ResolvedStreamingSettings } from './StreamingSettings';

/**
 * Where a cell's (or a layer's) content is. A cell's is its wanted layers' least advanced
 * (`updateStreamingCellPhase`): `LOADED` cells are at their `level`.
 * @internal
 */
export type StreamingCellPhase = 'UNLOADED' | 'LOADING' | 'PRIMING' | 'LOADED' | 'UNLOADING';

/**
 * A unit of a cell's content from the scene's data (its JSON content, `StreamingDataContent.ts`),
 * run ahead of the code-registered units: `waits` holds it, and every unit after it, until the
 * units before it have settled.
 * @internal
 */
export type StreamingCellUnitSource = {
  /** The unit. */
  readonly content: StreamingCellContent;
  /** Whether it waits for the units before it (an async one: the cell's assets). */
  readonly waits: boolean;
};

/**
 * A cell the machine tracks: one that is wanted loaded, or still has content.
 * @internal
 */
export type StreamingCell = {
  /** `packCellKey(cx, 0, cz)`. */
  key: number;
  /** The cell's index along x. */
  cx: number;
  /** The cell's index along z. */
  cz: number;
  /** The level the last decision gave it. */
  level: StreamingLevel;
  /** Where its content is: its wanted layers' least advanced phase (`UNLOADING` with none
   * wanted and content left). */
  phase: StreamingCellPhase;
  /** Its content layers (`STREAMING_LAYER_RANGES`' order: kept, near, far). */
  layers: readonly StreamingLayer[];
  /** Its ring around the focus cell at the last decision. */
  ring: number;
  /** The focus's distance to its edge at the last decision, in metres. */
  edgeDistance: number;
};

/**
 * A cell's priming, the primer's own (opaque to the machine).
 * @internal
 */
export type StreamingPrimeJob = object;

/**
 * What primes a streamed layer's content before it's drawn (StreamingPriming.ts; none in the
 * machine's tests, which then load straight to `LOADED`).
 * @internal
 */
export type StreamingPrimer = {
  /** A frame starts: the per-frame budgets restart (the pump's first call). */
  beginFrame(): void;
  /** Holds a finished unit's entities from drawing. */
  hold(world: ECSWorld, entityIds: readonly number[]): void;
  /** Lets go of entities a content's own `unload` left alive. */
  release(world: ECSWorld, entityIds: readonly number[]): void;
  /** Starts priming a loaded layer's held entities. */
  start(world: ECSWorld, entityIds: readonly number[], stats: StreamingStats): StreamingPrimeJob;
  /** A frame of a priming under the frame's budgets: true once it's done, everything shown. */
  step(job: StreamingPrimeJob): boolean;
  /** Shows everything now, primed or not (the focus outran the priming). */
  finish(job: StreamingPrimeJob): void;
  /** The layer unloads: drops the priming (its held entities go with the layer). */
  cancel(job: StreamingPrimeJob): void;
};

/**
 * A layer's fade, the fader's own (opaque to the machine).
 * @internal
 */
export type StreamingFadeJob = object;

/**
 * What fades a streamed layer's entities in and out (p353 Phase 5 D4-D6, StreamingFades.ts; none
 * in most machine tests, which then show and take down at once).
 * @internal
 */
export type StreamingFader = {
  /** A unit's entities arrived: their materials take part in fades (before any draw), and with
   * `hidden` they draw invisible until their fade in (a layer streamed in during play). */
  prepare(world: ECSWorld, entityIds: readonly number[], hidden: boolean): void;
  /** Starts fading the entities in or out, at `progress` (0 → 1). */
  start(
    world: ECSWorld,
    entityIds: readonly number[],
    direction: 'IN' | 'OUT',
    progress: number
  ): StreamingFadeJob;
  /** Draws the fade at `progress`; 1 ends it: in, the entities draw whole; out, they're held from
   * drawing (taken down next). */
  draw(job: StreamingFadeJob, progress: number): void;
  /** Lets go of entities a content's own `unload` left alive: they draw whole again. */
  release(world: ECSWorld, entityIds: readonly number[]): void;
};

/**
 * The machine's counters since the scene's load, for the debug tab. Loads and unloads count the
 * layers that ran units (an empty layer is neither).
 * @internal
 */
export type StreamingStats = {
  /** Loads started. */
  loadsStarted: number;
  /** Loads that finished. */
  loadsFinished: number;
  /** Loads cancelled before they finished. */
  loadsCancelled: number;
  /** Unloads that finished. */
  unloadsFinished: number;
  /** Content units whose `load` threw or rejected, or whose `unload` threw. */
  unitErrors: number;
  /** Async results that came back after their load was cancelled (unloaded at once). */
  lateResults: number;
  /** Layer asset releases run (one per finished unload that ran units, once its late units
   * settled). */
  assetReleases: number;
  /** Assets those releases freed. */
  assetsReleased: number;
  /** Primings that finished (their layers shown). */
  primesFinished: number;
  /** Layers shown before their priming finished: the focus reached their `RESIDENT` ring first (a
   * fast focus: widen the rings). */
  primingStalls: number;
  /** Textures the primings uploaded. */
  texturesUploaded: number;
  /** Uncompressed textures over 1024² uploaded (a frame each; ship them as KTX2). */
  oversizedUploads: number;
  /** Compiles the primings ran (one per layer that brought a material not drawn before). */
  compiles: number;
  /** Materials first shown by the primings, a few a frame (`maxNewStructuresPerFrame`). */
  structuresShown: number;
  /** Bodies handed to another cell because they had moved into it. */
  bodiesAdopted: number;
  /** Layer fades started (in when a layer streamed in during play is shown, out before a shown
   * one is taken down). */
  fadesStarted: number;
  /** Fades turned around (a layer fading out wanted again, or one fading in no longer wanted). */
  fadesReversed: number;
};

/**
 * The loading budgets (`AppConfig.streaming`).
 * @internal
 */
export type StreamingBudgets = {
  /** The most cells loading at once (a cell with any layer loading). */
  maxConcurrentLoads: number;
  /** The milliseconds per frame content loads may take, and unloads again, checked before each
   * unit: a frame always runs at least one unit of each, and can go over by one unit. */
  maxCreateMsPerFrame: number;
};

/**
 * A streaming scene's machine.
 * @internal
 */
export type StreamingRuntime = {
  /** The scene whose cells these are. */
  sceneId: string;
  /** Its settings, the defaults applied. */
  settings: ResolvedStreamingSettings;
  /** The world the content goes into. */
  world: ECSWorld;
  /** The clock the budgets and load times read, in ms. */
  now: () => number;
  /** The tracked cells by key. */
  cells: Map<number, StreamingCell>;
  /** The tracked cells nearest first, as the last decision sorted them (may hold a cell dropped
   * since, in `UNLOADED`, until the next decision). */
  order: StreamingCell[];
  /** The focus's x at the last decision (NaN before one). */
  focusX: number;
  /** The focus's z at the last decision (NaN before one). */
  focusZ: number;
  /** The focus cell at the last decision. */
  focusCx: number;
  /** The focus cell at the last decision. */
  focusCz: number;
  /** The counters. */
  stats: StreamingStats;
  /** Frees what a cell's layer alone holds and nothing uses (`releaseCellOwnedAssets`, `layer`
   * its owner key's suffix), returning how many assets went. */
  releaseCellAssets: (cellKey: number, layer?: string) => number;
  /** Set by {@link dropStreamingCells}: the scene's release takes its cells' assets from there. */
  isDropped: boolean;
  /** Primes the layers streamed in during play, or null (shown as soon as they're loaded). */
  primer: StreamingPrimer | null;
  /** Fades the layers' entities in and out (`settings.fadeSeconds` over 0), or null (at once). */
  fader: StreamingFader | null;
  /** A cell's layer's units from the scene's data (its JSON content), run before the
   * code-registered ones; null without any. */
  dataContent:
    | ((cellKey: number, range: StreamingContentRange) => readonly StreamingCellUnitSource[])
    | null;
  /** The cells' bodies (StreamingBodies.ts): which entities can leave their cell, and where they
   * are. Null: nothing moves (the machine's own tests). */
  bodies: StreamingBodies | null;
};

/**
 * A machine for a scene, no cell tracked yet.
 * @internal
 */
export const createStreamingRuntime = (
  sceneId: string,
  settings: ResolvedStreamingSettings,
  world: ECSWorld,
  now: () => number,
  releaseCellAssets: (cellKey: number, layer?: string) => number,
  primer: StreamingPrimer | null = null
): StreamingRuntime => ({
  sceneId,
  settings,
  world,
  now,
  releaseCellAssets,
  primer,
  fader: null,
  dataContent: null,
  bodies: null,
  isDropped: false,
  cells: new Map(),
  order: [],
  focusX: NaN,
  focusZ: NaN,
  focusCx: 0,
  focusCz: 0,
  stats: {
    loadsStarted: 0,
    loadsFinished: 0,
    loadsCancelled: 0,
    unloadsFinished: 0,
    unitErrors: 0,
    lateResults: 0,
    assetReleases: 0,
    assetsReleased: 0,
    primesFinished: 0,
    primingStalls: 0,
    texturesUploaded: 0,
    oversizedUploads: 0,
    compiles: 0,
    structuresShown: 0,
    bodiesAdopted: 0,
    fadesStarted: 0,
    fadesReversed: 0,
  },
});

/**
 * The entities a cell's layers' units created and still hold (a new array: the debug tab's).
 * @internal
 */
export const getStreamingCellEntityIds = (cell: StreamingCell): number[] => {
  const ids: number[] = [];
  for (let i = 0; i < cell.layers.length; i++) getStreamingLayerEntityIds(cell.layers[i], ids);
  return ids;
};

/**
 * The cell's layer of `range`.
 * @internal
 */
export const getStreamingCellLayer = (cell: StreamingCell, range: StreamingContentRange) =>
  cell.layers.find((layer) => layer.range === range) as StreamingLayer;

const createCell = (rt: StreamingRuntime, key: number, cx: number, cz: number): StreamingCell => {
  const cell: StreamingCell = {
    key,
    cx,
    cz,
    level: StreamingLevel.UNLOADED,
    phase: 'UNLOADED',
    layers: [],
    ring: 0,
    edgeDistance: 0,
  };
  cell.layers = createStreamingLayers(rt.sceneId, cell);
  return cell;
};

const isCellLoading = (cell: StreamingCell) => cell.layers.some(isStreamingLayerLoading);

/** Whether a layer of the cell is wanted and waits to load. */
const hasQueuedLayer = (cell: StreamingCell) =>
  cell.layers.some((layer) => layer.phase === 'UNLOADED' && isLayerWanted(layer));

// --- Deciding --------------------------------------------------------------------------------

/** Applies a decided level: the layers with content tell their bodies (their tier follows it),
 * and the layers the level no longer wants start unloading, a shown one once the layers replacing
 * it are shown (D2). A cell with nothing wanted or left is forgotten. */
const setCellLevel = (rt: StreamingRuntime, cell: StreamingCell, level: StreamingLevel) => {
  cell.level = level;
  for (let i = 0; i < cell.layers.length; i++) {
    // Its bodies take the level's tier (p353 Phase 4 D2), a leaving layer's too (Phase 5 D11)
    if (isLayerHolding(cell.layers[i])) rt.bodies?.levelChanged?.(rt, cell.layers[i]);
  }
  releaseLeavingLayers(rt, cell);
  if (!isLoadedLevel(level) && cell.layers.every((layer) => layer.phase === 'UNLOADED')) {
    rt.cells.delete(cell.key);
  }
  updateStreamingCellPhase(cell);
  notifyStreamingCell(rt, cell);
};

const compareCells = (a: StreamingCell, b: StreamingCell) =>
  a.ring - b.ring || a.edgeDistance - b.edgeDistance || a.key - b.key;

/**
 * Decides every cell's level for a focus at (`x`, `z`): the tracked cells move by the rings'
 * thresholds, and the untracked cells within the loaded rings start being tracked (queued to
 * load). Sorts the tracked cells nearest first.
 * @internal
 */
export const decideStreamingCells = (rt: StreamingRuntime, x: number, z: number) => {
  const { settings, cells, order } = rt;
  const { cellSize, invCellSize } = settings;
  // Bodies first go to the cells they're in, so the levels decided next reach the right ones
  rt.bodies?.rebalance?.(rt);
  const fcx = worldToCell(x, invCellSize);
  const fcz = worldToCell(z, invCellSize);
  rt.focusX = x;
  rt.focusZ = z;
  rt.focusCx = fcx;
  rt.focusCz = fcz;
  for (const cell of cells.values()) {
    cell.ring = Math.max(Math.abs(cell.cx - fcx), Math.abs(cell.cz - fcz));
    cell.edgeDistance = getCellEdgeDistance(cell.cx, cell.cz, cellSize, x, z);
    const level = decideStreamingLevel(cell.level, cell.ring, cell.edgeDistance, settings);
    if (level !== cell.level) setCellLevel(rt, cell, level);
  }
  const reach = settings.rings[DEEPEST_LOADED_LEVEL];
  for (let cz = fcz - reach; cz <= fcz + reach; cz++) {
    for (let cx = fcx - reach; cx <= fcx + reach; cx++) {
      if (!isCellInRange(cx, 0, cz)) continue;
      const key = packCellKey(cx, 0, cz);
      if (cells.has(key)) continue;
      const ring = Math.max(Math.abs(cx - fcx), Math.abs(cz - fcz));
      const edgeDistance = getCellEdgeDistance(cx, cz, cellSize, x, z);
      const level = decideStreamingLevel(StreamingLevel.UNLOADED, ring, edgeDistance, settings);
      if (!isLoadedLevel(level)) continue;
      const cell = createCell(rt, key, cx, cz);
      cell.level = level;
      cell.ring = ring;
      cell.edgeDistance = edgeDistance;
      cells.set(key, cell);
      notifyStreamingCell(rt, cell);
    }
  }
  order.length = 0;
  for (const cell of cells.values()) order.push(cell);
  order.sort(compareCells);
};

// --- Pumping ---------------------------------------------------------------------------------

/** Starts the queued layers' loads, nearest cell first, up to `maxConcurrentLoads` cells loading
 * (a priming layer doesn't count; a cell already loading starts its other queued layers). */
const startQueuedLoads = (rt: StreamingRuntime, budgets: StreamingBudgets) => {
  const { order } = rt;
  let loading = 0;
  for (let i = 0; i < order.length; i++) if (isCellLoading(order[i])) loading++;
  for (let i = 0; i < order.length; i++) {
    const cell = order[i];
    // A cell dropped since the decision (forgotten after an unload) isn't started again
    if (!hasQueuedLayer(cell) || rt.cells.get(cell.key) !== cell) continue;
    const wasLoading = isCellLoading(cell);
    if (!wasLoading && loading >= budgets.maxConcurrentLoads) continue;
    for (let j = 0; j < cell.layers.length; j++) {
      const layer = cell.layers[j];
      if (layer.phase === 'UNLOADED' && isLayerWanted(layer))
        beginStreamingLayerLoad(rt, layer, true);
    }
    if (!wasLoading && isCellLoading(cell)) loading++;
  }
};

/**
 * One frame of loading and unloading, under `budgets`: starts the queued layers' loads nearest
 * first (up to `maxConcurrentLoads` cells loading), runs their content units nearest first, a
 * frame of the primings (the primer's own budgets) and of the fades, then unloads the farthest
 * first. Loads and
 * unloads share `maxCreateMsPerFrame`, but a frame always runs at least one unit of each, so
 * neither starves.
 * @internal
 */
export const pumpStreamingCells = (rt: StreamingRuntime, budgets: StreamingBudgets) => {
  const { order } = rt;
  rt.primer?.beginFrame();
  startQueuedLoads(rt, budgets);

  const start = rt.now();
  let hasWorked = false;
  loads: for (let i = 0; i < order.length; i++) {
    const { layers } = order[i];
    for (let j = 0; j < layers.length; j++) {
      const layer = layers[j];
      if (layer.phase !== 'LOADING') continue;
      while (isStreamingLayerLoading(layer) && layer.nextUnit < layer.units.length) {
        // Its turn comes once the units before it are in (a later frame)
        if (isNextStreamingUnitWaiting(layer)) break;
        if (hasWorked && rt.now() - start >= budgets.maxCreateMsPerFrame) break loads;
        void runNextStreamingUnit(rt, layer);
        hasWorked = true;
      }
      finishStreamingLayerLoadIfDone(rt, layer);
    }
  }

  for (let i = 0; i < order.length; i++) {
    const { layers } = order[i];
    for (let j = 0; j < layers.length; j++) {
      pumpStreamingLayerPrime(rt, layers[j]);
      // After the priming: a layer shown this frame draws its fade's first frame now
      pumpStreamingLayerFade(rt, layers[j]);
    }
  }

  hasWorked = false;
  unloads: for (let i = order.length - 1; i >= 0; i--) {
    const { layers } = order[i];
    for (let j = layers.length - 1; j >= 0; j--) {
      const layer = layers[j];
      if (layer.phase !== 'UNLOADING') continue;
      while (layer.nextUnit < layer.units.length) {
        if (hasWorked && rt.now() - start >= budgets.maxCreateMsPerFrame) break unloads;
        const unit = layer.units[layer.nextUnit++];
        if (!isStreamingUnitDone(unit)) continue;
        unloadStreamingUnit(rt, layer, unit);
        hasWorked = true;
      }
      deleteAdoptedBodies(rt, layer);
      finishStreamingLayerUnload(rt, layer);
    }
  }
};

/** Runs a layer's units with no budget, awaiting its units in flight where a unit waits for them,
 * and resolves when its async units have settled. */
const loadLayerNowAsync = async (rt: StreamingRuntime, layer: StreamingLayer) => {
  let pending: Promise<void>[] = [];
  while (isStreamingLayerLoading(layer) && layer.nextUnit < layer.units.length) {
    if (isNextStreamingUnitWaiting(layer)) {
      await Promise.all(pending);
      pending = [];
      continue;
    }
    const promise = runNextStreamingUnit(rt, layer);
    if (promise) pending.push(promise);
  }
  finishStreamingLayerLoadIfDone(rt, layer);
  await Promise.all(pending);
};

/**
 * Loads every layer the last decision wants loaded at once, with no budget, and resolves when
 * their async units have settled: a scene load's cells around the focus (p353 §4.1). The layers
 * load side by side; within one, a unit that waits runs once the units before it are in.
 * @internal
 */
export const loadStreamingCellsNowAsync = async (rt: StreamingRuntime) => {
  const loads: Promise<void>[] = [];
  for (const cell of rt.order) {
    for (const layer of cell.layers) {
      if (layer.phase !== 'UNLOADED' || !isLayerWanted(layer)) continue;
      // Shown with the scene, like its other content (the load screen hides the first draws)
      beginStreamingLayerLoad(rt, layer, false);
      loads.push(loadLayerNowAsync(rt, layer));
    }
  }
  await Promise.all(loads);
};

/**
 * Takes every cell's content down at once and forgets every cell: the scene's exit. A load in
 * flight is cancelled (what it returns later is unloaded when it comes back). The cells' assets
 * aren't released here: the scene's release takes its cells' owner keys, and Streaming.ts
 * releases the dropped cells when the same scene loads again.
 * @internal
 */
export const dropStreamingCells = (rt: StreamingRuntime) => {
  rt.isDropped = true;
  for (const cell of rt.cells.values()) {
    for (const layer of cell.layers) {
      cancelStreamingPrime(rt, layer);
      layer.fade = null;
      layer.generation++;
      for (let i = 0; i < layer.units.length; i++) {
        if (isStreamingUnitDone(layer.units[i])) unloadStreamingUnit(rt, layer, layer.units[i]);
      }
      deleteAdoptedBodies(rt, layer);
      layer.phase = 'UNLOADED';
    }
    cell.level = StreamingLevel.UNLOADED;
    cell.phase = 'UNLOADED';
  }
  rt.cells.clear();
  rt.order.length = 0;
};
