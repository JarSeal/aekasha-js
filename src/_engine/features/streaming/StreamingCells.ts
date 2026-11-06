// The streaming cells' state machine (p353 §4.1): per cell UNLOADED → LOADING → LOADED(level) →
// UNLOADING → UNLOADED. `decideStreamingCells` sets each cell's level from the focus (every N
// frames), `pumpStreamingCells` does the loading and unloading under the budgets (every frame),
// `loadStreamingCellsNowAsync` loads the wanted cells at once (inside a scene load) and
// `dropStreamingCells` takes everything down (the scene's exit). No engine state: Streaming.ts
// holds the runtime and calls these, and the tests drive them with their own clock.
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import { lerror } from '../../utils/Logger';
import {
  type StreamingCellContent,
  type StreamingCellContext,
  getStreamingCellContent,
} from './StreamingContent';
import {
  DEEPEST_LOADED_LEVEL,
  decideStreamingLevel,
  getCellEdgeDistance,
  isLoadedLevel,
  StreamingLevel,
} from './StreamingRings';
import type { ResolvedStreamingSettings } from './StreamingSettings';

/**
 * Where a cell's content is: `LOADED` cells are at their `level`.
 * @internal
 */
export type StreamingCellPhase = 'UNLOADED' | 'LOADING' | 'LOADED' | 'UNLOADING';

const UNIT_PENDING = 0;
const UNIT_IN_FLIGHT = 1;
const UNIT_DONE = 2;
const UNIT_FAILED = 3;
const UNIT_UNLOADED = 4;

type CellUnit = {
  content: StreamingCellContent;
  state: number;
  entityIds: readonly number[] | null;
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
  /** Where its content is. */
  phase: StreamingCellPhase;
  /** Bumped by every load start, cancel and drop: a result of an older generation is late. */
  generation: number;
  /** The current (or last) load's units, from the content registered when it started. */
  units: CellUnit[];
  /** The next unit to load (`LOADING`) or unload (`UNLOADING`). */
  nextUnit: number;
  /** Async units of the current load not settled yet. */
  inFlight: number;
  /** Its ring around the focus cell at the last decision. */
  ring: number;
  /** The focus's distance to its edge at the last decision, in metres. */
  edgeDistance: number;
  /** When its current load started (the runtime's clock). */
  loadStartedAt: number;
  /** How long its last finished load took, in ms (-1 before one). */
  lastLoadMs: number;
  /** The context its current load's units get. */
  ctx: StreamingCellContext | null;
};

/**
 * The machine's counters since the scene's load, for the debug tab.
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
};

/**
 * The loading budgets (`AppConfig.streaming`).
 * @internal
 */
export type StreamingBudgets = {
  /** The most cells loading at once. */
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
  /** The focus cell at the last decision. */
  focusCx: number;
  /** The focus cell at the last decision. */
  focusCz: number;
  /** The counters. */
  stats: StreamingStats;
};

/**
 * A machine for a scene, no cell tracked yet.
 * @internal
 */
export const createStreamingRuntime = (
  sceneId: string,
  settings: ResolvedStreamingSettings,
  world: ECSWorld,
  now: () => number
): StreamingRuntime => ({
  sceneId,
  settings,
  world,
  now,
  cells: new Map(),
  order: [],
  focusCx: 0,
  focusCz: 0,
  stats: {
    loadsStarted: 0,
    loadsFinished: 0,
    loadsCancelled: 0,
    unloadsFinished: 0,
    unitErrors: 0,
    lateResults: 0,
  },
});

const createCell = (key: number, cx: number, cz: number): StreamingCell => ({
  key,
  cx,
  cz,
  level: StreamingLevel.UNLOADED,
  phase: 'UNLOADED',
  generation: 0,
  units: [],
  nextUnit: 0,
  inFlight: 0,
  ring: 0,
  edgeDistance: 0,
  loadStartedAt: 0,
  lastLoadMs: -1,
  ctx: null,
});

// --- Unloading -------------------------------------------------------------------------------

const unloadUnitContent = (
  rt: StreamingRuntime,
  content: StreamingCellContent,
  entityIds: readonly number[],
  ctx: StreamingCellContext
) => {
  if (content.unload) {
    try {
      content.unload(entityIds, ctx);
    } catch (err) {
      rt.stats.unitErrors++;
      lerror(`Streaming: a content unload of cell ${ctx.cx},${ctx.cz} threw.`, err);
    }
    return;
  }
  for (let i = 0; i < entityIds.length; i++) rt.world.deleteEntity(entityIds[i]);
};

