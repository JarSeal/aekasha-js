import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getFirstFocusable } from '../overlays/FocusTrap';
import type { BadgeTone } from './Badge';
import './Badge.scss';
import './Tag.scss';
import '../styles/kit.scss';

/** What {@link createTag} makes a tag from. */
export type TagProps = {
  /** Its text. */
  label: string;
  /** Its colour (default 'neutral'): a status's on its `-soft` background. */
  tone?: BadgeTone;
  /** Raw HTML of an icon before the label (`getSvgIcon('pin')`), at `1em`. */
  icon?: string;
  /** A remove button ("Remove {label}"); Backspace or Delete on the tag removes it too. The tag
   * removes itself, calls `onRemove` and moves the focus to the next tag (else the previous). */
  removable?: boolean;
  /** Runs when the player removed it (the tag is gone already: drop it from the app's list). */
  onRemove?: () => void;
  /** Makes it a toggle button (`aria-pressed`): a filter's chip. Default false. */
  selectable?: boolean;
  /** A selectable tag's state (default false). */
  selected?: boolean;
  /** A selectable tag's new state, after a press flipped it. */
  onSelectedChange?: (selected: boolean) => void;
  /** Disables its buttons (default false). */
  disabled?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A tag {@link createTag} made: its CMP and its setters, each writing it in place. */
export type Tag = {
  /** Its element (`.aekTag`): add it where it goes. `cmp.remove()` removes it without
   * `onRemove`. */
  cmp: CMPHandle;
  /** Changes its text (and its remove button's name). */
  setLabel: (label: string) => void;
  /** Sets a selectable tag's state without calling `onSelectedChange`. */
  setSelected: (selected: boolean) => void;
  /** A selectable tag's state */
  isSelected: () => boolean;
};

const REMOVE_KEYS = new Set(['Backspace', 'Delete']);

/** The focusable element of the tag after `elem` in its parent (else before it) */
const findNeighbourFocus = (elem: HTMLElement) => {
  for (const sibling of [elem.nextElementSibling, elem.previousElementSibling]) {
    if (sibling?.classList.contains('aekTag')) {
      const target = getFirstFocusable(sibling as HTMLElement);
      if (target) return target;
    }
  }
  return null;
};

/**
 * Creates a tag (p803 D10): a short label for a thing's kind or a filter, optionally removable (a
 * picked item in a list) or selectable (a filter's chip).
 * - Parts: `.aekTag` (`data-tone`, `data-selectable`, `data-selected`, `data-removable`), `.aekTag__icon`,
 *   `.aekTag__label` (a `<button>`, `aria-pressed`, when selectable), `.aekTag__remove` (a
 *   `<button>` named "Remove {label}", its cross drawn in CSS).
 * - Keys: Enter and Space press a selectable tag's button (the browser's); Backspace or Delete on
 *   either button of a removable tag removes it, and the focus goes to the next tag (else the
 *   previous).
 * - Custom properties: `--aek-tag-radius`, and the tone's `--aek-tone` / `--aek-tone-soft`.
 * @example
 * ```ts
 * const filters = panel.add({ class: 'filters' });
 * for (const kind of ['Rocks', 'Trees', 'Water']) {
 *   filters.add(createTag({ label: kind, selectable: true, onSelectedChange: (on) => setFilter(kind, on) }).cmp);
 * }
 * filters.add(createTag({ label: 'level1.scene', removable: true, onRemove: () => unloadLevel() }).cmp);
 * ```
 */
export const createTag = (props: TagProps): Tag => {
  const { selectable = false, removable = false } = props;
  let selected = Boolean(props.selected);
  let label = props.label;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekTag', props.class),
    attr: {
      ...props.attr,
      'data-tone': props.tone ?? 'neutral',
      ...(selectable ? { 'data-selectable': '' } : {}),
      ...(selectable && selected ? { 'data-selected': '' } : {}),
      ...(removable ? { 'data-removable': '' } : {}),
    },
    listeners: removable
      ? [
          {
            type: 'keydown',
            fn: (e) => {
              if (!REMOVE_KEYS.has((e as KeyboardEvent).key) || props.disabled) return;
              e.preventDefault();
              e.stopPropagation();
              remove();
            },
          },
        ]
      : [],
  });
  const elem = cmp.elem;

  if (props.icon) {
    const icon = document.createElement('span');
    icon.className = 'aekTag__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = props.icon;
    elem.append(icon);
  }
  const labelElem = document.createElement(selectable ? 'button' : 'span');
  labelElem.className = 'aekTag__label';
  labelElem.textContent = label;
  elem.append(labelElem);
  if (selectable) {
    labelElem.setAttribute('type', 'button');
    labelElem.setAttribute('aria-pressed', String(selected));
    if (props.disabled) labelElem.setAttribute('disabled', '');
    labelElem.addEventListener('click', () => {
      setSelected(!selected);
      props.onSelectedChange?.(selected);
    });
  }

  let removeButton: HTMLButtonElement | null = null;
  if (removable) {
    removeButton = document.createElement('button');
    removeButton.className = 'aekTag__remove';
    removeButton.setAttribute('type', 'button');
    removeButton.setAttribute('aria-label', `Remove ${label}`);
    if (props.disabled) removeButton.setAttribute('disabled', '');
    removeButton.addEventListener('click', () => remove());
    elem.append(removeButton);
  }

  /** The player's removal: the focus to a neighbour first (it held the focus or not), then gone */
  function remove() {
    const hadFocus = elem.contains(document.activeElement);
    const next = hadFocus ? findNeighbourFocus(elem) : null;
    cmp.remove();
    next?.focus({ preventScroll: true });
    props.onRemove?.();
  }

  function setSelected(isOn: boolean) {
    if (!selectable) return;
    selected = isOn;
    labelElem.setAttribute('aria-pressed', String(isOn));
    if (isOn) elem.setAttribute('data-selected', '');
    else elem.removeAttribute('data-selected');
  }

  return {
    cmp,
    setLabel: (text) => {
      label = text;
      labelElem.textContent = text;
      removeButton?.setAttribute('aria-label', `Remove ${text}`);
    },
    setSelected,
    isSelected: () => selected,
  };
};
