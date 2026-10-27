import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { createBadge, type Badge, type BadgeTone } from './Badge';
import { createRovingTabStop, getMoveTarget } from './RovingFocus';
import './Tabs.scss';
import '../styles/kit.scss';

/** A tab's badge: a count or a word, or the badge's label with its tone and spoken text. */
export type TabBadge =
  | string
  | number
  | {
      /** What it shows */
      label: string | number;
      /** Its colour (default 'neutral'): never the only sign. */
      tone?: BadgeTone;
      /** What assistive tech hears in place of `label` (`'3 errors'`). */
      spokenLabel?: string;
    };

/** One tab of {@link createTabs}: its button and its panel's content. */
export type TabDef = {
  /** Its key: what `onSelect`, `select` and `setBadge` name it by, unique among the tabs. */
  key: string;
  /** Its text, and its accessible name. With `iconOnly` it isn't shown: it's visually hidden and
   * the tooltip. */
  label: string;
  /** Raw HTML of its icon (`getSvgIcon('gear')`), drawn at `1em` before the label. */
  icon?: string;
  /** Shows only the icon: the label is read by assistive tech and shown as a tooltip. */
  iconOnly?: boolean;
  /** A badge after the label (an error count). */
  badge?: TabBadge;
  /** Disables it: the arrows pass over it and a click does nothing. Default false. */
  disabled?: boolean;
  /** The panel's content: a CMP, or a function that builds it, called the first time the tab is
   * selected (a panel that costs something to build). */
  content: CMPHandle | (() => CMPHandle);
};

/** What {@link createTabs} makes tabs from. */
export type TabsProps = {
  /** The tabs, in order (at least one). */
  tabs: TabDef[];
  /** The selected tab's key (default: the first enabled tab). */
  selected?: string;
  /** A tab the user selected (a click, an arrow with automatic activation, Enter or Space), by
   * its key; also when `setTabs` removed the selected tab and the next one took its place. */
  onSelect?: (key: string) => void;
  /** When a tab is selected (default 'automatic'): as the arrows move the focus onto it, or
   * ('manual') only on Enter, Space or a click, for panels that cost something to build. */
  activation?: 'automatic' | 'manual';
  /** Which way the tabs run, and so which arrows move between them (default 'horizontal'): a
   * vertical tab list sits at the start of its panels. */
  orientation?: 'horizontal' | 'vertical';
  /** Keeps a panel built from a function when another tab is selected (hidden, its state kept),
   * or (false) removes its content and builds it again on its next selection. A CMP given as
   * `content` is always kept. Default true. */
  keepMounted?: boolean;
  /** The tab list's accessible name (its `aria-label`): what the tabs are for. */
  label: string;
  /** Extra classes for the tabs' element. */
  class?: string | string[];
  /** Extra attributes for the tabs' element. */
  attr?: CMPAttr;
  /** The tabs' element id (default: a generated one, not written to the element). */
  id?: string;
};

/** Tabs {@link createTabs} made: their CMP and their controls. */
export type Tabs = {
  /** The tabs' element, the tab list and the panels: add it where it goes. `cmp.remove()` removes
   * every panel's content with it. */
  cmp: CMPHandle;
  /** Selects a tab by its key without calling `onSelect` (an unknown key does nothing). */
  select: (key: string) => void;
  /** The selected tab's key (null: no tabs) */
  getSelected: () => string | null;
  /** Replaces the tabs: a kept key keeps its button, its panel and its built content (built again
   * when its `content` changed), a new key is added, a gone one removed with its content. */
  setTabs: (tabs: TabDef[]) => void;
  /** Changes a tab's badge in place (null removes it). */
  setBadge: (key: string, badge: TabBadge | null) => void;
};

/** One tab's parts and state */
type TabEntry = {
  def: TabDef;
  tabCmp: CMPHandle;
  panelCmp: CMPHandle;
  /** The panel's content once built */
  content: CMPHandle | null;
  badge: Badge | null;
  tooltip: Tooltip | null;
};

const createPart = (className: string, text?: string) => {
  const span = document.createElement('span');
  span.className = className;
  if (text !== undefined) span.textContent = text;
  return span;
};

