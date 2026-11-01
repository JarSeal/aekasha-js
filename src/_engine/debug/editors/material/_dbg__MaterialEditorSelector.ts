/**
 * The material editor's selector (docs/plans/_DONE_p084_material-editor-stage-and-selector.md
 * DD5), on the UI kit (p806 D10): the bottom drawer with every project material as a card, a
 * search field filtering by id and name, a collapse button and, on its top edge, a height handle.
 * It is only UI: the editor hands it the entries and its callbacks, and calls `refresh` when the
 * selected, loading or failed material changes.
 *
 * - The cards are kit buttons in a toolbar (`role="toolbar"`, one tab stop): Left / Right move
 *   between the shown cards, Up / Down a row of the grid (its columns as laid out), Home / End to
 *   the ends; Enter or Space picks. The shown material's card is `aria-current`, a loading one
 *   `aria-busy`, a failed one `data-failed` with a "Failed" mark; an unavailable one is
 *   `aria-disabled` (still focusable: its tooltip says why).
 * - The height handle is an APG window splitter's separator (`SeparatorInput.ts`, as the drawer's
 *   width handle: the selector is one fixed pane): ArrowUp heightens, Home is the lowest, End the
 *   highest (70 % of the HUD's bounds), Enter collapses and restores; a drag moves it.
 */
import { CMP } from '../../../ui/core/CMP';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { getWindowSize } from '../../../ui/core/Window';
import { announce } from '../../../ui/components/Announcer';
import { createBadge } from '../../../ui/components/Badge';
import { createButton, type Button } from '../../../ui/components/Button';
import { createRovingTabStop, getMoveTarget } from '../../../ui/components/RovingFocus';
import { createSeparatorInput } from '../../../ui/components/SeparatorInput';
import { createTextField } from '../../../ui/forms/TextField';
import { swallowNextKeyUp } from '../../../ui/overlays/OverlayStack';
import { createTooltip, type Tooltip } from '../../../ui/overlays/Tooltip';
import styles from './MaterialEditor.module.scss';

/** A project material as the selector shows it. */
export type MaterialSelectorEntry = {
  id: string;
  /** `debugData.name`, else the id. */
  name: string;
  /** The material type (eg. 'STANDARDNODEMATERIAL'). */
  type: string;
  /** Has a TSL file. */
  isTsl: boolean;
  sourcePath?: string;
  description?: string;
  /** A CSS colour for the preview slot's swatch (the material's first colour), or null. */
  swatch: string | null;
  /** Why it can't be loaded (eg. no TSL graph in a production-gathered build); listed disabled. */
  unavailableReason?: string;
};

/** The selector's UI state (persisted by the editor). */
export type MaterialSelectorState = {
  isOpen: boolean;
  filterText: string;
  scrollTop: number;
  /** The body's height its handle set, in px (none: the default) */
  height?: number;
};

export type MaterialSelectorOpts = {
  /** The parent (the editor's HUD). */
  parent: CMPHandle;
  entries: MaterialSelectorEntry[];
  initialState?: Partial<MaterialSelectorState>;
  /** A card's pick (not for unavailable materials). */
  onSelect: (id: string) => void;
  getSelectedId: () => string | null;
  /** The material whose load is in progress, if any. */
  getLoadingId: () => string | null;
  /** Why a material failed to load, if it did. */
  getFailure: (id: string) => string | undefined;
  /** After any state change (open, filter, scroll, height). */
  onStateChange?: (state: MaterialSelectorState) => void;
};

export type MaterialSelector = {
  cmp: CMPHandle;
  elem: HTMLElement;
  /** Re-reads the selected, loading and failed materials into the cards. */
  refresh: () => void;
  setOpen: (isOpen: boolean) => void;
  getState: () => MaterialSelectorState;
  /** Puts the saved scroll position back: a hidden element (display: none, eg. the editor's HUD
   * outside its view) loses it. */
  restoreScroll: () => void;
  dispose: () => void;
};

/** The body's height until the user moves the handle (the old `15rem` at the defaults) */
export const SELECTOR_DEFAULT_HEIGHT = 150;
/** The lowest the handle takes it */
const SELECTOR_MIN_HEIGHT = 80;
/** The highest, as a share of the HUD's bounds */
const SELECTOR_MAX_SHARE = 0.7;
/** An arrow's step on the handle, in px (Shift ×10, Alt ×0.1) */
const HEIGHT_STEP = 10;
const HEIGHT_PROPERTY = '--aek-mat-selector-height';

