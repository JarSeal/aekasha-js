// The Physics API tab (p806 D11's split): the world's boot and live settings, the live readouts'
// folders (_dbg__PhysicsTabFolders.ts) and the physics entities' list, whose rows open the entity's
// edit window (_dbg__PhysicsEntityWindow.ts, imported here so its kind registers with the tab).
import {
  createDebuggerTab,
  debuggerListCMP,
  hydrateDebuggerTabState,
  persistDebuggerTabValue,
  type DebuggerListItem,
  type DebuggerPaneItem,
} from '../../../debug/DebuggerGUI';
import { lsRemoveItem } from '../../../utils/LocalAndSessionStorage';
import { getDraggableWindowsOfKind } from '../../../ui/overlays/windows/DraggableWindow';
import { createClearTabLSButton, lsKeyHasData } from '../../../debug/_dbg__ClearLSButtons';
import { getConfig } from '../../../kernel/config/Config';
import { getECSWorld } from '../../../kernel/ecs/ECS';
import { getPhysicsState, getPhysicsWorld, isPhysicsWorldEnabled } from '../PhysicsState';
import { getResolvedTransportMode } from '../PhysicsWorld';
import type { PhysicsState, PhysicsWorkerTarget } from '../types/PhysicsConfigTypes';
import { setBootOverride } from './_dbg__PhysicsBootOverrides';
import {
  getWireframeColors,
  getWireframeLineThickness,
  getWireframePoseSource,
  isWireframeVisible,
  PHYSICS_WIREFRAME_ENTITY_LS_KEY,
  setWireframePoseSource,
  type WireframeColorState,
  type WireframePoseSource,
} from './_dbg__PhysicsDebugDraw';
import {
  EDIT_PHYS_ENTITY_WIN_ID,
  PHYSICS_LS_KEY,
  PHYSICS_TAB_ID,
  PHYSICS_UI_LS_KEY,
  PHYSICS_WIREFRAME_LS_KEY,
  getAllPhysicsEntityIds,
  getPhysWinEntityId,
  getPhysicsEntityLabel,
  loadPhysicsUIState,
  persistWireframeState,
  restoreWireframeState,
} from './_dbg__PhysicsDebugState';
import {
  toggleEditPhysicsEntityWindow,
  togglePhysicsEntityWireframe,
} from './_dbg__PhysicsEntityWindow';
import { applySettingToWorld, copySetting, recordSettingChange } from './_dbg__PhysicsSettingsUndo';
import {
  getBodiesFolder,
  getDeterminismProbeFolder,
  getInterpolationClockFolder,
  getTiersFolder,
  getWireframeFolder,
  refreshPhysicsReadouts,
  type WireframeProxies,
} from './_dbg__PhysicsTabFolders';

type Item = DebuggerPaneItem<PhysicsState>;

// Only these fields persist under PHYSICS_LS_KEY. workerTarget/useSAB/maxBodies/stepStatsEnabled
// live under their own boot-override key (DEBUG_PHYSICS_API_BOOT_LS_KEY, see
// setBootOverride) and applying via config on the next reload — persisting the whole
// PhysicsState blob here would let a stale in-memory copy of those four fields clobber the
// boot-override-derived values the moment any live field changes.
const LIVE_PERSIST_KEYS = [
  'timestep',
  'worldStepEnabled',
  'gravity',
  'solverIterations',
  'internalPgsIterations',
  'backgroundBehavior',
  'minDeltaTime',
  'maxDeltaTime',
  'maxSubSteps',
  'interpolationMode',
] as const satisfies readonly (keyof PhysicsState)[];

/**
 * Restores the persisted world settings into the physics state, before the first physics world
 * is created (registerPhysicsAPIDebugGUI in kernel/init/InitEngine.ts). gravity/solverIterations/
 * internalPgsIterations/timestep are baked into a Rapier world when it's created, and every
 * world (the boot one, and each scene load's fresh one) is built from the physics state. So
 * nothing is pushed into a running world: that would overwrite what the start scene set on its
 * own world (eg. the space scene's zero gravity). The tab hydrates the same values again when it
 * registers, after the start scene.
 */
