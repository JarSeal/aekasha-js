import { CMP } from '../../ui/core/CMP';
import { getSvgIcon } from '../../ui/core/icons/SvgIcon';
import { createButton } from '../../ui/components/Button';
import { createList } from '../../ui/data/List';
import { createListReorder } from '../../ui/data/Reorder';
import { addScheduledRefresh } from '../../ui/forms/binding/BindingScheduler';
import type { DebuggerTabContext, DebuggerTabDef } from '../DebuggerGUI';
import {
  PROFILER_LS_KEY,
  PROFILER_UI_LS_KEY,
  PROFILER_UPDATE_RATES_HZ,
  type ProfilerOverviewMetricEntry,
  type ProfilerSettings,
} from '../Profiler';
import {
  getDefaultOverviewMetrics,
  getOverviewMetricEntries,
  getOverviewMetricLabel,
  isAppMetricId,
} from './_dbg__ProfilerOverview';

export const PROFILER_SETTINGS_TAB_ID = 'profilerSettings';

export const PROFILER_SETTINGS_PERSIST_KEYS = [
  'updateRateHz',
  'overviewMetrics',
  'openFromStatsPanels',
  'enabledInProdTest',
  'measureGpu',
  'excludeDebugHelpers',
  // Picked in the Objects tab
  'objectsBarMeasure',
] as const satisfies readonly (keyof ProfilerSettings)[];

type SettingsTabOpts = {
  settings: ProfilerSettings;
  /** A setting changed (already written and persisted): apply it. */
  onChange: (key: keyof ProfilerSettings) => void;
  /** Changes settings outside the pane bindings: persists and applies them. */
  setSettings: (partial: Partial<ProfilerSettings>) => void;
  /** The clear-LS button removed the stored settings. */
  onClearLS: () => void;
};

const UPDATE_RATE_OPTIONS = Object.fromEntries(
  PROFILER_UPDATE_RATES_HZ.map((hz) => [`${hz} Hz`, hz])
) as Record<string, number>;

const isDefaultMetricList = (list: ProfilerOverviewMetricEntry[]) =>
  JSON.stringify(list) === JSON.stringify(getDefaultOverviewMetrics());

/**
 * The Overview's rows with `id` moved to `to`, an index among its own group's rows (the engine's
 * or the app sources'), the others closing the gap: a row moves only within its group, since the
 * Overview shows the app rows after the engine's.
 */
export const moveOverviewMetric = (
  entries: readonly ProfilerOverviewMetricEntry[],
  id: string,
  to: number
): ProfilerOverviewMetricEntry[] => {
  const next = entries.map((entry) => ({ ...entry }));
  const from = next.findIndex((entry) => entry.id === id);
  if (from === -1) return next;
  const isApp = isAppMetricId(id);
  const [row] = next.splice(from, 1);
  const groupIndices: number[] = [];
  for (let i = 0; i < next.length; i++) {
    if (isAppMetricId(next[i].id) === isApp) groupIndices.push(i);
  }
  const at =
    to < groupIndices.length
      ? groupIndices[Math.max(0, to)]
      : groupIndices.length
        ? groupIndices[groupIndices.length - 1] + 1
        : from;
  next.splice(at, 0, row);
  return next;
};

/** One group's rows (the engine's or the app sources') as a kit list: a visibility toggle per row,
 * moved by Alt + ArrowUp / ArrowDown or a drag (p806 D10) */
const createMetricList = (opts: SettingsTabOpts, ctx: DebuggerTabContext, isApp: boolean) => {
  const getRows = () =>
    getOverviewMetricEntries(opts.settings).filter((entry) => isAppMetricId(entry.id) === isApp);
  const setRows = (next: ProfilerOverviewMetricEntry[]) =>
    opts.setSettings({ overviewMetrics: next });
  return createList<ProfilerOverviewMetricEntry>({
    items: getRows,
    getKey: (entry) => entry.id,
    title: (entry) => getOverviewMetricLabel(entry.id),
    // Not the colour alone
    suffix: (entry) => (entry.visible ? '' : 'Hidden'),
    ...(isApp ? { heading: 'App', headingLevel: 5 } : { label: 'Overview rows' }),
    actions: [
      {
        key: 'visible',
        label: 'Show in the Overview',
        icon: getSvgIcon('circleCheckCutout', 'sm'),
        pressed: (entry) => entry.visible,
        onPress: (entry) =>
          setRows(
            getOverviewMetricEntries(opts.settings).map((row) =>
              row.id === entry.id ? { ...row, visible: !row.visible } : { ...row }
            )
          ),
      },
    ],
    reorder: createListReorder({
      onReorder: ({ key, to }) =>
        setRows(moveOverviewMetric(getOverviewMetricEntries(opts.settings), key, to)),
    }),
    scheduler: ctx.scheduler,
    class: 'profilerMetricList',
  });
};