/** What a filter matcher reads: the search field's state. */
type MaterialFilter = { text: string };
type Card = {
  entry: MaterialSelectorEntry;
  button: Button;
  elem: HTMLButtonElement;
  tooltip: Tooltip;
  searchText: string;
  isShown: boolean;
};
/** Every matcher must accept a card for it to be shown. A later criterion (type, source folder,
 * tags) is one more matcher. */
type MaterialMatcher = (card: Card, filter: MaterialFilter) => boolean;

const MATCHERS: MaterialMatcher[] = [
  (card, filter) => !filter.text || card.searchText.includes(filter.text),
];

/** The collapse button's chevron (down while open: it collapses) */
const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

/** The type without its NodeMaterial suffix, eg. 'STANDARD' for 'STANDARDNODEMATERIAL'. */
const getBaseType = (type: string) => type.replace(/NODEMATERIAL$/, '');

const getCardTooltip = (entry: MaterialSelectorEntry, failure?: string) =>
  [
    entry.unavailableReason ? `Unavailable: ${entry.unavailableReason}` : '',
    failure ? `Failed to load: ${failure}` : '',
    entry.sourcePath ?? '',
    entry.description ?? '',
  ]
    .filter(Boolean)
    .join(' · ') || entry.id;

const byNameThenId = (a: MaterialSelectorEntry, b: MaterialSelectorEntry) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The height kept between the lowest and its share of the bounds, in whole px */
const clampHeight = (height: number) => {
  const max = Math.max(
    SELECTOR_MIN_HEIGHT,
    Math.floor(getWindowSize().height * SELECTOR_MAX_SHARE)
  );
  return Math.round(Math.min(max, Math.max(SELECTOR_MIN_HEIGHT, height)));
};

/** A card: a kit button with the preview slot before its name, and the id and the badges after */
const createCard = (entry: MaterialSelectorEntry, onPick: (id: string) => void): Card => {
  const button = createButton({
    label: entry.name,
    class: styles.card,
    attr: {
      'data-id': entry.id,
      tabindex: '-1',
      ...(entry.unavailableReason ? { 'aria-disabled': 'true' } : {}),
    },
    onClick: () => {
      if (!entry.unavailableReason) onPick(entry.id);
    },
  });
  const elem = button.cmp.elem as HTMLButtonElement;
  // Reserved for the preview thumbnails (later): a swatch of the first colour, or the initials
  const slot = document.createElement('span');
  slot.className = `${styles.previewSlot} matEditorPreviewSlot`;
  slot.setAttribute('aria-hidden', 'true');
  if (entry.swatch) slot.style.background = entry.swatch;
  else slot.textContent = getBaseType(entry.type).slice(0, 2);
  elem.prepend(slot);

  const meta = button.cmp.add({ tag: 'span', class: styles.cardMeta });
  meta.add({ tag: 'span', class: styles.cardId, text: entry.id });
  const badges = meta.add({ tag: 'span', class: styles.cardBadges });
  badges.add(createBadge({ label: getBaseType(entry.type) }).cmp);
  if (entry.isTsl) badges.add(createBadge({ label: 'TSL', tone: 'info' }).cmp);
  // Shown only while the card is `data-failed` (the tooltip says why)
  const failed = createBadge({ label: 'Failed', tone: 'danger' });
  failed.cmp.updateClass(styles.cardFailed, 'add');
  badges.add(failed.cmp);

  const tooltip = createTooltip({ anchor: elem, text: getCardTooltip(entry) });
  return {
    entry,
    button,
    elem,
    tooltip,
    searchText: `${entry.id}\n${entry.name}`.toLowerCase(),
    isShown: true,
  };
};

/** The cards in a row of the grid as it's laid out: those at the first shown card's top */
const countColumns = (shown: Card[]) => {
  if (!shown.length) return 1;
  const top = shown[0].elem.offsetTop;
  let count = 0;
  while (count < shown.length && shown[count].elem.offsetTop === top) count++;
  return Math.max(1, count);
};

/**
 * Creates the material selector (the editor's bottom drawer) in `opts.parent` (see the file
 * comment).
 * @param opts ({@link MaterialSelectorOpts})
 * @returns ({@link MaterialSelector})
 */
