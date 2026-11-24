// The Physics API tab's folders: the live readouts (bodies, simulation tiers, the interpolation
// clock) with their refresh, the determinism probe, the snapshot (p500), and the global wireframe
// palette.
import { addDebugToast, type DebuggerPaneItem } from '../../../debug/DebuggerGUI';
import { lsRemoveItem } from '../../../utils/LocalAndSessionStorage';
import { lerror, llog } from '../../../utils/Logger';
import { getECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { getCurrentSceneId, registerOnAllSceneExits } from '../../../kernel/scene/Scene';
import { getPhysicsBodyCapacity } from '../PhysicsBodies';
import { getPhysicsBodyOwner } from '../PhysicsEntity';
import { getPhysicsInterpolationReadout } from '../PhysicsInterpolation';
import { isPhysicsWorldEnabled } from '../PhysicsState';
import { getLastPhysicsBodyActivity } from '../PhysicsStepStats';
import { getPhysicsStepGateStats } from '../PhysicsStepping';
import { restorePhysicsSnapshot, takePhysicsSnapshot } from '../PhysicsWorld';
import {
  getPhysicsTierPolicy,
  getPhysicsTierPolicyFreezeSources,
  getPhysicsTierPolicyStatus,
  isPhysicsTierPolicyFrozen,
  setPhysicsTierPolicyFrozen,
} from '../PhysicsTierPolicy';
import type { PhysicsTierPolicy } from '../PhysicsTierTypes';
import type { RigidBodyAPI } from '../types/PhysicsBodyTypes';
import type { PhysicsState } from '../types/PhysicsConfigTypes';
import type { PhysicsSnapshot, RestoreSnapshotOpts } from '../types/PhysicsWorldTypes';
import {
  DEFAULT_WIREFRAME_POSE_SOURCE,
  getWireframeColorDefault,
  getWireframeLineThicknessDefault,
  setGlobalWireframeColor,
  setGlobalWireframeLineThickness,
  setWireframePoseSource,
  WIREFRAME_COLOR_STATES,
  type WireframeColorState,
  type WireframePoseSource,
} from './_dbg__PhysicsDebugDraw';
import {
  armPhysicsDeterminismProbe,
  disarmPhysicsDeterminismProbe,
  getPhysicsDeterminismProbeSteps,
} from './_dbg__PhysicsDeterminism';
import {
  PHYSICS_WIREFRAME_LS_KEY,
  WIREFRAME_STATE_LABELS,
  persistWireframeState,
  refreshPhysicsTab,
} from './_dbg__PhysicsDebugState';

/** The objects the global wireframe fields bind, mirroring the draw module's values */
export type WireframeProxies = {
  colors: Record<WireframeColorState, number>;
  thickness: { lineThickness: number };
  pose: { poseSource: WireframePoseSource };
};

/**
 * "Wireframe" folder: the global palette every per-entity collider wireframe falls back
 * to. Visibility itself is never global — it's toggled per entity (edit window or list).
 * The live values are mirrored into plain proxies the fields bind; each onChange writes through
 * to the draw module and persists (to its own module-owned key).
 */
export const getWireframeFolder = (proxies: WireframeProxies): DebuggerPaneItem<PhysicsState> => {
  const { colors, thickness, pose } = proxies;
  const items: DebuggerPaneItem<PhysicsState>[] = [];
  for (const state of WIREFRAME_COLOR_STATES) {
    items.push(
      {
        key: state,
        target: colors,
        label: WIREFRAME_STATE_LABELS[state],
        kind: 'color',
        onChange: (value) => {
          setGlobalWireframeColor(state, Number(value));
          persistWireframeState();
        },
      },
      // A bare "Reset" directly under its own picker, matching the Sky box tab's pattern.
      {
        type: 'button',
        title: 'Reset',
        onClick: () => {
          setGlobalWireframeColor(state, undefined);
          colors[state] = getWireframeColorDefault(state);
          persistWireframeState();
          refreshPhysicsTab();
        },
      }
    );
  }
  items.push(
    { type: 'separator' },
    {
      key: 'lineThickness',
      target: thickness,
      label: 'Line thickness (px)',
      min: 1,
      max: 10,
      step: 1,
      onChange: (value) => {
        setGlobalWireframeLineThickness(Number(value));
        persistWireframeState();
      },
    },
    {
      type: 'button',
      title: 'Reset',
      onClick: () => {
        setGlobalWireframeLineThickness(undefined);
        thickness.lineThickness = getWireframeLineThicknessDefault();
        persistWireframeState();
        refreshPhysicsTab();
      },
    },
    {
      type: 'button',
      title: 'Reset all wireframe settings',
      onClick: () => {
        for (const state of WIREFRAME_COLOR_STATES) {
          setGlobalWireframeColor(state, undefined);
          colors[state] = getWireframeColorDefault(state);
        }
        setGlobalWireframeLineThickness(undefined);
        thickness.lineThickness = getWireframeLineThicknessDefault();
        setWireframePoseSource(undefined);
        pose.poseSource = DEFAULT_WIREFRAME_POSE_SOURCE;
        lsRemoveItem(PHYSICS_WIREFRAME_LS_KEY);
        refreshPhysicsTab();
      },
    }
  );
  return { type: 'folder', id: 'wireframe', title: 'Wireframe', expanded: false, content: items };
};

/** Arms/disarms the determinism probe (_dbg__PhysicsDeterminism.ts). Results go to the console. */
export const getDeterminismProbeFolder = (): DebuggerPaneItem<PhysicsState> => {
  const probeState = { steps: getPhysicsDeterminismProbeSteps() ?? 300 };
  return {
    type: 'folder',
    id: 'determinismProbe',
    title: 'Determinism probe',
    expanded: false,
    content: [
      { key: 'steps', target: probeState, label: 'Steps (N)', step: 1, min: 1 },
      {
        type: 'button',
        title: 'Probe N steps (from now, then on every scene enter)',
        onClick: () => armPhysicsDeterminismProbe(probeState.steps),
      },
      {
        type: 'button',
        title: 'Stop probe (resumes physics)',
        onClick: () => disarmPhysicsDeterminismProbe(),
      },
    ],
  };
};

/** The snapshot the "Snapshot" folder holds (one at a time), and the scene it was taken in */
let heldSnapshot: { snapshot: PhysicsSnapshot; sceneId: string } | null = null;
/** A take or restore in flight (a worker round trip): the buttons wait for it */
let isSnapshotBusy = false;

/** The "Snapshot" folder's values, written by its buttons (readonly bindings poll them) */
const snapshotReadout = {
  size: '-',
  step: '-',
  sceneId: '-',
  takeMs: '-',
  restoreMs: '-',
  reaped: '-',
  orphans: '-',
};
const snapshotOptions: Required<RestoreSnapshotOpts> = { orphanPolicy: 'DELETE' };

const formatDuration = (ms: number) => `${ms.toFixed(2)} ms`;

const syncHeldSnapshotReadout = () => {
  const held = heldSnapshot;
  snapshotReadout.size = held ? `${(held.snapshot.bytes.byteLength / 1024).toFixed(1)} kB` : '-';
  snapshotReadout.step = held ? String(held.snapshot.step) : '-';
  snapshotReadout.sceneId = held?.sceneId ?? '-';
};

const clearHeldSnapshot = () => {
  heldSnapshot = null;
  syncHeldSnapshotReadout();
};

// A scene load replaces the world, and a restore refuses another world's snapshot
registerOnAllSceneExits('physicsDebugSnapshot', clearHeldSnapshot);

/** Runs a take or restore, one at a time; a failure goes to the console and a toast */
const runSnapshotAction = async (failure: string, action: () => Promise<void>) => {
  if (isSnapshotBusy) return;
  isSnapshotBusy = true;
  refreshPhysicsTab();
  try {
    await action();
  } catch (err) {
    lerror(`[PhysicsSnapshot] ${failure}:`, err);
    addDebugToast({
      type: 'alert',
      title: failure,
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    isSnapshotBusy = false;
    refreshPhysicsTab();
  }
};

const takeHeldSnapshot = () =>
  runSnapshotAction('Could not take a snapshot', async () => {
    const start = performance.now();
    const snapshot = await takePhysicsSnapshot();
    snapshotReadout.takeMs = formatDuration(performance.now() - start);
    if (!snapshot) throw new Error('The backend has no world to take a snapshot of.');
    heldSnapshot = { snapshot, sceneId: getCurrentSceneId() ?? '-' };
    syncHeldSnapshotReadout();
  });

const restoreHeldSnapshot = () =>
  runSnapshotAction('Could not restore the snapshot', async () => {
    if (!heldSnapshot) return;
    const start = performance.now();
    const { world: _world, ...delta } = await restorePhysicsSnapshot(heldSnapshot.snapshot, {
      ...snapshotOptions,
    });
    snapshotReadout.restoreMs = formatDuration(performance.now() - start);
    const { reapedRigidBodyIds, reapedColliderIds, reapedJointIds, orphanCounts } = delta;
    snapshotReadout.reaped = `${reapedRigidBodyIds.length} bodies, ${reapedColliderIds.length} colliders, ${reapedJointIds.length} joints`;
    snapshotReadout.orphans = `${orphanCounts.rigidBodies} bodies, ${orphanCounts.colliders} colliders, ${orphanCounts.joints} joints`;
    llog(`[PhysicsSnapshot] restored step ${delta.step}:`, delta);
  });

/** Takes, restores and clears one held snapshot of the world (p500), with its size and step, the
 * take's and the last restore's time (on WORKER_THREAD the round trip), and what the last restore
 * reaped (made since the snapshot: deleted with their entities) and found orphaned (deleted
 * since). The restore's whole delta goes to the console. Dropped on every scene exit. */
export const getSnapshotFolder = (): DebuggerPaneItem<PhysicsState> => {
  const monitor = (key: keyof typeof snapshotReadout, label: string) =>
    ({ key, target: snapshotReadout, label, readonly: true }) as DebuggerPaneItem<PhysicsState>;
  return {
    type: 'folder',
    id: 'snapshot',
    title: 'Snapshot',
    expanded: false,
    content: [
      {
        type: 'button',
        title: 'Take snapshot',
        disabled: () => isSnapshotBusy || !isPhysicsWorldEnabled(),
        onClick: () => void takeHeldSnapshot(),
      },
      {
        type: 'button',
        title: 'Restore snapshot',
        disabled: () => isSnapshotBusy || !heldSnapshot,
        onClick: () => void restoreHeldSnapshot(),
      },
      {
        type: 'button',
        title: 'Clear snapshot',
        disabled: () => isSnapshotBusy || !heldSnapshot,
        onClick: () => {
          clearHeldSnapshot();
          refreshPhysicsTab();
        },
      },
      {
        key: 'orphanPolicy',
        target: snapshotOptions,
        label: 'Orphans (deleted since the snapshot)',
        options: [
          { value: 'DELETE', text: 'Take out of the restored world' },
          { value: 'KEEP', text: 'Keep (unreachable through the API)' },
        ],
      },
      { type: 'separator' },
      monitor('size', 'Size'),
      monitor('step', 'Step'),
      monitor('sceneId', 'Scene'),
      monitor('takeMs', 'Take time'),
      { type: 'separator' },
      monitor('restoreMs', 'Last restore time'),
      monitor('reaped', 'Last restore reaped'),
      monitor('orphans', 'Last restore orphans'),
    ],
  };
};

/** Live render-clock values (updated by physicsInterpolationSystem, frozen in 'NONE') — the
 * jitter margin and servo can't be tuned without them. Readonly bindings poll. */
export const getInterpolationClockFolder = (): DebuggerPaneItem<PhysicsState> => {
  const readout = getPhysicsInterpolationReadout(getECSWorld());
  const formatMs = (v: number) => v.toFixed(2);
  const monitor = (key: string, label: string, format = formatMs) =>
    ({ key, target: readout, label, readonly: true, format }) as DebuggerPaneItem<PhysicsState>;
  return {
    type: 'folder',
    id: 'interpolationClock',
    title: 'Interpolation clock (live, simulated ms)',
    expanded: false,
    content: [
      monitor('lagMs', 'Lag behind the stepper'),
      monitor('delayMs', 'Delay D (max recent interval)'),
      monitor('intervalMs', 'Last snapshot interval'),
      monitor('errorMs', 'Servo error (RENDERER)'),
      monitor('rate', 'Clock rate', (v: number) => v.toFixed(3)),
      monitor('resets', 'Clock re-anchors', (v: number) => v.toFixed(0)),
    ],
  };
};

/** The "Bodies" folder's values, synced by the tab's onRefresh (readonly bindings poll it). */
const bodiesReadout = { slots: '', refused: 0, activity: '' };

const refreshBodiesReadout = () => {
  const capacity = getPhysicsBodyCapacity();
  bodiesReadout.slots = capacity ? `${capacity.used} / ${capacity.max}` : 'N/A, worker only';
  bodiesReadout.refused = capacity?.refused ?? 0;
  const activity = getLastPhysicsBodyActivity();
  bodiesReadout.activity = activity
    ? `${activity.awake} awake, ${activity.sleeping} sleeping`
    : 'Measured with the step time';
};

/** Transform-buffer slots and refused creates (p352: FIXED bodies take no slot, a full buffer
 * refuses a create), and how many dynamic bodies sleep (with the step stats on). */
export const getBodiesFolder = (): DebuggerPaneItem<PhysicsState> => ({
  type: 'folder',
  id: 'bodies',
  title: 'Bodies (live)',
  expanded: false,
  content: [
    { key: 'slots', target: bodiesReadout, label: 'Slots used / max bodies', readonly: true },
    {
      key: 'refused',
      target: bodiesReadout,
      label: 'Refused creates (buffer full)',
      readonly: true,
      format: (v: number) => v.toFixed(0),
    },
    { key: 'activity', target: bodiesReadout, label: 'Dynamic bodies', readonly: true },
  ] as DebuggerPaneItem<PhysicsState>[],
});

/** The tab's own freeze of the tier policy (the determinism probe has another), session only:
 * a freeze restored by a reload would read as the policy being broken. */
const TIER_POLICY_FREEZE_SOURCE = 'DEBUG_TAB';

/** The "Simulation tiers" folder's values, synced by the tab's onRefresh. */
const tiersReadout = {
  FULL: 0,
  STATIC: 0,
  DISABLED: 0,
  REMOVED: 0,
  pending: 0,
  inFlight: 0,
  policy: '',
  policyState: '',
  lastMeasuredStep: '',
  pendingMeasurements: 0,
  gateWaits: '',
};
const tierPolicyProxy = { frozen: false };

const formatTierPolicy = (policy: Readonly<PhysicsTierPolicy>) =>
  policy.rings
    .map(({ tier, within }) => (within === undefined ? `${tier} beyond` : `${tier} ≤ ${within}`))
    .join(', ');

/** Per-tier counts of the default world's entities that can have a tier: a DYNAMIC
 * createPhysicsEntity body, not a character. One never given a tier is FULL. */
const refreshTiersReadout = () => {
  const world = getECSWorld();
  tiersReadout.FULL = tiersReadout.STATIC = tiersReadout.DISABLED = tiersReadout.REMOVED = 0;
  tiersReadout.pending = tiersReadout.inFlight = 0;
  const tierStorage = world.getStorage(ComponentType.PHYSICS_SIM_TIER);
  for (const [, data] of tierStorage) {
    tiersReadout[data.tier]++;
    if (data.target !== data.tier) tiersReadout.pending++;
    if (data.inFlight) tiersReadout.inFlight++;
  }
  const countNeverTiered = (bodies: Iterable<[number, RigidBodyAPI]>) => {
    for (const [entityId, rb] of bodies) {
      if (tierStorage.has(entityId)) continue;
      if (world.hasComponent(entityId, ComponentType.TAG_IS_CHARACTER)) continue;
      const owner = getPhysicsBodyOwner(rb.id);
      if (owner?.entityId === entityId && owner.rigidType === 'DYNAMIC') tiersReadout.FULL++;
    }
  };
  countNeverTiered(world.getStorage(ComponentType.BODY_DYNAMIC_VISUAL));
  countNeverTiered(world.getStorage(ComponentType.BODY_DYNAMIC_HEADLESS));

  const policy = getPhysicsTierPolicy(world);
  tiersReadout.policy = policy ? formatTierPolicy(policy) : 'None (setPhysicsTierPolicy)';
  const status = getPhysicsTierPolicyStatus(world);
  const freezeSources = getPhysicsTierPolicyFreezeSources(world);
  const cadence = status
    ? `${status.cadence}, every ${status.interval} ${status.cadence === 'STEPS' ? 'steps' : 'frames'}`
    : '';
  tiersReadout.policyState = !status
    ? '-'
    : freezeSources.length
      ? `${cadence}, frozen by ${freezeSources.join(', ')}`
      : `${cadence}, running`;
  const isSteps = status?.cadence === 'STEPS';
  tiersReadout.lastMeasuredStep = !isSteps
    ? '-'
    : status.lastMeasuredStep < 0
      ? 'None yet'
      : String(status.lastMeasuredStep);
  tiersReadout.pendingMeasurements = isSteps ? status.pendingMeasurements : 0;
  // Stepping held for a measurement's reply (WORKER_THREAD); the policy is the gates' only user
  const gates = getPhysicsStepGateStats();
  tiersReadout.gateWaits = `${gates.waits} (${Math.round(gates.heldMs)} ms)`;
  tierPolicyProxy.frozen = isPhysicsTierPolicyFrozen(world, TIER_POLICY_FREEZE_SOURCE);
};

/** p352's simulation tiers: per-tier counts, transitions waiting for their step (pending) or
 * for the worker's reply (in flight, WORKER_THREAD), and the default world's distance policy
 * with a freeze toggle. */
export const getTiersFolder = (): DebuggerPaneItem<PhysicsState> => {
  const count = (key: keyof typeof tiersReadout, label: string) => ({
    key,
    target: tiersReadout,
    label,
    readonly: true,
    format: (v: number) => v.toFixed(0),
  });
  return {
    type: 'folder',
    id: 'simulationTiers',
    title: 'Simulation tiers (live)',
    expanded: false,
    content: [
      count('FULL', 'FULL (incl. never tiered)'),
      count('STATIC', 'STATIC'),
      count('DISABLED', 'DISABLED'),
      count('REMOVED', 'REMOVED'),
      count('pending', 'Pending (next step)'),
      count('inFlight', 'In flight (worker reply)'),
      { type: 'separator' },
      {
        key: 'policy',
        target: tiersReadout,
        label: 'Tier policy rings',
        readonly: true,
        multiline: true,
        rows: 2,
      },
      { key: 'policyState', target: tiersReadout, label: 'Tier policy', readonly: true },
      {
        key: 'lastMeasuredStep',
        target: tiersReadout,
        label: 'Last measured step (STEPS)',
        readonly: true,
      },
      count('pendingMeasurements', 'Measurements waiting for their step'),
      { key: 'gateWaits', target: tiersReadout, label: 'Step gate waits', readonly: true },
      {
        key: 'frozen',
        target: tierPolicyProxy,
        label: 'Freeze tier policy',
        onChange: (value) => {
          setPhysicsTierPolicyFrozen(Boolean(value), TIER_POLICY_FREEZE_SOURCE, getECSWorld());
          refreshTiersReadout();
        },
      },
    ] as DebuggerPaneItem<PhysicsState>[],
  };
};

/** Syncs the live folders' values: the tab's `onRefresh` */
export const refreshPhysicsReadouts = () => {
  refreshBodiesReadout();
  refreshTiersReadout();
};
