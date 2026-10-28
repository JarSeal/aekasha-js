// A tree's rows (p805 D7): the elements that show one entry, made only where it renders (the shown
// lines, or virtual rows' window) and bound to another entry when it's recycled, writing a part
// only when its text changed; and the status rows under a lazy node. `Tree.ts` keeps which lines
// render and where.
import type { CMPHandle } from '../core/CMPTypes';
import { updateBadge, type Badge, type BadgeValue } from '../components/Badge';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { createElem, writeAttr } from './CollectionParts';
import { appendMarked } from './Filter';
import type { TreeEntry, TreeStatus } from './TreeNodes';
import type { TreeProps } from './TreeTypes';

/**
 * The last values a row wrote, so an unchanged one isn't written again.
 * @internal
 */
export type TreeRowWritten = {
  key: string;
  title: string;
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
  level: number;
};

/**
 * The elements that show an entry, and what they last showed.
 * @internal
 */
export type TreeRow<T> = {
  /** The entry it shows (null: in the pool) */
  entry: TreeEntry<T> | null;
  /** The tree item */
  elem: HTMLElement;
  /** Where the parts or the rendered CMP go */
  content: HTMLElement;
  title: HTMLElement | null;
  suffix: HTMLElement | null;
  icon: HTMLElement | null;
  badge: Badge | null;
  rendered: CMPHandle | null;
  /** The node `rendered` was made from */
  renderedNode: T | undefined;
  tooltip: Tooltip | null;
  written: TreeRowWritten;
};

/**
 * A node row's class, which the tree finds its lines by.
 * @internal
 */
export const TREE_ROW_CLASS = 'aekTree__row';

/**
 * A lazy node's status row's class, which the tree finds its lines by.
 * @internal
 */
export const TREE_STATUS_CLASS = 'aekTree__status';

/**
 * The filter's query as the rows mark it: the tree writes it, the rows read it.
 * @internal
 */
export type TreeMarks = { query: string; words: readonly string[] };

/** A badge's value, split for comparing */
const splitBadge = (value: BadgeValue | null) => {
  const isObject = typeof value === 'object' && value !== null;
  return {
    label: isObject ? value.label : value,
    tone: (isObject ? value.tone : undefined) ?? 'neutral',
    spoken: isObject ? value.spokenLabel : undefined,
  };
};

/** Writes the indent's level (`--aek-tree-level`, read by the row's padding) */
const writeLevel = (elem: HTMLElement, level: number) =>
  elem.style.setProperty('--aek-tree-level', String(level));

/**
 * A tree's rows: `createRow()`, `bindRow(row, entry)` (shows the entry: a recycled row writes only
 * what differs), `writeRow(row, isNewNode)` (the entry's parts and state; `isNewNode` renders a
 * `render` row again), `writePlace(row)` (its level, place among its siblings, open and busy
 * states: after each `computeShown`) and `disposeRow(row)` (removed with its tooltip and
 * rendered CMP).
 * @internal
 */
