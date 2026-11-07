// A streaming cell's content layers (p353 Phase 5 D1): each cell has one per content range,
// `NEAR_AND_FAR` (kept from `FAR` in: a cell's ground), `NEAR` (`RESIDENT` and `NEARBY`) and
// `FAR` (the stand-ins while `FAR`), and each runs this machine on its own units: UNLOADED →
// LOADING → PRIMING → LOADED → UNLOADING → UNLOADED, with a generation counter bumped by every
// load start, cancel and drop. A layer's units run in its owner key (D10) and creation scope, its
// finished unload releases what it alone held, and its bodies that moved go to the same layer of
// the cell they're in. A layer its cell's level no longer wants waits, drawn, until the layers the
// level wants are shown (D2). With the runtime's fader and a `fadeSeconds` over 0 (D4), a layer
// streamed in during play fades in once it's shown, and a shown layer fades out before it
// unloads, both at once in a near ↔ far switch; a fade turns around when the cell changes its mind.
// The cells (StreamingCells.ts) decide the levels and pump the layers; no engine state, as there.
import { getCellOwnerKey, runInAssetOwnerScope } from '../../kernel/assets/AssetOwners';
import { runInPhysicsCreationScope } from '../../kernel/ecs/PhysicsTierAccess';
import { lerror } from '../../utils/Logger';
import type {
  StreamingCell,
  StreamingCellPhase,
  StreamingFadeJob,
  StreamingPrimeJob,
  StreamingRuntime,
} from './StreamingCells';
import {
  type StreamingCellContent,
  type StreamingCellContext,
  type StreamingContentRange,
  getStreamingCellContent,
} from './StreamingContent';
import { StreamingLevel } from './StreamingRings';

const UNIT_PENDING = 0;
const UNIT_IN_FLIGHT = 1;
const UNIT_DONE = 2;
const UNIT_FAILED = 3;
const UNIT_UNLOADED = 4;

/**
 * One unit of a layer's current (or last) load.
 * @internal
 */
export type StreamingLayerUnit = {
  /** The content it runs. */
  content: StreamingCellContent;
  /** `UNIT_*`. */
  state: number;
  /** The entities its load returned, while it holds them. */
  entityIds: readonly number[] | null;
  /** Not started while the layer has units in flight (a JSON cell's entities wait for its assets). */
  waits: boolean;
};

/**
 * The layers' ranges in a cell's `layers` order: the kept content first (a far cell's ground
 * before its stand-ins), then the near and the far.
 * @internal
 */
export const STREAMING_LAYER_RANGES: readonly StreamingContentRange[] = [
  'NEAR_AND_FAR',
  'NEAR',
  'FAR',
];

/** A layer's owner key suffix (D10): none for `NEAR`, the keys Phases 2-4 used. */
const OWNER_LAYERS: Record<StreamingContentRange, string | undefined> = {
  NEAR_AND_FAR: 'kept',
  NEAR: undefined,
  FAR: 'far',
};

/**
 * The owner key suffix of a cell's layer of `range` (`getCellOwnerKey`'s `layer`).
 * @internal
 */
export const getStreamingLayerOwnerLayer = (range: StreamingContentRange) => OWNER_LAYERS[range];

/**
 * A cell's layer of content: the units of one content range, and where they are.
 * @internal
 */
