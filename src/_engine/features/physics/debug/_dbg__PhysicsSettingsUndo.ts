// The Physics API tab's world settings on the global undo / redo history (the physics world and
// its settings are shared by every scene): gravity and the solver's iterations, their handlers
// registered at this module's load.
import { persistDebuggerTabValue, updateDebuggerTab } from '../../../debug/DebuggerGUI';
import {
  _recordOrCoalesceUndoRedoAction,
  _registerUndoRedoActionHandler,
} from '../../../debug/_dbg__UndoRedo';
import { getPhysicsState, getPhysicsWorld, isPhysicsWorldEnabled } from '../PhysicsState';
import type { PhysicsState } from '../types/PhysicsConfigTypes';
import {
  PHYSICS_TAB_ID,
  getAllPhysicsEntityIds,
  getPhysicsEntityRigidBody,
} from './_dbg__PhysicsDebugState';

type UndoableSetting = 'gravity' | 'solverIterations' | 'internalPgsIterations';
type SettingValues = Pick<PhysicsState, UndoableSetting>;
type SettingUndoPayload<K extends UndoableSetting> = {
  prev: SettingValues[K];
  next: SettingValues[K];
};

const UNDOABLE_SETTING_LABELS: Record<UndoableSetting, string> = {
  gravity: 'Physics: gravity',
  solverIterations: 'Physics: solver iterations',
  internalPgsIterations: 'Physics: internal PGS iterations',
};

/** Pushes a setting from the state into the running world. */
export const applySettingToWorld: Record<UndoableSetting, (state: PhysicsState) => void> = {
  gravity: (state) => {
    if (!isPhysicsWorldEnabled()) return;
    getPhysicsWorld().setGravity(state.gravity);
    // Sleeping bodies don't re-evaluate forces until woken, so they'd keep ignoring
    // the new gravity value until something else disturbs them.
    for (const entityId of getAllPhysicsEntityIds()) {
      getPhysicsEntityRigidBody(entityId)?.wakeUp();
    }
  },
  solverIterations: (state) => {
    if (isPhysicsWorldEnabled()) getPhysicsWorld().setNumSolverIterations(state.solverIterations);
  },
  internalPgsIterations: (state) => {
    if (isPhysicsWorldEnabled()) {
      getPhysicsWorld().setNumInternalPgsIterations(state.internalPgsIterations);
    }
  },
};

/** The vector field writes the bound gravity object in place, so the state and the history
 * payloads must never share one. */
export const copySetting = <T>(value: T): T => structuredClone(value);

/** Records a finished or in-progress change; the ticks of one drag merge into one entry
 * (the first `prev`, the latest `next`). */
export const recordSettingChange = <K extends UndoableSetting>(
  key: K,
  prev: SettingValues[K],
  next: SettingValues[K]
) => {
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  const payload: SettingUndoPayload<K> = { prev: copySetting(prev), next: copySetting(next) };
  _recordOrCoalesceUndoRedoAction(`physics.${key}`, UNDOABLE_SETTING_LABELS[key], payload, key);
};

const setSetting = <K extends UndoableSetting>(key: K, value: SettingValues[K]) => {
  const state = getPhysicsState();
  (state as SettingValues)[key] = copySetting(value);
  persistDebuggerTabValue(PHYSICS_TAB_ID, key);
  applySettingToWorld[key](state);
  updateDebuggerTab(PHYSICS_TAB_ID);
};

const registerSettingUndoHandler = <K extends UndoableSetting>(key: K) => {
  _registerUndoRedoActionHandler<SettingUndoPayload<K>>(
    `physics.${key}`,
    {
      undo: ({ prev }) => setSetting(key, prev),
      redo: ({ next }) => setSetting(key, next),
    },
    'global'
  );
};
registerSettingUndoHandler('gravity');
registerSettingUndoHandler('solverIterations');
registerSettingUndoHandler('internalPgsIterations');
