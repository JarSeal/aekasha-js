/**
 * The component library's layout pieces (the Hub's `features/ui-kit/core/` page, after its
 * components; their own module so `core.ts` stays under the coding standards' 800 lines, p805
 * D15): the tabs, the accordion and the splitter.
 */
import { CMP, createAccordion, createSplitter, createTabs, getSvgIcon } from 'aekasha/ui';
import type { CMPHandle, TabDef, Tabs } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';

/** A tab's or a section's content: a line of text (a tab panel's gets a padding) */
const createTextPanel = (text: string) => {
  const panel = CMP({ class: 'hubDemoTextPanel' });
  panel.add({ tag: 'p', text });
  return panel;
};

// --- Tabs ---

const TABS_ID = (name: string) => `${ID_PREFIX}Tabs${name}`;

/** In the page: tabs of each kind; what the user selects and what a panel's build did show in the
 * status line */
const initTabsDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = TABS_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (text: string) => (status.textContent = text);
  const row = (label: string, tabs: Tabs, narrow = false) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoTabs');
    if (narrow) tabs.cmp.elem.classList.add('hubDemoTabsNarrow');
    group.append(tabs.cmp.elem);
    return group;
  };

  row(
    'Automatic: the arrows select; a badge and a disabled tab',
    createTabs({
      id: TABS_ID('Scene'),
      label: 'Scene settings',
      tabs: [
        { key: 'scene', label: 'Scene', content: createTextPanel('The scene’s name and its sky.') },
        {
          key: 'lighting',
          label: 'Lighting',
          badge: { label: 2, tone: 'warning', spokenLabel: '2 warnings' },
          content: createTextPanel('The sun, the ambient light and the shadows.'),
        },
        { key: 'render', label: 'Render', content: createTextPanel('PostFX and the tone map.') },
        { key: 'network', label: 'Network', disabled: true, content: createTextPanel('') },
      ],
      onSelect: (key) => report(`Scene settings: ${key}`),
    })
  );

  let builds = 0;
  row(
    'Manual: the arrows move, Enter or Space selects; Stats is built on its first selection',
    createTabs({
      id: TABS_ID('Inspector'),
      label: 'Inspector',
      activation: 'manual',
      tabs: [
        { key: 'props', label: 'Properties', content: createTextPanel('The entity’s fields.') },
        {
          key: 'stats',
          label: 'Stats',
          content: () => {
            builds++;
            const times = builds === 1 ? 'once' : `${builds} times`;
            return createTextPanel(`Frame time and draw calls: built ${times}.`);
          },
        },
        { key: 'log', label: 'Log', content: createTextPanel('No messages.') },
      ],
      onSelect: (key) => report(`Inspector: ${key}`),
    })
  );

  const icons: [string, string, string][] = [
    ['scene', 'Scene', 'gear'],
    ['info', 'About', 'info'],
    ['history', 'History', 'undo'],
  ];
  row(
    'Vertical and icon only: Up and Down move; the label is the tooltip',
    createTabs({
      id: TABS_ID('Drawer'),
      label: 'Debugger',
      orientation: 'vertical',
      tabs: icons.map(([key, label, icon]) => ({
        key,
        label,
        icon: getSvgIcon(icon),
        iconOnly: true,
        content: createTextPanel(`The ${label.toLowerCase()} tab.`),
      })),
    })
  );

  const manyTabs: TabDef[] = [];
  for (let i = 1; i <= 10; i++) {
    manyTabs.push({ key: `t${i}`, label: `Layer ${i}`, content: createTextPanel(`Layer ${i}.`) });
  }
  const many = createTabs({ id: TABS_ID('Layers'), label: 'Layers', tabs: manyTabs });
  const overflowRow = row('Overflowing: the list scrolls, its cut edges faded', many, true);
  addButton(overflowRow, 'Select Layer 6', () => many.select('t6'));
  root.append(status);
};

// --- Accordion ---

const ACCORDION_ID = (name: string) => `${ID_PREFIX}Accordion${name}`;

/** In the page: a one-open accordion and a several-open one; what the user opens shows in the
 * status line */
const initAccordionDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = ACCORDION_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (name: string) => (keys: string[]) =>
    (status.textContent = `${name}: ${keys.length ? keys.join(', ') : 'none'} open`);
  const row = (label: string, cmp: CMPHandle) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoAccordions');
    group.append(cmp.elem);
    return group;
  };

  row(
    'One open at a time: opening one shuts the other',
    createAccordion({
      id: ACCORDION_ID('Help'),
      level: 3,
      items: [
        {
          key: 'move',
          title: 'How do I move?',
          content: createTextPanel('WASD or the left stick; Shift runs.'),
        },
        {
          key: 'save',
          title: 'How do I save?',
          content: createTextPanel('The game saves at each checkpoint.'),
        },
        {
          key: 'quit',
          title: 'How do I quit?',
          content: createTextPanel('Escape opens the menu; Quit is its last item.'),
        },
      ],
      expanded: ['move'],
      onExpandedChange: report('Help'),
    }).cmp
  );

  let builds = 0;
  const settings = createAccordion({
    id: ACCORDION_ID('Settings'),
    level: 3,
    multiple: true,
    items: [
      { key: 'video', title: 'Video', content: createTextPanel('Resolution and the frame cap.') },
      {
        key: 'audio',
        title: 'Audio',
        content: () => {
          builds++;
          const times = builds === 1 ? 'once' : `${builds} times`;
          return createTextPanel(`Volumes and the output: built ${times}.`);
        },
      },
      { key: 'online', title: 'Online', disabled: true, content: createTextPanel('') },
      { key: 'controls', title: 'Controls', content: createTextPanel('The key bindings.') },
    ],
    onExpandedChange: report('Settings'),
  });
  const several = row(
    'Several open; a disabled section; Audio is built when it first opens',
    settings.cmp
  );
  addButton(several, 'Open every section', () => {
    for (const key of ['video', 'audio', 'controls']) settings.expand(key);
  });
  root.append(status);
};

// --- Splitter ---

const SPLITTER_ID = (name: string) => `${ID_PREFIX}Splitter${name}`;

/** Text lines in a pane's padding */
const createPaneText = (...lines: string[]) => {
  const panel = CMP({ class: 'hubDemoTextPanel hubDemoPaneText' });
  for (const line of lines) panel.add({ tag: 'p', text: line });
  return panel;
};

/** In the page: a collapsible splitter in percent and a stacked one in px; what the user moves
 * shows in the status line */
const initSplitterDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = SPLITTER_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const row = (label: string, cmp: CMPHandle) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoSplitters');
    group.append(cmp.elem);
    return group;
  };

  const outline = createSplitter({
    id: SPLITTER_ID('Outline'),
    label: 'Outline width',
    first: createPaneText('Scene', 'Camera', 'Sun', 'Terrain', 'Player'),
    second: createPaneText('Player: its position, its speed and its health.'),
    size: 35,
    min: 15,
    max: 70,
    collapsible: true,
    onSizeChange: (size) => (status.textContent = `Outline width: ${size} %`),
    onCollapsedChange: (on) => (status.textContent = `Outline ${on ? 'collapsed' : 'restored'}`),
  });
  const outlineRow = row(
    'Side by side, in percent: Left and Right move it, Enter collapses the outline and restores it',
    outline.cmp
  );
  addButton(outlineRow, 'Collapse the outline', () => outline.collapse());

  row(
    'Stacked, in px (40 to 160): Up and Down move it by 10 px',
    createSplitter({
      id: SPLITTER_ID('Console'),
      label: 'Editor height',
      orientation: 'vertical',
      unit: 'px',
      size: 80,
      min: 40,
      max: 160,
      first: createPaneText('The editor.'),
      second: createPaneText('The console: no messages.'),
      onSizeChange: (size) => (status.textContent = `Editor height: ${size} px`),
    }).cmp
  );
  root.append(status);
};

/** The layout group's demos by their box's key (`data-hub-demo`) */
export const LAYOUT_DEMOS: Record<string, Demo> = {
  tabs: initTabsDemo,
  accordion: initAccordionDemo,
  splitter: initSplitterDemo,
};
