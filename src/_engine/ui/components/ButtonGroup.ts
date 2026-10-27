import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import type { Button } from './Button';
import { createRovingTabStop, getMoveTarget } from './RovingFocus';
import './Button.scss';
import '../styles/kit.scss';

/** What {@link createButtonGroup} makes a group from. */
export type ButtonGroupProps = {
  /** The group's accessible name (its `aria-label`): what the buttons are for. */
  label: string;
  /** Its buttons, made with `createButton`, in order: the group adds them. */
  buttons: Button[];
  /** One of its toggles pressed at a time (a view mode, a tool): the group is a toolbar, one tab
   * stop whose arrows move between the buttons. The buttons are toggles (`pressed`). Default false. */
  exclusive?: boolean;
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

/** A button group {@link createButtonGroup} made: its CMP, its buttons and an exclusive group's
 * pressed button. */
export type ButtonGroup = {
  /** The group's element: add it where it goes. `cmp.remove()` removes its buttons too. */
  cmp: CMPHandle;
  /** Its buttons, as given */
  buttons: Button[];
  /** The pressed button's index (-1: none) */
  getPressedIndex: () => number;
  /** Presses the button at `index` and releases the others, without calling `onChange` (-1
   * releases them all). */
  setPressedIndex: (index: number) => void;
};

/**
 * Creates a button group (p803 D10): buttons joined into one row (or column), named as a group.
 * With `exclusive` its toggles are a toolbar with one pressed at a time: a press of another one
 * releases the pressed one, and a press of the pressed one changes nothing.
 * - Parts: `.aekButtonGroup` (`data-orientation`), its `.aekButton`s with the inner corners square.
 * - ARIA: `role="group"`, or `role="toolbar"` (with `aria-orientation`) when exclusive; named by
 *   `label`.
 * - Keys, exclusive: the group is one tab stop (the pressed button, else the first), the arrows
 *   along it (Left / Right, or Up / Down) move the focus to the next enabled button, wrapping, and
 *   Home / End to the first / last; Space and Enter press the focused one. The keys it uses reach no
 *   key binding. A group that isn't exclusive is a tab stop per button.
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
export const createButtonGroup = (props: ButtonGroupProps): ButtonGroup => {
  const { buttons, exclusive = false, orientation = 'horizontal' } = props;
  const elems = buttons.map((button) => button.cmp.elem);

  const indexOf = (target: EventTarget | null) =>
    target ? elems.findIndex((elem) => elem.contains(target as Node)) : -1;
  const isDisabled = (index: number) => elems[index].hasAttribute('disabled');
  const moveOptions = { count: elems.length, orientation, wrap: true, isSkipped: isDisabled };

  /** The one tab stop of a toolbar */
  const tabStop = createRovingTabStop({ getElems: () => elems });

  const getPressedIndex = () => buttons.findIndex((button) => button.isPressed());

  const setPressedIndex = (index: number) => {
    for (let i = 0; i < buttons.length; i++) buttons[i].setPressed(i === index);
    if (exclusive && index !== -1) tabStop.setIndex(index);
  };

  /** Capture, before the button's own click: a press of the pressed button changes nothing */
  const onClickCapture = (e: Event) => {
    const index = indexOf(e.target);
    if (index !== -1 && buttons[index].isPressed()) e.stopPropagation();
  };

  /** Bubble, after the button pressed itself: the others are released */
  const onClick = (e: Event) => {
    const index = indexOf(e.target);
    if (index === -1 || !buttons[index].isPressed()) return;
    for (let i = 0; i < buttons.length; i++) if (i !== index) buttons[i].setPressed(false);
    tabStop.setIndex(index);
    props.onChange?.(index);
  };

  const onKeyDown = (e: Event) => {
    const { key } = e as KeyboardEvent;
    const index = indexOf(e.target);
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
      role: exclusive ? 'toolbar' : 'group',
      'aria-label': props.label,
      'data-orientation': orientation,
      ...(exclusive && orientation === 'vertical' ? { 'aria-orientation': 'vertical' } : {}),
    },
    listeners: exclusive
      ? [
          { type: 'click', fn: onClickCapture },
          { type: 'click', fn: onClick, options: { capture: false } },
          { type: 'keydown', fn: onKeyDown },
          // The focus moving in some other way (a click, code) moves the tab stop with it
          { type: 'focusin', fn: tabStop.onFocusIn },
        ]
      : [],
  });
  for (const button of buttons) cmp.add(button.cmp);
  if (exclusive) {
    const pressed = getPressedIndex();
    const first = getMoveTarget('Home', -1, moveOptions) ?? -1;
    tabStop.reset(pressed !== -1 && !isDisabled(pressed) ? pressed : first);
  }

  return { cmp, buttons, getPressedIndex, setPressedIndex };
};
