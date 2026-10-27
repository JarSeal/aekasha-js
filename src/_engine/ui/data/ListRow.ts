// A list's entries and rows (p805 D6, D8). An entry is an item's key, its text as last read and its
// state, for every item; a row is the elements that show one entry, made only where it renders
// (every entry without virtual rows) and bound to another entry when it's recycled. A row writes a
// part only when its text changed, so a live figure writes one text node. `List.ts` keeps the
// order, the filter, the selection, the keys and which entries render.
import type { CMPHandle } from '../core/CMPTypes';
import { updateBadge, type Badge, type BadgeValue } from '../components/Badge';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { appendMarked, foldText } from './Filter';
import type { ListAction, ListProps } from './ListTypes';

/**
 * An entry's parts as last read from its item.
 * @internal
 */
export type ListEntryText = {
  title: string;
  subTitle: string;
  description: string;
  suffix: string;
  icon: string;
  tooltip: string;
  badge: BadgeValue | null;
  isPlaceholder: boolean;
  isDisabled: boolean;
};

/**
 * One item of the list: its key, its text, its state and the row showing it (null where it
 * doesn't render).
 * @internal
 */
export type ListEntry<T> = {
  key: string;
  item: T;
  /** Its index in the items */
  index: number;
  /** Its index among the shown entries (-1: filtered out) */
  shownIndex: number;
  isShown: boolean;
  isSelected: boolean;
  text: ListEntryText;
  /** The text folded, for the filter */
  folded: string;
  /** The title folded, for the typeahead */
  foldedTitle: string;
  view: ListRow<T> | null;
};

/**
 * The last values a row wrote, so an unchanged one isn't written again.
 * @internal
 */
export type ListRowWritten = {
  key: string;
  title: string;
  subTitle: string;
  description: string;
  suffix: string;
  icon: string;
  tooltip: string;
  badgeLabel: string | number | null;
  badgeTone: string;
  badgeSpoken: string | undefined;
  isPlaceholder: boolean;
  isDisabled: boolean;
  isSelected: boolean;
  /** The query the parts were last marked for */
  query: string;
};

/**
 * An action's cell on a row and what it last showed.
 * @internal
 */
export type ListActionCell = {
  button: HTMLButtonElement;
  icon: HTMLElement;
  tooltip: Tooltip;
  label: string;
  iconHtml: string;
  pressed: boolean | null;
  isDisabled: boolean;
  isHidden: boolean;
};

/**
 * The elements that show an entry, and what they last showed.
 * @internal
 */
export type ListRow<T> = {
  /** The entry it shows (null: in the pool) */
  entry: ListEntry<T> | null;
  /** The row: an `<li>`, an option or a grid row */
  elem: HTMLElement;
  /** What takes the focus for the row: the option, or the grid row's first cell (the `<li>`) */
  main: HTMLElement;
  /** Where the parts or the rendered CMP go */
  content: HTMLElement;
  title: HTMLElement | null;
  subTitle: HTMLElement | null;
  description: HTMLElement | null;
  suffix: HTMLElement | null;
  icon: HTMLElement | null;
  badge: Badge | null;
  rendered: CMPHandle | null;
  /** The item `rendered` was made from */
  renderedItem: T | undefined;
  tooltip: Tooltip | null;
  actions: ListActionCell[];
  written: ListRowWritten;
};

/**
 * A row's class, which the list finds its rows by.
 * @internal
 */
export const ROW_CLASS = 'aekList__row';

/**
 * An element with its class.
 * @internal
 */
