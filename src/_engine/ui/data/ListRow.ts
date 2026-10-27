// A list's rows (p805 D6): each made once for its key, its parts written only when their text
// changed, so a live figure writes one text node. `List.ts` keeps the rows' order, the filter, the
// selection and the keys.
import type { CMPHandle } from '../core/CMPTypes';
import { updateBadge, type Badge, type BadgeValue } from '../components/Badge';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { appendMarked, foldText } from './Filter';
import type { ListAction, ListProps } from './List';

/**
 * The last values written to a row's parts, so an unchanged one isn't written.
 * @internal
 */
export type ListRowWritten = {
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
  /** The query the title and description were last marked for */
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
 * A row of the list: its elements, its item and what it last showed.
 * @internal
 */
export type ListRow<T> = {
  key: string;
  item: T;
  /** Its index in `rows` */
  index: number;
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
  tooltip: Tooltip | null;
  actions: ListActionCell[];
  written: ListRowWritten;
  /** The row's text folded, for the filter */
  folded: string;
  /** The title folded, for the typeahead */
  foldedTitle: string;
  isShown: boolean;
  isSelected: boolean;
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
};

/**
 * A list's row writer: `createRow(key, item)` makes a row and writes it, `writeRow(row, isNewItem)`
 * reads its item again and writes what changed (`isNewItem`: a `render` row is rendered again),
 * `disposeRow(row)` removes it with its tooltips and rendered CMP.
 * @internal
 */
export const createListRows = <T>({ props, mode, marks }: ListRowsConfig<T>) => {
  const { actions = [] } = props;
  const isInteractive = mode !== 'static';
  const selectionMode = props.selection ?? 'none';

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
    row.foldedTitle = foldText(text);
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
      row.content.insertBefore(row.icon, row.content.firstChild);
    }
    writeAttr(row.icon, 'hidden', html ? null : '');
    row.icon.innerHTML = html;
  };

  const writeBadge = (row: ListRow<T>, value: BadgeValue | null | undefined) => {
    const isObject = typeof value === 'object' && value !== null;
    const label = isObject ? value.label : value ?? null;
    const tone = (isObject ? value.tone : undefined) ?? 'neutral';
    const spoken = isObject ? value.spokenLabel : undefined;
    const { written } = row;
    if (
      written.badgeLabel === label &&
      written.badgeTone === tone &&
      written.badgeSpoken === spoken
    ) {
      return;
    }
    written.badgeLabel = label;
    written.badgeTone = tone;
    written.badgeSpoken = spoken;
    const next = updateBadge(row.badge, label === null ? null : value, 'aekList__badge');
    if (next && next !== row.badge)
      row.content.insertBefore(next.cmp.elem, row.title?.parentNode ?? null);
    row.badge = next;
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
    const { item } = row;
    const isHidden = action.hidden?.(item) ?? false;
    const isDisabled = row.written.isDisabled || (action.disabled?.(item) ?? false);
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

  /** Reads a row's item and writes its changed parts; `isNewItem` renders a `render` row again */
  const writeRow = (row: ListRow<T>, isNewItem: boolean) => {
    const { item, written } = row;
    const title = props.title?.(item) ?? row.key;
    const isDisabled = props.disabled?.(item) ?? false;
    if (written.isDisabled !== isDisabled) {
      written.isDisabled = isDisabled;
      if (isInteractive) writeAttr(row.elem, 'aria-disabled', isDisabled ? 'true' : null);
      else writeAttr(row.elem, 'data-disabled', isDisabled ? '' : null);
    }
    if (props.render) {
      if (isNewItem || !row.rendered) {
        row.rendered?.remove();
        row.rendered = props.render(item);
        row.content.append(row.rendered.elem);
      }
      if (written.title !== title) {
        written.title = title;
        row.foldedTitle = row.folded = foldText(title);
      }
    } else {
      const before = written.title + written.subTitle + written.description + written.suffix;
      const badgeBefore = written.badgeLabel;
      writeIcon(row, props.icon?.(item) ?? '');
      writeBadge(row, props.badge?.(item));
      writeTitle(row, title);
      const text = row.title?.parentNode as HTMLElement;
      writePart(row, 'subTitle', props.subTitle?.(item) ?? '', (e) => text.prepend(e));
      writePart(row, 'description', props.description?.(item) ?? '', (e) => text.append(e));
      writePart(row, 'suffix', props.suffix?.(item) ?? '', (e) => row.content.append(e));
      written.query = marks.query;
      const isPlaceholder = props.isPlaceholder?.(item) ?? false;
      if (written.isPlaceholder !== isPlaceholder) {
        written.isPlaceholder = isPlaceholder;
        writeAttr(row.title as HTMLElement, 'data-placeholder', isPlaceholder ? '' : null);
      }
      // The filter's text: folded again only when a part of it changed
      if (
        before !== written.title + written.subTitle + written.description + written.suffix ||
        badgeBefore !== written.badgeLabel ||
        !row.folded
      ) {
        row.folded = foldText(
          `${written.title} ${written.subTitle} ${written.description} ${written.suffix} ${written.badgeLabel ?? ''}`
        );
      }
    }
    writeTooltip(row, props.tooltip?.(item) ?? '');
    for (let i = 0; i < actions.length; i++) writeAction(row, row.actions[i], actions[i]);
  };

  const createRow = (key: string, item: T): ListRow<T> => {
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
    elem.setAttribute('data-key', key);
    if (selectionMode !== 'none') elem.setAttribute('aria-selected', 'false');
    const content = createElem('span', 'aekList__content');
    main.append(content);
    let title: HTMLElement | null = null;
    if (!props.render) {
      const text = createElem('span', 'aekList__text');
      title = createElem('span', 'aekList__title');
      text.append(title);
      content.append(text);
    }
    const row: ListRow<T> = {
      key,
      item,
      index: -1,
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
      tooltip: null,
      actions: [],
      written: {
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
        query: '',
      },
      folded: '',
      foldedTitle: '',
      isShown: true,
      isSelected: false,
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
    writeRow(row, true);
    return row;
  };

  const disposeRow = (row: ListRow<T>) => {
    row.tooltip?.cmp.remove();
    row.tooltip = null;
    for (const cell of row.actions) cell.tooltip.cmp.remove();
    row.rendered?.remove();
    row.rendered = null;
    row.elem.remove();
  };

  return { createRow, writeRow, disposeRow };
};
