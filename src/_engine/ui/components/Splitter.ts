import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createSeparatorInput } from './SeparatorInput';
import './Splitter.scss';
import '../styles/kit.scss';

/** What {@link createSplitter} makes a splitter from. */
export type SplitterProps = {
  /** The first pane's content (the left one, or the top one when vertical): the one the
   * separator sizes and collapses. */
  first: CMPHandle;
  /** The second pane's content: it takes the rest of the room. */
  second: CMPHandle;
  /** The panes side by side ('horizontal', the default: the separator a vertical line, moved by
   * Left and Right) or one above the other ('vertical': moved by Up and Down). */
  orientation?: 'horizontal' | 'vertical';
  /** The first pane's size in `unit` (default 50 %, or 240 px). */
  size?: number;
  /** The size's unit: a percent of the splitter's width (or height), or CSS px (default '%'). */
  unit?: '%' | 'px';
  /** The first pane's smallest size, in `unit` (default 10 %, or 0 px). */
  min?: number;
  /** The first pane's largest size, in `unit` (default 90 %, or the splitter's size less the
   * separator's, measured). */
  max?: number;
  /** An arrow's step, in `unit` (default 1 %, or 10 px; Shift ×10, Alt ×0.1). */
  step?: number;
  /** Enter on the separator collapses the first pane and restores it (the APG's). Default false. */
  collapsible?: boolean;
  /** Starts with the first pane collapsed (with `collapsible`). Default false. */
  collapsed?: boolean;
  /** The first pane's size after the user moved the separator (a drag's release, a key's keyup):
   * what an owner persists (a splitter writes no storage). */
  onSizeChange?: (size: number) => void;
  /** The user collapsed the first pane (Enter) or restored it (Enter, a move). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** The separator's accessible name: what it sizes ("Outline width"). */
  label: string;
  /** Extra classes for the splitter's element. */
  class?: string | string[];
  /** Extra attributes for the splitter's element. */
  attr?: CMPAttr;
  /** The splitter's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A splitter {@link createSplitter} made: its CMP and its controls. */
export type Splitter = {
  /** The splitter's element, its panes and separator: add it where it goes. `cmp.remove()` removes
   * both panes' content with it. */
  cmp: CMPHandle;
  /** Sets the first pane's size in `unit`, kept in its range; no `onSizeChange`. */
  setSize: (size: number) => void;
  /** The first pane's size in `unit` (the one it restores to while collapsed) */
  getSize: () => number;
  /** Collapses the first pane (with `collapsible`); no `onCollapsedChange`. */
  collapse: () => void;
  /** Restores a collapsed first pane to its size; no `onCollapsedChange`. */
  restore: () => void;
  /** Whether the first pane is collapsed */
  isCollapsed: () => boolean;
};

const SIZE_PROPERTY = '--aek-splitter-size';

/**
 * Creates a splitter (p805 D10): two panes and the separator between them, which the pointer drags
 * and the keys move (the APG window splitter); with `collapsible`, Enter collapses the first pane
 * and restores it. The size is the first pane's, in a percent of the splitter or in px; the second
 * takes the rest. Its owner keeps it: `onSizeChange` reports a finished move.
 * - Parts: `.aekSplitter` (`data-orientation`, `data-collapsed`; `--aek-splitter-size` on it) with
 *   `.aekSplitter__pane` (`data-pane="first" | "second"`, the first `hidden` while collapsed) and
 *   `.aekSplitter__separator` (`data-dragging`).
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-splitter-gutter`
 *   (the separator's width, default `--aek-space-3`; its pointer target is 24 px whatever it is).
 * - Keys: on the separator, the arrows along the orientation move it by `step` (Shift ×10, Alt
 *   ×0.1), Home and End to `min` and `max`, Enter collapses and restores (`collapsible`); each
 *   keyup reports the size. The keys it uses reach no key binding.
 * - Pointer: a drag on the separator moves it, keeping where it was grabbed; the release reports
 *   the size.
 * - ARIA: the separator is a focusable `separator` named by `label`, `aria-orientation` its line's
 *   (vertical between side-by-side panes), `aria-valuenow` the size (0 collapsed), `aria-valuemin`
 *   / `-max` (0 with `collapsible`), `aria-valuetext` with the unit ("Collapsed"), `aria-controls`
 *   the first pane.
 * @example
 * ```ts
 * const split = createSplitter({
 *   label: 'Outline width',
 *   first: outlinePanel,
 *   second: propertiesPanel,
 *   size: settings.outlineWidth ?? 35,
 *   collapsible: true,
 *   onSizeChange: (size) => saveSetting('outlineWidth', size),
 * });
 * inspectorWindow.add(split.cmp);
 * ```
 */
export const createSplitter = (props: SplitterProps): Splitter => {
  const { orientation = 'horizontal', unit = '%', collapsible = false } = props;
  const isPercent = unit === '%';
  const isRow = orientation === 'horizontal';
  const min = props.min ?? (isPercent ? 10 : 0);
  const step = props.step ?? (isPercent ? 1 : 10);
  /** The measured room for the first pane (px without a `max`): 0 until measured */
  let room = 0;
  let resizeObserver: ResizeObserver | null = null;
  const getMax = () => props.max ?? (isPercent ? 90 : room > 0 ? room : Infinity);
  /** In the range, to a tenth (Alt's step) for a percent, to a px */
  const constrain = (value: number) => {
    const kept = Math.min(getMax(), Math.max(min, value));
    return isPercent ? Math.round(kept * 10) / 10 : Math.round(kept);
  };

  let size = constrain(props.size ?? (isPercent ? 50 : 240));
  let isCollapsed = collapsible && Boolean(props.collapsed);
  /** Where in the separator the pointer grabbed it, px from its start */
  let grabOffset = 0;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekSplitter', props.class),
    attr: { ...props.attr, 'data-orientation': orientation },
    onRemoveCmp: () => {
      input.dispose();
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
  });
  const root = cmp.elem;
  const firstPane = cmp.add({
    idAttr: true,
    class: 'aekSplitter__pane',
    attr: { 'data-pane': 'first' },
  });
  const separator = cmp.add({
    class: 'aekSplitter__separator',
    attr: {
      role: 'separator',
      tabindex: '0',
      'aria-label': props.label,
      'aria-orientation': isRow ? 'vertical' : 'horizontal',
      'aria-controls': firstPane.id,
      'aria-valuemin': String(collapsible ? 0 : min),
    },
  }).elem;
  const secondPane = cmp.add({ class: 'aekSplitter__pane', attr: { 'data-pane': 'second' } });
  firstPane.add(props.first);
  secondPane.add(props.second);

  const draw = () => {
    root.style.setProperty(SIZE_PROPERTY, isCollapsed ? '0px' : `${size}${unit}`);
    const max = getMax();
    if (Number.isFinite(max)) separator.setAttribute('aria-valuemax', String(max));
    else separator.removeAttribute('aria-valuemax');
    separator.setAttribute('aria-valuenow', String(isCollapsed ? 0 : size));
    separator.setAttribute('aria-valuetext', isCollapsed ? 'Collapsed' : `${size} ${unit}`);
    if (isCollapsed) {
      root.setAttribute('data-collapsed', '');
      firstPane.elem.setAttribute('hidden', '');
    } else {
      root.removeAttribute('data-collapsed');
      firstPane.elem.removeAttribute('hidden');
    }
  };

  const setCollapsed = (on: boolean, isUser: boolean) => {
    if (!collapsible || on === isCollapsed) return;
    // What had the focus is going: the separator keeps it
    if (on && firstPane.elem.contains(document.activeElement)) separator.focus();
    isCollapsed = on;
    draw();
    if (isUser) props.onCollapsedChange?.(on);
  };

  /** A move by a key or the pointer: a collapsed pane is restored at the moved size */
  const moveTo = (value: number) => {
    const next = constrain(value);
    if (isCollapsed) {
      size = next;
      setCollapsed(false, true);
      return;
    }
    if (next === size) return;
    size = next;
    draw();
  };

  const getValueAt = (e: PointerEvent) => {
    const rect = root.getBoundingClientRect();
    const offset = (isRow ? e.clientX - rect.left : e.clientY - rect.top) - grabOffset;
    const whole = isRow ? rect.width : rect.height;
    if (!isPercent) return offset;
    return whole > 0 ? (offset / whole) * 100 : size;
  };

  const input = createSeparatorInput(separator, {
    axis: isRow ? 'x' : 'y',
    step,
    // From a collapsed pane, the arrows start at nothing
    get: () => (isCollapsed ? 0 : size),
    getMin: () => min,
    getMax,
    set: moveTo,
    getValueAt,
    onPress: (e) => {
      const rect = separator.getBoundingClientRect();
      grabOffset = isRow ? e.clientX - rect.left : e.clientY - rect.top;
    },
    onCommit: () => props.onSizeChange?.(size),
    onEnter: collapsible ? () => setCollapsed(!isCollapsed, true) : undefined,
  });

  if (!isPercent && props.max === undefined && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      const rect = root.getBoundingClientRect();
      const sep = separator.getBoundingClientRect();
      room = Math.max(0, (isRow ? rect.width - sep.width : rect.height - sep.height) | 0);
      size = constrain(size);
      draw();
    });
    resizeObserver.observe(root);
  }
  draw();

  return {
    cmp,
    setSize: (value) => {
      size = constrain(value);
      draw();
    },
    getSize: () => size,
    collapse: () => setCollapsed(true, false),
    restore: () => setCollapsed(false, false),
    isCollapsed: () => isCollapsed,
  };
};
