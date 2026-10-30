/**
 * The dev page's "Debugger parity" box (p805 D14), as p804's Tweakpane parity box: a row per
 * shape of p805 §4.1's census (each table, debugger list, tab menu, bar, sparkline and the pie)
 * built from the kit's data pieces, each with its census source line and what its port takes
 * that isn't a rename, so p806 and p807 start from a page that shows each. The sections are an
 * accordion (shut, each built on its first open); a live run (a kit switch, off at the start) moves
 * the figures the census refreshes. The tables are `parityTables.ts`'.
 */
import {
  CMP,
  createAccordion,
  createBindingScheduler,
  createDonut,
  createList,
  createSparkline,
  createStackedBar,
  createTabs,
  getSvgIcon,
} from 'aekasha/ui';
import type { CMPHandle, ListAction, ListProps, TabDef } from 'aekasha/ui';
import { addFigureLine, addLiveSwitch } from './graphs';
import { addKitRoot } from './page';
import type { Demo } from './page';
import {
  addParityRow,
  buildAssetTables,
  buildGpuMemoryTables,
  buildProfilerTables,
} from './parityTables';
import type { ParityLive } from './parityTables';

/** A section's content: a column of rows, built on the section's first open */
const createSection = (build: (parent: HTMLElement) => void) => () => {
  const section = CMP({ class: 'hubDemoParitySection' });
  build(section.elem);
  return section;
};

// --- Debugger lists ---

/** A debugger list's row: the census' item fields (`DebuggerListItem`) */
type Item = {
  id: string;
  title: string;
  subTitle?: string;
  icon?: string;
  badge?: string;
  description?: string;
  suffix?: string;
  tooltip?: string;
  isPlaceholder?: boolean;
  disabled?: boolean;
  /** A toggle's value by its key; `null` hides it on this row (the debugger's `null`) */
  toggles?: Record<string, boolean | null>;
};

/** The parts every list reads from an `Item` (a debugger list's item fields, one to one) */
const ITEM_PARTS: Omit<ListProps<Item>, 'items'> = {
  title: (item) => item.title,
  subTitle: (item) => item.subTitle,
  icon: (item) => (item.icon ? getSvgIcon(item.icon) : null),
  badge: (item) => item.badge,
  description: (item) => item.description,
  suffix: (item) => item.suffix,
  tooltip: (item) => item.tooltip,
  isPlaceholder: (item) => Boolean(item.isPlaceholder),
  disabled: (item) => Boolean(item.disabled),
};

/** A debugger toggle (`perItemConfig.toggles`) as a list action: pressed and hidden by its value */
const toggle = (key: string, label: string, icon: string): ListAction<Item> => ({
  key,
  label,
  icon: getSvgIcon(icon),
  pressed: (item) => Boolean(item.toggles?.[key]),
  hidden: (item) => item.toggles?.[key] === null,
  onPress: (item) => {
    if (item.toggles) item.toggles[key] = !item.toggles[key];
  },
});

/** A list with the debugger list's row click and selection (`onClick`, `selectedItemId`) */
const clickable = (actions?: ListAction<Item>[]): Partial<ListProps<Item>> => ({
  selection: 'single',
  onActivate: () => {},
  actions,
});

const range = (count: number, item: (i: number) => Item) =>
  Array.from({ length: count }, (_, i) => item(i));