export const _hydratePhysicsLiveSettings = () => {
  const state = getPhysicsState();
  hydrateDebuggerTabState({ lsKey: PHYSICS_LS_KEY, state, persistKeys: LIVE_PERSIST_KEYS });
  state.timestepRatio = 1 / (state.timestep || 60);
};

/** The boot-time settings: each saved as a boot override, taking effect after a reload */
const getBootItems = (state: PhysicsState): Item[] => {
  // Read once: createPhysicsWorld() (which resolves this) always runs before this tab is
  // ever built (see kernel/init/InitEngine.ts's boot order). The world is recreated on every scene
  // load, but always resolves the same transport (it only depends on the boot-time useSAB
  // setting and the page's cross-origin isolation), so there's nothing to poll.
  const transportModeReadout = {
    transportMode: getResolvedTransportMode() ?? 'N/A, worker only',
  };
  // The boot value, not the live one: it only takes effect after a reload
  const workerTargetProxy = { workerTarget: state.workerTarget };
  // The boot value too: the live one is on while the profiler measures the step
  const stepStatsBootProxy = {
    stepStatsEnabled: Boolean(getConfig().physics?.stepStatsEnabled),
  };
  return [
    {
      key: 'workerTarget',
      target: workerTargetProxy,
      label: 'Worker target (reloads)',
      options: [
        { value: 'MAIN_THREAD', text: 'Main thread' },
        { value: 'WORKER_THREAD', text: 'Worker thread' },
      ],
      onChange: (value) => setBootOverride({ workerTarget: value as PhysicsWorkerTarget }),
    },
    {
      key: 'useSAB',
      label: 'Use SharedArrayBuffer (reloads)',
      onChange: (value) => setBootOverride({ useSAB: Boolean(value) }),
    },
    {
      key: 'maxBodies',
      label: 'Max bodies (reloads)',
      step: 1,
      min: 1,
      onChange: (value) => setBootOverride({ maxBodies: Number(value) }),
    },
    // Feeds the stats "PHY" panel, and getLastPhysicsStepDuration()/
    // getLastPhysicsStepMessagingLatency(). Off by default so the measurement costs
    // nothing — including the risk of the timing overhead skewing the very number it
    // reports — unless someone asks for it. The boot value: the PHY panel is created
    // at boot, and the profiler switches the measurement on at runtime while it shows
    // it (setPhysicsStepStatsEnabled).
    {
      key: 'stepStatsEnabled',
      target: stepStatsBootProxy,
      label: 'Track physics step time (reloads)',
      onChange: (value) => setBootOverride({ stepStatsEnabled: Boolean(value) }),
    },
    {
      key: 'transportMode',
      target: transportModeReadout,
      label: 'Resolved transport mode',
      readonly: true,
    },
  ];
};

/** The live world settings: the step, gravity and the solver (the last three undoable) */
const getWorldItems = (state: PhysicsState): Item[] => [
  // Enable visualizer is still omitted: visualizerEnabled has no debugRender wiring
  // yet. 'EXTRAPOLATION' isn't offered below yet — reserved, not implemented.
  {
    key: 'timestep',
    label: 'Global timestep (1 / ts)',
    step: 1,
    min: 1,
    onChange: (value) => {
      state.timestepRatio = 1 / Number(value);
      if (isPhysicsWorldEnabled()) getPhysicsWorld().setTimestep(state.timestepRatio);
    },
  },
  { key: 'worldStepEnabled', label: 'Enable world step' },
  {
    key: 'gravity',
    label: 'Gravity',
    onChange: (value, e) => {
      state.gravity = copySetting(value as PhysicsState['gravity']);
      applySettingToWorld.gravity(state);
      recordSettingChange('gravity', e.prev as PhysicsState['gravity'], state.gravity);
    },
  },
  {
    key: 'solverIterations',
    label: 'Solver iterations',
    min: 1,
    step: 1,
    onChange: (value, e) => {
      applySettingToWorld.solverIterations(state);
      recordSettingChange('solverIterations', Number(e.prev), Number(value));
    },
  },
  {
    key: 'internalPgsIterations',
    label: 'Internal PGS iterations (run at each solver iteration)',
    min: 1,
    step: 1,
    onChange: (value, e) => {
      applySettingToWorld.internalPgsIterations(state);
      recordSettingChange('internalPgsIterations', Number(e.prev), Number(value));
    },
  },
];

