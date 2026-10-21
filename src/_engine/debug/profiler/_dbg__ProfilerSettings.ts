import { CMP } from '../../ui/CMP';
import type { DebuggerTabDef } from '../DebuggerGUI';
import {
  PROFILER_LS_KEY,
  PROFILER_UI_LS_KEY,
  PROFILER_UPDATE_RATES_HZ,
  type ProfilerOverviewMetricEntry,
  type ProfilerSettings,
} from '../Profiler';
import {
  escapeProfilerHtml as esc,
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
 * The Overview rows editor: a visibility checkbox and ▲ / ▼ per row, and "Reset to default". The
 * app stats sources' rows are a group of their own after the engine's (the Overview shows them
 * there), so a row moves only within its group. A plain CMP list (the debugger list has no
 * reordering). Re-rendered by the tab refresh that every change triggers; its click handler
 * survives the re-render.
 */
const createMetricListEditor = (opts: SettingsTabOpts) => {
  const renderRow = (list: ProfilerOverviewMetricEntry[], i: number) => {
    const { id, visible } = list[i];
    const isApp = isAppMetricId(id);
    const isFirst = i === 0 || isAppMetricId(list[i - 1].id) !== isApp;
    const isLast = i === list.length - 1 || isAppMetricId(list[i + 1].id) !== isApp;
    return (
      `<li${visible ? '' : ' class="isHidden"'}>` +
      `<label><input type="checkbox" data-action="toggle" data-index="${i}"` +
      `${visible ? ' checked' : ''}> ${esc(getOverviewMetricLabel(id))}</label>` +
      `<button data-action="up" data-index="${i}" title="Move up"${isFirst ? ' disabled' : ''}>▲</button>` +
      `<button data-action="down" data-index="${i}" title="Move down"` +
      `${isLast ? ' disabled' : ''}>▼</button></li>`
    );
  };

  const renderList = () => {
    const list = getOverviewMetricEntries(opts.settings);
    let engineRows = '';
    let appRows = '';
    for (let i = 0; i < list.length; i++) {
      if (isAppMetricId(list[i].id)) {
        appRows += renderRow(list, i);
      } else {
        engineRows += renderRow(list, i);
      }
    }
    const resetDisabled = isDefaultMetricList(list) ? ' disabled' : '';
    const appGroup = appRows
      ? `<h5 class="profilerMetricGroupHead">App</h5><ol>${appRows}</ol>`
      : '';
    return (
      `<div class="profilerMetricList"><div class="profilerMetricListHead">` +
      `<h4>Overview rows</h4>` +
      `<button data-action="reset" title="Default rows and order"${resetDisabled}>Reset to default</button>` +
      `</div><ol>${engineRows}</ol>${appGroup}</div>`
    );
  };

  const onClick = (e: Event) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!target || (target as HTMLButtonElement).disabled) return;
    const { action, index: indexAttr } = target.dataset;
    if (action === 'reset') {
      opts.setSettings({ overviewMetrics: getDefaultOverviewMetrics() });
      return;
    }
    const index = Number(indexAttr);
    const next = getOverviewMetricEntries(opts.settings).map((entry) => ({ ...entry }));
    if (!next[index]) return;
    if (action === 'toggle') {
      next[index].visible = !next[index].visible;
    } else {
      const other = action === 'up' ? index - 1 : index + 1;
      if (!next[other] || isAppMetricId(next[other].id) !== isAppMetricId(next[index].id)) return;
      [next[index], next[other]] = [next[other], next[index]];
    }
    opts.setSettings({ overviewMetrics: next });
  };

  return CMP({ html: renderList, onClick });
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
  content: () => [
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
    createMetricListEditor(opts),
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
