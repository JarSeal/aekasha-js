import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { KEEP_LIVE_ATTR } from '../overlays/OverlayStack';
import './Subtitles.scss';
import '../styles/kit.scss';

/** What {@link createSubtitles} draws. */
export type SubtitlesProps = {
  /** How many lines show at once (default 2): a new one past it removes the oldest. */
  maxLines?: number;
  /** Where it places itself (default `'bottom'`): centred at the bottom or the top of the HUD's
   * bounds (a dialogue box at the bottom), fixed there, or `'inline'`, in the flow of what it's
   * added to (a panel). */
  placement?: 'bottom' | 'top' | 'inline';
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A line for {@link Subtitles}' `show`. */
export type SubtitleLine = {
  /** What's said. */
  text: string;
  /** Who says it, bold before the text ('Mara'). */
  speaker?: string;
  /** The speaker's colour (any CSS colour), on its name only: the name says who it is, the
   * colour helps tell them apart. Default `--aek-subtitles-speaker-color`. */
  speakerColor?: string;
  /** How long it shows, in ms. Default from its length: 1000 + 65 per character (about 15
   * characters a second), at least 2000. */
  durationMs?: number;
};

/** Subtitles {@link createSubtitles} made: its CMP and its controls. */
export type Subtitles = {
  /** Its element (`.aekSubtitles`, a live region): add it to the HUD root (a direct child, so a
   * modal's `inert` leaves it live), or into a panel for `'inline'`. `cmp.remove()` clears its
   * timers. */
  cmp: CMPHandle;
  /** Shows a line under the others, read by a screen reader as it's added. */
  show: (line: SubtitleLine) => void;
  /** Removes every line now. */
  clear: () => void;
};

type Shown = { elem: HTMLElement; timer: ReturnType<typeof setTimeout> | null };

const MAX_LINES = 2;
const MIN_DURATION_MS = 2000;
const BASE_DURATION_MS = 1000;
const PER_CHAR_MS = 65;

/** A line's time from its length: about 15 characters a second, and a second to start reading */
const getDurationMs = (line: SubtitleLine) =>
  Math.max(
    MIN_DURATION_MS,
    BASE_DURATION_MS + PER_CHAR_MS * (line.text.length + (line.speaker?.length ?? 0))
  );

/**
 * Creates subtitles (p808 D10): what's said in the game, a line at a time, stacked at the bottom
 * of the screen with the speaker's name in bold and in its own colour. Each line shows for its
 * time (from its length by default) and the oldest goes when a new one passes `maxLines`. Its
 * size and background are custom properties, so an app's subtitle size setting is one write.
 * - Parts: `.aekSubtitles` (`data-placement`), `.aekSubtitles__line` (a `p`, the newest last) with
 *   `.aekSubtitles__speaker`, `.aekSubtitles__separator` (': ') and `.aekSubtitles__text`.
 * - Custom properties (read on any ancestor): `--aek-subtitles-font-size` (default
 *   `--aek-font-size-xl`), `--aek-subtitles-bg` (a line's background, default the page's at
 *   80 %), `--aek-subtitles-color` (default `--aek-text`), `--aek-subtitles-speaker-color`
 *   (default `--aek-accent`; a line's `speakerColor` sets it on its name), `--aek-subtitles-width`
 *   (a line's maximum width), `--aek-subtitles-inset` (its distance from the bottom or the top),
 *   `--aek-subtitles-z` (default `--aek-z-window`).
 * - ARIA: the element is `aria-live="polite"` (additions only), so each line is read once as it's
 *   added, its speaker first ('Mara: Over here!'); kept live under a modal's `inert`.
 * - Motion: a line fades in over `--aek-motion-fast` (none under reduced motion) and goes at once.
 * @example
 * ```ts
 * import { createSubtitles, getHUDRootCMP } from 'aekasha/ui';
 *
 * const subtitles = createSubtitles({ maxLines: 2 });
 * getHUDRootCMP().add(subtitles.cmp);
 * subtitles.show({ speaker: 'Mara', speakerColor: '#e8a33d', text: 'Over here! The gate is open.' });
 * // A player's subtitle size setting
 * subtitles.cmp.updateStyle({ '--aek-subtitles-font-size': '28px' });
 * ```
 */
export const createSubtitles = (props: SubtitlesProps = {}): Subtitles => {
  const maxLines = Math.max(1, Math.floor(props.maxLines ?? MAX_LINES));
  // The oldest first, as they're shown
  const shown: Shown[] = [];

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekSubtitles', props.class),
    attr: {
      ...props.attr,
      'aria-live': 'polite',
      'aria-relevant': 'additions',
      'data-placement': props.placement ?? 'bottom',
      // A modal's inert leaves it live: the game may still speak under an inventory dialog
      [KEEP_LIVE_ATTR]: '',
    },
    onRemoveCmp: () => clear(),
  });
  const elem = cmp.elem;

  const removeShown = (line: Shown) => {
    if (line.timer) clearTimeout(line.timer);
    shown.splice(shown.indexOf(line), 1);
    line.elem.remove();
  };

  function clear() {
    while (shown.length) removeShown(shown[0]);
  }

  const show = (line: SubtitleLine) => {
    const lineElem = document.createElement('p');
    lineElem.className = 'aekSubtitles__line';
    if (line.speaker) {
      const speaker = document.createElement('span');
      speaker.className = 'aekSubtitles__speaker';
      speaker.textContent = line.speaker;
      if (line.speakerColor) {
        speaker.style.setProperty('--aek-subtitles-speaker-color', line.speakerColor);
      }
      const separator = document.createElement('span');
      separator.className = 'aekSubtitles__separator';
      separator.textContent = ': ';
      lineElem.append(speaker, separator);
    }
    const text = document.createElement('span');
    text.className = 'aekSubtitles__text';
    text.textContent = line.text;
    lineElem.append(text);
    // The line's whole text in one addition, so it's read once
    elem.append(lineElem);
    const entry: Shown = { elem: lineElem, timer: null };
    entry.timer = setTimeout(() => removeShown(entry), line.durationMs ?? getDurationMs(line));
    shown.push(entry);
    while (shown.length > maxLines) removeShown(shown[0]);
  };

  return { cmp, show, clear };
};