const buildLists = (parent: HTMLElement) => {
  const row = (source: string, note: string, props: ListProps<Item>, scroll = false) => {
    const list = createList<Item>({ ...ITEM_PARTS, ...props });
    if (scroll) list.cmp.elem.classList.add('hubDemoListScroll');
    addParityRow(parent, { source, note, cmp: list.cmp, layout: ['hubDemoLists'] });
  };

  row(
    '_dbg__CameraGUI.ts:171',
    'cameras: a click, the selection and a helper toggle; an unnamed camera’s placeholder',
    {
      label: 'Cameras',
      items: [
        {
          id: 'main',
          subTitle: 'PerspectiveCamera',
          title: 'Main camera',
          toggles: { helper: false },
        },
        {
          id: 'debug',
          subTitle: 'PerspectiveCamera',
          title: 'Unnamed camera',
          isPlaceholder: true,
          toggles: { helper: true },
        },
      ],
      selected: ['main'],
      ...clickable([toggle('helper', 'Show helper', 'cameraReels')]),
    }
  );

  row(
    '_dbg__LightGUI.ts:126',
    'lights: an icon, a badge, two toggles; a toggle the row hasn’t (`null`) hidden, its cell kept',
    {
      label: 'Lights',
      items: [
        {
          id: 'sun',
          subTitle: 'DirectionalLight',
          icon: 'lightBulb',
          badge: 'shadow',
          title: 'Sun',
          toggles: { on: true, helper: false },
        },
        {
          id: 'fill',
          subTitle: 'HemisphereLight',
          icon: 'lightBulb',
          title: 'Fill',
          toggles: { on: true, helper: null },
        },
        {
          id: 'lamp',
          subTitle: 'PointLight',
          icon: 'lightBulb',
          title: 'Unnamed light',
          isPlaceholder: true,
          toggles: { on: false, helper: true },
        },
      ],
      empty: 'No ECS lights found.',
      ...clickable([toggle('on', 'Enabled', 'lightBulb'), toggle('helper', 'Show helper', 'lamp')]),
    }
  );

  row('_dbg__ECS.ts:223', 'ECS worlds: a suffix', {
    label: 'ECS worlds',
    items: [{ id: 'main', subTitle: 'World 0', title: 'main', suffix: '2,318 entities' }],
    empty: 'No ECS worlds.',
    ...clickable(),
  });

  const assets = CMP();
  const assetsHeader = assets.add({ class: 'hubDemoParityHeader' });
  assetsHeader.add({ tag: 'h4', text: 'Assets 57' });
  assetsHeader.add({
    tag: 'button',
    class: 'hubButton',
    text: 'This scene',
    attr: { type: 'button' },
  });
  assets.add(
    createList<Item>({
      ...ITEM_PARTS,
      label: 'Assets',
      items: range(57, (i) => ({
        id: `asset${i}`,
        subTitle: ['Texture', 'Model', 'Material'][i % 3],
        icon: ['texture', 'geometry', 'material'][i % 3],
        title: `asset${String(i + 1).padStart(2, '0')}`,
        description: i % 5 === 0 ? 'Not loaded' : undefined,
        tooltip: `src/app/scenes/gym/asset${i + 1}.json`,
      })),
      filter: { field: true },
      ...clickable(),
      class: 'hubDemoListScroll',
    }).cmp
  );
  addParityRow(parent, {
    source: '_dbg__Assets.ts:1111',
    note: 'assets (57 in the gym): the tab’s own heading with its count and scope switch stays above the list (`heading` is a text); a description, a tooltip; the filter field is new',
    cmp: assets,
    layout: ['hubDemoLists'],
  });

  row(
    '_dbg__PhysicsAPI.ts:306',
    'physics entities (86 in physicsTiers): a heading with the count, a wireframe toggle; the largest list, still under the ~200 where virtual rows pay',
    {
      heading: 'Physics entities',
      headingLevel: 4,
      items: range(86, (i) => ({
        id: `body${i}`,
        subTitle: i % 4 === 0 ? 'Fixed' : 'Dynamic',
        title: `body${i + 1}`,
        toggles: { wireframe: i % 7 === 0 },
      })),
      empty: 'No physics entities.',
      ...clickable([toggle('wireframe', 'Show wireframe', 'rocket')]),
    },
    true
  );

  row('_dbg__Character.ts:340', 'characters: two toggles (the state window, the gizmos’ pin)', {
    label: 'Characters',
    items: ['player', 'dummy1', 'dummy2'].map((id, i) => ({
      id,
      subTitle: i ? 'Dummy brain' : 'Player brain',
      title: id,
      toggles: { state: i === 0, pin: false },
    })),
    empty: 'No characters.',
    ...clickable([
      toggle('state', 'Character state window', 'personArmsUp'),
      toggle('pin', 'Pin the gizmos', 'pin'),
    ]),
  });

  row('_dbg__PostFX.ts:628', 'PostFX: a heading, a badge, a tooltip, a disabled row', {
    heading: 'PostFX',
    headingLevel: 4,
    items: [
      { id: 'bloom', subTitle: 'Pass', badge: 'on', title: 'Bloom', tooltip: 'bloomPostFx.json' },
      {
        id: 'fxaa',
        subTitle: 'Pass',
        badge: 'off',
        title: 'FXAA',
        disabled: true,
        tooltip: 'Not supported on WebGL',
      },
    ],
    empty: 'No PostFX in this scene.',
    ...clickable(),
  });

  row(
    '_dbg__LOD.ts:625',
    'LOD entities: a suffix; the cap’s “…and N more” a disabled row (or virtual rows in place of the cap)',
    {
      heading: 'LOD entities',
      headingLevel: 4,
      items: [
        ...range(12, (i) => ({
          id: `lod${i}`,
          subTitle: 'LOD chain',
          title: `tree${i + 1}`,
          suffix: `level ${i % 3}`,
        })),
        { id: 'more', title: '…and 28 more', disabled: true },
      ],
      empty: 'No LOD entities.',
      ...clickable(),
    }
  );

  row(
    '_dbg__assetCompare.ts:226 (×3)',
    'a static list (no click): a total row and a “Loading…” row disabled',
    {
      heading: 'KTX2',
      headingLevel: 4,
      items: [
        {
          id: 'albedo',
          subTitle: 'rockAlbedo',
          badge: 'UASTC',
          title: '5.3 MB',
          description: '2048 × 2048, 12 mips',
          suffix: '41 ms',
        },
        { id: 'normal', subTitle: 'rockNormal', badge: 'UASTC', title: '5.3 MB', suffix: '38 ms' },
        {
          id: 'pending',
          subTitle: 'rockRoughness',
          title: 'Loading…',
          isPlaceholder: true,
          disabled: true,
        },
        { id: 'total', title: 'Total 10.6 MB', suffix: '79 ms', disabled: true },
      ],
      empty: 'No assets compared.',
    }
  );

  row('_dbg__lodShowcase.ts:379', 'lanes: a description, a suffix, a tooltip (static)', {
    heading: 'Lanes',
    headingLevel: 4,
    items: ['Cross-fade', 'Dithered', 'Impostors'].map((title, i) => ({
      id: title,
      subTitle: `Lane ${i + 1}`,
      title,
      description: '24 trees, 3 levels',
      suffix: `${(1.2 + i * 0.4).toFixed(1)} ms`,
      tooltip: `${title}: the lane’s LOD mode`,
    })),
    empty: 'No lanes.',
  });

  row('_dbg__spaceDemo.ts:153', 'the space demo: `data` an array (the only one)', {
    heading: 'Bodies',
    headingLevel: 4,
    items: ['Sun', 'Planet', 'Moon', 'Asteroids'].map((title, i) => ({
      id: title,
      subTitle: i ? 'Orbiting' : 'Fixed',
      title,
      description: i === 3 ? '400 instances' : undefined,
      suffix: `${(10 ** (3 - i)).toLocaleString('en')} kg`,
    })),
    empty: 'No bodies.',
  });
};

