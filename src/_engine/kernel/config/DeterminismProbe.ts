// The determinism probe's arm state (p353 Phase 4 D8): physics' debug probe sets it, and other
// features read it without importing physics (streaming() stops moving its cells while a probe
// is armed, so a probe run streams nothing). Read only behind the debug flags.

let isArmed = false;

/**
 * Sets whether the determinism probe is armed (the probe's own arm and disarm).
 * @internal
 */
export const setDeterminismProbeArmed = (armed: boolean) => {
  isArmed = armed;
};

/**
 * Whether the determinism probe is armed.
 * @internal
 */
export const isDeterminismProbeArmed = () => isArmed;
