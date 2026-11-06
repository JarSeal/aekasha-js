// The streaming cells' state machine (p353 §4.1): per cell UNLOADED → LOADING → LOADED(level) →
// UNLOADING → UNLOADED. `decideStreamingCells` sets each cell's level from the focus (every N
// frames), `pumpStreamingCells` does the loading and unloading under the budgets (every frame),
// `loadStreamingCellsNowAsync` loads the wanted cells at once (inside a scene load) and
// `dropStreamingCells` takes everything down (the scene's exit). A cell's content units run in its
// asset owner scope (`sceneId#cellKey`, kernel/assets/AssetOwners.ts), and once its unload is done
// the runtime's `releaseCellAssets` frees what the cell alone held (p353 §4.2). No engine state:
// Streaming.ts holds the runtime and calls these, and the tests drive them with their own clock.
// A cell streamed in during play is primed before it's drawn (§5): its units' entities are held
// as they're made, and once they're all in, the runtime's primer (StreamingPriming.ts) uploads its
// textures, compiles its new shaders and shows it (`PRIMING`, then `LOADED`). A cell that starts
// unloading hands the bodies that moved into another loaded cell to that cell (p353 Phase 4 D1).
import { getCellOwnerKey, runInAssetOwnerScope } from '../../kernel/assets/AssetOwners';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { isCellInRange, packCellKey, worldToCell } from '../../utils/CellKey';
import { type StreamingBodies, deleteAdoptedBodies, handOverMovedBodies } from './StreamingBodies';
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
export type StreamingCellPhase = 'UNLOADED' | 'LOADING' | 'PRIMING' | 'LOADED' | 'UNLOADING';

const UNIT_PENDING = 0;
const UNIT_IN_FLIGHT = 1;
const UNIT_DONE = 2;
const UNIT_FAILED = 3;
const UNIT_UNLOADED = 4;

type CellUnit = {
  content: StreamingCellContent;
  state: number;
  entityIds: readonly number[] | null;
  /** Not started while the cell has units in flight (a JSON cell's entities wait for its assets) */
  waits: boolean;
};

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
  /** Its asset owner key, `sceneId#cellKey`: what its units register belongs to it. */
  ownerKey: string;
  /** Async units of cancelled loads not settled yet: its assets are released once they have. */
  lateUnits: number;
  /** Whether its current load is primed before it's shown (not a scene load's cells). */
  primes: boolean;
  /** Its priming while `PRIMING`. */
  primeJob: StreamingPrimeJob | null;
  /** When its priming started (the runtime's clock). */
  primeStartedAt: number;
  /** How long its last finished priming took, in ms (-1 before one). */
  lastPrimeMs: number;
  /** Bodies other cells' content made that moved into it and were handed to it when their cell
   * unloaded (p353 Phase 4 D1): deleted with it, unless they moved on by then. */
  adopted: number[];
};

/**
 * A cell's priming, the primer's own (opaque to the machine).
 * @internal
 */
export type StreamingPrimeJob = object;

