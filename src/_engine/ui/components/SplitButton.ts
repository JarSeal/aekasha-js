import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createMenu, type Menu, type MenuItem } from '../overlays/Menu';
import { createButton, type Button } from './Button';
import './Button.scss';
import '../styles/kit.scss';

/** What {@link createSplitButton} makes a split button from. */
export type SplitButtonProps = {
  /** The action's text, and the group's accessible name. */
  label: string;
  /** The action. */
  onClick: (e: Event) => void;
  /** The menu's items (the action's variants: "Save as…", "Save a copy"), or a getter re-read on
   * every open. */
  items: MenuItem[] | (() => MenuItem[]);
  /** The menu button's accessible name and tooltip (default 'More options'). */
  menuLabel?: string;
  /** Both buttons' look (default 'secondary'). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Both buttons' size (default 'md'). */
  size?: 'sm' | 'md' | 'lg';
  /** Raw HTML of the action's icon (`getSvgIcon('fileCode')`). */
  icon?: string;
  /** The action's shortcut's hint (`'Ctrl+S'`). */
  kbd?: string;
  /** Disables both buttons (default false). */
  disabled?: boolean;
  /** Extra classes for the group. */
  class?: string | string[];
  /** Extra attributes for the group. */
  attr?: CMPAttr;
  /** The group's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A split button {@link createSplitButton} made: its group, its two buttons and the menu. */
export type SplitButton = {
  /** The group: add it where it goes. `cmp.remove()` disposes of both buttons and the menu. */
  cmp: CMPHandle;
  /** The action's button */
  button: Button;
  /** The button that opens the menu */
  menuButton: Button;
  /** The menu */
  menu: Menu;
};

/** The menu button's caret, in the text colour (the kit's own markup) */
const CARET_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

/**
 * Creates a split button (p803 D10): an action's button and, joined to it, a button that opens a
 * menu of the action's variants, in a group named by the action.
 * - Parts: `.aekButtonGroup.aekSplitButton` (`role="group"`), its two `.aekButton`s (the menu
 *   button icon only, with a caret), and the menu's (see `createMenu`).
 * - Keys: Tab reaches each button; the menu button's keys are the menu's (Enter, Space, ArrowDown
 *   open it on its first item, ArrowUp on its last).
 * @example
 * ```ts
 * const save = createSplitButton({
 *   label: 'Save',
 *   variant: 'primary',
 *   onClick: () => saveScene(),
 *   items: [
 *     { label: 'Save as…', onSelect: () => saveSceneAs() },
 *     { label: 'Save a copy', onSelect: () => saveSceneCopy() },
 *   ],
 * });
 * toolbarPanel.add(save.cmp);
 * ```
 */
export const createSplitButton = (props: SplitButtonProps): SplitButton => {
  const { variant, size, disabled } = props;
  const button = createButton({
    label: props.label,
    onClick: props.onClick,
    icon: props.icon,
    kbd: props.kbd,
    variant,
    size,
    disabled,
  });
  const menuButton = createButton({
    label: props.menuLabel ?? 'More options',
    icon: CARET_SVG,
    iconOnly: true,
    variant,
    size,
    disabled,
  });
  const menu = createMenu({ anchor: menuButton.cmp.elem, items: props.items, align: 'end' });

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekButtonGroup', 'aekSplitButton', props.class),
    attr: { ...props.attr, role: 'group', 'aria-label': props.label },
    onRemoveCmp: () => menu.cmp.remove(),
  });
  cmp.add(button.cmp);
  cmp.add(menuButton.cmp);

  return { cmp, button, menuButton, menu };
};