export type StreamingLayer = {
  /** The cell it's in. */
  readonly cell: StreamingCell;
  /** Its index in the cell's `layers` (the same in every cell). */
  readonly index: number;
  /** The units it loads. */
  readonly range: StreamingContentRange;
  /** Its owner key's layer suffix (`getCellOwnerKey`), undefined for `NEAR`. */
  readonly ownerLayer: string | undefined;
  /** Its asset owner key: what its units register belongs to it. */
  readonly ownerKey: string;
  /** Where its content is. */
  phase: StreamingCellPhase;
  /** Bumped by every load start, cancel and drop: a result of an older generation is late. */
  generation: number;
  /** The current (or last) load's units, from the content registered when it started. */
  units: StreamingLayerUnit[];
  /** The next unit to load (`LOADING`) or unload (`UNLOADING`). */
  nextUnit: number;
  /** Async units of the current load not settled yet. */
  inFlight: number;
  /** When its current load started (the runtime's clock). */
  loadStartedAt: number;
  /** How long its last finished load took, in ms (-1 before one). */
  lastLoadMs: number;
  /** The context its current load's units get. */
  ctx: StreamingCellContext | null;
  /** Async units of cancelled loads not settled yet: its assets are released once they have. */
  lateUnits: number;
  /** Whether a load of it ran units since its last release: an empty layer registers nothing, so
   * it's neither counted nor released. */
  hasUnits: boolean;
  /** Whether its current load is primed before it's shown (not a scene load's cells). */
  primes: boolean;
  /** Its priming while `PRIMING`. */
  primeJob: StreamingPrimeJob | null;
  /** When its priming started (the runtime's clock). */
  primeStartedAt: number;
  /** How long its last finished priming took, in ms (-1 before one). */
  lastPrimeMs: number;
  /** Bodies other cells' layers of its range made that moved into its cell and were handed to it
   * (p353 Phase 4 D1): deleted with it, unless they moved on by then. */
  adopted: number[];
  /** Whether its current load fades in once it's shown (streamed in during play, with a fader). */
  fadesIn: boolean;
  /** Its running fade: in once shown, out before it unloads (D4). */
  fade: StreamingLayerFade | null;
};

/**
 * A layer's running fade.
 * @internal
 */
export type StreamingLayerFade = {
  /** The fader's job. */
  job: StreamingFadeJob;
  /** In (shown) or out (taken down once it ends). */
  direction: 'IN' | 'OUT';
  /** When it started on the runtime's clock, shifted back by a turned-around fade's progress. */
  startedAt: number;
};

/**
 * A cell's layers, in {@link STREAMING_LAYER_RANGES}' order.
 * @internal
 */
export const createStreamingLayers = (
  sceneId: string,
  cell: StreamingCell
): readonly StreamingLayer[] =>
  STREAMING_LAYER_RANGES.map((range, index) => {
    const ownerLayer = OWNER_LAYERS[range];
    return {
      cell,
      index,
      range,
      ownerLayer,
      ownerKey: getCellOwnerKey(sceneId, cell.key, ownerLayer),
      phase: 'UNLOADED',
      generation: 0,
      units: [],
      nextUnit: 0,
      inFlight: 0,
      loadStartedAt: 0,
      lastLoadMs: -1,
      ctx: null,
      lateUnits: 0,
      hasUnits: false,
      primes: false,
      primeJob: null,
      primeStartedAt: 0,
      lastPrimeMs: -1,
      adopted: [],
      fadesIn: false,
      fade: null,
    };
  });

/**
 * Whether a cell at `level` wants its layer of `range` loaded: `RESIDENT` and `NEARBY` the
 * `NEAR` and kept layers, `FAR` the far and kept ones, `UNLOADED` none.
 * @internal
 */
export const isRangeWanted = (range: StreamingContentRange, level: StreamingLevel) => {
  if (level === StreamingLevel.UNLOADED) return false;
  return level === StreamingLevel.FAR ? range !== 'NEAR' : range !== 'FAR';
};

/**
 * Whether the layer's cell's level wants it.
 * @internal
 */
export const isLayerWanted = (layer: StreamingLayer) =>
  isRangeWanted(layer.range, layer.cell.level);

/**
 * Whether the layer has content its cell holds (it can take bodies, and they a tier).
 * @internal
 */
export const isLayerHolding = (layer: StreamingLayer) =>
  layer.phase === 'LOADING' || layer.phase === 'PRIMING' || layer.phase === 'LOADED';