export const createElem = (tag: string, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/**
 * Writes an attribute only when it changes; `null` removes it.
 * @internal
 */
export const writeAttr = (elem: Element, name: string, value: string | null) => {
  if (value === null) {
    if (elem.hasAttribute(name)) elem.removeAttribute(name);
  } else if (elem.getAttribute(name) !== value) elem.setAttribute(name, value);
};

/**
 * The filter's query as the rows mark it: the list writes it, the rows read it.
 * @internal
 */
export type ListMarks = { query: string; words: readonly string[] };

/**
 * What `createListRows` writes rows for.
 * @internal
 */
export type ListRowsConfig<T> = {
  props: ListProps<T>;
  mode: 'static' | 'listbox' | 'grid';
  marks: ListMarks;
  /** Whether rows have a drag handle (a reorder) */
  hasHandle: boolean;
};

/** A drag handle's grip: six dots, in the text colour */
const GRIP_SVG =
  '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.25"/><circle cx="10.5" cy="3.5" r="1.25"/><circle cx="5.5" cy="8" r="1.25"/><circle cx="10.5" cy="8" r="1.25"/><circle cx="5.5" cy="12.5" r="1.25"/><circle cx="10.5" cy="12.5" r="1.25"/></svg>';

/** A badge's value, split for comparing */
const splitBadge = (value: BadgeValue | null) => {
  const isObject = typeof value === 'object' && value !== null;
  return {
    label: isObject ? value.label : value,
    tone: (isObject ? value.tone : undefined) ?? 'neutral',
    spoken: isObject ? value.spokenLabel : undefined,
  };
};

/**
 * A list's entries and rows: `createEntry(key, item)` and `readEntry(entry)` (its text read again,
 * folded again when it changed: whether it did), `createRow()`, `bindRow(row, entry)` (shows the
 * entry: a recycled row writes only what differs), `writeRow(row, isNewItem)` (the entry's text
 * and state written; `isNewItem` renders a `render` row again) and `disposeRow(row)` (removed
 * with its tooltips and rendered CMP).
 * @internal
 */
export const createListRows = <T>({ props, mode, marks, hasHandle }: ListRowsConfig<T>) => {
  const { actions = [] } = props;
  const isInteractive = mode !== 'static';
  const selectionMode = props.selection ?? 'none';

  // --- Entries ---

  const readEntry = (entry: ListEntry<T>) => {
    const { item, text } = entry;
    const title = props.title?.(item) ?? entry.key;
    const isDisabled = props.disabled?.(item) ?? false;
    const tooltip = props.tooltip?.(item) ?? '';
    text.isDisabled = isDisabled;
    text.tooltip = tooltip;
    if (props.render) {
      if (text.title === title && entry.folded) return false;
      text.title = title;
      entry.folded = entry.foldedTitle = foldText(title);
      return true;
    }
    const subTitle = props.subTitle?.(item) ?? '';
    const description = props.description?.(item) ?? '';
    const suffix = props.suffix?.(item) ?? '';
    const badge = props.badge?.(item) ?? null;
    text.icon = props.icon?.(item) ?? '';
    text.isPlaceholder = props.isPlaceholder?.(item) ?? false;
    const badgeLabel = splitBadge(badge).label ?? '';
    const oldLabel = splitBadge(text.badge).label ?? '';
    text.badge = badge;
    if (
      entry.folded &&
      title === text.title &&
      subTitle === text.subTitle &&
      description === text.description &&
      suffix === text.suffix &&
      badgeLabel === oldLabel
    ) {
      return false;
    }
    if (title !== text.title || !entry.foldedTitle) entry.foldedTitle = foldText(title);
    text.title = title;
    text.subTitle = subTitle;
    text.description = description;
    text.suffix = suffix;
    entry.folded = foldText(`${title} ${subTitle} ${description} ${suffix} ${badgeLabel}`);
    return true;
  };

  const createEntry = (key: string, item: T): ListEntry<T> => {
    const entry: ListEntry<T> = {
      key,
      item,
      index: -1,
      shownIndex: -1,
      isShown: true,
      isSelected: false,
      text: {
        title: '',
        subTitle: '',
        description: '',
        suffix: '',
        icon: '',
        tooltip: '',
        badge: null,
        isPlaceholder: false,
        isDisabled: false,
      },
      folded: '',
      foldedTitle: '',
      view: null,
    };
    readEntry(entry);
    return entry;
  };

  // --- Writing a row ---

  /** Writes a text part made on first use; an empty text hides it */
  const writePart = (
    row: ListRow<T>,
    part: 'subTitle' | 'description' | 'suffix',
    text: string,
    place: (elem: HTMLElement) => void
  ) => {
    if (row.written[part] === text && row.written.query === marks.query) return;
    row.written[part] = text;
    let elem = row[part];
    if (!elem) {
      if (!text) return;
      elem = createElem('span', `aekList__${part}`);
      row[part] = elem;
      place(elem);
    }
    writeAttr(elem, 'hidden', text ? null : '');
    if (marks.words.length) {
      elem.textContent = '';
      appendMarked(elem, text, marks.words);
    } else elem.textContent = text;
  };

  const writeTitle = (row: ListRow<T>, text: string) => {
    if (row.written.title === text && row.written.query === marks.query) return;
    row.written.title = text;
    const elem = row.title as HTMLElement;
    if (marks.words.length) {
      elem.textContent = '';
      appendMarked(elem, text, marks.words);
    } else elem.textContent = text;
  };

  const writeIcon = (row: ListRow<T>, html: string) => {
    if (row.written.icon === html) return;
    row.written.icon = html;
    if (!row.icon) {
      if (!html) return;
      row.icon = createElem('span', 'aekList__icon');
      row.icon.setAttribute('aria-hidden', 'true');
      // Before the badge, if there's one, and the text
      row.content.insertBefore(row.icon, row.badge?.cmp.elem ?? row.title?.parentNode ?? null);
    }
    writeAttr(row.icon, 'hidden', html ? null : '');
    row.icon.innerHTML = html;
  };

  const writeBadge = (row: ListRow<T>, value: BadgeValue | null) => {
    const { label, tone, spoken } = splitBadge(value);
    const { written } = row;
    const next = label ?? null;
    if (
      written.badgeLabel === next &&
      written.badgeTone === tone &&
      written.badgeSpoken === spoken
    ) {
      return;
    }
    written.badgeLabel = next;
    written.badgeTone = tone;
    written.badgeSpoken = spoken;
    const badge = updateBadge(row.badge, next === null ? null : value, 'aekList__badge');
    if (badge && badge !== row.badge) {
      row.content.insertBefore(badge.cmp.elem, row.title?.parentNode ?? null);
    }
    row.badge = badge;
  };

  const writeTooltip = (row: ListRow<T>, text: string) => {
    if (row.written.tooltip === text) return;
    row.written.tooltip = text;
    if (!text) {
      row.tooltip?.cmp.remove();
      row.tooltip = null;
    } else if (row.tooltip) row.tooltip.setText(text);
    else row.tooltip = createTooltip({ anchor: row.main, text });
  };

  const writeAction = (row: ListRow<T>, cell: ListActionCell, action: ListAction<T>) => {
    const { item, text } = row.entry as ListEntry<T>;
    const isHidden = action.hidden?.(item) ?? false;
    const isDisabled = text.isDisabled || (action.disabled?.(item) ?? false);
    const pressed = action.pressed ? action.pressed(item) : null;
    const label = typeof action.label === 'function' ? action.label(item) : action.label;
    const iconHtml = pressed === false && action.iconOff ? action.iconOff : action.icon;
    const { button } = cell;
    if (cell.isHidden !== isHidden) {
      cell.isHidden = isHidden;
      writeAttr(button, 'hidden', isHidden ? '' : null);
    }
    if (cell.isDisabled !== isDisabled) {
      cell.isDisabled = isDisabled;
      writeAttr(button, 'disabled', isDisabled ? '' : null);
    }
    if (cell.pressed !== pressed) {
      cell.pressed = pressed;
      writeAttr(button, 'aria-pressed', pressed === null ? null : String(pressed));
    }
    if (cell.label !== label) {
      cell.label = label;
      button.setAttribute('aria-label', label);
      cell.tooltip.setText(label);
    }
    if (cell.iconHtml !== iconHtml) {
      cell.iconHtml = iconHtml;
      cell.icon.innerHTML = iconHtml;
    }
  };

  /** Writes the row's entry: its key, state and parts where they differ from what it shows */
  const writeRow = (row: ListRow<T>, isNewItem: boolean) => {
    const entry = row.entry;
    if (!entry) return;
    const { elem, written } = row;
    if (written.key !== entry.key) {
      written.key = entry.key;
      elem.setAttribute('data-key', entry.key);
    }
    if (written.isDisabled !== entry.text.isDisabled) {
      written.isDisabled = entry.text.isDisabled;
      const isDisabled = written.isDisabled;
      if (isInteractive) writeAttr(elem, 'aria-disabled', isDisabled ? 'true' : null);
      else writeAttr(elem, 'data-disabled', isDisabled ? '' : null);
    }
    if (selectionMode !== 'none' && written.isSelected !== entry.isSelected) {
      written.isSelected = entry.isSelected;
      elem.setAttribute('aria-selected', String(entry.isSelected));
    }
    if (props.render) {
      if (isNewItem || !row.rendered || row.renderedItem !== entry.item) {
        row.rendered?.remove();
        row.rendered = props.render(entry.item);
        row.renderedItem = entry.item;
        row.content.append(row.rendered.elem);
      }
    } else {
      writeIcon(row, entry.text.icon);
      writeBadge(row, entry.text.badge);
      writeTitle(row, entry.text.title);
      const textElem = row.title?.parentNode as HTMLElement;
      writePart(row, 'subTitle', entry.text.subTitle, (e) => textElem.prepend(e));
      writePart(row, 'description', entry.text.description, (e) => textElem.append(e));
      writePart(row, 'suffix', entry.text.suffix, (e) => row.content.append(e));
      written.query = marks.query;
      if (written.isPlaceholder !== entry.text.isPlaceholder) {
        written.isPlaceholder = entry.text.isPlaceholder;
        writeAttr(row.title as HTMLElement, 'data-placeholder', written.isPlaceholder ? '' : null);
      }
    }
    writeTooltip(row, entry.text.tooltip);
    for (let i = 0; i < actions.length; i++) writeAction(row, row.actions[i], actions[i]);
  };

  const bindRow = (row: ListRow<T>, entry: ListEntry<T>) => {
    if (row.entry && row.entry !== entry) row.entry.view = null;
    row.entry = entry;
    entry.view = row;
    writeRow(row, false);
  };

  const createRow = (): ListRow<T> => {
    let elem: HTMLElement;
    let main: HTMLElement;
    if (mode === 'static') {
      elem = main = createElem('li', ROW_CLASS);
    } else if (mode === 'listbox') {
      elem = main = createElem('div', ROW_CLASS);
      elem.setAttribute('role', 'option');
      elem.setAttribute('tabindex', '-1');
    } else {
      elem = createElem('div', ROW_CLASS);
      elem.setAttribute('role', 'row');
      main = createElem('div', 'aekList__main');
      main.setAttribute('role', 'gridcell');
      main.setAttribute('tabindex', '-1');
      elem.append(main);
    }
    if (selectionMode !== 'none') elem.setAttribute('aria-selected', 'false');
    if (hasHandle) {
      const grip = createElem('span', 'aekList__handle');
      grip.setAttribute('aria-hidden', 'true');
      grip.innerHTML = GRIP_SVG;
      main.append(grip);
    }
    const content = createElem('span', 'aekList__content');
    main.append(content);
    let title: HTMLElement | null = null;
    if (!props.render) {
      const textElem = createElem('span', 'aekList__text');
      title = createElem('span', 'aekList__title');
      textElem.append(title);
      content.append(textElem);
    }
    const row: ListRow<T> = {
      entry: null,
      elem,
      main,
      content,
      title,
      subTitle: null,
      description: null,
      suffix: null,
      icon: null,
      badge: null,
      rendered: null,
      renderedItem: undefined,
      tooltip: null,
      actions: [],
      written: {
        key: '',
        title: '',
        subTitle: '',
        description: '',
        suffix: '',
        icon: '',
        tooltip: '',
        badgeLabel: null,
        badgeTone: 'neutral',
        badgeSpoken: undefined,
        isPlaceholder: false,
        isDisabled: false,
        isSelected: false,
        query: '',
      },
    };
    for (let i = 0; i < actions.length; i++) {
      const cell = createElem('div', 'aekList__actionCell');
      cell.setAttribute('role', 'gridcell');
      const button = createElem('button', 'aekList__action') as HTMLButtonElement;
      button.type = 'button';
      button.setAttribute('tabindex', '-1');
      button.setAttribute('data-action', String(i));
      const icon = createElem('span', 'aekList__actionIcon');
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      cell.append(button);
      elem.append(cell);
      row.actions.push({
        button,
        icon,
        tooltip: createTooltip({ anchor: button, text: '' }),
        label: '',
        iconHtml: '',
        pressed: null,
        isDisabled: false,
        isHidden: false,
      });
    }
    return row;
  };

  const disposeRow = (row: ListRow<T>) => {
    if (row.entry) row.entry.view = null;
    row.entry = null;
    row.tooltip?.cmp.remove();
    row.tooltip = null;
    for (const cell of row.actions) cell.tooltip.cmp.remove();
    row.rendered?.remove();
    row.rendered = null;
    row.elem.remove();
  };

  return { createEntry, readEntry, createRow, bindRow, writeRow, disposeRow };
};