/**
 * The Overview rows editor (p806 D10): the engine's rows and the app sources' (a group of their
 * own after the engine's, shown once there is one) as two kit lists, and "Reset to default". Every
 * change goes through `setSettings`, whose tab refresh reads the lists and the button again on the
 * tab's scheduler.
 */
const createMetricListEditor = (opts: SettingsTabOpts, ctx: DebuggerTabContext) => {
  let removeRefresh: (() => void) | null = null;
  const root = CMP({
    class: 'profilerMetricEditor',
    onRemoveCmp: () => {
      removeRefresh?.();
      removeRefresh = null;
    },
  });
  const head = root.add({ class: 'profilerMetricEditorHead' });
  head.add({ tag: 'h4', text: 'Overview rows' });
  const reset = createButton({
    label: 'Reset to default',
    size: 'sm',
    tooltip: 'The default rows and order',
    onClick: () => opts.setSettings({ overviewMetrics: getDefaultOverviewMetrics() }),
  });
  head.add(reset.cmp);
  root.add(createMetricList(opts, ctx, false).cmp);
  const appGroup = root.add({ class: 'profilerMetricAppGroup' });
  appGroup.add(createMetricList(opts, ctx, true).cmp);

  const read = () => {
    const entries = getOverviewMetricEntries(opts.settings);
    reset.setDisabled(isDefaultMetricList(entries));
    const hasApp = entries.some((entry) => isAppMetricId(entry.id));
    if (hasApp) appGroup.elem.removeAttribute('hidden');
    else appGroup.elem.setAttribute('hidden', '');
  };
  read();
  removeRefresh = addScheduledRefresh(ctx.scheduler, read, {
    isShown: () => root.elem.isConnected,
  });
  return root;
};

/**
 * The Settings tab: the update rate, what the Overview shows, measuring, the entry points and
 * prodTest.
 * @param opts ({@link SettingsTabOpts})
 */
export const createProfilerSettingsTabDef = (
  opts: SettingsTabOpts
): DebuggerTabDef<ProfilerSettings> => ({
  id: PROFILER_SETTINGS_TAB_ID,
  title: 'Settings',
  icon: 'gear',
  orderNr: 100,
  lsKey: PROFILER_LS_KEY,
  uiLsKey: PROFILER_UI_LS_KEY,
  state: opts.settings,
  persistKeys: PROFILER_SETTINGS_PERSIST_KEYS,
  onClearLS: opts.onClearLS,
  content: (ctx) => [
    {
      pane: true,
      content: [
        {
          type: 'folder',
          id: 'general',
          title: 'General',
          content: [
            {
              key: 'updateRateHz',
              label: 'Update rate',
              options: UPDATE_RATE_OPTIONS,
              onChange: () => opts.onChange('updateRateHz'),
            },
          ],
        },
        {
          type: 'folder',
          id: 'measuring',
          title: 'Measuring',
          content: [
            {
              key: 'measureGpu',
              label: 'Measure GPU time',
              onChange: () => opts.onChange('measureGpu'),
            },
            {
              key: 'excludeDebugHelpers',
              label: 'Exclude debug helpers',
              onChange: () => opts.onChange('excludeDebugHelpers'),
            },
          ],
        },
      ],
    },
    createMetricListEditor(opts, ctx),
    {
      pane: true,
      content: [
        {
          type: 'folder',
          id: 'entryPoints',
          title: 'Entry points',
          content: [
            {
              key: 'openFromStatsPanels',
              label: 'Open from stats panels',
              onChange: () => opts.onChange('openFromStatsPanels'),
            },
          ],
        },
        {
          type: 'folder',
          id: 'prodTest',
          title: 'Production test mode',
          content: [
            {
              key: 'enabledInProdTest',
              label: 'Enable in prodTest',
              onChange: () => opts.onChange('enabledInProdTest'),
            },
          ],
        },
      ],
    },
    CMP({
      class: 'profilerNote',
      text:
        '"Enable in prodTest" is read when prodTest starts: the profiler then loads there, an ' +
        'open window stays open over the play button, and the on-screen tools get its button ' +
        '(when they are shown in prodTest).',
    }),
  ],
});
