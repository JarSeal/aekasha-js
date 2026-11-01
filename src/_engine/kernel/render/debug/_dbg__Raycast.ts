// The Ray cast controls tab: the ray testers' buttons, each kind's helper settings and its
// statistics, a table per counter (p806 D10).
import { CMP } from '../../../ui/core/CMP';
import { IS_DEBUG_ENV } from '../../config/Config';
import {
  createDebuggerTab,
  persistDebuggerTabValue,
  updateDebuggerTab,
  type DebuggerPaneItem,
} from '../../../debug/DebuggerGUI';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { createDonut, type Donut } from '../../../ui/data/graphs/Donut';
import { createTable } from '../../../ui/data/Table';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import type {
  IntervalCounterSnapshot,
  IntervalWindowSnapshot,
} from '../../../utils/IntervalCounterStats';
import type { RayHelperKind } from '../RayDebugTypes';
import { getRayCastStats, isRayCastStatsEnabled, setRayCastStatsEnabled } from '../Raycast';
import {
  getPhysicsRayStats,
  isPhysicsRayStatsEnabled,
  setPhysicsRayHelpersEnabled,
  setPhysicsRayStatsEnabled,
} from '../../../features/physics/PhysicsQueryStats';
import { getPhysicsState, isPhysicsWorldEnabled } from '../../../features/physics/PhysicsState';
import {
  getRayHelperSettings,
  setRayHelperSettings,
  type RayHelperKindSettings,
} from './_dbg__RayHelpers';
import {
  _createClearRayTestersLSButton,
  _refreshRayTesterHelperNotices,
  _toggleRayTesterWindow,
} from './_dbg__RayTester';
import styles from './RayDebug.module.scss';

const LS_KEY = 'debugRayCast';
const TAB_ID = 'rayCastControls';
/** How often the open tab writes the stats tables' figures */
const STATS_VIEW_REFRESH_MS = 200;
/** The pre-p141 single helper toggle, migrated to `threeShow` */
const LEGACY_SHOW_HELPERS_KEY = 'showAllRayDebugHelpers';

/** The helper settings in the tab, per kind: state key suffix → the kind's setting. The state
 * keys are the kind's prefix plus the suffix (eg. `threeActiveColor`). */
const HELPER_SETTING_KEYS = {
  Show: 'show',
  ShowAnonymous: 'showAnonymous',
  ForceKindColors: 'forceKindColors',
  DepthTest: 'depthTest',
  ActiveColor: 'activeColor',
  InactiveColor: 'inactiveColor',
  Width: 'width',
  HoldMs: 'holdMs',
  FadeOutMs: 'fadeOutMs',
  DashPx: 'dashPx',
  GapPx: 'gapPx',
} as const satisfies Record<string, keyof RayHelperKindSettings>;
type HelperSettingSuffix = keyof typeof HELPER_SETTING_KEYS;
const HELPER_SETTING_SUFFIXES = Object.keys(HELPER_SETTING_KEYS) as HelperSettingSuffix[];

type HelperStatePrefix = 'three' | 'physics';
type HelperState<P extends HelperStatePrefix> = {
  [K in HelperSettingSuffix as `${P}${K}`]: RayHelperKindSettings[(typeof HELPER_SETTING_KEYS)[K]];
};

/** A kind's tab state keys, seeded with the kind's default settings. */
const createHelperState = <P extends HelperStatePrefix>(prefix: P, kind: RayHelperKind) => {
  const settings = getRayHelperSettings(kind);
  const state: Record<string, unknown> = {};
  for (const suffix of HELPER_SETTING_SUFFIXES) {
    state[`${prefix}${suffix}`] = settings[HELPER_SETTING_KEYS[suffix]];
  }
  return state as HelperState<P>;
};

const helperStateKeys = <P extends HelperStatePrefix>(prefix: P) =>
  HELPER_SETTING_SUFFIXES.map((suffix) => `${prefix}${suffix}` as keyof HelperState<P>);

