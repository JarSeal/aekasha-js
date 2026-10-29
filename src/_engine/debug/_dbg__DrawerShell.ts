// The debugger's right drawer's shell (p806 D6), the scene drawer's and each editor drawer's: a
// debugger root holding the toggler, the width handle and a labelled <aside> with the heading row
// (a label, the title, the close button) over a vertical icon rail of tabs (`createTabs`) on the
// outer edge. Each tab gets a container of its own, its scroller, which the owner's tab host
// mounts the tab into. Only UI: the owner keeps the state (open, the tab, the width, the scroll
// positions) and tells the shell.
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { getSvgIcon, type SvgIconKey } from '../ui/core/icons/SvgIcon';
import { createButton } from '../ui/components/Button';
import { createKbd } from '../ui/components/Kbd';
import { createTabs, type TabDef } from '../ui/components/Tabs';
import { createSeparatorInput } from '../ui/components/SeparatorInput';
import { getWindowSize } from '../ui/core/Window';
import { getDebuggerRootProps } from '../ui/overlays/DebuggerRoot';
import { createTabContainers } from './_dbg__TabContainers';
import styles from './DebuggerGUI.module.scss';

/** The narrowest the width handle takes the drawer (D6) */
export const DRAWER_MIN_WIDTH = 280;
/** Its width until the user moves the handle (D6: the old `40rem` at the defaults) */
const DRAWER_DEFAULT_WIDTH = 400;
/** The widest, as a share of the HUD's bounds (D6) */
const DRAWER_MAX_SHARE = 0.7;
/** An arrow's step on the width handle, in px (Shift ×10, Alt ×0.1) */
const WIDTH_STEP = 10;
const WIDTH_PROPERTY = '--aek-debug-drawer-width';

/**
 * Writes the open drawer's width on <body> (`--aek-debug-drawer-width`, beside the
 * `debugDrawerOpen` class), which the styles that make room for it read: the on-screen tools, the
 * viewport stack, the material selector. Whichever drawer sets the class writes it.
 */
export const setBodyDrawerWidth = (width: number) =>
  document.body.style.setProperty(WIDTH_PROPERTY, `${width}px`);

/** One tab of the rail */
export type DrawerShellTab = {
  /** The tab's id: the owner's tab definition's */
  id: string;
  /** Its name: the rail's tooltip and the tab's accessible name */
  title: string;
  /** Its icon */
  icon: SvgIconKey;
  /** A divider before it (the first scene tab) */
  separatorBefore?: boolean;
};

export type DrawerShellOpts = {
  /** Unique among the drawers: the element ids are prefixed with it */
  id: string;
  /** The <aside>'s accessible name ('Debugger') */
  label: string;
  /** The toggler's text ('Debug') */
  togglerText: string;
  /** The toggler's place on the drawer's edge (a global class other debug styles read) */
  togglerPlace?: 'TOP' | 'MIDDLE' | 'BOTTOM';
  /** The key that toggles the drawer, as `getKeyChordLabel` writes it: the toggler's key hint */
  keys?: string;
  /** The small label above the title ('Scene') */
  headingLabel: string;
  /** The title (the scene's name) */
  title: string;
  /** The rail's accessible name */
  railLabel: string;
  /** Open at the start */
  isOpen: boolean;
  /** The saved width in px (default 400) */
  width?: number;
  /** The toggler's click */
  onToggle: () => void;
  /** The close button's click */
  onClose: () => void;
  /** The user picked a tab in the rail (a click, Enter or Space) */
  onSelect: (tabId: string) => void;
  /** The width handle moved it (each key and drag step) */
  onWidthInput?: (width: number) => void;
  /** The width handle's move finished (a key's keyup, a drag's end) */
  onWidthChange?: (width: number) => void;
  /** A tab's container scrolled */
  onScroll?: (tabId: string, scrollTop: number) => void;
};

