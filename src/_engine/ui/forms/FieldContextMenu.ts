// The fields' context menu (p805 D11, p804 D1's move): one delegated context menu over the fields
// in a container (a grid, a form, a panel): Reset, Copy, Paste and Copy as, read from each field's
// shell (`getFieldMenuEntry`). An app opts in per container.
import type { CMPAttr } from '../core/CMPTypes';
import { lwarn } from '../../utils/Logger';
import { createContextMenu, type ContextMenu } from '../overlays/ContextMenu';
import type { MenuItem } from '../overlays/Menu';
import { getFieldMenuEntry, type FieldMenuEntry } from './Field';

/** What {@link createFieldContextMenu} makes the fields' menu from. */
export type FieldContextMenuProps = {
  /** The element whose fields get the menu: a property grid's, a form's or any panel's element. */
  container: HTMLElement;
  /** Extra classes for the menu's element. */
  class?: string | string[];
  /** Extra attributes for the menu's element. */
  attr?: CMPAttr;
  /** The menu's element id (default: a generated one). */
  id?: string;
};

const getClipboard = () =>
  typeof navigator === 'undefined' ? undefined : (navigator.clipboard as Clipboard | undefined);
const canWrite = () => typeof getClipboard()?.writeText === 'function';
const canRead = () => typeof getClipboard()?.readText === 'function';

const writeText = (text: string) => {
  getClipboard()
    ?.writeText(text)
    .catch(() => lwarn('The fields’ menu could not copy: the clipboard refused the write.'));
};

/** Reads the clipboard and pastes it into the field, if it's still there and enabled after the
 * read (the browser may ask the user first) */
const pasteAsync = async (fieldElem: Element, entry: FieldMenuEntry) => {
  let text: string;
  try {
    text = (await getClipboard()?.readText()) ?? '';
  } catch {
    lwarn('The fields’ menu could not paste: the clipboard refused the read.');
    return;
  }
  if (!fieldElem.isConnected || getFieldMenuEntry(fieldElem) !== entry || entry.isDisabled()) {
    return;
  }
  entry.paste?.(text);
};

/** The menu's items for a field, its state read now */
const getFieldItems = (fieldElem: Element, entry: FieldMenuEntry): MenuItem[] => {
  const items: MenuItem[] = [
    {
      label: 'Reset',
      disabled: entry.isMonitor || entry.isDisabled() || entry.isDefault(),
      onSelect: entry.reset,
    },
    { type: 'separator' },
    {
      label: 'Copy',
      disabled: !entry.getText || !canWrite(),
      onSelect: () => entry.getText && writeText(entry.getText()),
    },
    {
      label: 'Paste',
      disabled: !entry.paste || entry.isDisabled() || !canRead(),
      onSelect: () => void pasteAsync(fieldElem, entry),
    },
  ];
  if (entry.copyAs.length) {
    items.push({
      type: 'submenu',
      label: 'Copy as',
      disabled: !canWrite(),
      items: entry.copyAs.map((form) => ({
        label: form.label,
        onSelect: () => writeText(form.getText()),
      })),
    });
  }
  return items;
};

/**
 * Gives every field in `container` a context menu (p805 D11): Reset (the field's default; disabled
 * at it, for a monitor and for a disabled field), Copy (the value as text: a number as it is, a
 * colour's hex, a vector's `1, 2.5, -3`, an option's label, a monitor's text), Paste (read when
 * it's picked, which the browser may ask about; a text that isn't a value is the field's message,
 * as a typed one is; disabled for a monitor, a disabled field and where the page can't read the
 * clipboard) and Copy as, a submenu of a colour's hex, `rgb()` and sRGB floats or a vector's array
 * and object. One delegated menu (`createContextMenu`) serves fields added later too.
 * - Opens: a right click on a field's label (on the control the browser's own menu stays: a text's
 *   Cut, Copy and Paste), the ContextMenu key or Shift+F10 with the focus in a field, a touch long
 *   press on the label. Named by the field's label.
 *
 * The menu isn't added anywhere: dispose of it with `cmp.remove()` when the container goes.
 * @example
 * ```ts
 * const grid = createPropertyGrid({ children: [speedField, tintField] });
 * settingsPanel.add(grid.cmp);
 * const fieldsMenu = createFieldContextMenu({ container: grid.cmp.elem });
 * // With the panel: fieldsMenu.cmp.remove()
 * ```
 */
export const createFieldContextMenu = (props: FieldContextMenuProps): ContextMenu => {
  const { container } = props;
  const findField = (elem: Element) => {
    const fieldElem = elem.closest('.aekField');
    if (!fieldElem || !container.contains(fieldElem)) return null;
    const entry = getFieldMenuEntry(fieldElem);
    return entry ? { fieldElem, entry } : null;
  };
  return createContextMenu({
    target: container,
    items: (elem, source) => {
      const found = findField(elem);
      if (!found) return [];
      // The pointer on the control leaves the browser's own menu (a text's Cut, Copy, Paste)
      if (source !== 'keyboard' && !found.entry.labelElem.contains(elem)) return [];
      return getFieldItems(found.fieldElem, found.entry);
    },
    label: (elem) => findField(elem)?.entry.label ?? 'Field',
    class: props.class,
    attr: props.attr,
    id: props.id,
  });
};