const rayCastState = {
  enableRayStatistics: false,
  ...createHelperState('three', 'THREE'),
  physicsEnableRayStatistics: false,
  ...createHelperState('physics', 'PHYSICS'),
};
type RayCastState = typeof rayCastState;

export const _initRayCastingDebugger = () => {
  if (IS_DEBUG_ENV) {
    migrateLegacyShowHelpers();
    createDebugControls();
    // The persisted values are hydrated by createDebuggerTab
    setRayCastStatsEnabled(rayCastState.enableRayStatistics);
    applyHelperSettings('three', 'THREE');
    setPhysicsRayStatsEnabled(rayCastState.physicsEnableRayStatistics);
    applyHelperSettings('physics', 'PHYSICS');
  }
};

/** Pushes a kind's tab state into the helper renderer (and, for physics, whether the Physics API
 * draws its queries at all). Live helpers restyle on the next frame (uniform writes), so this
 * runs on every change, drag ticks included. */
const applyHelperSettings = (prefix: HelperStatePrefix, kind: RayHelperKind) => {
  const patch: Record<string, unknown> = {};
  for (const suffix of HELPER_SETTING_SUFFIXES) {
    patch[HELPER_SETTING_KEYS[suffix]] = rayCastState[`${prefix}${suffix}`];
  }
  setRayHelperSettings(kind, patch as Partial<RayHelperKindSettings>);
  if (kind === 'PHYSICS') setPhysicsRayHelpersEnabled(rayCastState.physicsShow);
  _refreshRayTesterHelperNotices();
};

/** Turns a kind's helpers on or off as the tab's "Show helpers" does (persisted, tab refreshed).
 * The ray tester windows use it, so the tab stays the one owner of the setting. */
export const _setRayHelpersShown = (kind: RayHelperKind, show: boolean) => {
  const prefix: HelperStatePrefix = kind === 'THREE' ? 'three' : 'physics';
  const key = `${prefix}Show` as const;
  rayCastState[key] = show;
  applyHelperSettings(prefix, kind);
  persistDebuggerTabValue(TAB_ID, key);
  updateDebuggerTab(TAB_ID);
};

/** `showAllRayDebugHelpers` became `threeShow`. Rewritten once, before hydration (which only
 * reads the persistKeys). */
const migrateLegacyShowHelpers = () => {
  const saved = lsGetItem(LS_KEY, {}) as Record<string, unknown> | null;
  if (!saved || !(LEGACY_SHOW_HELPERS_KEY in saved)) return;
  const { [LEGACY_SHOW_HELPERS_KEY]: legacyShow, ...rest } = saved;
  if (!('threeShow' in rest) && typeof legacyShow === 'boolean') rest.threeShow = legacyShow;
  lsSetItem(LS_KEY, rest);
};

/** A kind's helper settings folder. */
const helperSettingsFolder = (
  prefix: HelperStatePrefix,
  kind: RayHelperKind,
  title: string
): DebuggerPaneItem<RayCastState> => {
  const onChange = () => applyHelperSettings(prefix, kind);
  const key = (suffix: HelperSettingSuffix) => `${prefix}${suffix}` as const;
  return {
    type: 'folder',
    id: `${prefix}RayHelpers`,
    title,
    content: [
      { key: key('Show'), label: 'Show helpers', onChange },
      { key: key('ShowAnonymous'), label: 'Show rays without an id', onChange },
      { key: key('ForceKindColors'), label: 'Force kind colors', onChange },
      { key: key('DepthTest'), label: 'Respect depth', onChange },
      { key: key('ActiveColor'), label: 'Active color', kind: 'color', onChange },
      { key: key('InactiveColor'), label: 'Inactive color', kind: 'color', onChange },
      { key: key('Width'), label: 'Width (px)', min: 1, max: 20, step: 0.5, onChange },
      { key: key('HoldMs'), label: 'Hold (ms)', min: 0, max: 5000, step: 10, onChange },
      { key: key('FadeOutMs'), label: 'Fade out (ms)', min: 0, max: 10000, step: 50, onChange },
      { key: key('DashPx'), label: 'Dash (px)', min: 1, max: 64, step: 1, onChange },
      { key: key('GapPx'), label: 'Gap (px)', min: 0, max: 64, step: 1, onChange },
    ],
  };
};