// --- Transitions -----------------------------------------------------------------------------

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

/**
 * Tells the listener the cell changed.
 * @internal
 */
export const notifyStreamingCell = (rt: StreamingRuntime, cell: StreamingCell) =>
  transitionListener?.(rt, cell);

const PHASE_RANK: Record<StreamingCellPhase, number> = {
  UNLOADED: 0,
  UNLOADING: 0,
  LOADING: 1,
  PRIMING: 2,
  LOADED: 3,
};

/**
 * Sets the cell's phase from its layers' (D3): the least advanced of the layers its level wants
 * (`UNLOADED` while one waits to load, also behind a layer finishing its unload first), `LOADED`
 * once they're all shown; with none wanted, `UNLOADING` while a layer still has content.
 * @internal
 */
export const updateStreamingCellPhase = (cell: StreamingCell) => {
  let phase: StreamingCellPhase | null = null;
  let isAnyLeft = false;
  for (let i = 0; i < cell.layers.length; i++) {
    const layer = cell.layers[i];
    if (layer.phase !== 'UNLOADED') isAnyLeft = true;
    if (!isLayerWanted(layer)) continue;
    const own = layer.phase === 'UNLOADING' ? 'UNLOADED' : layer.phase;
    if (phase === null || PHASE_RANK[own] < PHASE_RANK[phase]) phase = own;
  }
  cell.phase = phase ?? (isAnyLeft ? 'UNLOADING' : 'UNLOADED');
};

const changed = (rt: StreamingRuntime, layer: StreamingLayer) => {
  updateStreamingCellPhase(layer.cell);
  notifyStreamingCell(rt, layer.cell);
};

// --- Fades (D4) ------------------------------------------------------------------------------

/** The runtime's fader, when its scene fades (a `fadeSeconds` over 0). */
const getFader = (rt: StreamingRuntime) => (rt.settings.fadeSeconds > 0 ? rt.fader : null);

const getFadeMs = (rt: StreamingRuntime) => rt.settings.fadeSeconds * 1000;

/** The entities a fade takes: the layer's units' and the bodies it adopted. */
const getFadedEntityIds = (layer: StreamingLayer) => {
  const ids = getStreamingLayerEntityIds(layer);
  for (let i = 0; i < layer.adopted.length; i++) ids.push(layer.adopted[i]);
  return ids;
};

/** Starts the layer's fade `direction`, or turns its running one around from where it is.
 * Returns false when there's nothing to fade (no fader, no entities). */
const startFade = (rt: StreamingRuntime, layer: StreamingLayer, direction: 'IN' | 'OUT') => {
  const fader = getFader(rt);
  if (!fader) return false;
  const now = rt.now();
  const { fade } = layer;
  if (fade) {
    if (fade.direction === direction) return true;
    const progress = Math.min(1, (now - fade.startedAt) / getFadeMs(rt));
    // The other way from where it is: a new job at the turned progress, on the same objects
    fade.direction = direction;
    fade.startedAt = now - (1 - progress) * getFadeMs(rt);
    fade.job = fader.start(rt.world, getFadedEntityIds(layer), direction, 1 - progress);
    rt.stats.fadesReversed++;
    return true;
  }
  const ids = getFadedEntityIds(layer);
  if (!ids.length) return false;
  layer.fade = { job: fader.start(rt.world, ids, direction, 0), direction, startedAt: now };
  rt.stats.fadesStarted++;
  return true;
};

/**
 * A frame of the layer's fade: drawn at its progress; one that ends lets an incoming layer draw
 * whole, and starts a leaving one's unload.
 * @internal
 */
export const pumpStreamingLayerFade = (rt: StreamingRuntime, layer: StreamingLayer) => {
  const { fade } = layer;
  const fader = rt.fader;
  if (!fade || !fader) return;
  const progress = Math.min(1, (rt.now() - fade.startedAt) / getFadeMs(rt));
  fader.draw(fade.job, progress);
  if (progress < 1) return;
  layer.fade = null;
  if (fade.direction === 'OUT') beginStreamingLayerUnload(rt, layer);
};

