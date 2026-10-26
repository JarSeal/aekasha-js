// The monitor (p804 D7): a bound value shown as text, read on the scheduler's tick. Each field's
// `readonly: true` is one too, built here with that field's own text (`buildMonitor`).
import {
  createObjectValueKind,
  getPrimitiveValueKind,
  type BindingSource,
  type BindingValueKind,
  type ReadonlyBindingSource,
} from './binding/Binding';
import { createValueFormatter } from './binding/ValueText';
import {
  createField,
  type Field,
  type AnyFieldProps,
  type FieldOptions,
  type FieldShell,
} from './Field';
import './Monitor.scss';
import '../styles/kit.scss';

/**
 * What {@link createMonitor} makes a monitor from: the binding (`{ target, key }`, `{ get }`
 * with or without a `set`, or `{ value }`), the label and how the value is written as text.
 * @template T the value's type
 */
export type MonitorProps<T> = (BindingSource<T> | ReadonlyBindingSource<T>) &
  FieldOptions<T> & {
    /** The value's text (Tweakpane's `format`), in place of the defaults: a number's decimals, a
     * boolean's `onText` / `offText`, a vector's axes. */
    format?: (value: T) => string;
    /** A number's decimals (default: the value's own, at least 2), a vector's axes' too. */
    precision?: number;
    /** A unit shown after the value (`'ms'`); not with `multiline`. */
    unit?: string;
    /** Shows the text as a block of lines, as typed (Tweakpane's `multiline`, default false): a
     * read-only text area that scrolls, so it's a tab stop. */
    multiline?: boolean;
    /** The block's height in lines, with `multiline` (default 3). */
    rows?: number;
    /** A boolean's text while it's true (default 'On'). */
    onText?: string;
    /** A boolean's text while it's false (default 'Off'). */
    offText?: string;
  };

/**
 * A monitor {@link createMonitor} made: the field's handle.
 * @template T the value's type
 */
export type Monitor<T> = Field<T>;

/**
 * How a field's `readonly: true` is shown: its value's kind and its text.
 * @internal
 */
export type MonitorSpec<T> = {
  /** How the value is compared and copied */
  valueKind: BindingValueKind<T>;
  /** The value's text: made only when the value changed (or on `redraw`) */
  getText: (value: T) => string;
  /** Makes the text again on every refresh, the value changed or not (a getter's option labels) */
  redrawOnRefresh?: boolean;
};

/**
 * What `buildMonitor` gives back: the shell, and a redraw for a text that changed while the
 * value didn't (a checkbox's mixed state, a getter's option labels).
 * @internal
 */
export type MonitorBuild<T> = {
  shell: FieldShell<T>;
  redraw: () => void;
};

/** A monitor's tick when its props give no `interval`: Tweakpane's */
const MONITOR_INTERVAL_MS = 200;
const DEFAULT_ROWS = 3;
const VECTOR_KEYS = ['x', 'y', 'z', 'w'] as const;

/**
 * Builds a monitor (D7): the value's text in a `<span>` (a `<textarea readonly>` with
 * `multiline`), on the shell with no reset button and no flash, read on the tick every
 * `interval` ms (default 200) of its scheduler, or of the page's when it has none.
 * @internal
 */
export const buildMonitor = <T>(
  props: AnyFieldProps<T> & Pick<MonitorProps<T>, 'unit' | 'multiline' | 'rows'>,
  spec: MonitorSpec<T>
): MonitorBuild<T> => {
  /** The text last drawn: a draw that makes the same writes nothing */
  let shownText: string | null = null;
  let control: HTMLElement;
  let area: HTMLTextAreaElement | null = null;
  /** The line's one text node: its `data` written, so no node is replaced (a style recalc) */
  let valueText: Text | null = null;
  if (props.multiline) {
    area = document.createElement('textarea');
    area.className = 'aekMonitor aekMonitor__text';
    area.setAttribute('readonly', '');
    area.setAttribute('rows', String(props.rows ?? DEFAULT_ROWS));
    area.setAttribute('spellcheck', 'false');
    control = area;
  } else {
    control = document.createElement('span');
    control.className = 'aekMonitor';
    const valueElem = document.createElement('span');
    valueElem.className = 'aekMonitor__value';
    valueText = document.createTextNode('');
    valueElem.append(valueText);
    control.append(valueElem);
    if (props.unit) {
      const unit = document.createElement('span');
      unit.className = 'aekMonitor__unit';
      unit.textContent = props.unit;
      control.append(unit);
    }
  }

  const draw = (value: T) => {
    const text = spec.getText(value);
    if (text === shownText) return;
    shownText = text;
    if (area) area.value = text;
    else if (valueText) valueText.data = text;
  };

  /** Set once the shell is made: it reads its state (and so refreshes) while it's made */
  let shell: FieldShell<T> | null = null;
  const redraw = () => {
    if (!shell) return;
    shownText = null;
    draw(shell.binding.peek());
  };

  shell = createField<T>(
    { ...props, interval: props.interval ?? MONITOR_INTERVAL_MS },
    {
      kind: 'monitor',
      valueKind: spec.valueKind,
      control,
      isMonitor: true,
      isTextOnly: !area,
      // An error describes and marks the text area; a line of text takes neither
      messageFor: area ? [area] : [],
      draw,
      applyDisabled: (on) => {
        if (!area) return;
        if (on) area.setAttribute('disabled', '');
        else area.removeAttribute('disabled');
      },
      onRefresh: spec.redrawOnRefresh ? redraw : undefined,
    }
  );
  return { shell, redraw };
};

