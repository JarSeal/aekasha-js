import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { SvgIconKey } from '../core/icons/SvgIcon';
import type { SpatialNavigation } from './SpatialNavigation';
import { CMP, classes } from '../core/CMP';
import { getHUDRootCMP } from '../core/HUD';
import { getSvgIcon } from '../core/icons/SvgIcon';
import { getFirstFocusable, trapFocus } from '../overlays/FocusTrap';
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import { createSpatialNavigation } from './SpatialNavigation';
import './GameMenu.scss';
import '../styles/kit.scss';

/** An item of a {@link GameMenu} or of one of its pages: a large button. */
export type GameMenuItem = {
  /** Its id, which `onSelect` gets. */
  id: string;
  /** What it says ('Resume', 'Settings'). */
  label: string;
  /** A line under the label, read as its description ('Graphics, audio and controls'). */
  description?: string;
  /** A registered icon's name (`registerIcon`), drawn before the label. */
  icon?: SvgIconKey;
  /** Shown and focusable but doing nothing (say why in its description). */
  disabled?: boolean;
  /** What it does (Resume closes the menu: the app's `menu.close()` and the game's resume). */
  onSelect?: (id: string) => void;
  /** A page it opens in the panel's place, with Back to return (a settings menu). */
  page?: GameMenuPage;
};

/** A page of a {@link GameMenu}: more items, or content of the app's (a settings menu). */
export type GameMenuPage = {
  /** Its title, shown over it while it's open. */
  title: string;
  /** Its items, made on each open. */
  items?: readonly GameMenuItem[];
  /** Its content, after the items: a CMP added once and kept (hidden while the page isn't
   * shown, removed with the menu), or a function called on each open, its CMP removed on Back. */
  content?: CMPHandle | (() => CMPHandle);
};

