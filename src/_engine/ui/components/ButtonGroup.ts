import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getDropDownTrigger, type DropDown } from '../forms/DropDown';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import type { Button } from './Button';
import { createRovingTabStop, getMoveTarget } from './RovingFocus';
import './Button.scss';
import '../styles/kit.scss';

/** What a button group holds: buttons made with `createButton`, and in a toolbar that isn't
 * exclusive also drop-downs made with `createDropDown` (a toolbar's menu button). */
export type ButtonGroupItem = Button | DropDown;

/**
 * What {@link createButtonGroup} makes a group from.
 * @template T its items' type: buttons, or buttons and drop-downs
 */
export type ButtonGroupProps<T extends ButtonGroupItem = Button> = {
  /** The group's accessible name (its `aria-label`): what the buttons are for. */
  label: string;
  /** Its buttons, made with `createButton`, in order: the group adds them. A `toolbar` that isn't
   * `exclusive` takes drop-downs (`createDropDown`) among them too. */
  buttons: T[];
  /** One of its toggles pressed at a time (a view mode, a tool): the group is a toolbar, one tab
   * stop whose arrows move between the buttons. The buttons are toggles (`pressed`). Default false. */
  exclusive?: boolean;
  /** A toolbar of independent buttons, toggles and drop-downs (a viewport's tools): one tab stop
   * whose arrows move between them, each acting on its own. Implied by `exclusive`. Default false. */
  toolbar?: boolean;
  /** Which way the buttons run, and so which arrows move between them (default 'horizontal'). */
  orientation?: 'horizontal' | 'vertical';
  /** An exclusive group's newly pressed button, by its index. */
  onChange?: (index: number) => void;
  /** Extra classes for the group. */
  class?: string | string[];
  /** Extra attributes for the group. */
  attr?: CMPAttr;
  /** The group's element id (default: a generated one, not written to the element). */
  id?: string;
};

/**
 * A button group {@link createButtonGroup} made: its CMP, its buttons and an exclusive group's
 * pressed button.
 * @template T its items' type: buttons, or buttons and drop-downs
 */
export type ButtonGroup<T extends ButtonGroupItem = Button> = {
  /** The group's element: add it where it goes. `cmp.remove()` removes its buttons too. */
  cmp: CMPHandle;
  /** Its buttons, as given */
  buttons: T[];
  /** The pressed button's index (-1: none) */
  getPressedIndex: () => number;
  /** Presses the button at `index` and releases the others, without calling `onChange` (-1
   * releases them all). */
  setPressedIndex: (index: number) => void;
};

const isDropDown = (item: ButtonGroupItem): item is DropDown => 'toggle' in item;

/**
 * Creates a button group (p803 D10): buttons joined into one row (or column), named as a group.
 * With `exclusive` its toggles are a toolbar with one pressed at a time: a press of another one
 * releases the pressed one, and a press of the pressed one changes nothing. With `toolbar` its
 * buttons, toggles and drop-downs are a toolbar whose items act on their own (p806 D7).
 * - Parts: `.aekButtonGroup` (`data-orientation`), its `.aekButton`s with the inner corners square.
 * - ARIA: `role="group"`, or `role="toolbar"` (with `aria-orientation`) when exclusive or a
 *   toolbar; named by `label`.
 * - Keys, a toolbar (exclusive or not): the group is one tab stop (an exclusive group's pressed
 *   button, else the first), the arrows along it (Left / Right, or Up / Down) move the focus to the
 *   next item that isn't `disabled`, wrapping, and Home / End to the first / last; an item disabled
 *   with `aria-disabled` (`focusableWhenDisabled`) is still a stop, as the APG's toolbar. Space and
 *   Enter press the focused button or open the focused drop-down. The keys it uses reach no key
 *   binding. A group that isn't a toolbar is a tab stop per button.
 * @template T its items' type: buttons, or buttons and drop-downs
 * @example
 * ```ts
 * const views = ['Lit', 'Wireframe', 'Normals'].map((label, i) =>
 *   createButton({ label, pressed: i === 0 })
 * );
 * const viewGroup = createButtonGroup({
 *   label: 'View mode',
 *   buttons: views,
 *   exclusive: true,
 *   onChange: (index) => setViewMode(index),
 * });
 * toolbarPanel.add(viewGroup.cmp);
 * ```
 */