/** The axes a vector-like value has (`{ x, y }` to `{ x, y, z, w }`), or null */
const getVectorKeys = (value: unknown) => {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const keys = VECTOR_KEYS.filter((key) => typeof source[key] === 'number');
  return keys.length >= 2 && keys[0] === 'x' && keys[1] === 'y' ? keys : null;
};

/** The value at creation: a `{ value }`'s, a getter's or the target's */
const readFirstValue = <T>(props: AnyFieldProps<T>): T => {
  if (props.get) return props.get();
  if (props.target) return (props.target as Record<string, unknown>)[props.key] as T;
  return props.value as T;
};

/**
 * Creates a monitor (p804 D7, Tweakpane's monitor binding): a value shown as text, read from its
 * binding (`{ target, key }`, `{ get, set }` or `{ value }`) on its scheduler's tick every
 * `interval` ms (default 200; 0 every frame), or on a tick the page's monitors share when it has no
 * scheduler. A read that finds the value unchanged writes nothing; a change writes the text only.
 * A refresh never fires `onChange` (`setValue` does). Any field's `readonly: true` is a monitor in
 * that field's own text.
 * - Text: `format`'s, else a number's decimals (`precision`, else the value's own and at least
 *   2), a boolean's `onText` / `offText` ('On' / 'Off'), a vector-like object's axes (`{ x, y }`
 *   to `{ x, y, z, w }`, compared axis by axis), a string as it is. `multiline` shows the text as
 *   lines in a scrolling block `rows` high.
 * - Parts: `.aekField` (`data-kind="monitor"`, `data-disabled`) with `.aekField__head`
 *   (`.aekField__label`; no reset button), `.aekField__control` holding `.aekMonitor` (tabular
 *   figures) with `.aekMonitor__value` and `.aekMonitor__unit`, or with `multiline` the
 *   `textarea.aekMonitor.aekMonitor__text`, and `.aekField__message`.
 * - Custom properties: `--aek-monitor-bg`, `--aek-monitor-color`, `--aek-monitor-font` (the
 *   multiline block's, default the mono font).
 * - ARIA: **not a live region**, on purpose (p800 D8's deviation): a value changing every frame
 *   would drown a screen reader. A line of text is read after its label (a name on a plain
 *   `<span>` is a prohibited attribute); the multiline block is a read-only text area labelled
 *   by the `<label>`, a tab stop so its scroll is reachable. A value an app wants announced is
 *   its own `aria-live` text.
 * - Motion: none (a monitor never flashes).
 * @template T the value's type
 * @example
 * ```ts
 * const scheduler = createBindingScheduler();
 * const frameTime = createMonitor({
 *   label: 'Frame time',
 *   get: () => stats.frameMs,
 *   unit: 'ms',
 *   precision: 1,
 *   interval: 250,
 *   scheduler,
 * });
 * settingsPanel.add(frameTime.cmp);
 * ```
 */
export const createMonitor = <T>(props: MonitorProps<T>): Monitor<T> => {
  const vectorKeys = getVectorKeys(readFirstValue(props));
  const numberText = createValueFormatter({ precision: props.precision });
  const { format, onText = 'On', offText = 'Off' } = props;
  const getText = (value: T) => {
    if (format) return format(value);
    if (typeof value === 'number') return numberText.getText(value);
    if (typeof value === 'boolean') return value ? onText : offText;
    if (typeof value === 'string') return value;
    if (vectorKeys) {
      const vector = value as Record<string, number>;
      return vectorKeys.map((key) => numberText.getText(vector[key])).join(', ');
    }
    return value === null || value === undefined ? '' : String(value);
  };
  const valueKind = vectorKeys
    ? createObjectValueKind<T & object>(vectorKeys)
    : getPrimitiveValueKind<T>();
  return buildMonitor(props, { valueKind: valueKind as BindingValueKind<T>, getText }).shell.field;
};