/**
 * A body handed to `layer` (p353 Phase 4 D1) draws as the layer does: one handed to a shown layer
 * is let go of a fade or hold its old layer left on it (a fade out's end holds what it faded); one
 * handed to a layer not shown yet takes that layer's fade in.
 * @internal
 */
export const showAdoptedBody = (rt: StreamingRuntime, layer: StreamingLayer, entityId: number) => {
  if (layer.phase === 'LOADED' && !isStreamingLayerFadingOut(layer)) {
    rt.fader?.release(rt.world, [entityId]);
  }
};

/**
 * Whether the layer fades out before it unloads (its cell no longer wants it).
 * @internal
 */
export const isStreamingLayerFadingOut = (layer: StreamingLayer) => layer.fade?.direction === 'OUT';

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
    rt.fader?.release(rt.world, entityIds);
    return;
  }
  for (let i = 0; i < entityIds.length; i++) rt.world.deleteEntity(entityIds[i]);
};

/**
 * Takes a finished unit's content down.
 * @internal
 */
export const unloadStreamingUnit = (
  rt: StreamingRuntime,
  layer: StreamingLayer,
  unit: StreamingLayerUnit
) => {
  const ids = unit.entityIds;
  unit.state = UNIT_UNLOADED;
  unit.entityIds = null;
  if (ids && layer.ctx) unloadUnitContent(rt, unit.content, ids, layer.ctx);
};

/**
 * Whether the unit has content to take down.
 * @internal
 */
export const isStreamingUnitDone = (unit: StreamingLayerUnit) => unit.state === UNIT_DONE;

/** Frees the layer's assets once it's unloaded and no late unit can still register any: not for
 * a cell another object has replaced under its key (a load of it may be running), nor after the
 * scene's exit dropped the cells, nor for a layer that ran no units. */
const releaseLayerAssetsIfDone = (rt: StreamingRuntime, layer: StreamingLayer) => {
  if (rt.isDropped || layer.phase !== 'UNLOADED' || layer.lateUnits > 0 || !layer.hasUnits) return;
  const tracked = rt.cells.get(layer.cell.key);
  if (tracked && tracked !== layer.cell) return;
  layer.hasUnits = false;
  rt.stats.assetReleases++;
  rt.stats.assetsReleased += rt.releaseCellAssets(layer.cell.key, layer.ownerLayer);
};

/**
 * Deletes the bodies a layer adopted (its unload, or the scene's exit; p353 Phase 4 D1).
 * @internal
 */
export const deleteAdoptedBodies = (rt: StreamingRuntime, layer: StreamingLayer) => {
  const { adopted } = layer;
  for (let i = 0; i < adopted.length; i++) rt.world.deleteEntity(adopted[i]);
  adopted.length = 0;
};

const cancelPrime = (rt: StreamingRuntime, layer: StreamingLayer) => {
  if (layer.primeJob) rt.primer?.cancel(layer.primeJob);
  layer.primeJob = null;
};

/**
 * Drops the layer's priming, if any (the scene's exit).
 * @internal
 */
export const cancelStreamingPrime = cancelPrime;

/**
 * Starts taking a layer's content down; a load in flight is cancelled (its units not started are
 * skipped, a late one unloads when it comes back). Its bodies that moved into another loaded cell
 * go to that cell first.
 * @internal
 */
export const beginStreamingLayerUnload = (rt: StreamingRuntime, layer: StreamingLayer) => {
  rt.bodies?.handOver?.(rt, layer);
  cancelPrime(rt, layer);
  // A fade still running goes with the entities (a never-shown layer is held from drawing)
  layer.fade = null;
  if (layer.phase === 'LOADING') {
    if (layer.units.length) rt.stats.loadsCancelled++;
    layer.generation++;
    layer.lateUnits += layer.inFlight;
    layer.inFlight = 0;
  }
  layer.phase = 'UNLOADING';
  layer.nextUnit = 0;
  changed(rt, layer);
};

