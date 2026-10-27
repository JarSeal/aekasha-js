/**
 * The component library's layout pieces (the Hub's `features/ui-kit/core/` page, after its
 * components; their own module so `core.ts` stays under the coding standards' 800 lines, p805
 * D15): the tabs; the accordion and the splitter come next.
 */
import { CMP, createTabs, getSvgIcon } from 'aekasha/ui';
import type { TabDef, Tabs } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';

// --- Tabs ---

const TABS_ID = (name: string) => `${ID_PREFIX}Tabs${name}`;

/** A panel's content: a line of text in the panel's padding */
const createTabPanel = (text: string) => {
  const panel = CMP({ class: 'hubDemoTabPanel' });
  panel.add({ tag: 'p', text });
  return panel;
};

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
        { key: 'scene', label: 'Scene', content: createTabPanel('The scene’s name and its sky.') },
        {
          key: 'lighting',
          label: 'Lighting',
          badge: { label: 2, tone: 'warning', spokenLabel: '2 warnings' },
          content: createTabPanel('The sun, the ambient light and the shadows.'),
        },
        { key: 'render', label: 'Render', content: createTabPanel('PostFX and the tone map.') },
        { key: 'network', label: 'Network', disabled: true, content: createTabPanel('') },
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
        { key: 'props', label: 'Properties', content: createTabPanel('The entity’s fields.') },
        {
          key: 'stats',
          label: 'Stats',
          content: () => {
            builds++;
            const times = builds === 1 ? 'once' : `${builds} times`;
            return createTabPanel(`Frame time and draw calls: built ${times}.`);
          },
        },
        { key: 'log', label: 'Log', content: createTabPanel('No messages.') },
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
        content: createTabPanel(`The ${label.toLowerCase()} tab.`),
      })),
    })
  );

  const manyTabs: TabDef[] = [];
  for (let i = 1; i <= 10; i++) {
    manyTabs.push({ key: `t${i}`, label: `Layer ${i}`, content: createTabPanel(`Layer ${i}.`) });
  }
  const many = createTabs({ id: TABS_ID('Layers'), label: 'Layers', tabs: manyTabs });
  const overflowRow = row('Overflowing: the list scrolls, its cut edges faded', many, true);
  addButton(overflowRow, 'Select Layer 6', () => many.select('t6'));
  root.append(status);
};

/** The layout group's demos by their box's key (`data-hub-demo`) */
export const LAYOUT_DEMOS: Record<string, Demo> = {
  tabs: initTabsDemo,
};