export const createMaterialSelector = (opts: MaterialSelectorOpts): MaterialSelector => {
  const state: MaterialSelectorState = {
    isOpen: opts.initialState?.isOpen ?? true,
    filterText: opts.initialState?.filterText ?? '',
    scrollTop: opts.initialState?.scrollTop ?? 0,
    ...(opts.initialState?.height === undefined ? {} : { height: opts.initialState.height }),
  };
  const notify = () => opts.onStateChange?.({ ...state });
  let height = clampHeight(state.height ?? SELECTOR_DEFAULT_HEIGHT);
  let disposeHandle: (() => void) | null = null;

  const cards: Card[] = [];
  const root = opts.parent.add({
    tag: 'section',
    class: [styles.selector, 'matEditorSelector'],
    onRemoveCmp: () => {
      disposeHandle?.();
      disposeHandle = null;
      for (const card of cards) card.tooltip.cmp.remove();
    },
  });

  // The height handle on the top edge, over the canvas
  const handle = root.add({
    class: styles.heightHandle,
    attr: {
      role: 'separator',
      tabindex: '0',
      'aria-orientation': 'horizontal',
      'aria-label': 'Materials height',
    },
  });

  // Header row (always visible): title, count, search, collapse
  const header = root.add({ class: styles.selectorHeader });
  const title = header.add({
    tag: 'h3',
    idAttr: true,
    class: styles.selectorTitle,
    text: 'Materials',
  });
  root.updateAttr({ 'aria-labelledby': title.id });
  const count = header.add({ tag: 'span', class: styles.selectorCount, text: '' });
  const search = createTextField({
    type: 'search',
    label: 'Filter materials by id or name',
    labelHidden: true,
    placeholder: 'Filter by id or name',
    live: true,
    get: () => state.filterText,
    set: (text) => setFilterText(text),
    class: styles.filterField,
  });
  header.add(search.cmp);
  const body = CMP({ idAttr: true, class: styles.selectorBody });
  const collapse = createButton({
    label: 'Collapse the materials',
    icon: CHEVRON_ICON,
    iconOnly: true,
    variant: 'ghost',
    size: 'sm',
    class: styles.collapseButton,
    attr: { 'aria-expanded': String(state.isOpen), 'aria-controls': body.id },
    onClick: () => setOpen(!state.isOpen),
  });
  header.add(collapse.cmp);
  handle.updateAttr({ 'aria-controls': body.id });

  root.add(body);
  const grid = body.add({
    class: styles.grid,
    attr: { role: 'toolbar', 'aria-label': 'Materials' },
  });
  const emptyNotice = body.add({ tag: 'p', class: styles.emptyNotice, text: '' });

  for (const entry of opts.entries.slice().sort(byNameThenId)) {
    const card = createCard(entry, opts.onSelect);
    cards.push(card);
    grid.add(card.button.cmp);
  }

  const isSkipped = (index: number) => !cards[index].isShown;
  const tabStop = createRovingTabStop({ getElems: () => cards.map((card) => card.elem) });

  /** The tab stop on a shown card: the shown material's, else the first */
  const resetTabStop = () => {
    const current = tabStop.getIndex();
    if (current >= 0 && cards[current]?.isShown) return;
    const selectedId = opts.getSelectedId();
    const selected = cards.findIndex((card) => card.isShown && card.entry.id === selectedId);
    tabStop.reset(selected >= 0 ? selected : cards.findIndex((card) => card.isShown));
  };

  const onGridKeyDown = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.ctrlKey || ke.metaKey || ke.altKey) return;
    const index = cards.findIndex((card) => card.elem.contains(e.target as Node));
    if (index === -1) return;
    let next: number | null = null;
    if (ke.key === 'ArrowUp' || ke.key === 'ArrowDown') {
      const shown = cards.filter((card) => card.isShown);
      const at = shown.indexOf(cards[index]);
      const columns = countColumns(shown);
      const target = shown[at + (ke.key === 'ArrowDown' ? columns : -columns)];
      next = target ? cards.indexOf(target) : -1;
    } else {
      next = getMoveTarget(ke.key, index, {
        count: cards.length,
        orientation: 'horizontal',
        isSkipped,
      });
    }
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(ke.key);
    if (next === -1) return;
    tabStop.setIndex(next);
    cards[next].elem.focus();
  };
  grid.elem.addEventListener('keydown', onGridKeyDown);
  grid.elem.addEventListener('focusin', tabStop.onFocusIn);

  const applyFilter = (doAnnounce: boolean) => {
    const filter: MaterialFilter = { text: state.filterText.trim().toLowerCase() };
    let shown = 0;
    for (const card of cards) {
      card.isShown = MATCHERS.every((matcher) => matcher(card, filter));
      if (card.isShown) {
        card.elem.removeAttribute('hidden');
        shown++;
      } else {
        card.elem.setAttribute('hidden', '');
      }
    }
    count.updateText(`${shown} / ${cards.length}`);
    emptyNotice.updateText(
      !cards.length
        ? 'No project materials (*.material.json) found.'
        : !shown
          ? 'No material matches the filter.'
          : ''
    );
    resetTabStop();
    if (doAnnounce) announce(root.elem, `${shown} of ${cards.length} materials`);
  };

  const writeHeight = (next: number) => {
    height = next;
    root.elem.style.setProperty(HEIGHT_PROPERTY, `${next}px`);
    const el = handle.elem;
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(clampHeight(Infinity)));
    el.setAttribute('aria-valuenow', String(state.isOpen ? next : 0));
    el.setAttribute('aria-valuetext', state.isOpen ? `${next} px` : 'Collapsed');
  };

  const applyOpen = () => {
    root.updateAttr({ 'data-state': state.isOpen ? 'open' : 'collapsed' });
    if (state.isOpen) body.elem.removeAttribute('hidden');
    else body.elem.setAttribute('hidden', '');
    collapse.setLabel(state.isOpen ? 'Collapse the materials' : 'Expand the materials');
    collapse.cmp.updateAttr({ 'aria-expanded': String(state.isOpen) });
    writeHeight(height);
  };

  const refresh = () => {
    const selectedId = opts.getSelectedId();
    const loadingId = opts.getLoadingId();
    for (const card of cards) {
      const { id } = card.entry;
      const failure = opts.getFailure(id);
      const { elem } = card;
      if (id === selectedId) elem.setAttribute('aria-current', 'true');
      else elem.removeAttribute('aria-current');
      if (id === loadingId) elem.setAttribute('aria-busy', 'true');
      else elem.removeAttribute('aria-busy');
      if (failure) elem.setAttribute('data-failed', '');
      else elem.removeAttribute('data-failed');
      card.tooltip.setText(getCardTooltip(card.entry, failure));
    }
  };

  const restoreScroll = () => {
    body.elem.scrollTop = state.scrollTop;
  };

  const setOpen = (isOpen: boolean) => {
    if (state.isOpen === isOpen) return;
    // What had the focus is going: the collapse button keeps it
    if (!isOpen && body.elem.contains(document.activeElement)) collapse.cmp.elem.focus();
    state.isOpen = isOpen;
    applyOpen();
    // The collapsed body is hidden, which loses its scroll position
    if (isOpen) restoreScroll();
    notify();
  };

  function setFilterText(text: string) {
    if (state.filterText === text) return;
    state.filterText = text;
    applyFilter(true);
    notify();
  }

  body.elem.addEventListener('scroll', () => {
    if (!state.isOpen) return;
    state.scrollTop = body.elem.scrollTop;
    notify();
  });

  /** The selector's bottom edge, read at a drag's press */
  let bottomEdge = 0;
  // The values are the height negated: the edge moves up (back) as the body heightens
  const input = createSeparatorInput(handle.elem, {
    axis: 'y',
    step: HEIGHT_STEP,
    get: () => (state.isOpen ? -height : 0),
    getMin: () => -SELECTOR_MIN_HEIGHT,
    getMax: () => -clampHeight(Infinity),
    set: (value) => {
      writeHeight(clampHeight(-value));
      // A move restores a collapsed body at the moved height
      if (!state.isOpen) setOpen(true);
    },
    getValueAt: (e) => e.clientY - bottomEdge,
    onPress: () => (bottomEdge = root.elem.getBoundingClientRect().bottom),
    onCommit: () => {
      state.height = height;
      notify();
    },
    onEnter: () => setOpen(!state.isOpen),
  });
  disposeHandle = () => {
    input.dispose();
    grid.elem.removeEventListener('keydown', onGridKeyDown);
    grid.elem.removeEventListener('focusin', tabStop.onFocusIn);
  };

  applyFilter(false);
  applyOpen();
  refresh();
  // After the cards are in the DOM, so there is something to scroll
  restoreScroll();

  return {
    cmp: root,
    elem: root.elem,
    refresh,
    setOpen,
    getState: () => ({ ...state }),
    restoreScroll,
    dispose: () => root.remove(),
  };
};
