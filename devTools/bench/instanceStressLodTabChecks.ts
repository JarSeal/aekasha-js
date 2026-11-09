// The pure parts of the LOD tab check (instanceStressLodTab.ts, p354 Phase 2 step 3): its
// checkpoints, and their comparison between the two paths.

/** An instance state count, as `instanceStress`' `measure()` reports it (a fading instance in
 * both its levels) */
export type CheckpointState = { levels: number[]; fading: number };

/** A checkpoint of the script: what the LOD tab was set to, and what it should show */
export type CheckpointId =
  | 'settled'
  | 'heldAt0'
  | 'heldAtHalf'
  | 'forcedLevel1'
  | 'forceOff'
  | 'frozenOrbit';

/** Each checkpoint's line in the report, in the script's order */
export const CHECKPOINTS: { id: CheckpointId; title: string }[] = [
  { id: 'settled', title: 'Settled (still camera, the tab untouched)' },
  { id: 'heldAt0', title: 'Time scale 0, then Force level 1: every fade held at 0' },
  { id: 'heldAtHalf', title: 'Time scale 0.1 for 75 frames, then 0: every fade held at 0.5' },
  { id: 'forcedLevel1', title: 'Time scale 1: the fades end, every instance at level 1' },
  { id: 'forceOff', title: 'Force level Off: the selection again (from level 1: its hysteresis)' },
  { id: 'frozenOrbit', title: 'Freeze, then 120 frames of the orbit: the levels hold' },
];

/** The checkpoints' states, by checkpoint (a missing one: the script stopped before it) */
export type CheckpointStates = Partial<Record<CheckpointId, CheckpointState>>;

const formatState = (state: CheckpointState | undefined) =>
  state
    ? `${state.levels.map((n) => n.toLocaleString('en-US')).join(' / ')}, ${state.fading.toLocaleString('en-US')} fading`
    : '—';

const isSameState = (a: CheckpointState, b: CheckpointState) =>
  a.fading === b.fading &&
  a.levels.length === b.levels.length &&
  a.levels.every((n, i) => n === b.levels[i]);

/**
 * Compares the two paths checkpoint by checkpoint, and each against what the tab's setting means:
 * the same state on both paths at every checkpoint, every instance at level 1 and none fading once
 * forced, and the levels from before the freeze kept by it.
 * @returns the problems, empty when everything holds
 */
export const findCheckpointProblems = (pools: CheckpointStates, set: CheckpointStates) => {
  const problems: string[] = [];
  for (const { id } of CHECKPOINTS) {
    const a = pools[id];
    const b = set[id];
    if (!a || !b) {
      problems.push(`${id}: not reached on the ${a ? 'set' : 'pools'} path`);
      continue;
    }
    if (!isSameState(a, b)) {
      problems.push(`${id}: the pools ${formatState(a)}, the set ${formatState(b)}`);
    }
  }
  for (const [name, states] of [
    ['pools', pools],
    ['set', set],
  ] as const) {
    const forced = states.forcedLevel1;
    if (forced) {
      const total = forced.levels.reduce((sum, n) => sum + n, 0);
      if (forced.fading !== 0 || forced.levels[1] !== total) {
        problems.push(
          `forcedLevel1 (${name}): not every instance at level 1 (${formatState(forced)})`
        );
      }
    }
    // The freeze keeps the levels it was switched on with. Force off isn't the settled state:
    // coming from level 1, the hysteresis keeps level 1 where level 2's band is within it
    const beforeFreeze = states.forceOff;
    const frozen = states.frozenOrbit;
    if (beforeFreeze && frozen && !isSameState(beforeFreeze, frozen)) {
      problems.push(
        `frozenOrbit (${name}): ${formatState(frozen)}, before the freeze ${formatState(beforeFreeze)}`
      );
    }
    const held = states.heldAt0;
    if (held && held.fading === 0) problems.push(`heldAt0 (${name}): nothing fading`);
  }
  return problems;
};

/** The report's table: a checkpoint per row, both paths' states */
export const formatCheckpointTable = (pools: CheckpointStates, set: CheckpointStates) => [
  '| Checkpoint | Pools: per level, fading | Set: per level, fading |',
  '| --- | --- | --- |',
  ...CHECKPOINTS.map(
    ({ id, title }) => `| ${title} | ${formatState(pools[id])} | ${formatState(set[id])} |`
  ),
];