/** The frame timing: the background behaviour, the delta time's clamps and the sub-step cap */
const getTimingItems = (state: PhysicsState): Item[] => {
  // Displayed as Hz (1 / seconds), matching the 'Global timestep' control — the state
  // fields are stored as seconds.
  const deltaTimeHzProxy = {
    minDeltaTimeHz: state.minDeltaTime > 0 ? 1 / state.minDeltaTime : 0,
    maxDeltaTimeHz: state.maxDeltaTime > 0 ? 1 / state.maxDeltaTime : 0,
  };
  return [
    {
      key: 'backgroundBehavior',
      label:
        'Background behavior (while the window is hidden — another tab, another window, minimized)',
      options: [
        { value: 'KEEP_RUNNING', text: 'Keep running' },
        {
          value: 'KEEP_RUNNING_USE_MIN_DELTA',
          text: 'Keep running, use minimum delta time',
        },
        { value: 'PAUSE', text: 'Pause' },
      ],
    },
    {
      key: 'minDeltaTimeHz',
      target: deltaTimeHzProxy,
      label:
        'Minimum delta time (as fps; used by "Keep running, use minimum delta time"), 0 = not in use',
      step: 1,
      min: 0,
      onChange: (value, e) => {
        state.minDeltaTime = Number(value) > 0 ? 1 / Number(value) : 0;
        if (e.last) persistDebuggerTabValue(PHYSICS_TAB_ID, 'minDeltaTime');
      },
    },
    {
      key: 'maxDeltaTimeHz',
      target: deltaTimeHzProxy,
      label:
        'Maximum delta time (as fps; clamps a single frame’s contribution to the physics accumulator), 0 = not in use',
      step: 1,
      min: 0,
      onChange: (value, e) => {
        state.maxDeltaTime = Number(value) > 0 ? 1 / Number(value) : 0;
        if (e.last) persistDebuggerTabValue(PHYSICS_TAB_ID, 'maxDeltaTime');
      },
    },
    {
      key: 'maxSubSteps',
      label:
        'Max sub-steps per frame (drops backlog beyond this instead of deferring it), 0 = not in use',
      step: 1,
      min: 0,
    },
  ];
};

/** The render interpolation's mode, and the pose the wireframes follow */
const getInterpolationItems = (pose: WireframeProxies['pose']): Item[] => [
  // physicsInterpolationSystem (PhysicsInterpolation.ts) returns early for
  // 'EXTRAPOLATION', so selecting it via AppConfig is safe but inert.
  {
    key: 'interpolationMode',
    label:
      'Interpolation mode (render-only smoothing; ECS TRANSFORM always stays the discrete pose)',
    options: [
      { value: 'NONE', text: 'None (latest step pose, judders above the physics rate)' },
      {
        value: 'RENDERER',
        text: 'Renderer (servoed to the received snapshots; use with the worker)',
      },
      {
        value: 'FIXED_PHYSICS',
        text: 'Fixed physics (open-loop from the stepper; MAIN_THREAD only)',
      },
    ],
  },
  // Which pose moving bodies' collider wireframes follow: the raw physics pose shows
  // the interpolation offset (the mesh trails its wireframe while moving), the
  // rendered pose puts the wireframe on the mesh. Headless bodies have no mesh and
  // always show physics.
  {
    key: 'poseSource',
    target: pose,
    label: 'Wireframe pose (moving bodies)',
    options: [
      { value: 'PHYSICS', text: 'Physics (raw stepped pose)' },
      { value: 'RENDERED', text: 'Rendered (interpolated mesh pose)' },
    ],
    onChange: (value) => {
      setWireframePoseSource(value as WireframePoseSource);
      persistWireframeState();
    },
  },
];