/**
 * What primes a streamed cell's content before it's drawn (StreamingPriming.ts; none in the
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
  /** Starts priming a loaded cell's held entities. */
  start(world: ECSWorld, entityIds: readonly number[], stats: StreamingStats): StreamingPrimeJob;
  /** A frame of a priming under the frame's budgets: true once it's done, everything shown. */
  step(job: StreamingPrimeJob): boolean;
  /** Shows everything now, primed or not (the focus outran the priming). */
  finish(job: StreamingPrimeJob): void;
  /** The cell unloads: drops the priming (its held entities go with the cell). */
  cancel(job: StreamingPrimeJob): void;
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
  /** Cell asset releases run (one per finished unload, once its late units settled). */
  assetReleases: number;
  /** Assets those releases freed. */
  assetsReleased: number;
  /** Primings that finished (their cells shown). */
  primesFinished: number;
  /** Cells shown before their priming finished: the focus reached their `RESIDENT` ring first (a
   * fast focus: widen the rings). */
  primingStalls: number;
  /** Textures the primings uploaded. */
  texturesUploaded: number;
  /** Uncompressed textures over 1024² uploaded (a frame each; ship them as KTX2). */
  oversizedUploads: number;
  /** Compiles the primings ran (one per cell that brought a material not drawn before). */
  compiles: number;
  /** Materials first shown by the primings, a few a frame (`maxNewStructuresPerFrame`). */
  structuresShown: number;
  /** Bodies handed to another cell because they had moved into it when their cell unloaded. */
  bodiesAdopted: number;
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
  /** Frees what a cell alone holds and nothing uses (`releaseCellOwnedAssets`), returning how
   * many assets went. */
  releaseCellAssets: (cellKey: number) => number;
  /** Set by {@link dropStreamingCells}: the scene's release takes its cells' assets from there. */
  isDropped: boolean;
  /** Primes the cells streamed in during play, or null (shown as soon as they're loaded). */
  primer: StreamingPrimer | null;
  /** A cell's units from the scene's data (its JSON content), run before the code-registered
   * ones; null without any. */
  dataContent: ((cellKey: number) => readonly StreamingCellUnitSource[]) | null;
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
  releaseCellAssets: (cellKey: number) => number,
  primer: StreamingPrimer | null = null
): StreamingRuntime => ({
  sceneId,
  settings,
  world,
  now,
  releaseCellAssets,
  primer,
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
  },
});

/**
 * Called after a cell's phase or level changed (the debug tab's cell history). One listener; the
 * machine pays a null check without one.
 * @internal
 */
export type StreamingTransitionListener = (rt: StreamingRuntime, cell: StreamingCell) => void;

let transitionListener: StreamingTransitionListener | null = null;

/**
 * Sets the transition listener (`null` removes it).
 * @internal
 */
export const setStreamingTransitionListener = (listener: StreamingTransitionListener | null) => {
  transitionListener = listener;
};

const notify = (rt: StreamingRuntime, cell: StreamingCell) => transitionListener?.(rt, cell);

/**
 * The entities a cell's content units created and still hold (a new array: the debug tab's).
 * @internal
 */
export const getStreamingCellEntityIds = (cell: StreamingCell): number[] => {
  const ids: number[] = [];
  for (let i = 0; i < cell.units.length; i++) {
    const unitIds = cell.units[i].entityIds;
    if (unitIds) for (let j = 0; j < unitIds.length; j++) ids.push(unitIds[j]);
  }
  return ids;
};

const createCell = (rt: StreamingRuntime, key: number, cx: number, cz: number): StreamingCell => ({
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
  ownerKey: getCellOwnerKey(rt.sceneId, key),
  lateUnits: 0,
  primes: false,
  primeJob: null,
  primeStartedAt: 0,
  lastPrimeMs: -1,
  adopted: [],
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
    rt.primer?.release(rt.world, entityIds);
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

/** Frees the cell's assets once it's unloaded and no late unit can still register any: not for a
 * cell another object has replaced under its key (a load of it may be running), nor after the
 * scene's exit dropped the cells. */
const releaseCellAssetsIfDone = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (rt.isDropped || cell.phase !== 'UNLOADED' || cell.lateUnits > 0) return;
  const tracked = rt.cells.get(cell.key);
  if (tracked && tracked !== cell) return;
  rt.stats.assetReleases++;
  rt.stats.assetsReleased += rt.releaseCellAssets(cell.key);
};

/** Starts taking a cell's content down; a load in flight is cancelled (its units not started
 * are skipped, a late one unloads when it comes back). Its bodies that moved into another loaded
 * cell go to that cell first. */
const beginUnload = (rt: StreamingRuntime, cell: StreamingCell) => {
  handOverMovedBodies(rt, cell);
  cancelPrime(rt, cell);
  if (cell.phase === 'LOADING') {
    rt.stats.loadsCancelled++;
    cell.generation++;
    cell.lateUnits += cell.inFlight;
    cell.inFlight = 0;
  }
  cell.phase = 'UNLOADING';
  cell.nextUnit = 0;
  notify(rt, cell);
};

/** The cell's content is down: it waits to load again when it's still wanted, else it's
 * forgotten. */
const finishUnload = (rt: StreamingRuntime, cell: StreamingCell) => {
  rt.stats.unloadsFinished++;
  cell.phase = 'UNLOADED';
  cell.units = [];
  cell.nextUnit = 0;
  if (!isLoadedLevel(cell.level)) rt.cells.delete(cell.key);
  releaseCellAssetsIfDone(rt, cell);
  notify(rt, cell);
};

// --- Priming ---------------------------------------------------------------------------------

const cancelPrime = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (cell.primeJob) rt.primer?.cancel(cell.primeJob);
  cell.primeJob = null;
};

