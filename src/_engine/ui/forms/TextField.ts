import { createButton } from '../components/Button';
import { getPrimitiveValueKind } from './binding/Binding';
import { createField, type Field, type FieldProps } from './Field';
import { createTypedText } from './TypedText';
import './TextField.scss';
import '../styles/kit.scss';

/** What {@link createTextField} makes a text field from. */
export type TextFieldProps = FieldProps<string> & {
  /** A `<textarea>` (Tweakpane's `multiline`): Enter is a new line, Ctrl/⌘+Enter or a blur writes
   * it (default false). */
  multiline?: boolean;
  /** A multiline field's height in lines (Tweakpane's `rows`, default 3). */
  rows?: number;
  /** `'search'`: a search field, with its mark, a clear button and `onSearch` (default 'text'). */
  type?: 'text' | 'search';
  /** The input's placeholder: an example, never the label. */
  placeholder?: string;
  /** The most characters it takes. */
  maxLength?: number;
  /** Writes each keystroke (`last: false`), not only on Enter or a blur (default false). */
  live?: boolean;
  /** Each keystroke's text, before it's written. */
  onInput?: (text: string) => void;
  /** A search field's query: `searchDelayMs` after the last keystroke, at once on Enter and on a
   * clear. */
  onSearch?: (text: string) => void;
  /** How long a search field waits after a keystroke before `onSearch` (default 250). */
  searchDelayMs?: number;
};

/** A text field {@link createTextField} made: the field's handle. */
export type TextField = Field<string>;

const DEFAULT_ROWS = 3;
const DEFAULT_SEARCH_DELAY_MS = 250;

const CLEAR_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const SEARCH_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

/**
 * Creates a text field (p804 D7): an `<input type="text">`, a `<textarea>` with `multiline`, or a
 * search field with `type: 'search'`, its value from its binding (`{ target, key }`,
 * `{ get, set }` or `{ value }`) and written there.
 * - Typing: the text is written on Enter (a single line) or Ctrl/⌘+Enter (multiline) or a blur,
 *   once with `last: true`, or on each keystroke with `live`; `onInput` gets each keystroke's
 *   text. Escape puts the value's text back (and goes no further, so a dialog stays open). A
 *   refresh never writes over typed text.
 * - Search: a search mark before the input (`role="searchbox"`), a clear button ("Clear
 *   {label}", shown while there's text) that empties it, writes it and focuses the input, and
 *   `onSearch(text)` `searchDelayMs` after the last keystroke, at once on Enter and on a clear.
 * - Parts: `.aekField` (`data-kind="text"`) with the shell's parts, its `.aekField__control`
 *   holding `.aekField__box.aekTextField` (`data-multiline`, `data-search`,
 *   `data-flash`) with `.aekTextField__icon`, `.aekField__input.aekTextField__input` and
 *   `.aekTextField__clear`.
 * - Custom properties: the fields' `--aek-field-control-bg`, `--aek-field-control-border-color`,
 *   `--aek-field-radius`, `--aek-field-flash-color`.
 * - ARIA: the input is labelled by the `<label>`; an error sets `aria-invalid` and is its
 *   description, as the hint is.
 * @example
 * ```ts
 * const name = createTextField({
 *   label: 'Name',
 *   target: player,
 *   key: 'name',
 *   maxLength: 24,
 *   onChange: (value, { last }) => {
 *     if (last) saveProfile();
 *   },
 * });
 * const filter = createTextField({
 *   label: 'Filter',
 *   labelHidden: true,
 *   type: 'search',
 *   value: '',
 *   placeholder: 'Filter entities',
 *   onSearch: (query) => filterEntities(query),
 * });
 * settingsPanel.add(name.cmp);
 * settingsPanel.add(filter.cmp);
 * ```
 */
