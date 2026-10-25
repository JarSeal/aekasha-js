import type { CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { pushOverlay, swallowNextKeyUp } from '../overlays/OverlayStack';
import { showAnchored } from '../overlays/Anchor';
import './DropDown.scss';
import '../styles/kit.scss';

/** One of a drop-down's options. */
export type DropDownOption = {
  /** What `onChange` gets */
  value: string;
  /** What the list and the trigger show */
  label: string;
};

/** What {@link createDropDown} makes a drop-down from. */
export type DropDownProps = {
  /** The options, or a getter re-read on every open (and refresh). */
  options: DropDownOption[] | (() => DropDownOption[]);
  /** The current value: the trigger shows its label, and the list opens on it and marks it. A
   * getter is re-read on every open, after every pick and on refresh. */
  value?: string | null | (() => string | null);
  /** A picked option, also the current one (the handler decides what that does). The trigger's
   * label is refreshed after it returns, so a `value` getter that reads what it set shows the
   * pick. */
  onChange: (value: string) => void;
  /** The trigger's text when no option matches the value. */
  placeholder?: string;
  /** Raw HTML of the trigger's icon (eg. `getSvgIcon('camera', 'small')`). */
  icon?: string;
  /** The trigger's tooltip and the list's accessible name. */
  title?: string;
  /** Which side of the trigger the list opens on, when it fits there (else the other). Default
   * 'bottom'. */
  placement?: 'top' | 'bottom';
  /** Disables the trigger (default false). */
  disabled?: boolean;
  /** Extra classes (a class name, or several) for the root. The default styles (DropDown.scss)
   * have zero specificity (`:where()`), so any class overrides them; the elements also carry the
   * global `aekDropDown*` classes. */
  className?: string | string[];
  /** Extra classes for the trigger button */
  triggerClass?: string | string[];
  /** Extra classes for the trigger's label */
  labelClass?: string | string[];
  /** Extra classes for the list */
  listClass?: string | string[];
  /** Extra classes for each option */
  itemClass?: string | string[];
  /** Runs when the list opens */
  onOpen?: () => void;
  /** Runs when the list closes, however it closes */
  onClose?: () => void;
};

/** A drop-down {@link createDropDown} made: its CMP, to add where it goes, and its controls. */
export type DropDown = {
  /** The dropdown's root (the trigger, and the list while it is open). */
  cmp: CMPHandle;
  /** Opens the list on the current value and focuses it. */
  open: () => void;
  /** Closes the list without a change, giving the focus back when it was in the list. */
  close: () => void;
  /** Opens the list, or closes it when it's open. */
  toggle: () => void;
  /** Whether the list is open */
  isOpen: () => boolean;
  /** Re-reads the value (and options) into the trigger's label: for a change made elsewhere (a
   * pick refreshes it itself). */
  refresh: () => void;
};

/**
 * The old name of {@link DropDown}.
 * @deprecated Use {@link DropDown}. Removed in engine 6.0.0.
 */
export type TDropDown = DropDown;

const ROOT_CLASS = 'aekDropDown';
const TRIGGER_CLASS = 'aekDropDownTrigger';
const LABEL_CLASS = 'aekDropDownLabel';
const CARET_CLASS = 'aekDropDownCaret';
const LIST_CLASS = 'aekDropDownList';
const ITEM_CLASS = 'aekDropDownItem';
const HIGHLIGHTED_CLASS = 'isHighlighted';
const ACTIVE_ATTR = 'data-active';
const CURRENT_CLASS = 'isCurrent';
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

const resolve = <T>(value: T | (() => T)) =>
  typeof value === 'function' ? (value as () => T)() : value;

/**
 * Creates a dropdown: a trigger button with an icon, the current option's label and a caret, and
 * an in-page list (not a native select: a native list owns the keyboard while it is open, and
 * Chrome on Windows commits the highlighted option when it is closed with Escape). The list opens
 * in the browser's top layer, so no window clips it, on the `placement` side when it fits there
 * (else the other), inside the HUD's bounds and as tall as the space left.
 * A click on the trigger toggles the list. In the list, arrow keys, Home and End move, Enter,
 * Space or a click picks, and Escape, Tab or a click outside closes it without a change. The
 * list's keys reach no key binding (their keyups included). The open list is on the kit's overlay
 * stack: in a dialog, one Escape closes the list and the next the dialog. A pick, Escape or Tab
 * gives the focus back to what had it when the list opened (the trigger, opened by its keys).
 * The drop-down isn't added anywhere: add its `cmp` where it goes.
 * @example
 * ```ts
 * const quality = createDropDown({
 *   options: [
 *     { value: 'low', label: 'Low' },
 *     { value: 'high', label: 'High' },
 *   ],
 *   value: () => settings.quality,
 *   onChange: (value) => setQuality(value),
 *   title: 'Quality',
 * });
 * settingsPanel.add(quality.cmp);
 * ```
 */
export const createDropDown = (props: DropDownProps): DropDown => {
  const placement = props.placement || 'bottom';
  let list: CMPHandle | null = null;
  /** Removes the open list's overlay stack entry */
  let removeOverlay: ((returnFocus?: boolean) => void) | null = null;
  /** Stops the open list's anchoring (`showAnchored`) */
  let hideAnchored: (() => void) | null = null;

  const getOptions = () => resolve(props.options);
  const getValue = () => resolve(props.value ?? null);

  const root = CMP({
    class: classes(ROOT_CLASS, `${ROOT_CLASS}_${placement}`, props.className),
    onRemoveCmp: () => {
      list = null;
      // Removed with its list open (eg. in a closing dialog): the dialog returns the focus
      removeOverlay?.(false);
      removeOverlay = null;
      hideAnchored?.();
      hideAnchored = null;
    },
  });

  const trigger = CMP({
    html: () => `<button type="button" class="${classes(TRIGGER_CLASS, props.triggerClass).join(' ')}"${props.disabled ? ' disabled' : ''}>
  ${props.icon || ''}
  <span class="${classes(LABEL_CLASS, props.labelClass).join(' ')}"></span>
  <span class="${CARET_CLASS}"></span>
</button>`,
    attr: {
      ...(props.title ? { title: props.title } : {}),
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
    },
    // Not focused by the press: an open list's focusout would close it before the click, which
    // would then reopen it instead of closing it
    listeners: [{ type: 'mousedown', fn: (e) => e.preventDefault() }],
    onClick: (e) => {
      e.stopPropagation();
      toggle();
    },
  });
  root.add(trigger);
  const labelElem = trigger.elem.querySelector(`.${LABEL_CLASS}`);

  const refresh = () => {
    const value = getValue();
    // Text, not HTML: labels often come from app data
    if (labelElem) {
      labelElem.textContent =
        getOptions().find((option) => option.value === value)?.label ?? props.placeholder ?? '';
    }
  };

  /** Closes the list; `returnFocus` false when the focus is moving elsewhere (a focusout) */
  const close = (returnFocus = true) => {
    const openList = list;
    list = null; // first: removing the focused list fires its focusout
    if (!openList) return;
    trigger.updateAttr({ 'aria-expanded': 'false' });
    // Before the list goes: the focus is still in it
    removeOverlay?.(returnFocus);
    removeOverlay = null;
    hideAnchored?.();
    hideAnchored = null;
    openList.remove();
    props.onClose?.();
  };

  const open = () => {
    if (list || props.disabled) return;
    const options = getOptions();
    if (!options.length) return;
    const currentValue = getValue();
    let index = Math.max(
      0,
      options.findIndex((option) => option.value === currentValue)
    );

    const newList: CMPHandle = CMP({
      tag: 'ul',
      class: classes(LIST_CLASS, props.listClass),
      attr: {
        role: 'listbox',
        tabindex: '-1',
        ...(props.title ? { 'aria-label': props.title } : {}),
      },
      onClick: (e) => {
        e.stopPropagation();
        const item = (e.target as HTMLElement).closest('li');
        if (item) choose(Number(item.dataset.index));
      },
      listeners: [
        // Keeps the focus in the list on a click, so the click lands before any focusout
        { type: 'mousedown', fn: (e) => e.preventDefault() },
        { type: 'keydown', fn: (e) => onKeyDown(e as KeyboardEvent) },
        {
          type: 'keyup',
          fn: (e) => {
            if (NAV_KEYS.has((e as KeyboardEvent).key)) e.stopPropagation();
          },
        },
        {
          type: 'mousemove',
          fn: (e) => {
            const item = (e.target as HTMLElement).closest('li');
            if (item && Number(item.dataset.index) !== index) highlight(Number(item.dataset.index));
          },
        },
        {
          type: 'focusout',
          fn: (e) => {
            const next = (e as FocusEvent).relatedTarget as Node | null;
            if (!next || !newList.elem.contains(next)) close(false);
          },
        },
      ],
    });

    const highlight = (newIndex: number) => {
      index = Math.min(options.length - 1, Math.max(0, newIndex));
      const items = newList.elem.children;
      for (let i = 0; i < items.length; i++) {
        items[i].classList.toggle(HIGHLIGHTED_CLASS, i === index);
        // The ring's: the list keeps the focus for aria-activedescendant (p803 D7)
        items[i].toggleAttribute(ACTIVE_ATTR, i === index);
      }
      items[index]?.scrollIntoView({ block: 'nearest' });
      newList.updateAttr({ 'aria-activedescendant': `${newList.id}-${index}` });
    };

    const choose = (chosenIndex: number) => {
      close();
      props.onChange(options[chosenIndex].value);
      refresh();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'ArrowDown') highlight(index + 1);
      else if (e.key === 'ArrowUp') highlight(index - 1);
      else if (e.key === 'Home') highlight(0);
      else if (e.key === 'End') highlight(options.length - 1);
      else if (e.key === 'Enter' || e.key === ' ') {
        swallowNextKeyUp(e.key);
        choose(index);
      } else if (e.key === 'Escape') {
        // The overlay stack takes Escape first under the HUD root; this is a list outside it
        swallowNextKeyUp(e.key);
        close();
      } else if (e.key === 'Tab') {
        close();
        return;
      } else return; // Other keys go on (eg. a shortcut that toggles this list)
      // The list's keys reach no key binding
      e.preventDefault();
      e.stopPropagation();
    };

    for (let i = 0; i < options.length; i++) {
      const isCurrent = options[i].value === currentValue;
      newList.add({
        tag: 'li',
        text: options[i].label,
        class: classes(ITEM_CLASS, isCurrent ? CURRENT_CLASS : null, props.itemClass),
        attr: {
          id: `${newList.id}-${i}`,
          role: 'option',
          'aria-selected': String(isCurrent),
          'data-index': String(i),
        },
      });
    }

    root.add(newList);
    list = newList;
    trigger.updateAttr({ 'aria-expanded': 'true' });
    // Shown before the highlight scrolls to it: a closed popover has no box
    hideAnchored = showAnchored({
      elem: newList.elem,
      anchor: trigger.elem,
      side: placement,
      matchAnchorWidth: true,
    });
    highlight(index);
    // Before the focus moves in: the entry returns it where it was
    removeOverlay = pushOverlay({ elem: newList.elem, close: () => close() });
    newList.elem.focus({ preventScroll: true });
    props.onOpen?.();
  };

  const toggle = () => (list ? close() : open());

  refresh();

  return { cmp: root, open, close: () => close(), toggle, isOpen: () => Boolean(list), refresh };
};