const unloadUnit = (rt: StreamingRuntime, cell: StreamingCell, unit: CellUnit) => {
  const ids = unit.entityIds;
  unit.state = UNIT_UNLOADED;
  unit.entityIds = null;
  if (ids && cell.ctx) unloadUnitContent(rt, unit.content, ids, cell.ctx);
};

/** Starts taking a cell's content down; a load in flight is cancelled (its units not started
 * are skipped, a late one unloads when it comes back). */
const beginUnload = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (cell.phase === 'LOADING') {
    rt.stats.loadsCancelled++;
    cell.generation++;
    cell.inFlight = 0;
  }
  cell.phase = 'UNLOADING';
  cell.nextUnit = 0;
};

/** The cell's content is down: it waits to load again when it's still wanted, else it's
 * forgotten. */
const finishUnload = (rt: StreamingRuntime, cell: StreamingCell) => {
  rt.stats.unloadsFinished++;
  cell.phase = 'UNLOADED';
  cell.units = [];
  cell.nextUnit = 0;
  if (!isLoadedLevel(cell.level)) rt.cells.delete(cell.key);
};

// --- Loading ---------------------------------------------------------------------------------

/** Whether a cell is loading: a call, so a check after one that changes the phase isn't narrowed
 * away. */
const isCellLoading = (cell: StreamingCell) => cell.phase === 'LOADING';

const finishLoadIfDone = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (cell.phase !== 'LOADING' || cell.nextUnit < cell.units.length || cell.inFlight > 0) return;
  cell.phase = 'LOADED';
  cell.lastLoadMs = rt.now() - cell.loadStartedAt;
  rt.stats.loadsFinished++;
};

const createCellContext = (
  rt: StreamingRuntime,
  cell: StreamingCell,
  generation: number
): StreamingCellContext => ({
  sceneId: rt.sceneId,
  cellKey: cell.key,
  cx: cell.cx,
  cz: cell.cz,
  cellSize: rt.settings.cellSize,
  world: rt.world,
  isCurrent: () => cell.generation === generation,
});

const beginLoad = (rt: StreamingRuntime, cell: StreamingCell) => {
  cell.generation++;
  cell.phase = 'LOADING';
  cell.units = getStreamingCellContent(rt.sceneId, cell.key).map((content) => ({
    content,
    state: UNIT_PENDING,
    entityIds: null,
  }));
  cell.nextUnit = 0;
  cell.inFlight = 0;
  cell.loadStartedAt = rt.now();
  cell.ctx = createCellContext(rt, cell, cell.generation);
  rt.stats.loadsStarted++;
  finishLoadIfDone(rt, cell);
};

const failUnit = (rt: StreamingRuntime, cell: StreamingCell, unit: CellUnit, err: unknown) => {
  unit.state = UNIT_FAILED;
  rt.stats.unitErrors++;
  lerror(`Streaming: a content load of cell ${cell.cx},${cell.cz} failed.`, err);
};

const isPromise = (value: unknown): value is Promise<readonly number[]> =>
  !!value && typeof (value as Promise<unknown>).then === 'function';

/** Runs the cell's next unit. Returns the promise of an async one (settled either way), else
 * null. */
const runNextUnit = (rt: StreamingRuntime, cell: StreamingCell): Promise<void> | null => {
  const unit = cell.units[cell.nextUnit++];
  const ctx = cell.ctx as StreamingCellContext;
  const generation = cell.generation;
  let result: readonly number[] | Promise<readonly number[]>;
  try {
    result = unit.content.load(ctx);
  } catch (err) {
    failUnit(rt, cell, unit, err);
    return null;
  }
  if (!isPromise(result)) {
    unit.state = UNIT_DONE;
    unit.entityIds = result.slice();
    return null;
  }
  unit.state = UNIT_IN_FLIGHT;
  cell.inFlight++;
  return result.then(
    (ids) => {
      if (cell.generation !== generation) {
        // Cancelled (or the scene left) meanwhile: what it made goes at once
        unit.state = UNIT_UNLOADED;
        rt.stats.lateResults++;
        unloadUnitContent(rt, unit.content, ids, ctx);
        return;
      }
      unit.state = UNIT_DONE;
      unit.entityIds = ids.slice();
      cell.inFlight--;
      finishLoadIfDone(rt, cell);
    },
    (err: unknown) => {
      if (cell.generation === generation) cell.inFlight--;
      failUnit(rt, cell, unit, err);
      if (cell.generation === generation) finishLoadIfDone(rt, cell);
    }
  );
};