/**
 * The layer's content is down: it waits to load again when it's still wanted; a cell with no
 * layer wanted or left is forgotten.
 * @internal
 */
export const finishStreamingLayerUnload = (rt: StreamingRuntime, layer: StreamingLayer) => {
  if (layer.units.length) rt.stats.unloadsFinished++;
  layer.phase = 'UNLOADED';
  layer.units = [];
  layer.nextUnit = 0;
  const { cell } = layer;
  if (cell.level === StreamingLevel.UNLOADED && cell.layers.every((l) => l.phase === 'UNLOADED')) {
    rt.cells.delete(cell.key);
  }
  releaseLayerAssetsIfDone(rt, layer);
  changed(rt, layer);
};

/**
 * Starts taking down the layers its cell no longer wants (D2): one never shown (`LOADING`,
 * `PRIMING`) unloads at once, a shown one once every layer the level wants is shown, so a switch
 * between a cell's near and far content never leaves it empty; with fades (D4) it fades out first,
 * while the layer replacing it fades in. A layer fading out that's wanted again fades back in.
 * Called when the level changes and when a layer is shown.
 * @internal
 */
export const releaseLeavingLayers = (rt: StreamingRuntime, cell: StreamingCell) => {
  let areWantedShown = true;
  for (let i = 0; i < cell.layers.length; i++) {
    const layer = cell.layers[i];
    if (isLayerWanted(layer) && layer.phase !== 'LOADED') areWantedShown = false;
  }
  for (let i = 0; i < cell.layers.length; i++) {
    const layer = cell.layers[i];
    if (isLayerWanted(layer)) {
      if (isStreamingLayerFadingOut(layer)) startFade(rt, layer, 'IN');
      continue;
    }
    if (!isLayerHolding(layer) || isStreamingLayerFadingOut(layer)) continue;
    if (layer.phase !== 'LOADED') beginStreamingLayerUnload(rt, layer);
    else if (areWantedShown && !startFade(rt, layer, 'OUT')) beginStreamingLayerUnload(rt, layer);
  }
};

// --- Priming ---------------------------------------------------------------------------------

/**
 * The entities a layer's units created and still hold (a new array).
 * @internal
 */
export const getStreamingLayerEntityIds = (layer: StreamingLayer, out: number[] = []) => {
  for (let i = 0; i < layer.units.length; i++) {
    const unitIds = layer.units[i].entityIds;
    if (unitIds) for (let j = 0; j < unitIds.length; j++) out.push(unitIds[j]);
  }
  return out;
};

/** A unit finished with `entityIds`: their materials take part in fades (drawn invisible until
 * the layer's fade in, D6), they're held from drawing while its layer's load is primed, and its
 * bodies get the layer's tier. */
const finishUnit = (rt: StreamingRuntime, layer: StreamingLayer, entityIds: readonly number[]) => {
  getFader(rt)?.prepare(rt.world, entityIds, layer.fadesIn);
  if (layer.primes && rt.primer) rt.primer.hold(rt.world, entityIds);
  rt.bodies?.unitLoaded?.(rt, layer, entityIds);
};

/** Runs `fn` in the layer's scopes: its asset owner key (what it registers is the layer's) and its
 * physics creation scope (the bodies it creates start in the layer's tier). */
const runInLayerScopes = <T>(rt: StreamingRuntime, layer: StreamingLayer, fn: () => T): T =>
  runInAssetOwnerScope(layer.ownerKey, () =>
    runInPhysicsCreationScope(rt.bodies?.getCreationScope?.(rt, layer) ?? null, fn)
  );

/** The layer is shown (fading in when streamed in during play): a layer its cell is leaving may
 * go now. */
