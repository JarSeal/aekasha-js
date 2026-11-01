// An on-screen tools group (p806 D7): a kit toolbar (`createButtonGroup`, roving focus) of icon
// buttons, toggles and drop-downs, refreshed in place so a press doesn't drop the focus. A group
// is rebuilt only when its tools change (a view switch adds or removes one), and the focus then
// goes to the same tool in the new one.
import { createButton } from '../ui/components/Button';
import { createButtonGroup } from '../ui/components/ButtonGroup';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { getSvgIcon, type SvgIconKey } from '../ui/core/icons/SvgIcon';
import { getDropDownTrigger, type DropDown } from '../ui/forms/DropDown';
import { getDebugKeyChordLabel } from './DefaultDebugKeyBindings';
import styles from './OnScreenTools.module.scss';

/** Every control's tooltip during a scene load (p806 D7) */
export const ON_SCREEN_TOOLS_LOADING_TEXT = 'Loading the scene…';

/** An on-screen tool: a kit icon button, its label the name and the tooltip. */
export type OnScreenTool = {
  /** Its key in the group, which a rebuilt group finds the focused tool by */
  key: string;
  label: string;
  icon: SvgIconKey;
  /** A smaller icon (the artwork fills its box) */
  isIconSmall?: boolean;
  /** The debug key's id (`DefaultDebugKeyBindings.ts`): its chord, with CONFIG.ts' rebinding, ends
   * the tooltip */
  keyId?: string;
  /** A toggle (`aria-pressed`): its state, read on every refresh */
  isPressed?: () => boolean;
  /** `aria-disabled` while false (undo with nothing to undo), read on every refresh */
  isEnabled?: () => boolean;
  /** Extra classes for the button */
  class?: string;
  onClick: () => void;
};

/** A drop-down in a group, made with the group (`focusableWhenDisabled`, so the arrows stop on it
 * while it's disabled) */
export type OnScreenDropDownTool = {
  key: string;
  create: () => DropDown;
  /** After each refresh of its label (a state the trigger shows) */
  onRefresh?: (dropDown: DropDown) => void;
};

export type OnScreenToolItem = OnScreenTool | OnScreenDropDownTool;

/** What `createOnScreenToolbar` makes a group from */
export type OnScreenToolbarProps = {
  /** The toolbar's accessible name */
  label: string;
  items: OnScreenToolItem[];
  /** The view switch: one tool pressed at a time (each one's `isPressed`) */
  exclusive?: boolean;
  class: string[];
};

/** A group `createOnScreenToolbar` made */
export type OnScreenToolbar = {
  cmp: CMPHandle;
  /** Its tools' keys and labels: a group whose items give another signature is rebuilt */
  signature: string;
  /** Re-reads every tool's state; `isLoading` disables them all (p806 D7) */
  refresh: (isLoading: boolean) => void;
  /** A drop-down tool by its key */
  getDropDown: (key: string) => DropDown | null;
  /** The focused tool's key, when the focus is in the group */
  getFocusedKey: () => string | null;
  /** Focuses a tool by its key (the first one when it's gone) */
  focusKey: (key: string) => void;
};

const isDropDownTool = (item: OnScreenToolItem): item is OnScreenDropDownTool => 'create' in item;

/** The signature of a group's items: its keys and labels in order */
export const getOnScreenToolsSignature = (items: OnScreenToolItem[]) =>
  items.map((item) => (isDropDownTool(item) ? item.key : `${item.key}:${item.label}`)).join('|');

const getTooltip = (tool: OnScreenTool) => {
  const chord = tool.keyId ? getDebugKeyChordLabel(tool.keyId) : '';
  return chord ? `${tool.label} (${chord})` : tool.label;
};

/** A press on a tool leaves the focus where it was (the canvas, the page): the app's keys go on
 * working after a click on a tool (a debugger control's keys are the debugger's, p806 D12). The
 * keys reach the tools by Tab. The rows' `mousedown` listener. */
export const keepFocusOnPress = (e: Event) => {
  if ((e as MouseEvent).button === 0) e.preventDefault();
};

const createToolButton = (tool: OnScreenTool) =>
  createButton({
    label: tool.label,
    tooltip: getTooltip(tool),
    icon: getSvgIcon(tool.icon),
    iconOnly: true,
    variant: 'ghost',
    size: 'lg',
    focusableWhenDisabled: true,
    ...(tool.isPressed ? { pressed: tool.isPressed() } : {}),
    class: [
      styles.onScreenTool,
      'onScreenTool',
      ...(tool.isIconSmall ? [styles.smallToolIcon] : []),
      ...(tool.class ? [tool.class] : []),
    ],
    // Not stopped: an exclusive group releases the other buttons after the click
    onClick: () => tool.onClick(),
  });

/** Creates an on-screen tools group: a toolbar of its items, refreshed with `refresh`. */
export const createOnScreenToolbar = (props: OnScreenToolbarProps): OnScreenToolbar => {
  const { items } = props;
  const controls = items.map((item) =>
    isDropDownTool(item) ? item.create() : createToolButton(item)
  );
  const group = createButtonGroup({
    label: props.label,
    buttons: controls,
    ...(props.exclusive ? { exclusive: true } : { toolbar: true }),
    class: [styles.onScreenToolGroup, 'onScreenToolGroup', ...props.class],
  });
  const { cmp } = group;

  /** The element of a control that takes the focus: a button, a drop-down's trigger */
  const getFocusElem = (index: number) => {
    const control = controls[index];
    return 'toggle' in control ? getDropDownTrigger(control) : control.cmp.elem;
  };

  const refresh = (isLoading: boolean) => {
    const reason = isLoading ? ON_SCREEN_TOOLS_LOADING_TEXT : undefined;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const control = controls[i];
      if ('toggle' in control) {
        control.refresh();
        control.setDisabled(isLoading, reason);
        if (isDropDownTool(item)) item.onRefresh?.(control);
      } else if (!isDropDownTool(item)) {
        if (item.isPressed) control.setPressed(item.isPressed());
        control.setDisabled(isLoading || item.isEnabled?.() === false, reason);
      }
    }
    cmp.elem.toggleAttribute('aria-busy', isLoading);
  };

  const indexOfKey = (key: string) => items.findIndex((item) => item.key === key);

  return {
    cmp,
    signature: getOnScreenToolsSignature(items),
    refresh,
    getDropDown: (key) => {
      const control = controls[indexOfKey(key)];
      return control && 'toggle' in control ? control : null;
    },
    getFocusedKey: () => {
      const focused = document.activeElement;
      if (!focused || !cmp.elem.contains(focused)) return null;
      return items.find((_, i) => getFocusElem(i).contains(focused))?.key ?? null;
    },
    focusKey: (key) => {
      const index = indexOfKey(key);
      if (items.length) getFocusElem(index === -1 ? 0 : index).focus();
    },
  };
};
