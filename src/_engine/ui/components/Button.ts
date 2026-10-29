import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { createTooltip, type Tooltip } from '../overlays/Tooltip';
import type { Kbd } from './Kbd';
import { addShortcutHint } from './ShortcutHint';
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
  /** A shortcut's hint drawn after the label (`createKbd({ keys: 'Ctrl+S' })`), whose keys are the
   * button's `aria-keyshortcuts`, also after its `setKeys`. The button removes it with itself.
   * Display only: binding the key is the app's. A string (`'Ctrl+S'`) is deprecated (removed in
   * engine 6.0.0): the button loads Kbd's code for it, so its hint appears a frame later. */
  kbd?: Kbd | string;
  /** Makes it a toggle button with this state (`aria-pressed`): a click flips it. */
  pressed?: boolean;
  /** A toggle's new state, after a click flipped it. */
  onPressedChange?: (pressed: boolean) => void;
  /** Makes it a hold to confirm button (a destructive action): it acts after the pointer, Space
   * or Enter is held this long (eg. 800), and releasing earlier cancels. */
  holdToConfirmMs?: number;
  /** With `holdToConfirmMs`: a click that no press on the button started (a screen reader's
   * browse mode clicks without one, so its user can't hold). The app confirms another way here
   * (opens its confirmation dialog); without it such a click does nothing. Not called while it's
   * loading. */
  onUnheldClick?: (e: Event) => void;
  /** Disables it (default false). */
  disabled?: boolean;
  /** Keeps it focusable while disabled (default false): `aria-disabled` instead of `disabled`, so
   * the keys still reach it and its tooltip (the reason `setDisabled` gives) can be read, while its
   * clicks and holds are ignored. A toolbar's buttons: the arrows still stop on a disabled one (the
   * APG's toolbar), and one disabled with the focus on it keeps it. */
  focusableWhenDisabled?: boolean;
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
  /** Disables or enables it. A `reason` (eg. 'Loading the scene…') is its tooltip while it's
   * disabled; the tooltip it had comes back when it's enabled. */
  setDisabled: (isDisabled: boolean, reason?: string) => void;
  /** Whether it's disabled */
  isDisabled: () => boolean;
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
  // A pointer press or a held key started what follows: the click after a pointer's release is
  // its, not one without a press
  let hasPress = false;

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
        hasPress = true;
        const elem = getElem();
        if (typeof elem.setPointerCapture === 'function') elem.setPointerCapture(pointer.pointerId);
        start(e);
      },
    },
    { type: 'pointerup', fn: clear },
    {
      type: 'pointercancel',
      fn: () => {
        // No click follows
        hasPress = false;
        clear();
      },
    },
    { type: 'lostpointercapture', fn: clear },
    {
      type: 'keydown',
      fn: (e: Event) => {
        const key = e as KeyboardEvent;
        if (!HOLD_KEYS.has(key.key)) return;
        // No click from the key: the timer acts
        e.preventDefault();
        hasPress = true;
        if (!key.repeat) start(e);
      },
    },
    {
      type: 'keyup',
      fn: (e: Event) => {
        if (!HOLD_KEYS.has((e as KeyboardEvent).key)) return;
        e.preventDefault();
        hasPress = false;
        clear();
      },
    },
    {
      type: 'blur',
      fn: () => {
        hasPress = false;
        clear();
      },
    },
  ];
  /** Whether a press started this click, which it ends */
  const takePress = () => {
    const had = hasPress;
    hasPress = false;
    return had;
  };
  return { listeners, clear, takePress };
};

/** Appends the button's parts, in order: the icon, the label (not with `iconOnly`), and a hold to
 * confirm's fill and description; returns the fill, which the shortcut's hint goes before */
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
  let fill: HTMLElement | null = null;
  if (props.holdToConfirmMs) {
    fill = createPart('aekButton__hold');
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
  return fill;
};

