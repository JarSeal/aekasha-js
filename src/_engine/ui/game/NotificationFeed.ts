import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { BadgeTone } from '../components/Badge';
import type { SvgIconKey } from '../core/icons/SvgIcon';
import type { HudPlacement } from './HudPlacement';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { getSvgIcon } from '../core/icons/SvgIcon';
import { announce } from '../components/Announcer';
import './NotificationFeed.scss';
import '../styles/kit.scss';

/** What {@link createNotificationFeed} shows. */
export type NotificationFeedProps = {
  /** Its name for assistive tech (default 'Notifications'). */
  label?: string;
  /** How many lines show at once (default 5): a new one past it pushes the oldest out. */
  max?: number;
  /** How long a line shows, in ms (default 4000), not counting the time the feed is held. */
  durationMs?: number;
  /** A corner of the HUD's bounds it's fixed in (default `'top-right'`), or `'inline'`: in the
   * flow of what it's added to (a panel). */
  placement?: HudPlacement;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A line for {@link NotificationFeed}'s `add`. */
export type NotificationFeedItem = {
  /** What it says ('+25 gold', 'Quest updated'). */
  text: string;
  /** What's read instead of `text` when the shown text isn't words ('25 gold' for '+25 ⛁'). */
  spokenText?: string;
  /** A repeat of a shown line with this key merges into it ('×3') instead of adding another. */
  key?: string;
  /** A registered icon's name (`registerIcon`), drawn before the text in the tone's colour. */
  icon?: SvgIconKey;
  /** Its status tone (default `'neutral'`): the stripe and the icon's colour, never the only
   * signal (the text says it). */
  tone?: BadgeTone;
  /** How long this line shows, in ms (default the feed's `durationMs`). */
  durationMs?: number;
};

/** A notification feed {@link createNotificationFeed} made: its CMP and its controls. */
export type NotificationFeed = {
  /** Its element (`.aekNotificationFeed`): add it to the HUD root, or into a panel for
   * `'inline'`. `cmp.remove()` clears its timers. */
  cmp: CMPHandle;
  /** Shows a line on top and reads it, or merges it into the shown line with its `key` (the count
   * goes up, the line moves to the top and shows for its whole time again). */
  add: (item: NotificationFeedItem) => void;
  /** Removes every line now, without a fade. */
  clear: () => void;
};

/** A shown line */
type FeedLine = {
  elem: HTMLLIElement;
  textElem: HTMLElement;
  countElem: HTMLElement;
  spokenElem: HTMLElement;
  key: string | undefined;
  count: number;
  durationMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** When the running timer ends (`performance.now()`), to count a hold */
  endsAt: number;
  /** The showing time left while the timer is stopped */
  left: number;
  isLeaving: boolean;
};

const MAX = 5;
const DURATION_MS = 4000;
/** The fade out: `--aek-motion-base`, times the motion factor */
const LEAVE_MS = 200;

const createPart = (tag: string, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/**
 * Creates a notification feed (p808 D10): short lines a game shows in a corner, '+25 gold',
 * 'Quest updated', each with an optional icon and tone. The newest is on top, a repeat with the
 * same `key` merges into its line ('×3'), and each fades after its time, held while the feed is
 * hovered or holds the focus and while the page is hidden. Many at once, no dismiss, no actions:
 * for a message that needs one, the toaster.
 * - Parts: `.aekNotificationFeed` (a `ul`, `data-placement`), `.aekNotificationFeed__item` (an
 *   `li`, `data-tone`, `data-state="leaving"` while it fades out), its `__icon`, `__text`,
 *   `__count` ('×3', `hidden` at one; `data-run` 1 / 2 restarts its pop) and `__spoken` (the
 *   words assistive tech reads for it).
 * - Custom properties (read on any ancestor): `--aek-notification-feed-bg` (a line's background,
 *   default the raised surface at 88 %), `--aek-notification-feed-width` (a line's maximum
 *   width), `--aek-notification-feed-inset` (its distance from the corner, default
 *   `--aek-space-5`), `--aek-notification-feed-z` (default `--aek-z-window`).
 * - Assistive tech: a list named by `label`; each line's shown text and count are `aria-hidden`
 *   and `__spoken` says it ('25 gold, 3 times'). A new or merged line is read politely, once,
 *   through the kit's announcer; lines added together are read together.
 * - Motion: a line slides in over `--aek-motion-base`, a merge pops its count, a line fades out
 *   over `--aek-motion-base`. Under reduced motion a line appears and goes without either.
 * @example
 * ```ts
 * import { createNotificationFeed, getHUDRootCMP } from 'aekasha/ui';
 *
 * const feed = createNotificationFeed({ placement: 'top-right', max: 4 });
 * getHUDRootCMP().add(feed.cmp);
 * feed.add({ text: '+25 gold', key: 'gold', tone: 'warning' });
 * feed.add({ text: 'Quest updated', tone: 'info' });
 * ```
 */
export const createNotificationFeed = (props: NotificationFeedProps = {}): NotificationFeed => {
  const max = Math.max(1, Math.floor(props.max ?? MAX));
  const durationMs = Math.max(0, props.durationMs ?? DURATION_MS);
  // Newest first, the leaving ones included until their fade ends
  const lines: FeedLine[] = [];
  let isHovered = false;
  let isFocused = false;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'ul',
    class: classes('aekNotificationFeed', props.class),
    attr: {
      ...props.attr,
      'aria-label': props.label ?? 'Notifications',
      'data-placement': props.placement ?? 'top-right',
    },
    onRemoveCmp: () => {
      for (const line of lines) clearLineTimer(line);
      lines.length = 0;
      elem.removeEventListener('pointerenter', onPointerEnter);
      elem.removeEventListener('pointerleave', onPointerLeave);
      elem.removeEventListener('focusin', onFocusIn);
      elem.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', syncHold);
    },
  });
  const elem = cmp.elem;

  const isHeld = () => isHovered || isFocused || document.hidden === true;

  function clearLineTimer(line: FeedLine) {
    if (line.timer) clearTimeout(line.timer);
    line.timer = null;
  }

  /** Starts a showing line's timer for the time it has left, unless the feed is held */
  const runLineTimer = (line: FeedLine) => {
    if (line.isLeaving || line.timer || isHeld()) return;
    line.endsAt = performance.now() + line.left;
    line.timer = setTimeout(() => leave(line), line.left);
  };

  /** Holds or lets go of every showing line's time */
  function syncHold() {
    const held = isHeld();
    for (const line of lines) {
      if (line.isLeaving) continue;
      if (held && line.timer) {
        clearLineTimer(line);
        line.left = Math.max(0, line.endsAt - performance.now());
      } else if (!held) runLineTimer(line);
    }
  }

  const onPointerEnter = () => {
    isHovered = true;
    syncHold();
  };
  const onPointerLeave = () => {
    isHovered = false;
    syncHold();
  };
  const onFocusIn = () => {
    isFocused = true;
    syncHold();
  };
  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && elem.contains(to)) return;
    isFocused = false;
    syncHold();
  };
  elem.addEventListener('pointerenter', onPointerEnter);
  elem.addEventListener('pointerleave', onPointerLeave);
  elem.addEventListener('focusin', onFocusIn);
  elem.addEventListener('focusout', onFocusOut);
  document.addEventListener('visibilitychange', syncHold);

  const removeLine = (line: FeedLine) => {
    clearLineTimer(line);
    const index = lines.indexOf(line);
    if (index >= 0) lines.splice(index, 1);
    line.elem.remove();
  };

  /** Fades a line out, then removes it */
  function leave(line: FeedLine) {
    clearLineTimer(line);
    if (line.isLeaving) return;
    line.isLeaving = true;
    const ms = LEAVE_MS * getMotionFactor(elem);
    if (ms <= 0) {
      removeLine(line);
      return;
    }
    line.elem.setAttribute('data-state', 'leaving');
    line.timer = setTimeout(() => removeLine(line), ms);
  }

  const getSpoken = (line: FeedLine, item: NotificationFeedItem) => {
    const words = item.spokenText ?? item.text;
    return line.count > 1 ? `${words}, ${line.count} times` : words;
  };

  const createLine = (item: NotificationFeedItem): FeedLine => {
    const lineElem = createPart('li', 'aekNotificationFeed__item') as HTMLLIElement;
    lineElem.setAttribute('data-tone', item.tone ?? 'neutral');
    if (item.icon) {
      const icon = createPart('span', 'aekNotificationFeed__icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = getSvgIcon(item.icon);
      lineElem.append(icon);
    }
    const textElem = createPart('span', 'aekNotificationFeed__text');
    textElem.setAttribute('aria-hidden', 'true');
    textElem.textContent = item.text;
    const countElem = createPart('span', 'aekNotificationFeed__count');
    countElem.setAttribute('aria-hidden', 'true');
    countElem.hidden = true;
    const spokenElem = createPart('span', 'aekNotificationFeed__spoken aekVisuallyHidden');
    lineElem.append(textElem, countElem, spokenElem);
    const lineDuration = Math.max(0, item.durationMs ?? durationMs);
    return {
      elem: lineElem,
      textElem,
      countElem,
      spokenElem,
      key: item.key,
      count: 1,
      durationMs: lineDuration,
      timer: null,
      endsAt: 0,
      left: lineDuration,
      isLeaving: false,
    };
  };

  const add = (item: NotificationFeedItem) => {
    let line =
      item.key === undefined
        ? undefined
        : lines.find((shown) => !shown.isLeaving && shown.key === item.key);
    if (line) {
      // A repeat: counted, moved to the top, its time from the start again
      clearLineTimer(line);
      lines.splice(lines.indexOf(line), 1);
      line.count += 1;
      line.textElem.textContent = item.text;
      line.countElem.textContent = `×${line.count}`;
      line.countElem.hidden = false;
      line.countElem.setAttribute(
        'data-run',
        line.countElem.getAttribute('data-run') === '1' ? '2' : '1'
      );
      line.left = line.durationMs;
    } else {
      line = createLine(item);
    }
    lines.unshift(line);
    elem.prepend(line.elem);
    const spoken = getSpoken(line, item);
    line.spokenElem.textContent = spoken;
    runLineTimer(line);
    // Past the maximum, the oldest showing lines go (a copy: under reduced motion `leave` removes
    // a line from `lines` at once)
    for (const shown of lines.filter((kept) => !kept.isLeaving).slice(max)) leave(shown);
    // Lines added together are read together
    announce(elem, spoken, { append: true });
  };

  return {
    cmp,
    add,
    clear: () => {
      while (lines.length) removeLine(lines[0]);
    },
  };
};