const getPhysicsEntitiesListData = (): DebuggerListItem[] => {
  const world = getECSWorld();
  return getAllPhysicsEntityIds().map((entityId) => ({
    itemId: String(entityId),
    title: getPhysicsEntityLabel(entityId),
    subTitle: `[${entityId}]`,
    toggleValues: [isWireframeVisible(entityId, world)],
  }));
};

/** The physics entities' list: a row opens the entity's edit window, its toggle the wireframe */
const getPhysicsEntitiesList = () =>
  debuggerListCMP({
    id: 'physicsEntities',
    heading: 'Physics entities',
    emptyText: 'No physics entities registered..',
    data: getPhysicsEntitiesListData,
    selectedItemId: () =>
      getDraggableWindowsOfKind(EDIT_PHYS_ENTITY_WIN_ID)
        .map((win) => getPhysWinEntityId(win.data))
        .filter((entityId) => entityId !== undefined)
        .map(String),
    perItemConfig: {
      onClick: toggleEditPhysicsEntityWindow,
      toggles: [{ icon: 'rocket', title: 'Show wireframe', fn: togglePhysicsEntityWireframe }],
    },
  });

/** Every LS key the tab owns, so its one clear button leaves nothing behind */
const TAB_LS_KEYS = [
  PHYSICS_LS_KEY,
  PHYSICS_WIREFRAME_LS_KEY,
  PHYSICS_WIREFRAME_ENTITY_LS_KEY,
  PHYSICS_UI_LS_KEY,
];

/** Registers the Physics API tab, after the start scene (createPhysicsAPIDebugGUI) */
export const _createPhysicsAPIDebugGUI = () => {
  loadPhysicsUIState();
  restoreWireframeState();

  const state = getPhysicsState();

  createDebuggerTab({
    id: PHYSICS_TAB_ID,
    title: 'Physics API controls',
    icon: 'rocketTakeoff',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    lsKey: PHYSICS_LS_KEY,
    state,
    persistKeys: LIVE_PERSIST_KEYS,
    clearLSButton: false,
    headerButtons: () => [
      createClearTabLSButton({
        hasData: () => TAB_LS_KEYS.some((key) => lsKeyHasData(key)),
        onClear: () => TAB_LS_KEYS.forEach((key) => lsRemoveItem(key)),
        watchKey: PHYSICS_LS_KEY,
      }),
    ],
    // No entity create/delete hook to subscribe to: poll, same tradeoff as the spatial grid
    // debug panel's live readout (the list only re-renders when its rows changed)
    refreshIntervalMs: 500,
    onRefresh: refreshPhysicsReadouts,
    content: () => {
      const wireframeProxies: WireframeProxies = {
        colors: { ...getWireframeColors() } as Record<WireframeColorState, number>,
        thickness: { lineThickness: getWireframeLineThickness() },
        pose: { poseSource: getWireframePoseSource() },
      };
      return [
        {
          pane: true,
          content: [
            ...getBootItems(state),
            { type: 'separator' },
            ...getWorldItems(state),
            { type: 'separator' },
            ...getTimingItems(state),
            { type: 'separator' },
            ...getInterpolationItems(wireframeProxies.pose),
            getBodiesFolder(),
            getTiersFolder(),
            getInterpolationClockFolder(),
            { type: 'separator' },
            getDeterminismProbeFolder(),
            { type: 'separator' },
            getWireframeFolder(wireframeProxies),
          ],
        },
        getPhysicsEntitiesList(),
      ];
    },
  });

  // Hydrated at registration (the same values _hydratePhysicsLiveSettings restored at boot)
  state.timestepRatio = 1 / (state.timestep || 60);
};