// --- Tab menus ---

/** The drawer's tabs in `testDebugScene` (title, icon), and a scene tab */
const DRAWER_TABS: [string, string][] = [
  ['Loop controls', 'infinity'],
  ['Statistics', 'speedometer'],
  ['Renderer controls', 'gpuCard'],
  ['Camera Controls', 'camera'],
  ['Light controls', 'lightBulb'],
  ['ECS', 'ecs'],
  ['Assets', 'assets'],
  ['Physics API controls', 'rocketTakeoff'],
  ['Character controls', 'personArmsUp'],
  ['Sky box controls', 'cloudSun'],
  ['PostFX controls', 'postFx'],
  ['LOD', 'lod'],
  ['Spatial index', 'spatialGrid'],
  ['Ray cast controls', 'heartArrow'],
  ['Debug tools controls', 'tools'],
  ['Boxes (scene tab: testDebugScene)', 'geometry'],
];

const tabPanel = (text: string) => {
  const panel = CMP({ class: 'hubDemoTextPanel' });
  panel.add({ tag: 'p', text });
  return panel;
};

const iconTabs = (tabs: [string, string][]): TabDef[] =>
  tabs.map(([label, icon]) => ({
    key: label,
    label,
    icon: getSvgIcon(icon),
    iconOnly: true,
    content: () => tabPanel(`${label}: the tab host mounts the tab’s content here.`),
  }));