/** What {@link createGameMenu} draws. */
export type GameMenuProps = {
  /** Its title (the dialog's name, and the heading of its first page): 'Paused'. */
  title: string;
  /** Its first page's items. */
  items: readonly GameMenuItem[];
  /** Back on its first page (Escape, the Back button, `back()`): the pause menu's resume. None:
   * no Back there (a title screen). On a page Back returns to the page before. */
  onBack?: () => void;
  /** `'panel'` (default): a box centred over a backdrop; `'fullscreen'`: the HUD's whole bounds
   * (a title screen). */
  layout?: 'panel' | 'fullscreen';
  /** The Back button's text (default 'Back'). */
  backLabel?: string;
  /** Whether a move past the last item goes round to the first (default true). */
  wrap?: boolean;
  /** Something for its footer, beside Back (the input prompts for Back and Select). The menu
   * removes it with itself. */
  footer?: CMPHandle;
  /** It opened. */
  onOpen?: () => void;
  /** It closed (before the focus goes back). */
  onClose?: () => void;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A game menu {@link createGameMenu} made: its CMP and its controls. */
export type GameMenu = {
  /** Its element (`.aekGameMenu`), put in the HUD root while open: don't add it anywhere.
   * `cmp.remove()` closes it without giving the focus back and removes its pages. */
  cmp: CMPHandle;
  /** Shows it on its first page, modal, the focus on its first item. */
  open: () => void;
  /** Hides it; the focus goes back to what had it. */
  close: () => void;
  /** Whether it's open */
  isOpen: () => boolean;
  /** Back (a gamepad's `EAST`): the page before, else `onBack` on the first page. */
  back: () => void;
  /** Opens a page over the current one (a menu opened straight on its settings). */
  openPage: (page: GameMenuPage) => void;
  /** How many pages are open over the first (0 on the first) */
  getDepth: () => number;
  /** Replaces its first page's items. */
  setItems: (items: readonly GameMenuItem[]) => void;
  /** Its spatial navigation: the app's gamepad calls `navigation.move(direction)` and, with focus
   * groups in a page, `nextGroup` / `previousGroup`; `navigation.back()` is `back()`. */
  navigation: SpatialNavigation;
};

/** An open page: its CMP, whether it's kept for the next open, what had the focus before it */
type PageEntry = {
  page: GameMenuPage;
  cmp: CMPHandle;
  isKept: boolean;
  opener: HTMLElement | null;
};

/** A script's focus that still shows the ring (no keydown came before a gamepad's move) */
const FOCUS_OPTIONS: FocusOptions & { focusVisible?: boolean } = { focusVisible: true };

const createPart = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/**
 * Creates a game menu (p808 D8): a modal menu of large buttons over the game (the pause menu, a
 * title screen), moved through by position with the arrows or a d-pad (its spatial navigation),
 * Back on Escape, the gamepad's `EAST` (the app calls `back()`) and a visible Back button. An item
 * acts, or opens a page in the panel's place (more items, or a settings menu), with Back to
 * return. The pause menu is this with Resume first.
 * - Parts: `.aekGameMenu` (fixed over the HUD's bounds, `data-layout`), `__panel` (the dialog),
 *   `__title`, `__body` with a `__page` per open page (the first one `data-root`), its `__items`
 *   of `__item` buttons (`data-id`, `data-page` when it opens one; `__itemIcon`, `__itemLabel`,
 *   `__itemDescription`, `__itemChevron`), and `__footer` with `__back`.
 * - Custom properties (read on any ancestor): `--aek-game-menu-width` (the panel's), `--aek-game-
 *   menu-bg` (default the raised surface), `--aek-game-menu-backdrop` (default the backdrop
 *   token), `--aek-game-menu-item-font-size` (default `--aek-font-size-xl`), `--aek-game-menu-z`
 *   (default `--aek-z-dialog`: above the app's windows, below the debugger).
 * - Keys: the arrows move by position (the spatial navigation's; round with `wrap`); Enter / Space
 *   act on the focused item (kept from the action maps); Escape is Back; Tab stays inside.
 * - Assistive tech: `role="dialog"`, `aria-modal`, named by its title, the rest of the HUD
 *   `inert` while it's open (the overlay stack's entry; the debugger stays live); a page is a
 *   group named by its title; a disabled item is `aria-disabled` (focusable, its description read);
 *   the focus goes to a page's first item, back to the item that opened it, and to what had it
 *   before the open on the close.
 * - Motion: the panel fades in over `--aek-motion-base` (none under reduced motion).
 * @example
 * ```ts
 * import { createGameMenu } from 'aekasha/ui';
 *
 * const pause = createGameMenu({
 *   title: 'Paused',
 *   onBack: () => pause.close(),
 *   items: [
 *     { id: 'resume', label: 'Resume', onSelect: () => pause.close() },
 *     {
 *       id: 'settings',
 *       label: 'Settings',
 *       description: 'Video, audio and controls',
 *       page: { title: 'Settings', items: [{ id: 'video', label: 'Video' }] },
 *     },
 *     { id: 'quit', label: 'Quit to title' },
 *   ],
 * });
 * pause.open();
 * // The app's menu map: the d-pad calls pause.navigation.move(direction), EAST pause.back()
 * ```
 */
export const createGameMenu = (props: GameMenuProps): GameMenu => {
  let rootItems: readonly GameMenuItem[] = props.items;
  const pages: PageEntry[] = [];
  /** The pages whose content is a CMP: kept between opens */
  const keptPages = new Map<GameMenuPage, CMPHandle>();
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;
  let removeTrap: (() => void) | null = null;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekGameMenu', props.class),
    attr: { ...props.attr, 'data-layout': props.layout ?? 'panel' },
    onRemoveCmp: () => {
      removeTrap?.();
      removeTrap = null;
      removeOverlay?.(false);
      removeOverlay = null;
      navigation.dispose();
      panel.removeEventListener('click', onClick);
      panel.removeEventListener('keydown', onKeyDown);
      backButton.removeEventListener('click', back);
    },
  });
  const elem = cmp.elem;

  const panelCmp = CMP({
    class: 'aekGameMenu__panel',
    attr: { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
  });
  cmp.add(panelCmp);
  const panel = panelCmp.elem;
  const titleElem = createPart('h2', 'aekGameMenu__title');
  titleElem.id = `${cmp.id}-title`;
  panel.setAttribute('aria-labelledby', titleElem.id);
  panel.append(titleElem);
  const bodyCmp = CMP({ class: 'aekGameMenu__body' });
  panelCmp.add(bodyCmp);
  const footerCmp = CMP({ class: 'aekGameMenu__footer' });
  panelCmp.add(footerCmp);
  const backButton = createPart('button', 'aekGameMenu__back');
  backButton.type = 'button';
  const backMark = createPart('span', 'aekGameMenu__backMark');
  backMark.setAttribute('aria-hidden', 'true');
  backButton.append(backMark, props.backLabel ?? 'Back');
  footerCmp.elem.append(backButton);
  if (props.footer) footerCmp.add(props.footer);

  const buildItems = (items: readonly GameMenuItem[]) => {
    const list = createPart('div', 'aekGameMenu__items');
    for (const item of items) {
      const button = createPart('button', 'aekGameMenu__item');
      button.type = 'button';
      button.setAttribute('data-id', item.id);
      if (item.page) button.setAttribute('data-page', '');
      if (item.disabled) button.setAttribute('aria-disabled', 'true');
      if (item.icon) {
        const icon = createPart('span', 'aekGameMenu__itemIcon');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = getSvgIcon(item.icon);
        button.append(icon);
      }
      const text = createPart('span', 'aekGameMenu__itemText');
      const label = createPart('span', 'aekGameMenu__itemLabel');
      label.textContent = item.label;
      text.append(label);
      if (item.description) {
        // Shown out of the name; read as the description from a hidden copy
        const shown = createPart('span', 'aekGameMenu__itemDescription');
        shown.setAttribute('aria-hidden', 'true');
        shown.textContent = item.description;
        const spoken = createPart('span', 'aekGameMenu__itemSpoken');
        spoken.hidden = true;
        spoken.id = `${cmp.id}-${pages.length}-${item.id}-description`;
        spoken.textContent = item.description;
        button.setAttribute('aria-describedby', spoken.id);
        text.append(shown, spoken);
      }
      button.append(text);
      if (item.page) {
        const chevron = createPart('span', 'aekGameMenu__itemChevron');
        chevron.setAttribute('aria-hidden', 'true');
        button.append(chevron);
      }
      list.append(button);
    }
    return list;
  };

  const rootPageCmp = CMP({ class: 'aekGameMenu__page', attr: { 'data-root': '' } });
  bodyCmp.add(rootPageCmp);
  rootPageCmp.elem.append(buildItems(rootItems));

  /** The page open on top, none on the first page (no `at()`: the Hub's lib predates it) */
  const getTop = (): PageEntry | undefined => pages[pages.length - 1];
  /** The items of the page shown */
  const getItems = () => getTop()?.page.items ?? rootItems;
  const getPageElem = () => (getTop()?.cmp ?? rootPageCmp).elem;

  const isOpen = () => removeOverlay !== null;

  const focusElem = (target: HTMLElement | null) => {
    target?.focus(FOCUS_OPTIONS);
  };

  /** The page's first item (or focusable), else Back */
  const focusFirst = () => {
    const pageElem = getPageElem();
    focusElem(getFirstFocusable(pageElem) ?? (backButton.hidden ? panel : backButton));
  };

  /** The title and Back for the page shown */
  const writeHeader = () => {
    titleElem.textContent = getTop()?.page.title ?? props.title;
    backButton.hidden = !pages.length && !props.onBack;
  };

  const openPage = (page: GameMenuPage) => {
    const active = document.activeElement as HTMLElement | null;
    getPageElem().hidden = true;
    let pageCmp = keptPages.get(page);
    const isKept = Boolean(page.content && typeof page.content !== 'function');
    if (pageCmp) {
      pageCmp.elem.hidden = false;
      // Last in the body: the page order is the stack's
      bodyCmp.elem.append(pageCmp.elem);
    } else {
      pageCmp = CMP({
        class: 'aekGameMenu__page',
        attr: { role: 'group', 'aria-label': page.title },
      });
      bodyCmp.add(pageCmp);
      if (page.items?.length) pageCmp.elem.append(buildItems(page.items));
      if (page.content) {
        pageCmp.add(typeof page.content === 'function' ? page.content() : page.content);
      }
      if (isKept) keptPages.set(page, pageCmp);
    }
    pages.push({
      page,
      cmp: pageCmp,
      isKept,
      opener: active && panel.contains(active) ? active : null,
    });
    writeHeader();
    if (isOpen()) focusFirst();
  };

  /** Closes the page on top: kept hidden, or removed with what it made */
  const popPage = () => {
    const entry = pages.pop();
    if (!entry) return null;
    if (entry.isKept) entry.cmp.elem.hidden = true;
    else entry.cmp.remove();
    getPageElem().hidden = false;
    writeHeader();
    return entry;
  };

  function back() {
    if (!pages.length) {
      props.onBack?.();
      return;
    }
    const entry = popPage();
    if (!isOpen()) return;
    if (entry?.opener?.isConnected) focusElem(entry.opener);
    else focusFirst();
  }

  const navigation = createSpatialNavigation({
    root: panel,
    onBack: back,
    wrap: props.wrap !== false,
  });

  const close = (returnFocus = true) => {
    if (!isOpen()) return;
    while (pages.length) popPage();
    removeTrap?.();
    removeTrap = null;
    // Before the focus goes back: a page the app made inert in `onOpen` would refuse it
    props.onClose?.();
    const remove = removeOverlay;
    removeOverlay = null;
    remove?.(returnFocus);
    elem.remove();
  };

  const open = () => {
    if (!isOpen()) {
      while (pages.length) popPage();
      writeHeader();
      getHUDRootCMP().elem.appendChild(elem);
      removeOverlay = pushOverlay({ elem, close: back, inert: true });
      removeTrap = trapFocus(panel);
      props.onOpen?.();
    }
    focusFirst();
  };

  /** An item's click acts, or opens its page; a disabled one's does nothing */
  const onClick = (e: MouseEvent) => {
    const button = (e.target as Element).closest('.aekGameMenu__item');
    if (!button || !getPageElem().contains(button)) return;
    if (button.getAttribute('aria-disabled') === 'true') return;
    const id = button.getAttribute('data-id');
    const item = getItems().find((candidate) => candidate.id === id);
    if (!item) return;
    if (item.page) openPage(item.page);
    else item.onSelect?.(item.id);
  };

  /** Enter and Space click a button themselves: kept from the action maps only (a game's Space
   * shouldn't jump as Resume is pressed) */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as Element).tagName !== 'BUTTON') return;
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };

  panel.addEventListener('click', onClick);
  panel.addEventListener('keydown', onKeyDown);
  backButton.addEventListener('click', back);
  writeHeader();

  return {
    cmp,
    open,
    close: () => close(),
    isOpen,
    back,
    openPage,
    getDepth: () => pages.length,
    setItems: (items) => {
      const active = document.activeElement;
      const list = rootPageCmp.elem.querySelector('.aekGameMenu__items');
      const index = list
        ? [...list.children].findIndex((child) => child === active || child.contains(active))
        : -1;
      rootItems = items;
      const next = buildItems(items);
      if (list) list.replaceWith(next);
      else rootPageCmp.elem.append(next);
      if (index >= 0 && isOpen() && !pages.length) {
        focusElem((next.children[index] ?? next.children[0] ?? null) as HTMLElement | null);
      }
    },
    navigation,
  };
};
