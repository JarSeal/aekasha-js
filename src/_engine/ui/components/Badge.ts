import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import './Badge.scss';
import '../styles/kit.scss';

/** A badge's or a tag's colour: a status, the accent, or none. */
export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

/** A badge as a piece's prop takes it (a tab's, a list row's): a count or a word, or the badge's
 * label with its tone and spoken text. */
export type BadgeValue =
  | string
  | number
  | {
      /** What it shows */
      label: string | number;
      /** Its colour (default 'neutral'): never the only sign. */
      tone?: BadgeTone;
      /** What assistive tech hears in place of `label` (`'3 errors'`). */
      spokenLabel?: string;
    };

/** What {@link createBadge} draws. */
export type BadgeProps = {
  /** What it shows: a count (`3`) or a status word (`'Beta'`). */
  label: string | number;
  /** Its colour (default 'neutral'): a status's on its `-soft` background. Never the only sign:
   * the word says it, or `spokenLabel` does. */
  tone?: BadgeTone;
  /** What assistive tech hears in place of `label`, where the label alone says too little (a
   * count: `'3 unread messages'`). */
  spokenLabel?: string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A badge {@link createBadge} made: its CMP and its setters, each writing it in place. */
export type Badge = {
  /** Its element (`.aekBadge`): add it where it goes. */
  cmp: CMPHandle;
  /** Changes what it shows and, when given, what assistive tech hears (a count going up). */
  setLabel: (label: string | number, spokenLabel?: string) => void;
  /** Changes its colour. */
  setTone: (tone: BadgeTone) => void;
};

/**
 * Creates a badge (p803 D10): a short count or status word next to what it's about ("Inbox 3",
 * "Beta"), in a status colour on its soft background.
 * - Parts: `.aekBadge` (`data-tone`), `.aekBadge__label` (`aria-hidden` with a `spokenLabel`, which
 *   a visually hidden copy says instead).
 * - Not interactive and not live: a count that changes while the player watches is announced by a
 *   live region of the app's, if it should be.
 * @example
 * ```ts
 * const inbox = panel.add({ tag: 'span', text: 'Inbox ' });
 * const unread = createBadge({ label: 3, tone: 'accent', spokenLabel: '3 unread' });
 * inbox.add(unread.cmp);
 * unread.setLabel(4, '4 unread');
 * ```
 */
export const createBadge = (props: BadgeProps): Badge => {
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekBadge', props.class),
    attr: { ...props.attr, 'data-tone': props.tone ?? 'neutral' },
  });
  const labelElem = document.createElement('span');
  labelElem.className = 'aekBadge__label';
  cmp.elem.append(labelElem);
  // Made on the first spoken label and kept
  let spokenElem: HTMLElement | null = null;

  const setLabel = (label: string | number, spokenLabel?: string) => {
    labelElem.textContent = String(label);
    if (spokenLabel === undefined) {
      labelElem.removeAttribute('aria-hidden');
      spokenElem?.remove();
      return;
    }
    labelElem.setAttribute('aria-hidden', 'true');
    if (!spokenElem) {
      spokenElem = document.createElement('span');
      spokenElem.className = 'aekVisuallyHidden';
    }
    spokenElem.textContent = spokenLabel;
    if (spokenElem.parentNode !== cmp.elem) cmp.elem.append(spokenElem);
  };
  setLabel(props.label, props.spokenLabel);

  return {
    cmp,
    setLabel,
    setTone: (tone) => cmp.elem.setAttribute('data-tone', tone),
  };
};

/**
 * Writes a piece's badge from its prop's value in place (a tab's, a list row's): null removes it,
 * a value updates the badge there is or makes one with `className`, which the caller adds where it
 * goes (it's new when the returned badge isn't the one passed).
 * @internal
 * @returns the badge now, or null
 */
export const updateBadge = (
  badge: Badge | null,
  value: BadgeValue | null | undefined,
  className: string
): Badge | null => {
  if (value === null || value === undefined) {
    badge?.cmp.remove();
    return null;
  }
  const isObject = typeof value === 'object';
  const label = isObject ? value.label : value;
  const tone = (isObject ? value.tone : undefined) ?? 'neutral';
  const spokenLabel = isObject ? value.spokenLabel : undefined;
  if (!badge) return createBadge({ label, tone, spokenLabel, class: className });
  badge.setLabel(label, spokenLabel);
  badge.setTone(tone);
  return badge;
};
