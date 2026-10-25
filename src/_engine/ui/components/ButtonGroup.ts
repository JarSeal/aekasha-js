import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import type { Button } from './Button';
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

const KEYS = {
  horizontal: { next: 'ArrowRight', previous: 'ArrowLeft' },
  vertical: { next: 'ArrowDown', previous: 'ArrowUp' },
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
  const keys = KEYS[orientation];

  const indexOf = (target: EventTarget | null) =>
    target ? elems.findIndex((elem) => elem.contains(target as Node)) : -1;
  const isEnabled = (index: number) => !elems[index].hasAttribute('disabled');

  /** The one tab stop of a toolbar */
  const setTabStop = (index: number) => {
    for (let i = 0; i < elems.length; i++) {
      elems[i].setAttribute('tabindex', i === index ? '0' : '-1');
    }
  };

  /** The next enabled button from `from` in `step`'s direction, wrapping (-1: none) */
  const findEnabled = (from: number, step: 1 | -1) => {
    const count = elems.length;
    for (let k = 1; k <= count; k++) {
      const index = (((from + step * k) % count) + count) % count;
      if (isEnabled(index)) return index;
    }
    return -1;
  };

  const getPressedIndex = () => buttons.findIndex((button) => button.isPressed());

  const setPressedIndex = (index: number) => {
    for (let i = 0; i < buttons.length; i++) buttons[i].setPressed(i === index);
    if (exclusive && index !== -1) setTabStop(index);
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
    setTabStop(index);
    props.onChange?.(index);
  };

  const onKeyDown = (e: Event) => {
    const { key } = e as KeyboardEvent;
    const index = indexOf(e.target);
    if (index === -1) return;
    let next = -1;
    if (key === keys.next) next = findEnabled(index, 1);
    else if (key === keys.previous) next = findEnabled(index, -1);
    else if (key === 'Home') next = findEnabled(elems.length - 1, 1);
    else if (key === 'End') next = findEnabled(0, -1);
    else return;
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(key);
    if (next === -1) return;
    setTabStop(next);
    elems[next].focus();
  };

  // The focus moving in some other way (a click, code) moves the tab stop with it
  const onFocusIn = (e: Event) => {
    const index = indexOf(e.target);
    if (index !== -1) setTabStop(index);
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
          { type: 'focusin', fn: onFocusIn },
        ]
      : [],
  });
  for (const button of buttons) cmp.add(button.cmp);
  if (exclusive) {
    const pressed = getPressedIndex();
    setTabStop(pressed !== -1 && isEnabled(pressed) ? pressed : findEnabled(-1, 1));
  }

  return { cmp, buttons, getPressedIndex, setPressedIndex };
};