const createDebugControls = () => {
  createDebuggerTab({
    id: TAB_ID,
    title: 'Ray cast controls',
    icon: 'heartArrow',
    lsKey: LS_KEY,
    // The ray testers' saved params are scene-scoped (their own LS key): a separate button
    headerButtons: () => [_createClearRayTestersLSButton()],
    state: rayCastState,
    persistKeys: [
      'enableRayStatistics',
      ...helperStateKeys('three'),
      'physicsEnableRayStatistics',
      ...helperStateKeys('physics'),
    ],
    // Only while the tab is visible: the stats tables' figures are written by the refresh
    refreshIntervalMs: STATS_VIEW_REFRESH_MS,
    onRefresh: rebuildIfPhysicsWorldChanged,
    onOpen: () => () => {
      physicsViewHasWorld = null;
    },
    content: () => {
      // Re-run on every mount and rebuild
      physicsViewHasWorld = isPhysicsWorldEnabled();
      return [
        {
          pane: true,
          content: [
            {
              type: 'button',
              title: 'Three.js ray tester',
              onClick: () => _toggleRayTesterWindow('THREE'),
            },
            {
              type: 'button',
              title: 'Physics ray tester',
              // Re-evaluated on every tab refresh (a scene may have no physics world)
              disabled: () => !isPhysicsWorldEnabled(),
              onClick: () => _toggleRayTesterWindow('PHYSICS'),
            },
            helperSettingsFolder('three', 'THREE', 'Three.js rays'),
            {
              key: 'enableRayStatistics',
              label: 'Enable ray cast statistics',
              onChange: () => {
                setRayCastStatsEnabled(rayCastState.enableRayStatistics);
                updateDebuggerTab(TAB_ID);
              },
            },
            {
              type: 'folder',
              id: 'threeRayStats',
              title: 'Three.js ray stats',
              content: [
                getStatsTableItem(
                  'Three.js ray stats',
                  getRayCastStats,
                  isRayCastStatsEnabled,
                  true
                ),
              ],
            },
            helperSettingsFolder('physics', 'PHYSICS', 'Physics rays'),
            {
              key: 'physicsEnableRayStatistics',
              label: 'Enable physics ray statistics',
              onChange: () => {
                setPhysicsRayStatsEnabled(rayCastState.physicsEnableRayStatistics);
                updateDebuggerTab(TAB_ID);
              },
            },
            getPhysicsStatsFolder(physicsViewHasWorld),
          ],
        },
      ];
    },
  });
};

const INACTIVE_VALUE = '-';

/** A stats table's row: the last frame, the max ever, or a measuring window with its donut */
type StatsRow = {
  id: string;
  label: string;
  win?: IntervalWindowSnapshot;
  donut?: Donut;
};

