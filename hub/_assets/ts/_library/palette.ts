/**
 * The command palette's demo (p805 D12): a group module of its own, out of `overlays.ts` for its
 * size, on the overlays page's part of the library. Two palettes: an editor's commands, ranked by
 * the kit, and a search through a `source` (the Hub's own search's shape: a first answer that's a
 * promise while its index loads, then answers at once; rows with a breadcrumb and a snippet, each a
 * link to the library page's section, which the overlays page's `::: demo` doesn't have).
 */
import { CMP, createCommandPalette, getSvgIcon } from 'aekasha/ui';
import type { PaletteCommand } from 'aekasha/ui';
import { addButton, addGroup, ID_PREFIX, type Demo } from './page';

const PALETTE_ID = (part: string) => `${ID_PREFIX}Palette${part}`;

/** A page of the demo's search: its section, title, crumbs and text */
type PageResult = PaletteCommand & { crumbs: string; text: string };

const PAGES: { section: string; crumbs: string; title: string; anchor: string; text: string }[] = [
  {
    section: 'Overlays',
    crumbs: 'UI kit › Windows and overlays',
    title: 'Context menus',
    anchor: 'context-menu',
    text: 'A right click, the ContextMenu key or Shift+F10 opens the menu over a whole list.',
  },
  {
    section: 'Overlays',
    crumbs: 'UI kit › Windows and overlays',
    title: 'Menus and split buttons',
    anchor: 'menu-and-split-button',
    text: 'The menu button pattern: actions, checkable items, choices, groups and submenus.',
  },
  {
    section: 'Data',
    crumbs: 'UI kit › Data display',
    title: 'Lists',
    anchor: 'list',
    text: 'Static, selectable or with row actions; a filter field marks the matches as you type.',
  },
  {
    section: 'Data',
    crumbs: 'UI kit › Data display',
    title: 'Trees',
    anchor: 'tree',
    text: 'One flat tree: lazy children, the filter with the matches’ ancestors, virtual rows.',
  },
  {
    section: 'Data',
    crumbs: 'UI kit › Data display',
    title: 'Tables',
    anchor: 'table',
    text: 'Sorting, a grid of cells, live figures written in place and virtual rows for long ones.',
  },
  {
    section: 'Core',
    crumbs: 'UI kit › Core components',
    title: 'Tabs',
    anchor: 'tabs',
    text: 'A tab list over its panels, each built on its first show, with automatic or manual keys.',
  },
];

/** The demo's search: every query word in a page's title or text */
const searchPages = (query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const found = PAGES.filter((page) =>
    words.every((word) => `${page.title} ${page.text}`.toLowerCase().includes(word))
  );
  return {
    commands: found.slice(0, 4).map(
      (page): PageResult => ({
        id: page.anchor,
        label: page.title,
        group: page.section,
        href: `#${page.anchor}`,
        crumbs: page.crumbs,
        text: page.text,
      })
    ),
    total: found.length,
  };
};

const initPaletteDemo: Demo = (box) => {
  const status = document.createElement('p');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const say = (text: string) => (status.textContent = text);

  let showGrid = true;
  let recent: string[] = ['frame'];
  const commands: PaletteCommand[] = [
    {
      id: 'reset',
      label: 'Reset the camera',
      group: 'View',
      icon: getSvgIcon('camera'),
      run: () => say('Ran: Reset the camera'),
    },
    {
      id: 'frame',
      label: 'Frame the selection',
      group: 'View',
      kbd: 'F',
      run: () => say('Ran: Frame the selection'),
    },
    {
      id: 'grid',
      label: 'Toggle the grid',
      group: 'View',
      description: 'Shows or hides the floor grid',
      icon: getSvgIcon('spatialGrid'),
      kbd: 'G',
      run: () => {
        showGrid = !showGrid;
        say(`Ran: Toggle the grid (${showGrid ? 'shown' : 'hidden'})`);
      },
    },
    {
      id: 'light',
      label: 'Add a light',
      group: 'Scene',
      icon: getSvgIcon('lightBulb'),
      keywords: ['lamp'],
      run: () => say('Ran: Add a light'),
    },
    {
      id: 'box',
      label: 'Add a box',
      group: 'Scene',
      icon: getSvgIcon('geometry'),
      keywords: ['cube', 'mesh'],
      run: () => say('Ran: Add a box'),
    },
    {
      id: 'delete',
      label: 'Delete the selection',
      group: 'Scene',
      icon: getSvgIcon('thrash'),
      kbd: 'Delete',
      disabled: true,
    },
    {
      id: 'save',
      label: 'Save the scene',
      group: 'File',
      kbd: 'Ctrl+S',
      run: () => say('Ran: Save the scene'),
    },
  ];
  const commandsPalette = createCommandPalette({
    id: PALETTE_ID('Commands'),
    label: 'Commands',
    placeholder: 'Type a command',
    commands,
    recent,
    onRecentChange: (ids) => (recent = ids),
  });

  const searchPalette = createCommandPalette<PageResult>({
    id: PALETTE_ID('Search'),
    label: 'Search the pages',
    hint: 'Search the UI kit’s pages.',
    loadingText: 'Loading the index…',
    hints: { select: 'to open' },
    emptyText: (query) => `No pages for “${query.trim()}”.`,
    source: (() => {
      let loaded: Promise<void> | null = null;
      let isLoaded = false;
      return (query: string) => {
        if (isLoaded || !query.trim()) return searchPages(query);
        // The first search loads the index, as the Hub's does (1.5 s: long enough for
        // `yarn verify:ui`'s script to see the loading status after its key's settle)
        loaded ??= new Promise<void>((resolve) => setTimeout(resolve, 1500)).then(() => {
          isLoaded = true;
        });
        return loaded.then(() => searchPages(query));
      };
    })(),
    renderRow: (page, { appendMarked }) => {
      const row = CMP({ class: 'hubDemoPaletteRow' });
      row.add({ tag: 'span', class: 'hubDemoPaletteCrumbs', text: page.crumbs });
      const title = row.add({ tag: 'span', class: 'hubDemoPaletteTitle' });
      appendMarked(title.elem, page.label);
      const text = row.add({ tag: 'span', class: 'hubDemoPaletteText' });
      appendMarked(text.elem, page.text);
      return row;
    },
    onSelect: (page) => say(`Opened: ${page.label}`),
  });

  const group = addGroup(box, 'Open a palette (an app binds Ctrl / ⌘ + K to `open()`)');
  addButton(group, 'Open the commands', () => commandsPalette.open({ query: '' }));
  addButton(group, 'Open with “tog”', () => commandsPalette.open({ query: 'tog' }));
  addButton(group, 'Open with “zz”', () => commandsPalette.open({ query: 'zz' }));
  addButton(group, 'Search the pages', () => searchPalette.open({ query: '' }));
  box.append(status);
};

export const PALETTE_DEMOS: Record<string, Demo> = {
  commandPalette: initPaletteDemo,
};