/**
 * Creates a button (p803 D10): a native `<button>` (`type="button"`) with a label, and optionally
 * an icon, a shortcut's hint, a tooltip, a toggle state, a loading state or a hold to confirm.
 * - Parts: `.aekButton` (`data-variant`, `data-size`, `data-icon-only`; the states `disabled` or
 *   `aria-disabled`, `aria-pressed`, `aria-busy`, `data-holding="filling" | "confirmed"`),
 *   `.aekButton__icon`,
 *   `.aekButton__label`, `.aekButton__kbd`, `.aekButton__hold` (the hold's fill). The loading
 *   spinner is the button's `::after`.
 * - Custom properties (read on any ancestor, the token as the fallback): `--aek-button-radius`,
 *   `--aek-button-hold-color` (the hold's fill, default the text colour).
 * - Keys: Enter and Space click it (the browser's). A hold to confirm acts after Space or Enter is
 *   held for `holdToConfirmMs` (the fill steps instead of sliding under reduced motion: it's
 *   information); releasing earlier cancels. A click without a press (assistive tech's) doesn't
 *   act on it: it calls `onUnheldClick`, where the app confirms another way.
 * - ARIA: a toggle has `aria-pressed`; `iconOnly` names it by `aria-label`; `kbd` sets
 *   `aria-keyshortcuts` from the hint's keys (the hint is hidden from assistive tech); loading
 *   sets `aria-busy`; a hold to confirm is described "Hold to confirm"; `focusableWhenDisabled`
 *   disables it with `aria-disabled`, its tooltip the reason why.
 * @example
 * ```ts
 * const save = createButton({
 *   label: 'Save',
 *   variant: 'primary',
 *   kbd: createKbd({ keys: 'Ctrl+S' }),
 *   onClick: () => {
 *     save.setLoading(true);
 *     saveSceneAsync().finally(() => save.setLoading(false));
 *   },
 * });
 * toolbarPanel.add(save.cmp);
 * toolbarPanel.add(createButton({ label: 'Settings', icon: getSvgIcon('gear'), iconOnly: true }).cmp);
 * ```
 */
export const createButton = (props: ButtonProps): Button => {
  const { iconOnly = false, holdToConfirmMs: holdMs = 0, focusableWhenDisabled = false } = props;
  const isToggle = props.pressed !== undefined;
  let pressed = Boolean(props.pressed);
  let isLoading = false;
  let isDisabled = Boolean(props.disabled);
  /** Its tooltip while it's disabled */
  let disabledReason: string | undefined;
  let label = props.label;
  let tooltip: Tooltip | null = null;
  /** Whether it acts on a press (a natively disabled button gets no click) */
  const canAct = () => !isLoading && !isDisabled;

  const act = (e: Event) => {
    if (isToggle) {
      pressed = !pressed;
      elem.setAttribute('aria-pressed', String(pressed));
      props.onPressedChange?.(pressed);
    }
    props.onClick?.(e);
  };

  const hold = holdMs ? createHoldToConfirm(() => elem, holdMs, canAct, act) : null;
  const clearHold = () => hold?.clear();

  const onClick = (e: Event) => {
    // A hold acts from its timer: the click after the release does nothing, and one with no press
    // (assistive tech's) is the app's to confirm
    if (hold) {
      if (!hold.takePress() && canAct()) props.onUnheldClick?.(e);
      return;
    }
    if (canAct()) act(e);
  };
  let stopHint: ((removeHint: boolean) => void) | null = null;

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
      ...(isDisabled
        ? focusableWhenDisabled
          ? { 'aria-disabled': 'true' }
          : { disabled: '' }
        : {}),
    },
    listeners: [{ type: 'click', fn: onClick }, ...(hold?.listeners ?? [])],
    onRemoveCmp: () => {
      clearHold();
      stopHint?.(true);
      stopHint = null;
      tooltip?.cmp.remove();
      tooltip = null;
    },
  });
  const elem = cmp.elem as HTMLButtonElement;

  const labelElem = createPart('aekButton__label');
  labelElem.textContent = label;
  const fill = appendParts(elem, props, labelElem, cmp.id);
  if (props.kbd) {
    stopHint = addShortcutHint({
      owner: elem,
      kbd: props.kbd,
      className: 'aekButton__kbd',
      before: fill,
    });
  }

  /** Shows the tooltip its state asks for: the disabled reason, else `tooltip`, else the label of
   * an icon-only button; removed when there's none */
  const syncTooltip = () => {
    const text =
      (isDisabled ? disabledReason : undefined) ?? props.tooltip ?? (iconOnly ? label : undefined);
    if (text === undefined) {
      tooltip?.cmp.remove();
      tooltip = null;
    } else if (tooltip) {
      tooltip.setText(text);
    } else {
      tooltip = createTooltip({ anchor: elem, text });
    }
  };
  syncTooltip();

  return {
    cmp,
    setLabel: (text) => {
      label = text;
      labelElem.textContent = text;
      if (!iconOnly) return;
      elem.setAttribute('aria-label', text);
      syncTooltip();
    },
    setDisabled: (isOn, reason) => {
      isDisabled = isOn;
      disabledReason = isOn ? reason : undefined;
      const attr = focusableWhenDisabled ? 'aria-disabled' : 'disabled';
      if (isOn) {
        elem.setAttribute(attr, focusableWhenDisabled ? 'true' : '');
        clearHold();
      } else {
        elem.removeAttribute(attr);
      }
      syncTooltip();
    },
    isDisabled: () => isDisabled,
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
