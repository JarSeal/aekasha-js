// A shortcut's hint on a button or a menu item (p804 D13): a Kbd the app made. Imports Kbd's type
// only, so a button or a menu without a hint carries none of its code (Kbd and its key names are
// about 860 B gzip).
import type { Kbd } from './Kbd';

/**
 * Where {@link addShortcutHint} draws a hint
 * @internal
 */
export type ShortcutHintProps = {
  /** The button or menu item: it gets the hint and its `aria-keyshortcuts` */
  owner: HTMLElement;
  /** The hint */
  kbd: Kbd;
  /** The part's class on the hint (`aekButton__kbd`) */
  className: string;
  /** The child it goes before (default: last) */
  before?: Node | null;
};

/**
 * Draws a shortcut's hint in its owner, hidden from assistive tech, and keeps the owner's
 * `aria-keyshortcuts` with its keys (`setKeys` included). Returns what stops it: `removeHint`
 * also removes the hint's CMP.
 * @internal
 */
export const addShortcutHint = (props: ShortcutHintProps) => {
  const { owner, kbd } = props;
  const elem = kbd.cmp.elem;
  elem.classList.add(props.className);
  elem.setAttribute('aria-hidden', 'true');
  owner.insertBefore(elem, props.before?.parentNode === owner ? props.before : null);
  const writeShortcuts = () => owner.setAttribute('aria-keyshortcuts', kbd.getAriaKeyShortcuts());
  writeShortcuts();
  const removeKeysListener = kbd.onKeysChange(writeShortcuts);

  return (removeHint: boolean) => {
    removeKeysListener();
    if (removeHint) kbd.cmp.remove();
  };
};