export type DrawerShell = {
  /** The root, the debugger root: add it where it goes */
  cmp: CMPHandle;
  /** Opens or closes it. `focusTab` puts the focus on the rail's selected tab (the toggler's
   * click); a close with the focus inside gives it to the toggler. */
  setOpen: (open: boolean, opts?: { focusTab?: boolean }) => void;
  setTitle: (title: string) => void;
  /** Replaces the rail's tabs in place: a kept tab keeps its button, panel and container */
  setTabs: (tabs: DrawerShellTab[]) => void;
  /** Shows a tab's panel (its container made), without `onSelect` */
  select: (tabId: string) => void;
  /** The selected tab's id */
  getSelected: () => string | null;
  /** The selected tab's container (null: no tab) */
  getContainer: () => CMPHandle | null;
  /** Empties every container but the selected tab's (after the owner mounted it there) */
  clearOtherContainers: () => void;
  /** During a scene load: `inert`, `aria-busy` and dimmed */
  setDisabled: (disabled: boolean) => void;
  /** The width in px */
  getWidth: () => number;
  /** Moves the toggler along the edge */
  setTogglerPlace: (place: 'TOP' | 'MIDDLE' | 'BOTTOM') => void;
  /** Removes it */
  dispose: () => void;
};

/** The width kept between the minimum and its share of the bounds, in whole px */
const clampWidth = (width: number) => {
  const max = Math.max(DRAWER_MIN_WIDTH, Math.floor(getWindowSize().width * DRAWER_MAX_SHARE));
  return Math.round(Math.min(max, Math.max(DRAWER_MIN_WIDTH, width)));
};

/** The toggler: a disclosure button on the drawer's edge, with its key hint */
const createToggler = (opts: DrawerShellOpts, asideId: string) =>
  createButton({
    label: opts.togglerText,
    variant: 'secondary',
    size: 'sm',
    ...(opts.keys ? { kbd: createKbd({ keys: opts.keys }) } : {}),
    class: [styles.toggler, 'debugDrawerToggler', opts.togglerPlace ?? 'MIDDLE'],
    attr: { 'aria-expanded': String(opts.isOpen), 'aria-controls': asideId },
    onClick: () => opts.onToggle(),
  });

/** The heading row: the label and the title, and the close button */
const createHeading = (opts: DrawerShellOpts) => {
  const row = CMP({ class: styles.heading });
  const text = row.add({ class: styles.headingText });
  text.add({ tag: 'span', class: styles.headingLabel, text: opts.headingLabel });
  const title = text.add({
    tag: 'h2',
    class: [styles.headingTitle, 'debugCurrentSceneTitleText'],
    text: opts.title,
  });
  const close = createButton({
    label: `Close the ${opts.label.toLowerCase()}`,
    icon: getSvgIcon('x'),
    iconOnly: true,
    variant: 'ghost',
    size: 'sm',
    class: styles.closeButton,
    onClick: () => opts.onClose(),
  });
  row.add(close.cmp);
  return { row, title };
};

/** The width handle on the drawer's inner edge (an APG window splitter's separator): the arrows
 * move the edge (Left widens), Home is the narrowest, End the widest */
const createWidthHandle = (
  opts: DrawerShellOpts,
  root: CMPHandle,
  asideId: string,
  state: { width: number }
) => {
  const handle = root.add({
    class: styles.widthHandle,
    attr: {
      role: 'separator',
      tabindex: '0',
      'aria-orientation': 'vertical',
      'aria-label': `${opts.label} width`,
      'aria-controls': asideId,
    },
  });
  /** The drawer's right edge, read at a drag's press */
  let rightEdge = 0;
  const write = (width: number) => {
    state.width = width;
    root.elem.style.setProperty(WIDTH_PROPERTY, `${width}px`);
    handle.elem.setAttribute('aria-valuenow', String(width));
    handle.elem.setAttribute('aria-valuetext', `${width} px`);
    handle.elem.setAttribute('aria-valuemin', String(DRAWER_MIN_WIDTH));
    handle.elem.setAttribute('aria-valuemax', String(clampWidth(Infinity)));
  };
  // The values are the width negated: the edge moves left (back) as the drawer widens
  const input = createSeparatorInput(handle.elem, {
    axis: 'x',
    step: WIDTH_STEP,
    get: () => -state.width,
    getMin: () => -DRAWER_MIN_WIDTH,
    getMax: () => -clampWidth(Infinity),
    set: (value) => {
      write(clampWidth(-value));
      opts.onWidthInput?.(state.width);
    },
    getValueAt: (e) => e.clientX - rightEdge,
    onPress: () => (rightEdge = root.elem.getBoundingClientRect().right),
    onCommit: () => opts.onWidthChange?.(state.width),
  });
  write(clampWidth(state.width));
  return { handle, dispose: input.dispose };
};