const showLayer = (rt: StreamingRuntime, layer: StreamingLayer) => {
  layer.phase = 'LOADED';
  if (layer.fadesIn) startFade(rt, layer, 'IN');
  changed(rt, layer);
  releaseLeavingLayers(rt, layer.cell);
};

const finishPrime = (rt: StreamingRuntime, layer: StreamingLayer) => {
  layer.primeJob = null;
  layer.lastPrimeMs = rt.now() - layer.primeStartedAt;
  rt.stats.primesFinished++;
  showLayer(rt, layer);
};

/**
 * A frame of a priming layer: shown once its priming is done, or at once (counted as a stall) when
 * the focus has reached its cell (`RESIDENT`).
 * @internal
 */
export const pumpStreamingLayerPrime = (rt: StreamingRuntime, layer: StreamingLayer) => {
  const { primer } = rt;
  if (!primer || layer.phase !== 'PRIMING' || !layer.primeJob) return;
  if (layer.cell.level === StreamingLevel.RESIDENT) {
    primer.finish(layer.primeJob);
    rt.stats.primingStalls++;
    finishPrime(rt, layer);
  } else if (primer.step(layer.primeJob)) {
    finishPrime(rt, layer);
  }
};

// --- Loading ---------------------------------------------------------------------------------

/**
 * Whether a layer is loading: a call, so a check after one that changes the phase isn't narrowed
 * away.
 * @internal
 */
export const isStreamingLayerLoading = (layer: StreamingLayer) => layer.phase === 'LOADING';

/**
 * Finishes the layer's load once its units are all in: to `PRIMING` (streamed in during play,
 * with entities) or shown.
 * @internal
 */
export const finishStreamingLayerLoadIfDone = (rt: StreamingRuntime, layer: StreamingLayer) => {
  if (layer.phase !== 'LOADING' || layer.nextUnit < layer.units.length || layer.inFlight > 0) {
    return;
  }
  if (layer.units.length) {
    layer.lastLoadMs = rt.now() - layer.loadStartedAt;
    rt.stats.loadsFinished++;
  }
  const entityIds = layer.primes && rt.primer ? getStreamingLayerEntityIds(layer) : null;
  if (rt.primer && entityIds?.length) {
    layer.phase = 'PRIMING';
    layer.primeStartedAt = rt.now();
    layer.primeJob = rt.primer.start(rt.world, entityIds, rt.stats);
    changed(rt, layer);
    return;
  }
  // Nothing to prime: an empty layer, or a scene load's
  showLayer(rt, layer);
};

const createLayerContext = (
  rt: StreamingRuntime,
  layer: StreamingLayer,
  generation: number
): StreamingCellContext => ({
  sceneId: rt.sceneId,
  cellKey: layer.cell.key,
  cx: layer.cell.cx,
  cz: layer.cell.cz,
  cellSize: rt.settings.cellSize,
  world: rt.world,
  isCurrent: () => layer.generation === generation,
  runOwned: (fn) => runInLayerScopes(rt, layer, fn),
});

/**
 * Starts a layer's load: its data units (the scene's JSON content), then the code-registered
 * units of its range. `primes`: hold its content and prime it before it's shown.
 * @internal
 */
export const beginStreamingLayerLoad = (
  rt: StreamingRuntime,
  layer: StreamingLayer,
  primes: boolean
) => {
  layer.generation++;
  layer.phase = 'LOADING';
  const units: StreamingLayerUnit[] = [];
  const dataUnits = rt.dataContent?.(layer.cell.key, layer.range);
  if (dataUnits) {
    for (const { content, waits } of dataUnits) {
      units.push({ content, waits, state: UNIT_PENDING, entityIds: null });
    }
  }
  for (const content of getStreamingCellContent(rt.sceneId, layer.cell.key)) {
    if ((content.loadedAt ?? 'NEAR') !== layer.range) continue;
    units.push({ content, waits: false, state: UNIT_PENDING, entityIds: null });
  }
  layer.units = units;
  layer.nextUnit = 0;
  layer.inFlight = 0;
  layer.loadStartedAt = rt.now();
  layer.primes = primes && rt.primer !== null;
  layer.fadesIn = primes && getFader(rt) !== null;
  layer.ctx = createLayerContext(rt, layer, layer.generation);
  if (units.length) {
    layer.hasUnits = true;
    rt.stats.loadsStarted++;
    changed(rt, layer);
  }
  // An empty layer is shown at once (one notification)
  finishStreamingLayerLoadIfDone(rt, layer);
};

