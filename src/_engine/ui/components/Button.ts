import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import { createKbd } from './Kbd';
import { getAriaKeyShortcuts } from './KeyNames';
import './Button.scss';
import '../styles/kit.scss';

/** What {@link createButton} makes a button from. */
export type ButtonProps = {
  /** Its text, and its accessible name. With `iconOnly` it isn't shown: it's the `aria-label` and
   * the tooltip. */
  label: string;
  /** Its look (default 'secondary'): `primary` is the one main action of a group, `danger` a
   * destructive one, `ghost` a quiet one (a toolbar's), `link` a button that looks like a link (an
   * action, not a navigation: a navigation is `createLink`). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
  /** Its size from the type and space scales (default 'md'). */
  size?: 'sm' | 'md' | 'lg';
  /** Raw HTML of its icon (`getSvgIcon('gear')`), drawn at `1em`. */
  icon?: string;
  /** Which side of the label the icon is on (default 'start'). */
  iconPosition?: 'start' | 'end';
  /** Shows only the icon: `label` becomes the `aria-label` and the tooltip. */
  iconOnly?: boolean;
  /** Its tooltip's text (default: none, or `label` with `iconOnly`). */
  tooltip?: string;
  /** A shortcut's hint drawn after the label with `createKbd` (`'Ctrl+S'`), and the button's
   * `aria-keyshortcuts`. Display only: binding the key is the app's. */
  kbd?: string;
  /** Makes it a toggle button with this state (`aria-pressed`): a click flips it. */
  pressed?: boolean;
  /** A toggle's new state, after a click flipped it. */
  onPressedChange?: (pressed: boolean) => void;
  /** Makes it a hold to confirm button (a destructive action): it acts after the pointer, Space
   * or Enter is held this long (eg. 800), and releasing earlier cancels. */
  holdToConfirmMs?: number;
  /** Disables it (default false). */
  disabled?: boolean;
  /** Its `type` in a form (default 'button'). */
  type?: 'button' | 'submit' | 'reset';
  /** Its action: the click, or the press that was held long enough with `holdToConfirmMs`. Not
   * called while it's loading. */
  onClick?: (e: Event) => void;
  /** Extra classes for the button. */
  class?: string | string[];
  /** Extra attributes for the button. */
  attr?: CMPAttr;
  /** The button's element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A button {@link createButton} made: its CMP and its setters, each writing it in place. */
export type Button = {
  /** The `<button>`: add it where it goes. `cmp.remove()` disposes of it with its tooltip and
   * its hold timer. */
  cmp: CMPHandle;
  /** Changes its text (with `iconOnly`, its `aria-label` and tooltip). */
  setLabel: (label: string) => void;
  /** Disables or enables it. */
  setDisabled: (isDisabled: boolean) => void;
  /** Shows it loading (its width kept, the text faded into a spinner, `aria-busy`, clicks
   * ignored), or done. */
  setLoading: (isLoading: boolean) => void;
  /** Whether it's loading */
  isLoading: () => boolean;
  /** Sets a toggle's state without calling `onPressedChange`. */
  setPressed: (pressed: boolean) => void;
  /** A toggle's state (false for a button that isn't one) */
  isPressed: () => boolean;
};

/** The hold to confirm's description, which assistive tech reads after the button's name */
const HOLD_TEXT = 'Hold to confirm';
const HOLD_KEYS = new Set([' ', 'Enter']);

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

/**
 * A hold to confirm's timer and listeners (the button's `holdToConfirmMs`): a primary pointer press
 * (captured), Space or Enter starts it unless `canStart` says no, it calls `onConfirm` after
 * `holdMs` and stays full until the release, and a release, a cancel or a blur before ends it.
 */
const createHoldToConfirm = (
  getElem: () => HTMLElement,
  holdMs: number,
  canStart: () => boolean,
  onConfirm: (e: Event) => void
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let isHolding = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!isHolding) return;
    isHolding = false;
    getElem().removeAttribute('data-holding');
  };

  const start = (e: Event) => {
    const elem = getElem();
    if (isHolding || !canStart()) return;
    isHolding = true;
    // Information, not motion: under reduced motion the fill steps
    if (getMotionFactor(elem) === 0) elem.setAttribute('data-hold-steps', '');
    else elem.removeAttribute('data-hold-steps');
    elem.setAttribute('data-holding', 'filling');
    timer = setTimeout(() => {
      timer = null;
      // Full until it's released
      elem.setAttribute('data-holding', 'confirmed');
      onConfirm(e);
    }, holdMs);
  };

  const listeners = [
    {
      type: 'pointerdown',
      fn: (e: Event) => {
        const pointer = e as PointerEvent;
        if (pointer.button !== 0) return;
        const elem = getElem();
        if (typeof elem.setPointerCapture === 'function') elem.setPointerCapture(pointer.pointerId);
        start(e);
      },
    },
    { type: 'pointerup', fn: clear },
    { type: 'pointercancel', fn: clear },
    { type: 'lostpointercapture', fn: clear },
    {
      type: 'keydown',
      fn: (e: Event) => {
        const key = e as KeyboardEvent;
        if (!HOLD_KEYS.has(key.key)) return;
        // No click from the key: the timer acts
        e.preventDefault();
        if (!key.repeat) start(e);
      },
    },
    {
      type: 'keyup',
      fn: (e: Event) => {
        if (!HOLD_KEYS.has((e as KeyboardEvent).key)) return;
        e.preventDefault();
        clear();
      },
    },
    { type: 'blur', fn: clear },
  ];
  return { listeners, clear };
};