export const createButtonGroup = <T extends ButtonGroupItem = Button>(
  props: ButtonGroupProps<T>
): ButtonGroup<T> => {
  const { buttons, exclusive = false, orientation = 'horizontal' } = props;
  const isToolbar = exclusive || Boolean(props.toolbar);
  /** The elements that take the focus: a button, a drop-down's trigger */
  const elems = buttons.map((item) =>
    isDropDown(item) ? getDropDownTrigger(item) : item.cmp.elem
  );

  const indexOf = (target: EventTarget | null) =>
    target ? elems.findIndex((elem) => elem.contains(target as Node)) : -1;
  const isDisabled = (index: number) => elems[index].hasAttribute('disabled');
  const moveOptions = { count: elems.length, orientation, wrap: true, isSkipped: isDisabled };

  /** The one tab stop of a toolbar */
  const tabStop = createRovingTabStop({ getElems: () => elems });

  const isPressedAt = (index: number) => {
    const item = buttons[index];
    return !isDropDown(item) && item.isPressed();
  };

  const getPressedIndex = () => buttons.findIndex((_, i) => isPressedAt(i));

  const setPressedIndex = (index: number) => {
    for (let i = 0; i < buttons.length; i++) {
      const item = buttons[i];
      if (!isDropDown(item)) item.setPressed(i === index);
    }
    if (exclusive && index !== -1) tabStop.setIndex(index);
  };

  /** Capture, before the button's own click: a press of the pressed button changes nothing */
  const onClickCapture = (e: Event) => {
    const index = indexOf(e.target);
    if (index !== -1 && isPressedAt(index)) e.stopPropagation();
  };

  /** Bubble, after the button pressed itself: the others are released */
  const onClick = (e: Event) => {
    const index = indexOf(e.target);
    if (index === -1 || !isPressedAt(index)) return;
    setPressedIndex(index);
    props.onChange?.(index);
  };

  const onKeyDown = (e: Event) => {
    const { key } = e as KeyboardEvent;
    // An item's own element only: an open drop-down's list keeps its keys
    const index = elems.indexOf(e.target as HTMLElement);
    if (index === -1) return;
    const next = getMoveTarget(key, index, moveOptions);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key);
    if (next === -1) return;
    tabStop.setIndex(next);
    elems[next].focus();
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekButtonGroup', props.class),
    attr: {
      ...props.attr,
      role: isToolbar ? 'toolbar' : 'group',
      'aria-label': props.label,
      'data-orientation': orientation,
      ...(isToolbar && orientation === 'vertical' ? { 'aria-orientation': 'vertical' } : {}),
    },
    listeners: [
      ...(exclusive
        ? [
            { type: 'click', fn: onClickCapture },
            { type: 'click', fn: onClick, options: { capture: false } },
          ]
        : []),
      ...(isToolbar
        ? [
            { type: 'keydown', fn: onKeyDown },
            // The focus moving in some other way (a click, code) moves the tab stop with it
            { type: 'focusin', fn: tabStop.onFocusIn },
          ]
        : []),
    ],
  });
  for (const button of buttons) cmp.add(button.cmp);
  if (isToolbar) {
    const pressed = exclusive ? getPressedIndex() : -1;
    const first = getMoveTarget('Home', -1, moveOptions) ?? -1;
    tabStop.reset(pressed !== -1 && !isDisabled(pressed) ? pressed : first);
  }

  return { cmp, buttons, getPressedIndex, setPressedIndex };
};