// --- Deciding --------------------------------------------------------------------------------

/** Applies a decided level: a cell no longer wanted loaded starts unloading (or is forgotten). */
const setCellLevel = (rt: StreamingRuntime, cell: StreamingCell, level: StreamingLevel) => {
  cell.level = level;
  if (isLoadedLevel(level)) return;
  if (cell.phase === 'LOADING' || cell.phase === 'LOADED') beginUnload(rt, cell);
  else if (cell.phase === 'UNLOADED') rt.cells.delete(cell.key);
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
  const fcx = worldToCell(x, invCellSize);
  const fcz = worldToCell(z, invCellSize);
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
      const cell = createCell(key, cx, cz);
      cell.level = level;
      cell.ring = ring;
      cell.edgeDistance = edgeDistance;
      cells.set(key, cell);
    }
  }
  order.length = 0;
  for (const cell of cells.values()) order.push(cell);
  order.sort(compareCells);
};

// --- Pumping ---------------------------------------------------------------------------------

/**
 * One frame of loading and unloading, under `budgets`: starts the queued cells' loads nearest
 * first (up to `maxConcurrentLoads` loading), runs their content units nearest first, then
 * unloads the farthest first. Loads and unloads share `maxCreateMsPerFrame`, but a frame always
 * runs at least one unit of each, so neither starves.
 * @internal
 */
export const pumpStreamingCells = (rt: StreamingRuntime, budgets: StreamingBudgets) => {
  const { order } = rt;
  let loading = 0;
  for (let i = 0; i < order.length; i++) if (order[i].phase === 'LOADING') loading++;
  for (let i = 0; i < order.length && loading < budgets.maxConcurrentLoads; i++) {
    const cell = order[i];
    if (cell.phase !== 'UNLOADED' || !isLoadedLevel(cell.level)) continue;
    // A cell dropped since the decision (forgotten after an unload) isn't started again
    if (rt.cells.get(cell.key) !== cell) continue;
    beginLoad(rt, cell);
    if (isCellLoading(cell)) loading++;
  }

  const start = rt.now();
  let hasWorked = false;
  loads: for (let i = 0; i < order.length; i++) {
    const cell = order[i];
    if (cell.phase !== 'LOADING') continue;
    while (cell.phase === 'LOADING' && cell.nextUnit < cell.units.length) {
      if (hasWorked && rt.now() - start >= budgets.maxCreateMsPerFrame) break loads;
      void runNextUnit(rt, cell);
      hasWorked = true;
    }
    finishLoadIfDone(rt, cell);
  }

  hasWorked = false;
  unloads: for (let i = order.length - 1; i >= 0; i--) {
    const cell = order[i];
    if (cell.phase !== 'UNLOADING') continue;
    while (cell.nextUnit < cell.units.length) {
      if (hasWorked && rt.now() - start >= budgets.maxCreateMsPerFrame) break unloads;
      const unit = cell.units[cell.nextUnit++];
      if (unit.state !== UNIT_DONE) continue;
      unloadUnit(rt, cell, unit);
      hasWorked = true;
    }
    finishUnload(rt, cell);
  }
};

/**
 * Loads every cell the last decision wants loaded at once, with no budget, and resolves when
 * their async units have settled: a scene load's cells around the focus (p353 §4.1).
 * @internal
 */
export const loadStreamingCellsNowAsync = async (rt: StreamingRuntime) => {
  const pending: Promise<void>[] = [];
  for (const cell of rt.order) {
    if (cell.phase !== 'UNLOADED' || !isLoadedLevel(cell.level)) continue;
    beginLoad(rt, cell);
    while (isCellLoading(cell) && cell.nextUnit < cell.units.length) {
      const promise = runNextUnit(rt, cell);
      if (promise) pending.push(promise);
    }
    finishLoadIfDone(rt, cell);
  }
  await Promise.all(pending);
};

/**
 * Takes every cell's content down at once and forgets every cell: the scene's exit. A load in
 * flight is cancelled (what it returns later is unloaded when it comes back).
 * @internal
 */
export const dropStreamingCells = (rt: StreamingRuntime) => {
  for (const cell of rt.cells.values()) {
    cell.generation++;
    for (let i = 0; i < cell.units.length; i++) {
      if (cell.units[i].state === UNIT_DONE) unloadUnit(rt, cell, cell.units[i]);
    }
    cell.phase = 'UNLOADED';
    cell.level = StreamingLevel.UNLOADED;
  }
  rt.cells.clear();
  rt.order.length = 0;
};