const buildTabMenus = (parent: HTMLElement) => {
  const row = (source: string, note: string, cmp: CMPHandle, narrow = false) => {
    if (narrow) cmp.elem.classList.add('hubDemoTabsNarrow');
    addParityRow(parent, { source, note, cmp, layout: ['hubDemoTabs'] });
  };
  row(
    '_dbg__DebuggerGUI.ts:141',
    'the drawer: 16 icon tabs (a scene tab’s “(scene tab: …)” in its name; its class has no place: no per-tab class). In the drawer’s width they wrap to two rows today; here they scroll with faded edges (no `wrap`: p806 decides)',
    createTabs({ label: 'Debugger', tabs: iconTabs(DRAWER_TABS) }).cmp,
    true
  );
  row(
    '_dbg__Profiler.ts:202',
    'the profiler window’s icon tabs; the editor drawer’s (`_dbg__EditorDrawer.ts:124`, the material editor alone today) are the same shape',
    createTabs({
      label: 'Profiler',
      tabs: iconTabs([
        ['Overview', 'profiler'],
        ['Objects', 'objectsCubes'],
        ['GPU memory', 'memory'],
        ['Settings', 'gear'],
      ]),
    }).cmp
  );
  row(
    '_dbg__DebugKeyShortcuts.ts:542',
    'the key shortcuts dialog: a `tablist` already, two text tabs; the arrows and `aria-controls` are new (every tab a tab stop today)',
    createTabs({
      label: 'Key shortcuts',
      tabs: ['App (current scene)', 'Ækasha'].map((label) => ({
        key: label,
        label,
        content: () => tabPanel(`${label}: the shortcuts’ tables.`),
      })),
    }).cmp
  );
};

// --- Bars, sparklines, the pie ---

const MB_BUDGET = 512;