const getStatsRows = (getStats: () => Readonly<IntervalCounterSnapshot>): StatsRow[] => {
  const rows: StatsRow[] = [
    { id: 'lastFrame', label: 'Last frame' },
    { id: 'maxEver', label: 'Max ever' },
  ];
  const windows = getStats().windows;
  for (const kind of ['AVERAGE', 'MIN_MAX'] as const) {
    const name = kind === 'AVERAGE' ? 'Average' : 'Max / min';
    for (let i = 0; i < windows.length; i++) {
      const win = windows[i];
      if (win.kind !== kind) continue;
      // How far the window has run, beside its figure: decorative (p805 D9)
      const donut = createDonut({ class: styles.statProgress });
      rows.push({ id: `w${i}`, label: `${name}, last ${win.intervalMs / 1000} s`, win, donut });
    }
  }
  return rows;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A window's figure: its average, or its max / min per frame */
const formatWindow = (win: IntervalWindowSnapshot) =>
  win.kind === 'AVERAGE' ? String(round2(win.average)) : `${win.max} / ${win.min}`;

/**
 * One counter's stats as a table (a row per figure, its value written in place on every refresh
 * of the tab: `setCell` writes a text node only when its text changed), dimmed with "-" while its
 * statistics are off. A custom item: the grid's refresh runs its writer.
 */
const getStatsTableItem = (
  caption: string,
  getStats: () => Readonly<IntervalCounterSnapshot>,
  isEnabled: () => boolean,
  captionHidden = false
): DebuggerPaneItem<RayCastState> => ({
  type: 'custom',
  build: (container) => {
    const rows = getStatsRows(getStats);
    const table = createTable<StatsRow>({
      caption,
      captionHidden,
      columns: [
        {
          key: 'label',
          label: 'Figure',
          rowHeader: true,
          cell: (row) => {
            const cell = CMP({ tag: 'span', class: styles.statLabel });
            if (row.donut) cell.add(row.donut.cmp);
            cell.add({ tag: 'span', text: row.label });
            return cell;
          },
        },
        { key: 'value', label: 'Value', value: () => INACTIVE_VALUE, align: 'end' },
      ],
      rows,
      class: styles.statsTable,
    });
    container.add(table.cmp);
    let isActive: boolean | null = null;
    const write = () => {
      const active = isEnabled();
      if (active !== isActive) {
        isActive = active;
        if (active) table.cmp.removeAttr('data-inactive');
        else table.cmp.updateAttr({ 'data-inactive': '' });
      }
      const s = getStats();
      table.setCell('lastFrame', 'value', active ? String(s.lastFrame) : INACTIVE_VALUE);
      table.setCell('maxEver', 'value', active ? String(s.maxEver) : INACTIVE_VALUE);
      for (let i = 2; i < rows.length; i++) {
        const { id, win, donut } = rows[i];
        donut?.setValue(active && win ? win.progress : 0);
        table.setCell(id, 'value', active && win ? formatWindow(win) : INACTIVE_VALUE);
      }
    };
    write();
    return write;
  },
});

const getPhysicsRaysSnapshot = () => getPhysicsRayStats().rays;
const getPhysicsShapeCastsSnapshot = () => getPhysicsRayStats().shapeCasts;

/** Whether the mounted physics stats were built with a physics world (null: not built). */
let physicsViewHasWorld: boolean | null = null;

/** A physics world created or deleted while the tab is open (no scene change, which rebuilds the
 * open tab anyway) rebuilds it, after the refresh that noticed. */
const rebuildIfPhysicsWorldChanged = () => {
  if (physicsViewHasWorld === null || physicsViewHasWorld === isPhysicsWorldEnabled()) return;
  physicsViewHasWorld = null;
  queueMicrotask(() => updateDebuggerTab(TAB_ID, { rebuild: true }));
};

/** The physics stats (rays, shape casts, and the worker's pending queries), or a note when there
 * is no physics world (the settings above stay). */
const getPhysicsStatsFolder = (hasWorld: boolean): DebuggerPaneItem<RayCastState> => ({
  type: 'folder',
  id: 'physicsRayStats',
  title: 'Physics ray stats',
  content: hasWorld
    ? [
        getStatsTableItem('Rays', getPhysicsRaysSnapshot, isPhysicsRayStatsEnabled),
        getStatsTableItem('Shape casts', getPhysicsShapeCastsSnapshot, isPhysicsRayStatsEnabled),
        {
          label: 'Pending worker queries',
          get: () =>
            isPhysicsRayStatsEnabled()
              ? String(getPhysicsRayStats().pendingQueries)
              : INACTIVE_VALUE,
          readonly: true,
          interval: 'refresh',
          hidden: () => getPhysicsState().workerTarget !== 'WORKER_THREAD',
        },
      ]
    : [getNoteItem('No physics world')],
});