/**
 * Creates tabs (p805 D10): a tab list over panels, one panel shown at a time. A panel built from a
 * function is built on its tab's first selection and kept (`keepMounted`) or removed when another
 * is selected; an overflowing tab list scrolls, its cut edges faded.
 * - Parts: `.aekTabs` (`data-orientation`), `.aekTabs__list` (`data-overflow="start" | "end" |
 *   "both"` while its tabs are cut there), `.aekTabs__tab` (`data-tab-key`, `aria-selected`,
 *   `disabled`, `data-icon-only`) with `__icon`, `__label` and `__badge` (a badge), `.aekTabs__panels`
 *   and a `.aekTabs__panel` per tab (`hidden` but the selected one's).
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-tabs-indicator-color`
 *   (the selected tab's line, default the accent), `--aek-tabs-fade-size` (the cut edges' fade).
 * - Keys (the APG tabs): the tab list is one tab stop (the selected tab); the arrows along it
 *   (Left / Right, or Up / Down) move the focus to the next enabled tab, wrapping, and Home / End to
 *   the first / last, selecting it with automatic activation; Enter and Space select the focused
 *   tab (manual). Tab goes on to the panel (`tabindex="0"`), and back into the list lands on the
 *   selected tab. The keys it uses reach no key binding.
 * - ARIA: `role="tablist"` named by `label` (`aria-orientation` when vertical), `role="tab"` with
 *   `aria-selected` and `aria-controls` its panel, `role="tabpanel"` with `aria-labelledby` its tab.
 *   An icon-only tab's label is visually hidden text (with its badge, its name) and its tooltip.
 * @example
 * ```ts
 * const tabs = createTabs({
 *   label: 'Inspector',
 *   tabs: [
 *     { key: 'props', label: 'Properties', content: propertiesPanel },
 *     { key: 'stats', label: 'Stats', badge: 2, content: () => buildStatsPanel() },
 *   ],
 *   onSelect: (key) => saveInspectorTab(key),
 * });
 * inspectorWindow.add(tabs.cmp);
 * tabs.setBadge('stats', { label: 3, tone: 'warning', spokenLabel: '3 warnings' });
 * ```
 */