/** Appends the button's parts, in order: the icon, the label (not with `iconOnly`), the
 * shortcut's hint, and a hold to confirm's fill and description */
const appendParts = (elem: HTMLElement, props: ButtonProps, labelElem: HTMLElement, id: string) => {
  const parts: HTMLElement[] = [];
  if (props.icon) {
    const icon = createPart('aekButton__icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = props.icon;
    parts.push(icon);
  }
  if (!props.iconOnly) {
    if (props.iconPosition === 'end') parts.unshift(labelElem);
    else parts.push(labelElem);
  }
  if (props.kbd) {
    const kbd = createKbd({ keys: props.kbd, class: 'aekButton__kbd' }).cmp.elem;
    kbd.setAttribute('aria-hidden', 'true');
    parts.push(kbd);
  }
  if (props.holdToConfirmMs) {
    const fill = createPart('aekButton__hold');
    fill.setAttribute('aria-hidden', 'true');
    // Hidden, so it isn't part of the name; aria-describedby reads it all the same
    const description = createPart('aekButton__holdText');
    description.id = `${id}__hold`;
    description.setAttribute('hidden', '');
    description.textContent = HOLD_TEXT;
    parts.push(fill, description);
    elem.setAttribute('aria-describedby', description.id);
    elem.style.setProperty('--aek-button-hold-time', `${props.holdToConfirmMs}ms`);
  }
  elem.append(...parts);
};

/**
 * Creates a button (p803 D10): a native `<button>` (`type="button"`) with a label, and optionally
 * an icon, a shortcut's hint, a tooltip, a toggle state, a loading state or a hold to confirm.
 * - Parts: `.aekButton` (`data-variant`, `data-size`, `data-icon-only`; the states `disabled`,
 *   `aria-pressed`, `aria-busy`, `data-holding="filling" | "confirmed"`), `.aekButton__icon`,
 *   `.aekButton__label`, `.aekButton__kbd`, `.aekButton__hold` (the hold's fill). The loading
 *   spinner is the button's `::after`.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-button-radius`,
 *   `--aek-button-hold-color` (the hold's fill, default the text colour).
 * - Keys: Enter and Space click it (the browser's). A hold to confirm acts after Space or Enter is
 *   held for `holdToConfirmMs` (the fill steps instead of sliding under reduced motion: it's
 *   information); releasing earlier cancels. A click without a press (assistive tech's) doesn't
 *   act on it.
 * - ARIA: a toggle has `aria-pressed`; `iconOnly` names it by `aria-label`; `kbd` sets
 *   `aria-keyshortcuts` (its hint is hidden from assistive tech); loading sets `aria-busy`; a hold
 *   to confirm is described "Hold to confirm".
 * @example
 * ```ts
 * const save = createButton({ label: 'Save', variant: 'primary', kbd: 'Ctrl+S', onClick: () => {
 *   save.setLoading(true);
 *   saveSceneAsync().finally(() => save.setLoading(false));
 * } });
 * toolbarPanel.add(save.cmp);
 * toolbarPanel.add(createButton({ label: 'Settings', icon: getSvgIcon('gear'), iconOnly: true }).cmp);
 * ```
 */
export const createButton = (props: ButtonProps): Button => {
  const { iconOnly = false, holdToConfirmMs: holdMs = 0 } = props;
  const isToggle = props.pressed !== undefined;
  let pressed = Boolean(props.pressed);
  let isLoading = false;
  let label = props.label;
  let tooltip: Tooltip | null = null;

  const act = (e: Event) => {
    if (isToggle) {
      pressed = !pressed;
      elem.setAttribute('aria-pressed', String(pressed));
      props.onPressedChange?.(pressed);
    }
    props.onClick?.(e);
  };

  const hold = holdMs
    ? createHoldToConfirm(
        () => elem,
        holdMs,
        () => !isLoading && !elem.hasAttribute('disabled'),
        act
      )
    : null;
  const clearHold = () => hold?.clear();

  const onClick = (e: Event) => {
    // A hold acts from its timer; the click after the release (or assistive tech's) does nothing
    if (isLoading || hold) return;
    act(e);
  };

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'button',
    class: classes('aekButton', props.class),
    attr: {
      ...props.attr,
      type: props.type ?? 'button',
      'data-variant': props.variant ?? 'secondary',
      'data-size': props.size ?? 'md',
      ...(iconOnly ? { 'data-icon-only': '', 'aria-label': label } : {}),
      ...(isToggle ? { 'aria-pressed': String(pressed) } : {}),
      ...(props.kbd ? { 'aria-keyshortcuts': getAriaKeyShortcuts(props.kbd) } : {}),
      ...(props.disabled ? { disabled: '' } : {}),
    },
    listeners: [{ type: 'click', fn: onClick }, ...(hold?.listeners ?? [])],
    onRemoveCmp: () => {
      clearHold();
      tooltip?.cmp.remove();
      tooltip = null;
    },
  });
  const elem = cmp.elem as HTMLButtonElement;

  const labelElem = createPart('aekButton__label');
  labelElem.textContent = label;
  appendParts(elem, props, labelElem, cmp.id);

  const tooltipText = props.tooltip ?? (iconOnly ? label : undefined);
  if (tooltipText !== undefined) tooltip = createTooltip({ anchor: elem, text: tooltipText });

  return {
    cmp,
    setLabel: (text) => {
      label = text;
      labelElem.textContent = text;
      if (!iconOnly) return;
      elem.setAttribute('aria-label', text);
      if (props.tooltip === undefined) tooltip?.setText(text);
    },
    setDisabled: (isDisabled) => {
      if (isDisabled) {
        elem.setAttribute('disabled', '');
        clearHold();
      } else {
        elem.removeAttribute('disabled');
      }
    },
    setLoading: (isOn) => {
      isLoading = isOn;
      if (isOn) {
        clearHold();
        elem.setAttribute('aria-busy', 'true');
      } else {
        elem.removeAttribute('aria-busy');
      }
    },
    isLoading: () => isLoading,
    setPressed: (isOn) => {
      if (!isToggle) return;
      pressed = isOn;
      elem.setAttribute('aria-pressed', String(isOn));
    },
    isPressed: () => pressed,
  };
};