/**
 * Creates a drawer shell (see the file comment). The tab containers are made the first time their
 * tab is selected and kept while the tab is; the owner mounts into `getContainer()`.
 * @param opts ({@link DrawerShellOpts})
 * @returns ({@link DrawerShell})
 */
export const createDrawerShell = (opts: DrawerShellOpts): DrawerShell => {
  const asideId = `${opts.id}-drawer`;
  let isOpen = opts.isOpen;
  const state = { width: opts.width ?? DRAWER_DEFAULT_WIDTH };
  const containers = createTabContainers({
    class: [styles.tabContent, 'debugDrawerTabsContainer'],
    onScroll: opts.onScroll,
  });

  const rootProps = getDebuggerRootProps();
  const root = CMP({
    class: [styles.drawer, 'debugDrawer'],
    ...rootProps,
    attr: { ...rootProps.attr, 'data-state': isOpen ? 'open' : 'closed' },
    settings: { replaceRootDom: false },
  });
  const toggler = createToggler(opts, asideId);
  root.add(toggler.cmp);
  const width = createWidthHandle(opts, root, asideId, state);
  const aside = root.add({
    tag: 'aside',
    class: styles.aside,
    attr: { id: asideId, 'aria-label': opts.label, ...(isOpen ? {} : { inert: '' }) },
  });
  const heading = createHeading(opts);
  aside.add(heading.row);

  const toTabDefs = (tabs: DrawerShellTab[]): TabDef[] =>
    tabs.map((tab) => ({
      key: tab.id,
      label: tab.title,
      icon: getSvgIcon(tab.icon),
      iconOnly: true,
      separatorBefore: tab.separatorBefore,
      content: containers.getContentFn(tab.id),
    }));

  const rail = createTabs({
    label: opts.railLabel,
    orientation: 'vertical',
    activation: 'manual',
    tabs: [],
    class: styles.rail,
    onSelect: (key) => opts.onSelect(key),
  });
  aside.add(rail.cmp);

  const getSelectedTabElem = () =>
    rail.cmp.elem.querySelector<HTMLElement>('.aekTabs__tab[aria-selected="true"]');

  const setOpen = (open: boolean, setOpts?: { focusTab?: boolean }) => {
    if (open !== isOpen) {
      isOpen = open;
      toggler.cmp.updateAttr({ 'aria-expanded': String(open) });
      root.updateAttr({ 'data-state': open ? 'open' : 'closed' });
      if (open) {
        aside.removeAttr('inert');
      } else {
        // Before it goes inert, which would drop the focus to the page
        if (aside.elem.contains(document.activeElement)) toggler.cmp.elem.focus();
        aside.updateAttr({ inert: '' });
      }
    }
    if (open && setOpts?.focusTab) getSelectedTabElem()?.focus();
  };

  return {
    cmp: root,
    setOpen,
    setTitle: (title) => heading.title.updateText(title),
    setTabs: (tabs) => {
      containers.retain(new Set(tabs.map((tab) => tab.id)));
      rail.setTabs(toTabDefs(tabs));
    },
    select: (tabId) => rail.select(tabId),
    getSelected: () => rail.getSelected(),
    getContainer: () => containers.get(rail.getSelected()),
    clearOtherContainers: () => containers.clearOthers(rail.getSelected()),
    setDisabled: (disabled) => {
      if (disabled) root.updateAttr({ inert: '', 'aria-busy': 'true', 'data-disabled': '' });
      else root.removeAttr(['inert', 'aria-busy', 'data-disabled']);
    },
    getWidth: () => state.width,
    setTogglerPlace: (place) => {
      toggler.cmp.updateClass(['TOP', 'MIDDLE', 'BOTTOM'], 'remove');
      toggler.cmp.updateClass(place, 'add');
    },
    dispose: () => {
      width.dispose();
      root.remove();
    },
  };
};