/** Holds a finished unit's entities from drawing while its cell's load is primed. */
const holdUnit = (rt: StreamingRuntime, cell: StreamingCell, entityIds: readonly number[]) => {
  if (cell.primes && rt.primer) rt.primer.hold(rt.world, entityIds);
};

const finishPrime = (rt: StreamingRuntime, cell: StreamingCell) => {
  cell.primeJob = null;
  cell.phase = 'LOADED';
  cell.lastPrimeMs = rt.now() - cell.primeStartedAt;
  rt.stats.primesFinished++;
  notify(rt, cell);
};

/** A frame of the primings, nearest first: a cell the focus has reached (`RESIDENT`) is shown
 * now, primed or not, and counted as a stall. */
const pumpPrimes = (rt: StreamingRuntime) => {
  const { order, primer } = rt;
  if (!primer) return;
  for (let i = 0; i < order.length; i++) {
    const cell = order[i];
    if (cell.phase !== 'PRIMING' || !cell.primeJob) continue;
    if (cell.level === StreamingLevel.RESIDENT) {
      primer.finish(cell.primeJob);
      rt.stats.primingStalls++;
      finishPrime(rt, cell);
    } else if (primer.step(cell.primeJob)) {
      finishPrime(rt, cell);
    }
  }
};

// --- Loading ---------------------------------------------------------------------------------

/** Whether a cell is loading: a call, so a check after one that changes the phase isn't narrowed
 * away. */
const isCellLoading = (cell: StreamingCell) => cell.phase === 'LOADING';

const finishLoadIfDone = (rt: StreamingRuntime, cell: StreamingCell) => {
  if (cell.phase !== 'LOADING' || cell.nextUnit < cell.units.length || cell.inFlight > 0) return;
  cell.lastLoadMs = rt.now() - cell.loadStartedAt;
  rt.stats.loadsFinished++;
  const entityIds = cell.primes && rt.primer ? getStreamingCellEntityIds(cell) : null;
  if (rt.primer && entityIds?.length) {
    cell.phase = 'PRIMING';
    cell.primeStartedAt = rt.now();
    cell.primeJob = rt.primer.start(rt.world, entityIds, rt.stats);
  } else {
    // Nothing to prime: an empty cell, or a scene load's
    cell.phase = 'LOADED';
  }
  notify(rt, cell);
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
  runOwned: (fn) => runInAssetOwnerScope(cell.ownerKey, fn),
});

/** Starts a cell's load; `primes`: hold its content and prime it before it's shown. */
const beginLoad = (rt: StreamingRuntime, cell: StreamingCell, primes: boolean) => {
  cell.generation++;
  cell.phase = 'LOADING';
  const units: CellUnit[] = [];
  const dataUnits = rt.dataContent?.(cell.key);
  if (dataUnits) {
    for (const { content, waits } of dataUnits) {
      units.push({ content, waits, state: UNIT_PENDING, entityIds: null });
    }
  }
  for (const content of getStreamingCellContent(rt.sceneId, cell.key)) {
    units.push({ content, waits: false, state: UNIT_PENDING, entityIds: null });
  }
  cell.units = units;
  cell.nextUnit = 0;
  cell.inFlight = 0;
  cell.loadStartedAt = rt.now();
  cell.primes = primes && rt.primer !== null;
  cell.ctx = createCellContext(rt, cell, cell.generation);
  rt.stats.loadsStarted++;
  notify(rt, cell);
  finishLoadIfDone(rt, cell);
};

