import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import {
  getAriaKeyShortcuts,
  getKeyName,
  getKeyPlatform,
  splitKeyChord,
  type KeyPlatform,
} from './KeyNames';
import './Kbd.scss';
import '../styles/kit.scss';

/** What {@link createKbd} draws. */
export type KbdProps = {
  /** The keys: a chord as `getKeyChordLabel` writes it (`'Ctrl+Shift+P'`, `'Ctrl++'` for the plus
   * key), or several joined with `' / '` (shown with "or" between them). */
  keys: string;
  /** Whose key names it shows: `'mac'` draws the modifiers as symbols (⌘ ⇧ ⌥ ⌃). Default: the
   * platform the page runs on. */
  platform?: 'mac' | 'other';
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A key hint {@link createKbd} made: its CMP, its setter, and what a button or menu item that
 * shows it reads. */
export type Kbd = {
  /** Its element (`<kbd class="aekKbd">`): add it where it goes, or give the handle to a button's
   * or a menu item's `kbd`, which draws it and removes it with itself. */
  cmp: CMPHandle;
  /** Draws other keys in place. */
  setKeys: (keys: string) => void;
  /** Its keys as `aria-keyshortcuts` takes them (`'Ctrl+S / Meta+S'` → `'Control+S Meta+S'`):
   * what the element whose shortcut it shows sets. */
  getAriaKeyShortcuts: () => string;
  /** Calls `fn` with the keys after each `setKeys`; returns its remover. */
  onKeysChange: (fn: (keys: string) => void) => () => void;
};

const createPart = (className: string, text: string) => {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
};

/** Writes the keys into the element: a `<kbd>` per key with `+` between a chord's keys and "or"
 * between chords, and the spoken names in a visually hidden copy when they differ from the shown */
const writeKeys = (elem: HTMLElement, keys: string, platform: KeyPlatform) => {
  const shown = document.createElement('span');
  shown.className = 'aekKbd__keys';
  const spoken: string[] = [];
  let isSpokenAsShown = true;
  keys.split(' / ').forEach((chord, i) => {
    if (i) shown.append(createPart('aekKbd__or', 'or'));
    const names = splitKeyChord(chord).map((key) => getKeyName(key, platform));
    names.forEach((name, j) => {
      if (j) shown.append(createPart('aekKbd__join', '+'));
      const key = document.createElement('kbd');
      key.className = 'aekKbd__key';
      key.textContent = name.shown;
      shown.append(key);
      if (name.shown !== name.spoken) isSpokenAsShown = false;
    });
    spoken.push(names.map((name) => name.spoken).join('+'));
  });
  if (isSpokenAsShown) {
    elem.replaceChildren(shown);
    return;
  }
  shown.setAttribute('aria-hidden', 'true');
  const label = createPart('aekVisuallyHidden', spoken.join(' or '));
  elem.replaceChildren(shown, label);
};

/**
 * Creates a key hint (p803 D10): a chord's keys as the keyboard shows them, a `<kbd>` each with
 * `+` between them (`Ctrl+Shift+P` is three keys), on macOS with the modifiers as symbols (⌘ ⇧ ⌥
 * ⌃) and the arrows as arrows everywhere. Display only: binding the key is the app's.
 * - Parts: `.aekKbd` (the outer `<kbd>`), `.aekKbd__key` (each key), `.aekKbd__join` (the `+`),
 *   `.aekKbd__or` (between alternatives). Sized in `em`, so it follows its text.
 * - Assistive tech: where a shown name isn't the key's word (a symbol, an arrow), the shown keys
 *   are hidden from it and a visually hidden copy says the full names ("Command+Shift+P"). On a
 *   button or a menu item (their `kbd`) the hint is hidden and the item's `aria-keyshortcuts`
 *   names the keys (`getAriaKeyShortcuts`, kept after `setKeys`).
 * @example
 * ```ts
 * const hint = panel.add({ tag: 'p', text: 'Open the palette with ' });
 * hint.add(createKbd({ keys: 'Ctrl+Shift+P' }).cmp);
 * panel.add(createButton({ label: 'Save', kbd: createKbd({ keys: 'Ctrl+S' }) }).cmp);
 * ```
 */
export const createKbd = (props: KbdProps): Kbd => {
  const platform = props.platform ?? getKeyPlatform();
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'kbd',
    class: classes('aekKbd', props.class),
    attr: props.attr,
  });
  let keys = props.keys;
  const listeners = new Set<(keys: string) => void>();
  writeKeys(cmp.elem, keys, platform);
  return {
    cmp,
    setKeys: (next) => {
      keys = next;
      writeKeys(cmp.elem, keys, platform);
      for (const fn of listeners) fn(keys);
    },
    getAriaKeyShortcuts: () => getAriaKeyShortcuts(keys),
    onKeysChange: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