export const createTabs = (props: TabsProps): Tabs => {
  const { activation = 'automatic', orientation = 'horizontal', keepMounted = true } = props;
  const isVertical = orientation === 'vertical';
  let entries: TabEntry[] = [];
  const byKey = new Map<string, TabEntry>();
  let selected: TabEntry | null = null;
  let overflow = '';
  let resizeObserver: ResizeObserver | null = null;

  const getTabElems = () => entries.map((entry) => entry.tabCmp.elem);
  const tabStop = createRovingTabStop({ getElems: getTabElems });
  const indexOf = (target: EventTarget | null) =>
    target ? entries.findIndex((entry) => entry.tabCmp.elem.contains(target as Node)) : -1;
  const isDisabled = (index: number) => entries[index].tabCmp.elem.hasAttribute('disabled');

  /** Writes `data-overflow` from the list's scroll: which ends have tabs cut off */
  const updateOverflow = () => {
    const elem = listCmp.elem;
    const pos = Math.abs(isVertical ? elem.scrollTop : elem.scrollLeft) || 0;
    const range = isVertical
      ? elem.scrollHeight - elem.clientHeight
      : elem.scrollWidth - elem.clientWidth;
    const start = pos > 1;
    const end = (range || 0) - pos > 1;
    const next = start && end ? 'both' : start ? 'start' : end ? 'end' : '';
    if (next === overflow) return;
    overflow = next;
    if (next) elem.setAttribute('data-overflow', next);
    else elem.removeAttribute('data-overflow');
  };

  /** The list's `scroll-padding` at its start (the faded edge's size; 0 without styles) */
  const getFadeSize = () => {
    if (typeof getComputedStyle !== 'function') return 0;
    const style = getComputedStyle(listCmp.elem);
    return (
      parseFloat(isVertical ? style.scrollPaddingBlockStart : style.scrollPaddingInlineStart) || 0
    );
  };

  /** Scrolls the list (not the page: never `scrollIntoView`) so a tab cut or under a faded edge
   * is in the middle. On a selection from code and a resize, not per frame: it reads a style. */
  const revealTab = (entry: TabEntry) => {
    const list = listCmp.elem;
    const tab = entry.tabCmp.elem;
    const [pos, size, view, range] = isVertical
      ? [tab.offsetTop, tab.offsetHeight, list.clientHeight, list.scrollHeight - list.clientHeight]
      : [tab.offsetLeft, tab.offsetWidth, list.clientWidth, list.scrollWidth - list.clientWidth];
    if (!view || !(range > 0)) return;
    const scroll = isVertical ? list.scrollTop : list.scrollLeft;
    const fade = getFadeSize();
    if (pos >= scroll + fade && pos + size <= scroll + view - fade) return;
    const next = Math.min(range, Math.max(0, Math.round(pos + size / 2 - view / 2)));
    if (next === scroll) return;
    if (isVertical) list.scrollTop = next;
    else list.scrollLeft = next;
  };

  const showPanel = (entry: TabEntry) => {
    if (!entry.content) {
      const { content } = entry.def;
      entry.content = typeof content === 'function' ? content() : content;
      entry.panelCmp.add(entry.content);
    }
    entry.panelCmp.elem.removeAttribute('hidden');
  };

  const hidePanel = (entry: TabEntry) => {
    entry.panelCmp.elem.setAttribute('hidden', '');
    if (keepMounted || typeof entry.def.content !== 'function' || !entry.content) return;
    entry.content.remove();
    entry.content = null;
  };

  /** Makes `entry` the selected tab (null: none) and moves the tab stop onto it */
  const selectEntry = (entry: TabEntry | null) => {
    if (entry === selected) return;
    if (selected) {
      selected.tabCmp.elem.setAttribute('aria-selected', 'false');
      hidePanel(selected);
    }
    selected = entry;
    if (!entry) return;
    entry.tabCmp.elem.setAttribute('aria-selected', 'true');
    showPanel(entry);
    tabStop.setIndex(entries.indexOf(entry));
  };

  /** A selection by the user: reported when it changed */
  const selectByUser = (index: number) => {
    const entry = entries[index];
    if (!entry || entry === selected || isDisabled(index)) return;
    selectEntry(entry);
    props.onSelect?.(entry.def.key);
  };

  const removeBadge = (entry: TabEntry) => {
    entry.badge?.cmp.remove();
    entry.badge = null;
  };

  /** Writes a tab's badge in place (no allocation but the badge's first creation) */
  const writeBadge = (entry: TabEntry, badge: TabBadge | null | undefined) => {
    if (badge === null || badge === undefined) return removeBadge(entry);
    const isObject = typeof badge === 'object';
    const label = isObject ? badge.label : badge;
    const tone = isObject ? badge.tone : undefined;
    const spokenLabel = isObject ? badge.spokenLabel : undefined;
    if (entry.badge) {
      entry.badge.setLabel(label, spokenLabel);
      entry.badge.setTone(tone ?? 'neutral');
      return;
    }
    entry.badge = createBadge({ label, tone, spokenLabel, class: 'aekTabs__badge' });
    entry.tabCmp.add(entry.badge.cmp);
  };

  /** Writes a tab's button from its definition: its parts, tooltip and state */
  const writeTab = (entry: TabEntry) => {
    const { def } = entry;
    const elem = entry.tabCmp.elem;
    removeBadge(entry);
    entry.tooltip?.cmp.remove();
    entry.tooltip = null;
    elem.textContent = '';
    if (def.icon) {
      const icon = createPart('aekTabs__icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = def.icon;
      elem.append(icon);
    }
    elem.append(
      createPart(def.iconOnly ? 'aekTabs__label aekVisuallyHidden' : 'aekTabs__label', def.label)
    );
    writeBadge(entry, def.badge);
    if (def.iconOnly) {
      elem.setAttribute('data-icon-only', '');
      entry.tooltip = createTooltip({ anchor: elem, text: def.label });
    } else {
      elem.removeAttribute('data-icon-only');
    }
    elem.setAttribute('data-tab-key', def.key);
    if (def.disabled) elem.setAttribute('disabled', '');
    else elem.removeAttribute('disabled');
  };

  const createEntry = (def: TabDef): TabEntry => {
    const tabCmp = listCmp.add({
      tag: 'button',
      idAttr: true,
      class: 'aekTabs__tab',
      attr: { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1' },
    });
    const panelCmp = panelsCmp.add({
      idAttr: true,
      class: 'aekTabs__panel',
      attr: { role: 'tabpanel', tabindex: '0', hidden: '', 'aria-labelledby': tabCmp.id },
    });
    tabCmp.elem.setAttribute('aria-controls', panelCmp.id);
    const entry: TabEntry = { def, tabCmp, panelCmp, content: null, badge: null, tooltip: null };
    writeTab(entry);
    return entry;
  };

  const removeEntry = (entry: TabEntry) => {
    entry.tooltip?.cmp.remove();
    entry.tooltip = null;
    entry.tabCmp.remove();
    entry.panelCmp.remove();
  };

  const onClick = (e: Event) => {
    const index = indexOf(e.target);
    if (index !== -1) selectByUser(index);
  };

  const onKeyDown = (e: Event) => {
    const { key } = e as KeyboardEvent;
    const index = indexOf(e.target);
    if (index === -1) return;
    const next = getMoveTarget(key, index, {
      count: entries.length,
      orientation: isVertical ? 'vertical' : 'horizontal',
      wrap: true,
      isSkipped: isDisabled,
    });
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key);
    if (next === -1) return;
    tabStop.setIndex(next);
    entries[next].tabCmp.elem.focus();
    if (activation === 'automatic') selectByUser(next);
  };

  /** The focus leaving the list: the tab stop goes back to the selected tab (manual activation
   * moves the focus without selecting) */
  const onFocusOut = (e: Event) => {
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (to && listCmp.elem.contains(to)) return;
    if (selected) tabStop.setIndex(entries.indexOf(selected));
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekTabs', props.class),
    attr: { ...props.attr, 'data-orientation': orientation },
    onRemoveCmp: () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      for (const entry of entries) {
        entry.tooltip?.cmp.remove();
        entry.tooltip = null;
      }
    },
  });
  const listCmp = cmp.add({
    class: 'aekTabs__list',
    attr: {
      role: 'tablist',
      'aria-label': props.label,
      ...(isVertical ? { 'aria-orientation': 'vertical' } : {}),
    },
    listeners: [
      { type: 'click', fn: onClick },
      { type: 'keydown', fn: onKeyDown },
      { type: 'focusin', fn: tabStop.onFocusIn },
      { type: 'focusout', fn: onFocusOut },
      { type: 'scroll', fn: updateOverflow, options: { passive: true } },
    ],
  });
  const panelsCmp = cmp.add({ class: 'aekTabs__panels' });

  /** The first tab the arrows can reach */
  const getFirstEnabled = () => {
    const index = getMoveTarget('Home', -1, { count: entries.length, isSkipped: isDisabled });
    return index === null || index === -1 ? null : entries[index];
  };

  const setTabs = (defs: TabDef[]) => {
    const next: TabEntry[] = [];
    for (const def of defs) {
      let entry = byKey.get(def.key);
      if (entry) {
        const contentChanged = entry.def.content !== def.content;
        entry.def = def;
        writeTab(entry);
        if (contentChanged && entry.content) {
          entry.content.remove();
          entry.content = null;
          if (entry === selected) showPanel(entry);
        }
      } else {
        entry = createEntry(def);
        byKey.set(def.key, entry);
      }
      next.push(entry);
    }
    const kept = new Set(next);
    for (const entry of entries) {
      if (kept.has(entry)) continue;
      byKey.delete(entry.def.key);
      removeEntry(entry);
    }
    entries = next;
    for (const entry of entries) {
      listCmp.elem.append(entry.tabCmp.elem);
      panelsCmp.elem.append(entry.panelCmp.elem);
    }
    if (selected && !kept.has(selected)) {
      // Its panel went with it
      selected = null;
      const first = getFirstEnabled();
      selectEntry(first);
      if (first) props.onSelect?.(first.def.key);
    }
    tabStop.reset(selected ? entries.indexOf(selected) : -1);
    updateOverflow();
  };

  setTabs(props.tabs);
  selectEntry(
    (props.selected !== undefined ? byKey.get(props.selected) : undefined) ?? getFirstEnabled()
  );
  tabStop.reset(selected ? entries.indexOf(selected) : -1);

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      updateOverflow();
      if (selected) revealTab(selected);
    });
    resizeObserver.observe(listCmp.elem);
  }

  return {
    cmp,
    select: (key) => {
      const entry = byKey.get(key);
      if (!entry) return;
      selectEntry(entry);
      revealTab(entry);
    },
    getSelected: () => selected?.def.key ?? null,
    setTabs,
    setBadge: (key, badge) => {
      const entry = byKey.get(key);
      if (!entry) return;
      writeBadge(entry, badge);
      updateOverflow();
    },
  };
};