const failUnit = (rt: StreamingRuntime, cell: StreamingCell, unit: CellUnit, err: unknown) => {
  unit.state = UNIT_FAILED;
  rt.stats.unitErrors++;
  lerror(`Streaming: a content load of cell ${cell.cx},${cell.cz} failed.`, err);
};

/** A cancelled load's async unit has settled: the cell's assets go once the last one has. */
const settleLateUnit = (rt: StreamingRuntime, cell: StreamingCell) => {
  cell.lateUnits--;
  releaseCellAssetsIfDone(rt, cell);
};

const notIdsError = (value: unknown) =>
  new Error(`its load returned ${typeof value}, not the array of entity ids it created`);

const isPromise = (value: unknown): value is Promise<readonly number[]> =>
  !!value && typeof (value as Promise<unknown>).then === 'function';

/** Whether the cell's next unit has to wait for the units in flight before it. */
const isNextUnitWaiting = (cell: StreamingCell) =>
  cell.inFlight > 0 && cell.units[cell.nextUnit].waits;

/** Runs the cell's next unit. Returns the promise of an async one (settled either way), else
 * null. */
const runNextUnit = (rt: StreamingRuntime, cell: StreamingCell): Promise<void> | null => {
  const unit = cell.units[cell.nextUnit++];
  const ctx = cell.ctx as StreamingCellContext;
  const generation = cell.generation;
  let result: readonly number[] | Promise<readonly number[]>;
  try {
    // What it registers (or gets from the cache) before its first await is the cell's
    result = runInAssetOwnerScope(cell.ownerKey, () => unit.content.load(ctx));
  } catch (err) {
    failUnit(rt, cell, unit, err);
    return null;
  }
  if (!isPromise(result)) {
    if (!Array.isArray(result)) {
      failUnit(rt, cell, unit, notIdsError(result));
      return null;
    }
    unit.state = UNIT_DONE;
    unit.entityIds = result.slice();
    holdUnit(rt, cell, unit.entityIds);
    return null;
  }
  unit.state = UNIT_IN_FLIGHT;
  cell.inFlight++;
  return result.then(
    (ids) => {
      const isIds = Array.isArray(ids);
      if (cell.generation !== generation) {
        // Cancelled (or the scene left) meanwhile: what it made goes at once
        unit.state = UNIT_UNLOADED;
        rt.stats.lateResults++;
        if (isIds) unloadUnitContent(rt, unit.content, ids, ctx);
        settleLateUnit(rt, cell);
        return;
      }
      cell.inFlight--;
      if (isIds) {
        unit.state = UNIT_DONE;
        unit.entityIds = ids.slice();
        holdUnit(rt, cell, unit.entityIds);
      } else {
        failUnit(rt, cell, unit, notIdsError(ids));
      }
      finishLoadIfDone(rt, cell);
    },
    (err: unknown) => {
      failUnit(rt, cell, unit, err);
      if (cell.generation !== generation) {
        settleLateUnit(rt, cell);
        return;
      }
      cell.inFlight--;
      finishLoadIfDone(rt, cell);
    }
  );
};

// --- Deciding --------------------------------------------------------------------------------

/** Applies a decided level: a cell no longer wanted loaded starts unloading (or is forgotten). */
const setCellLevel = (rt: StreamingRuntime, cell: StreamingCell, level: StreamingLevel) => {
  cell.level = level;
  if (isLoadedLevel(level)) {
    notify(rt, cell);
    return;
  }
  if (cell.phase === 'LOADING' || cell.phase === 'PRIMING' || cell.phase === 'LOADED') {
    beginUnload(rt, cell);
    return;
  }
  if (cell.phase === 'UNLOADED') rt.cells.delete(cell.key);
  notify(rt, cell);
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
      notify(rt, cell);
    }
  }
  order.length = 0;
  for (const cell of cells.values()) order.push(cell);
  order.sort(compareCells);
};

