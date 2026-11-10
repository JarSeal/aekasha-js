// The LOD rules on plain numbers (docs/plans/_DONE_p354_gpu-driven-culling.md D3): the level
// selection with its hysteresis, the cull test, and a cross-fade's start and step. Pure, so it's in
// utils/: the ECS path (features/lod/LodSystem.ts, LodFades.ts) calls it, and so do the instance
// sets (features/instancing/), which import no LOD code. The GPU backend's TSL ports these
// functions line by line (Node can't run TSL: its parity with the pool is checked in the browser,
// by instanceStress's readback), so a change of a rule here changes the port too.
//
// A selection measures a screen size `s` (the bounding sphere's diameter over the viewport height,
// both biases included) and turns it into a level, or culled. An instance's state is its level,
// the level it fades out of and the fade's progress (stepLodInstanceState); the ECS path keeps the
// same state in its components (`LodData`, TAG_LOD_CULLED, TAG_LOD_TRANSITIONING).

/** A `LodDef`'s `hysteresis` when it has none. */
export const DEFAULT_LOD_HYSTERESIS = 0.1;

/**
 * A fade ends once its progress reaches 1 − this, on every path: a 0.25 s fade at a fixed 1/60 s
 * then lasts 15 frames, where the plain `≥ 1` took 16 in f64 (15 steps of 1/15 sum to just under
 * 1) and 15 in a shader's f32 (p354 Phase 0).
 * @internal
 */
export const LOD_FADE_END_EPSILON = 1e-5;

/**
 * A level that isn't one: not selected yet (an instance's level), or no fade running (the level
 * it fades out of). `LodData.level`'s -1.
 * @internal
 */
export const LOD_LEVEL_NONE = -1;

/**
 * Beyond the last level: hidden at `cullScreenSize` (the ECS path's TAG_LOD_CULLED).
 * @internal
 */
export const LOD_LEVEL_CULLED = -2;

/**
 * The level for screen size `s`, coming from level `current` (-1, `LOD_LEVEL_NONE`: a first
 * selection, which takes no hysteresis). The finest level whose `screenSize` `s` reaches (below
 * all of them, the last level). A move to a finer level happens at its `screenSize`; a move to a
 * coarser one only once `s` is below the current level's `screenSize` × (1 − `h`).
 * @internal
 * @param levels level 0 first, `screenSize` descending (the last one's isn't read)
 * @param h the hysteresis
 */
export const selectLodLevel = (
  levels: ArrayLike<{ screenSize: number }>,
  s: number,
  current: number,
  h: number
) => {
  const last = levels.length - 1;
  let raw = last;
  for (let i = 0; i < last; i++) {
    if (s >= levels[i].screenSize) {
      raw = i;
      break;
    }
  }
  if (current < 0 || raw <= current) return raw;
  const f = 1 - h;
  for (let i = current; i < last; i++) {
    if (s >= levels[i].screenSize * f) return i;
  }
  return last;
};

/**
 * Whether screen size `s` is culled: below `cullScreenSize` × (1 − `h`) for a shown instance, and
 * below `cullScreenSize` itself for a culled one (it comes back at the threshold). Never without a
 * `cullScreenSize`.
 * @internal
 * @param cullScreenSize the definition's, 0 for none
 * @param h the hysteresis
 * @param isCulled whether it's culled now
 */
export const isLodCulledAt = (s: number, cullScreenSize: number, h: number, isCulled: boolean) =>
  cullScreenSize > 0 && s < (isCulled ? cullScreenSize : cullScreenSize * (1 - h));

/**
 * The selection: the level for screen size `s`, or `LOD_LEVEL_CULLED`, coming from
 * `current` (a level, `LOD_LEVEL_NONE` or `LOD_LEVEL_CULLED`). Coming back from
 * culled, it comes from beyond the last level, so it takes the coarser levels' hysteresis.
 * @internal
 * @param levels level 0 first, `screenSize` descending
 * @param cullScreenSize the definition's, 0 for none
 * @param h the hysteresis
 */
export const selectLodTarget = (
  levels: ArrayLike<{ screenSize: number }>,
  s: number,
  current: number,
  cullScreenSize: number,
  h: number
) => {
  const isCulled = current === LOD_LEVEL_CULLED;
  if (isLodCulledAt(s, cullScreenSize, h, isCulled)) return LOD_LEVEL_CULLED;
  return selectLodLevel(levels, s, isCulled ? levels.length - 1 : current, h);
};

/**
 * Whether a change of what's shown fades: only once something was shown (a first selection never
 * fades, but showing what was culled since its first selection does) and with fade seconds.
 * @internal
 * @param hasShown whether a selection was made before (culled counts)
 */
export const isLodChangeFaded = (hasShown: boolean, fadeSeconds: number) =>
  hasShown && fadeSeconds > 0;

/**
 * The progress a fade advances by in a frame: its step (the frame's seconds, times the
 * `fadeTimeScale` debug option) over the fade's seconds. 1, which ends a fade, without seconds.
 * @internal
 */
export const getLodFadeDelta = (step: number, fadeSeconds: number) =>
  fadeSeconds > 0 ? step / fadeSeconds : 1;

/**
 * A fade's progress after a frame's `delta` (`getLodFadeDelta`): exactly 1 once the fade
 * has ended, at 1 − `LOD_FADE_END_EPSILON`.
 * @internal
 */
export const advanceLodFade = (progress: number, delta: number) => {
  const next = progress + delta;
  return next >= 1 - LOD_FADE_END_EPSILON ? 1 : next;
};

/**
 * An instance's LOD state, what `stepLodInstanceState` moves.
 * @internal
 */
export type LodInstanceState = {
  /** The selected level, `LOD_LEVEL_NONE` before the first selection, or
   * `LOD_LEVEL_CULLED`. */
  level: number;
  /** The level it fades out of (`LOD_LEVEL_CULLED` when fading in), `LOD_LEVEL_NONE`
   * when no fade runs. */
  outgoing: number;
  /** The running fade's progress, in [0, 1); 1 when none runs. The incoming copy draws at it, the
   * outgoing one at it − 1 (`kernel/render/LodFade.ts`). */
  progress: number;
};

/**
 * A frame of an instance's LOD state, in place: the selection's `target` (`selectLodTarget`),
 * then the fade's advance. A change starts a fade from the level shown until now (unless
 * `isLodChangeFaded` says no), ending a running one; the advance runs in the same frame, so
 * a new fade draws its first frame at one step. The order and the rules are the ECS path's
 * (`lodSelectionSystem`, `lodApplySystem`, then `lodFadeSystem`).
 * @internal
 * @param state written in place
 * @param target this frame's level, or `LOD_LEVEL_CULLED`
 * @param step the frame's seconds, times the `fadeTimeScale` debug option (0 holds the fades)
 * @returns whether the state changed (a change, or a fade's advance)
 */
export const stepLodInstanceState = (
  state: LodInstanceState,
  target: number,
  fadeSeconds: number,
  step: number
) => {
  let isChanged = false;
  if (target !== state.level) {
    const isFaded = isLodChangeFaded(state.level !== LOD_LEVEL_NONE, fadeSeconds);
    state.outgoing = isFaded ? state.level : LOD_LEVEL_NONE;
    state.progress = isFaded ? 0 : 1;
    state.level = target;
    isChanged = true;
  }
  if (state.outgoing !== LOD_LEVEL_NONE) {
    state.progress = advanceLodFade(state.progress, getLodFadeDelta(step, fadeSeconds));
    if (state.progress >= 1) state.outgoing = LOD_LEVEL_NONE;
    isChanged = true;
  }
  return isChanged;
};
