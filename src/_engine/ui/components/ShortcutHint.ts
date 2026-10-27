// A shortcut's hint on a button or a menu item (p804 D13): a Kbd the app made, or the deprecated
// string form, whose Kbd code loads on first use. Imports Kbd's type only, so a button or a menu
// without a hint carries none of its code (Kbd and its key names are about 860 B gzip).
import type { Kbd } from './Kbd';

/**
 * Where {@link addShortcutHint} draws a hint
 * @internal
 */
export type ShortcutHintProps = {
  /** The button or menu item: it gets the hint and its `aria-keyshortcuts` */
  owner: HTMLElement;
  /** The hint, or its keys (deprecated: removed in engine 6.0.0) */
  kbd: Kbd | string;
  /** The part's class on the hint (`aekButton__kbd`) */
  className: string;
  /** The child it goes before (default: last) */
  before?: Node | null;
};

/**
 * Draws a shortcut's hint in its owner, hidden from assistive tech, and keeps the owner's
 * `aria-keyshortcuts` with its keys (`setKeys` included). A string makes the hint with `createKbd`
 * after an `import()` (a frame later the first time). Returns what stops it: `removeHint` also
 * removes the hint's CMP, which a string's always is.
 * @internal
 */
export const addShortcutHint = (props: ShortcutHintProps) => {
  const { owner, kbd } = props;
  const isOwnHint = typeof kbd === 'string';
  let isStopped = false;
  let hint: Kbd | null = null;
  let removeKeysListener: (() => void) | null = null;

  const attach = (made: Kbd) => {
    if (isStopped) {
      // Stopped while Kbd loaded
      made.cmp.remove();
      return;
    }
    hint = made;
    const elem = made.cmp.elem;
    elem.classList.add(props.className);
    elem.setAttribute('aria-hidden', 'true');
    owner.insertBefore(elem, props.before?.parentNode === owner ? props.before : null);
    const writeShortcuts = () =>
      owner.setAttribute('aria-keyshortcuts', made.getAriaKeyShortcuts());
    writeShortcuts();
    removeKeysListener = made.onKeysChange(writeShortcuts);
  };

  if (isOwnHint) {
    void import('./Kbd').then(({ createKbd }) => attach(createKbd({ keys: kbd })));
  } else {
    attach(kbd);
  }

  return (removeHint: boolean) => {
    isStopped = true;
    removeKeysListener?.();
    removeKeysListener = null;
    if (removeHint || isOwnHint) hint?.cmp.remove();
    hint = null;
  };
};