export const createTextField = (props: TextFieldProps): TextField => {
  const isSearch = props.type === 'search';
  const multiline = Boolean(props.multiline);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether there's typed text (set below: the shell draws while it's made) */
  let isTyping = () => false;
  /** Ends what's in progress (set below: disabling can run while the shell is made) */
  let settle = () => {};

  const box = document.createElement('span');
  box.className = 'aekField__box aekTextField';
  if (multiline) box.setAttribute('data-multiline', '');
  if (isSearch) box.setAttribute('data-search', '');
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.className = 'aekField__input aekTextField__input';
  if (multiline) {
    input.setAttribute('rows', String(props.rows ?? DEFAULT_ROWS));
  } else {
    input.setAttribute('type', 'text');
    if (isSearch) {
      // Not type="search": the browsers' own clear button and Escape differ, and this has both
      input.setAttribute('role', 'searchbox');
      input.setAttribute('enterkeyhint', 'search');
      input.setAttribute('autocomplete', 'off');
    }
  }
  if (props.placeholder !== undefined) input.setAttribute('placeholder', props.placeholder);
  if (props.maxLength !== undefined) input.setAttribute('maxlength', String(props.maxLength));
  if (isSearch) {
    const icon = document.createElement('span');
    icon.className = 'aekTextField__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = SEARCH_ICON;
    box.append(icon);
  }
  box.append(input);

  const clearButton = isSearch
    ? createButton({
        label: `Clear ${props.label}`,
        variant: 'ghost',
        size: 'sm',
        icon: CLEAR_ICON,
        iconOnly: true,
        class: 'aekTextField__clear',
        onClick: () => clear(),
      })
    : null;
  if (clearButton) box.append(clearButton.cmp.elem);

  const drawClear = () => {
    if (!clearButton) return;
    if (input.value) clearButton.cmp.elem.removeAttribute('hidden');
    else clearButton.cmp.elem.setAttribute('hidden', '');
  };

  const drawText = (value: string) => {
    if (input.value !== value) input.value = value;
    drawClear();
  };

  const shell = createField<string>(props, {
    kind: 'text',
    valueKind: getPrimitiveValueKind<string>(),
    control: box,
    labelFor: input,
    draw: (value) => {
      // Typed text stays until it's written or put back
      if (!isTyping()) drawText(value);
    },
    applyDisabled: (on) => {
      if (on) input.setAttribute('disabled', '');
      else input.removeAttribute('disabled');
      clearButton?.setDisabled(on);
      if (on) settle();
    },
    onRemove: () => {
      typed.dispose();
      stopSearchTimer();
      clearButton?.cmp.remove();
      for (const [type, fn] of listeners) input.removeEventListener(type, fn as EventListener);
    },
  });
  const { binding, field } = shell;

  const typed = createTypedText<string>({
    input,
    binding,
    parse: (text) => ({ value: text }),
    drawText,
    setError: shell.setOwnError,
    live: props.live,
    onInput: props.onInput,
  });
  isTyping = typed.isDirty;
  settle = typed.settle;

  const stopSearchTimer = () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  };

  const search = () => {
    stopSearchTimer();
    props.onSearch?.(input.value);
  };

  const clear = () => {
    const hadFocus = document.activeElement === clearButton?.cmp.elem;
    typed.end();
    binding.change('');
    drawText('');
    search();
    // The button hides with the text: the focus goes to the input (from the button's, or kept)
    if (hadFocus) input.focus();
  };

  const onInputEvent = () => {
    typed.onInput();
    drawClear();
    if (!isSearch || !props.onSearch) return;
    stopSearchTimer();
    searchTimer = setTimeout(search, props.searchDelayMs ?? DEFAULT_SEARCH_DELAY_MS);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Outside a HUD root (the overlay stack takes it first under one)
      typed.onEscape(e);
      return;
    }
    if (e.key !== 'Enter' || e.isComposing) return;
    if (multiline) {
      // Enter is a new line; Ctrl/⌘+Enter writes
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      typed.commit();
      return;
    }
    // Not stopped: in a form, Enter submits after the value is written
    typed.commit();
    if (isSearch) search();
  };

  const listeners: [string, (e: never) => void][] = [
    ['input', onInputEvent],
    ['keydown', onKeyDown],
    ['blur', () => typed.settle()],
  ];
  for (const [type, fn] of listeners) input.addEventListener(type, fn as EventListener);

  return field;
};
