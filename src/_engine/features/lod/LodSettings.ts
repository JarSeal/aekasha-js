// The LOD selection's settings (docs/plans/_DONE_p348_ecs-lod-selection.md): the global fade
// seconds, bias and selection budget (each initially from `AppConfig.lod`), the debug overrides
// and the per-world frame stats. LodSystem.ts, LodMeasure.ts and LodFades.ts read them.
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { getConfig } from '../../kernel/config/Config';
import { lwarn } from '../../utils/Logger';

// --- FADES ---

let globalFadeSeconds: number | undefined;

/** How long a LOD change cross-fades, in seconds, for LODs without their own `fadeSeconds`. */
export const getLodFadeSeconds = () => (globalFadeSeconds ??= getConfig().lod?.fadeSeconds ?? 0.25);

/**
 * Sets how long a LOD change (or hiding and showing) cross-fades, in seconds, for LODs without
 * their own `fadeSeconds` (initially `AppConfig.lod.fadeSeconds`); 0 switches at once. Fades
 * already running take the new duration from the next frame.
 */
export const setLodFadeSeconds = (seconds: number) => {
  globalFadeSeconds = Math.max(seconds, 0);
};

// --- GLOBAL BIAS ---

let globalBias: number | undefined;

/** The global LOD bias: multiplies every entity's screen size, >1 keeps detail longer. */
export const getLodBias = () => (globalBias ??= getConfig().lod?.bias ?? 1);

/** Sets the global LOD bias (initially `AppConfig.lod.bias`). Takes effect at the next selection. */
export const setLodBias = (bias: number) => {
  globalBias = bias;
};

// --- SELECTION BUDGET ---

let maxSelectionsPerFrame: number | undefined;

/** Infinity (no cap) or a whole number ≥ 1. Anything else warns and means no cap. */
const normalizeMaxSelections = (max: number | undefined) => {
  if (max === undefined || max === Infinity) return Infinity;
  if (!(max >= 1)) {
    lwarn(`[LOD] maxSelectionsPerFrame must be ≥ 1 or Infinity, got ${max}: no cap.`);
    return Infinity;
  }
  return Math.floor(max);
};

/** How many entities the selection reconsiders per frame and world (Infinity = all of them). */
export const getLodMaxSelectionsPerFrame = () =>
  (maxSelectionsPerFrame ??= normalizeMaxSelections(getConfig().lod?.maxSelectionsPerFrame));

/**
 * Caps the entities the selection reconsiders per frame and world (initially
 * `AppConfig.lod.maxSelectionsPerFrame`, Infinity = no cap). With a cap, the selection walks the
 * `LOD` entities round-robin from where it stopped, so each one is reconsidered every few frames.
 * Entities that come into view (frustum culling, DISABLED removed) or just got their `LOD` are
 * selected in that frame even past the cap, so none shows a stale level; they count against it.
 * @param max at least 1, or Infinity; anything else warns and removes the cap
 * @example
 * ```ts
 * import { setLodMaxSelectionsPerFrame } from 'aekasha/lod';
 *
 * // A large world: each LOD entity is reconsidered about every 4th frame
 * setLodMaxSelectionsPerFrame(1000);
 * ```
 */
export const setLodMaxSelectionsPerFrame = (max: number) => {
  maxSelectionsPerFrame = normalizeMaxSelections(max);
};

// --- DEBUG CONTROLS AND STATS ---

/**
 * Overrides of the selection and the fades, for inspecting levels (the LOD debug tab). Every
 * world.
 * @internal
 */
export type LodDebugOptions = {
  /** Stops selecting: every entity keeps its level and LOD-culled state. */
  freeze: boolean;
  /** -1 = off. Otherwise every entity shows this level (or its last, when it has fewer) and none
   * is LOD-culled. Wins over `freeze`. */
  forceLevel: number;
  /** Selects against the active camera (eg. the debug camera) instead of the main camera. */
  useActiveCamera: boolean;
  /** Multiplies the time cross-fades advance by: 1 = real time, below 1 slow motion (for judging
   * the dither), 0 holds every running fade. */
  fadeTimeScale: number;
};

const debugOptions: LodDebugOptions = {
  freeze: false,
  forceLevel: -1,
  useActiveCamera: false,
  fadeTimeScale: 1,
};

/**
 * The selection's debug overrides ({@link LodDebugOptions}), for the LOD systems, the LOD debug
 * tab and its entity windows.
 * @internal
 */
export const getLodDebugOptions = (): Readonly<LodDebugOptions> => debugOptions;

/**
 * Changes the selection's debug overrides ({@link LodDebugOptions}), from the next frame.
 * For the LOD debug tab.
 * @internal
 */
export const setLodDebugOptions = (opts: Partial<LodDebugOptions>) => {
  Object.assign(debugOptions, opts);
};

/** What the LOD systems did in a world's last frame. */
export type LodFrameStats = {
  /** Entities whose level was (re)selected. */
  selections: number;
  /** Frames the last full walk over the `LOD` entities took: 1 without a selection budget
   * (setLodMaxSelectionsPerFrame), else how many frames an entity in view can keep a stale level. */
  lapFrames: number;
  /** Level swaps applied. */
  applies: number;
  /** Level swaps applied since the start. */
  totalApplies: number;
  /** lodSelectionSystem's duration. Measured in the debug environment only (else 0). */
  selectionMs: number;
  /** Entities cross-fading (TAG_LOD_TRANSITIONING) after lodFadeSystem. */
  fading: number;
  /** lodFadeSystem's duration. Measured in the debug environment only (else 0). */
  fadeMs: number;
};

const frameStats = new WeakMap<ECSWorld, LodFrameStats>();

/**
 * The world's frame stats, created on first use, for the LOD systems to write.
 * @internal
 */
export const getWritableLodFrameStats = (world: ECSWorld) => {
  let stats = frameStats.get(world);
  if (!stats) {
    stats = {
      selections: 0,
      lapFrames: 1,
      applies: 0,
      totalApplies: 0,
      selectionMs: 0,
      fading: 0,
      fadeMs: 0,
    };
    frameStats.set(world, stats);
  }
  return stats;
};

/** What the LOD systems did in the world's last frame. */
export const getLodFrameStats = (world: ECSWorld): Readonly<LodFrameStats> =>
  getWritableLodFrameStats(world);