const buildGraphs = (parent: HTMLElement, live: ParityLive) => {
  const panel = (source: string, note: string) =>
    addParityRow(parent, { source, note, layout: ['hubDemoGraphs'] });

  const budget = panel(
    '_dbg__GPUMemory.ts:212',
    'the budget bar: a stacked bar of one part against a `total`; over it, the bar’s `data-over` and its label say so (the census’ over-budget class), the text beside it stays'
  );
  const budgetBar = createStackedBar({
    parts: [{ label: 'In use', value: 612 }],
    total: MB_BUDGET,
    label: 'GPU memory budget',
    format: (value) => `${value} MB`,
    legend: false,
    class: 'hubDemoBar',
  });
  const budgetText = document.createElement('p');
  budgetText.className = 'hubDemoLine';
  budget.append(budgetBar.cmp.elem, budgetText);
  const writeBudget = (mb: number) => {
    budgetBar.setParts([{ label: 'In use', value: mb }], MB_BUDGET);
    const ratio = mb / MB_BUDGET;
    budgetText.textContent = `${(ratio * 100).toFixed(0)} % of the ${MB_BUDGET} MB budget${ratio > 1 ? ' (over budget)' : ''}`;
  };
  writeBudget(612);
  live.onStep(() => writeBudget(Math.round(420 + 200 * Math.abs(Math.sin(live.getStep() / 8)))));

  const overTime = panel(
    '…Objects.ts:406',
    'over time: three sparklines of 60 samples, `area`, from 0, hidden beside their figures (the latest and the max)'
  );
  const series = [
    { name: 'Triangles in view', base: 1200, unit: 'k' },
    { name: 'Meshes in view', base: 410, unit: '' },
    { name: 'Draw calls', base: 380, unit: '' },
  ].map(({ name, base, unit }, s) => {
    const values = Array.from({ length: 60 }, (_, i) =>
      Math.round(base * (1 + 0.15 * Math.sin(i / (5 + s))))
    );
    const sparkline = createSparkline({ values, capacity: 60, min: 0, area: true });
    const text = (latest: number, max: number) => `${latest}${unit} · max ${max}${unit}`;
    const figure = addFigureLine(
      overTime,
      name,
      text(values[59], Math.max(...values)),
      sparkline.cmp
    );
    let max = Math.max(...values);
    return (step: number) => {
      const value = Math.round(base * (1 + 0.15 * Math.sin((59 + step) / (5 + s))));
      max = Math.max(max, value);
      sparkline.push(value);
      figure.textContent = text(value, max);
    };
  });
  live.onStep(() => series.forEach((push) => push(live.getStep())));

  const pies = panel(
    '_dbg__Raycast.ts:292',
    'the pie: moved onto the donut in Phase 5 (each window’s progress, decorative beside its figure; 12 in the tab)'
  );
  const windows = ['1 s', '5 s', '30 s', '60 s'].map((name, i) => {
    const donut = createDonut({ value: (0.2 + i * 0.25) % 1, size: '1.25rem' });
    addFigureLine(pies, `Window ${name}`, `${i * 14 + 3} rays`, donut.cmp);
    return donut;
  });
  live.onStep(() =>
    windows.forEach((donut, i) =>
      donut.setValue(((live.getStep() / 4) % [1, 5, 30, 60][i]) / [1, 5, 30, 60][i])
    )
  );

  const grid = panel(
    '…Objects.ts:330',
    'the component types by entity count: `<div>`s today; a static list with a suffix'
  );
  grid.append(
    createList<Item>({
      ...ITEM_PARTS,
      label: 'Component types',
      items: [
        ['TRANSFORM', 2318],
        ['MESH', 780],
        ['PHYSICS', 86],
        ['CHARACTER', 3],
      ].map(([title, entities]) => ({
        id: title as string,
        title: title as string,
        suffix: `${(entities as number).toLocaleString('en')} entities`,
      })),
    }).cmp.elem
  );
};

// --- The box ---

/** The census' shapes in an accordion: the profiler's, GPU memory's and the assets' tables, the
 * debugger lists, the tab menus, and the bars, sparklines and pie; a live run moves the figures */
const initDebuggerParityDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const stepListeners: (() => void)[] = [];
  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const live: ParityLive = {
    scheduler,
    getStep: () => step,
    onStep: (fn) => stepListeners.push(fn),
  };
  addLiveSwitch(root, 'Live figures (the census’ refreshes, 4 a second)', (on) => {
    if (on && timer === null) {
      timer = setInterval(() => {
        step++;
        for (const fn of stepListeners) fn();
      }, 250);
    } else if (!on && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });
  root.append(
    createAccordion({
      level: 3,
      multiple: true,
      class: 'hubDemoParity',
      items: [
        {
          key: 'profiler',
          title: 'The profiler’s tables (4)',
          content: createSection((p) => buildProfilerTables(p, live)),
        },
        {
          key: 'gpu',
          title: 'GPU memory’s tables (9)',
          content: createSection((p) => buildGpuMemoryTables(p, live)),
        },
        {
          key: 'assets',
          title: 'The assets info window’s tables (2)',
          content: createSection(buildAssetTables),
        },
        {
          key: 'lists',
          title: 'Debugger lists (11 shapes, 13 sites)',
          content: createSection(buildLists),
        },
        { key: 'tabs', title: 'Tab menus (4)', content: createSection(buildTabMenus) },
        {
          key: 'graphs',
          title: 'Bars, sparklines, the pie and a key-value grid',
          content: createSection((p) => buildGraphs(p, live)),
        },
      ],
    }).cmp.elem
  );
};

/** The dev page's parity box by its key (`data-hub-demo`) */
export const PARITY_DEMOS: Record<string, Demo> = {
  debuggerParity: initDebuggerParityDemo,
};