// --- Pumping ---------------------------------------------------------------------------------

/**
 * One frame of loading and unloading, under `budgets`: starts the queued cells' loads nearest
 * first (up to `maxConcurrentLoads` loading; a priming cell doesn't count), runs their content
 * units nearest first, a frame of the primings (the primer's own budgets), then unloads the
 * farthest first. Loads and unloads share `maxCreateMsPerFrame`, but a frame always runs at least
 * one unit of each, so neither starves.
 * @internal
 */
export const pumpStreamingCells = (rt: StreamingRuntime, budgets: StreamingBudgets) => {
  const { order } = rt;
  rt.primer?.beginFrame();
  let loading = 0;
  for (let i = 0; i < order.length; i++) if (order[i].phase === 'LOADING') loading++;
  for (let i = 0; i < order.length && loading < budgets.maxConcurrentLoads; i++) {
    const cell = order[i];
    if (cell.phase !== 'UNLOADED' || !isLoadedLevel(cell.level)) continue;
    // A cell dropped since the decision (forgotten after an unload) isn't started again
    if (rt.cells.get(cell.key) !== cell) continue;
    beginLoad(rt, cell, true);
    if (isCellLoading(cell)) loading++;
  }

  const start = rt.now();
  let hasWorked = false;
  loads: for (let i = 0; i < order.length; i++) {
    const cell = order[i];
    if (cell.phase !== 'LOADING') continue;
    while (cell.phase === 'LOADING' && cell.nextUnit < cell.units.length) {
      // Its turn comes once the units before it are in (a later frame)
      if (isNextUnitWaiting(cell)) break;
      if (hasWorked && rt.now() - start >= budgets.maxCreateMsPerFrame) break loads;
      void runNextUnit(rt, cell);
      hasWorked = true;
    }
    finishLoadIfDone(rt, cell);
  }

  pumpPrimes(rt);

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
    deleteAdoptedBodies(rt, cell);
    finishUnload(rt, cell);
  }
};

/** Runs a cell's units with no budget, awaiting its units in flight where a unit waits for
 * them, and resolves when its async units have settled. */
const loadCellNowAsync = async (rt: StreamingRuntime, cell: StreamingCell) => {
  let pending: Promise<void>[] = [];
  while (isCellLoading(cell) && cell.nextUnit < cell.units.length) {
    if (isNextUnitWaiting(cell)) {
      await Promise.all(pending);
      pending = [];
      continue;
    }
    const promise = runNextUnit(rt, cell);
    if (promise) pending.push(promise);
  }
  finishLoadIfDone(rt, cell);
  await Promise.all(pending);
};

/**
 * Loads every cell the last decision wants loaded at once, with no budget, and resolves when
 * their async units have settled: a scene load's cells around the focus (p353 §4.1). The cells
 * load side by side; within one, a unit that waits runs once the units before it are in.
 * @internal
 */
export const loadStreamingCellsNowAsync = async (rt: StreamingRuntime) => {
  const loads: Promise<void>[] = [];
  for (const cell of rt.order) {
    if (cell.phase !== 'UNLOADED' || !isLoadedLevel(cell.level)) continue;
    // Shown with the scene, like its other content (the load screen hides the first draws)
    beginLoad(rt, cell, false);
    loads.push(loadCellNowAsync(rt, cell));
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
    cancelPrime(rt, cell);
    cell.generation++;
    for (let i = 0; i < cell.units.length; i++) {
      if (cell.units[i].state === UNIT_DONE) unloadUnit(rt, cell, cell.units[i]);
    }
    deleteAdoptedBodies(rt, cell);
    cell.phase = 'UNLOADED';
    cell.level = StreamingLevel.UNLOADED;
  }
  rt.cells.clear();
  rt.order.length = 0;
};