export const createTreeRows = <T>({ props, marks }: { props: TreeProps<T>; marks: TreeMarks }) => {
  const hasSelection = (props.selection ?? 'none') !== 'none';

  const writeMarked = (elem: HTMLElement, text: string) => {
    if (marks.words.length) {
      elem.textContent = '';
      appendMarked(elem, text, marks.words);
    } else elem.textContent = text;
  };

  const writeTitle = (row: TreeRow<T>, text: string) => {
    if (row.written.title === text && row.written.query === marks.query) return;
    row.written.title = text;
    writeMarked(row.title as HTMLElement, text);
  };

  const writeSuffix = (row: TreeRow<T>, text: string) => {
    if (row.written.suffix === text && row.written.query === marks.query) return;
    row.written.suffix = text;
    if (!row.suffix) {
      if (!text) return;
      row.suffix = createElem('span', 'aekTree__suffix');
      row.content.append(row.suffix);
    }
    writeAttr(row.suffix, 'hidden', text ? null : '');
    writeMarked(row.suffix, text);
  };

  const writeIcon = (row: TreeRow<T>, html: string) => {
    if (row.written.icon === html) return;
    row.written.icon = html;
    if (!row.icon) {
      if (!html) return;
      row.icon = createElem('span', 'aekTree__icon');
      row.icon.setAttribute('aria-hidden', 'true');
      row.content.insertBefore(row.icon, row.badge?.cmp.elem ?? row.title);
    }
    writeAttr(row.icon, 'hidden', html ? null : '');
    row.icon.innerHTML = html;
  };

  const writeBadge = (row: TreeRow<T>, value: BadgeValue | null) => {
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
    const badge = updateBadge(row.badge, next === null ? null : value, 'aekTree__badge');
    if (badge && badge !== row.badge) row.content.insertBefore(badge.cmp.elem, row.title);
    row.badge = badge;
  };

  const writeTooltip = (row: TreeRow<T>, text: string) => {
    if (row.written.tooltip === text) return;
    row.written.tooltip = text;
    if (!text) {
      row.tooltip?.cmp.remove();
      row.tooltip = null;
    } else if (row.tooltip) row.tooltip.setText(text);
    else row.tooltip = createTooltip({ anchor: row.elem, text });
  };

  /** Writes the row's entry: its key, state and parts where they differ from what it shows */
  const writeRow = (row: TreeRow<T>, isNewNode: boolean) => {
    const entry = row.entry;
    if (!entry) return;
    const { elem, written, content } = row;
    if (written.key !== entry.key) {
      written.key = entry.key;
      elem.setAttribute('data-key', entry.key);
    }
    if (written.isDisabled !== entry.text.isDisabled) {
      written.isDisabled = entry.text.isDisabled;
      writeAttr(elem, 'aria-disabled', written.isDisabled ? 'true' : null);
    }
    if (hasSelection && written.isSelected !== entry.isSelected) {
      written.isSelected = entry.isSelected;
      elem.setAttribute('aria-selected', String(entry.isSelected));
    }
    if (props.render) {
      if (isNewNode || !row.rendered || row.renderedNode !== entry.node) {
        row.rendered?.remove();
        row.rendered = props.render(entry.node);
        row.renderedNode = entry.node;
        content.append(row.rendered.elem);
      }
    } else {
      writeIcon(row, entry.text.icon);
      writeBadge(row, entry.text.badge);
      writeTitle(row, entry.text.title);
      writeSuffix(row, entry.text.suffix);
      written.query = marks.query;
      if (written.isPlaceholder !== entry.text.isPlaceholder) {
        written.isPlaceholder = entry.text.isPlaceholder;
        writeAttr(row.title as HTMLElement, 'data-placeholder', written.isPlaceholder ? '' : null);
      }
    }
    writeTooltip(row, entry.text.tooltip);
  };

  /** Writes the row's place and open state, as `computeShown` left them */
  const writePlace = (row: TreeRow<T>) => {
    const entry = row.entry;
    if (!entry) return;
    const { elem } = row;
    if (row.written.level !== entry.level) {
      row.written.level = entry.level;
      writeLevel(elem, entry.level);
      elem.setAttribute('aria-level', String(entry.level));
    }
    writeAttr(elem, 'aria-setsize', String(entry.setSize));
    writeAttr(elem, 'aria-posinset', String(entry.posInSet));
    writeAttr(elem, 'aria-expanded', entry.isExpandable ? String(entry.isOpen) : null);
    writeAttr(elem, 'aria-busy', entry.isLoading ? 'true' : null);
  };

  const bindRow = (row: TreeRow<T>, entry: TreeEntry<T>) => {
    if (row.entry && row.entry !== entry) row.entry.view = null;
    row.entry = entry;
    entry.view = row;
    writeRow(row, false);
  };

  const createRow = (): TreeRow<T> => {
    const elem = createElem('div', TREE_ROW_CLASS);
    elem.setAttribute('role', 'treeitem');
    elem.setAttribute('tabindex', '-1');
    if (hasSelection) elem.setAttribute('aria-selected', 'false');
    const twisty = createElem('span', 'aekTree__twisty');
    twisty.setAttribute('aria-hidden', 'true');
    const content = createElem('span', 'aekTree__content');
    elem.append(twisty, content);
    let title: HTMLElement | null = null;
    if (!props.render) {
      title = createElem('span', 'aekTree__title');
      content.append(title);
    }
    return {
      entry: null,
      elem,
      content,
      title,
      suffix: null,
      icon: null,
      badge: null,
      rendered: null,
      renderedNode: undefined,
      tooltip: null,
      written: {
        key: '',
        title: '',
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
        level: 0,
      },
    };
  };

  const disposeRow = (row: TreeRow<T>) => {
    if (row.entry) row.entry.view = null;
    row.entry = null;
    row.tooltip?.cmp.remove();
    row.tooltip = null;
    row.rendered?.remove();
    row.rendered = null;
    row.elem.remove();
  };

  return { createRow, bindRow, writeRow, writePlace, disposeRow };
};

/**
 * Makes or writes a lazy node's status row (`.aekTree__status`, `data-status`): while it loads an
 * `aria-hidden` line with a spinner and the loading text (the node's `aria-busy` says it, and
 * the end is announced); after a failure a tree item one level down with the error text and
 * "Retry", which Enter, Space or a click on it does.
 * @internal
 */
export const writeStatusRow = <T>(status: TreeStatus<T>) => {
  let elem = status.elem;
  if (!elem) {
    elem = createElem('div', TREE_STATUS_CLASS);
    const mark = createElem('span', 'aekTree__statusMark');
    mark.setAttribute('aria-hidden', 'true');
    elem.append(
      createElem('span', 'aekTree__twisty'),
      mark,
      createElem('span', 'aekTree__statusText')
    );
    const retry = createElem('span', 'aekTree__retry');
    retry.textContent = 'Retry';
    elem.append(retry);
    status.elem = elem;
  }
  const level = status.parent.level + 1;
  const isError = status.state === 'error';
  elem.setAttribute('data-key', status.key);
  writeAttr(elem, 'data-status', status.state);
  writeLevel(elem, level);
  writeAttr(elem, 'role', isError ? 'treeitem' : null);
  writeAttr(elem, 'aria-hidden', isError ? null : 'true');
  writeAttr(elem, 'aria-level', isError ? String(level) : null);
  writeAttr(elem, 'aria-setsize', isError ? '1' : null);
  writeAttr(elem, 'aria-posinset', isError ? '1' : null);
  if (isError) {
    if (!elem.hasAttribute('tabindex')) elem.setAttribute('tabindex', '-1');
  } else writeAttr(elem, 'tabindex', null);
  const text = elem.querySelector('.aekTree__statusText') as HTMLElement;
  if (text.textContent !== status.text) text.textContent = status.text;
  return elem;
};