const failUnit = (
  rt: StreamingRuntime,
  layer: StreamingLayer,
  unit: StreamingLayerUnit,
  err: unknown
) => {
  unit.state = UNIT_FAILED;
  rt.stats.unitErrors++;
  lerror(`Streaming: a content load of cell ${layer.cell.cx},${layer.cell.cz} failed.`, err);
};

/** A cancelled load's async unit has settled: the layer's assets go once the last one has. */
const settleLateUnit = (rt: StreamingRuntime, layer: StreamingLayer) => {
  layer.lateUnits--;
  releaseLayerAssetsIfDone(rt, layer);
};

const notIdsError = (value: unknown) =>
  new Error(`its load returned ${typeof value}, not the array of entity ids it created`);

const isPromise = (value: unknown): value is Promise<readonly number[]> =>
  !!value && typeof (value as Promise<unknown>).then === 'function';

/**
 * Whether the layer's next unit has to wait for the units in flight before it.
 * @internal
 */
export const isNextStreamingUnitWaiting = (layer: StreamingLayer) =>
  layer.inFlight > 0 && layer.units[layer.nextUnit].waits;

/**
 * Runs the layer's next unit. Returns the promise of an async one (settled either way), else null.
 * @internal
 */
export const runNextStreamingUnit = (
  rt: StreamingRuntime,
  layer: StreamingLayer
): Promise<void> | null => {
  const unit = layer.units[layer.nextUnit++];
  const ctx = layer.ctx as StreamingCellContext;
  const generation = layer.generation;
  let result: readonly number[] | Promise<readonly number[]>;
  try {
    // What it registers (or gets from the cache) and the bodies it creates before its first
    // await are the layer's
    result = runInLayerScopes(rt, layer, () => unit.content.load(ctx));
  } catch (err) {
    failUnit(rt, layer, unit, err);
    return null;
  }
  if (!isPromise(result)) {
    if (!Array.isArray(result)) {
      failUnit(rt, layer, unit, notIdsError(result));
      return null;
    }
    unit.state = UNIT_DONE;
    unit.entityIds = result.slice();
    finishUnit(rt, layer, unit.entityIds);
    return null;
  }
  unit.state = UNIT_IN_FLIGHT;
  layer.inFlight++;
  return result.then(
    (ids) => {
      const isIds = Array.isArray(ids);
      if (layer.generation !== generation) {
        // Cancelled (or the scene left) meanwhile: what it made goes at once
        unit.state = UNIT_UNLOADED;
        rt.stats.lateResults++;
        if (isIds) unloadUnitContent(rt, unit.content, ids, ctx);
        settleLateUnit(rt, layer);
        return;
      }
      layer.inFlight--;
      if (isIds) {
        unit.state = UNIT_DONE;
        unit.entityIds = ids.slice();
        finishUnit(rt, layer, unit.entityIds);
      } else {
        failUnit(rt, layer, unit, notIdsError(ids));
      }
      finishStreamingLayerLoadIfDone(rt, layer);
    },
    (err: unknown) => {
      failUnit(rt, layer, unit, err);
      if (layer.generation !== generation) {
        settleLateUnit(rt, layer);
        return;
      }
      layer.inFlight--;
      finishStreamingLayerLoadIfDone(rt, layer);
    }
  );
};
