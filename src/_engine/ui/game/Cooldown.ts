import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import './Cooldown.scss';
import '../styles/kit.scss';

/** What {@link createCooldown} covers. */
export type CooldownProps = {
  /** The control it covers (an ability's button, a hotbar slot): `aria-disabled` and a "Ready in
   * 3 seconds" description while it runs. Add `cmp` inside it; it needs a position (`relative`). */
  target?: CMPHandle | HTMLElement;
  /** Called when a run ends by itself (not on `cancel`). */
  onReady?: () => void;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A cooldown {@link createCooldown} made: its CMP and its controls. */
export type Cooldown = {
  /** Its element (`.aekCooldown`): add it inside the control it covers. */
  cmp: CMPHandle;
  /** Starts a run of `durationMs` (again from the start when one runs), `elapsedMs` of it already
   * gone (a cooldown saved and restored). */
  start: (durationMs: number, elapsedMs?: number) => void;
  /** Ends the run now, without `onReady`. */
  cancel: () => void;
  /** Whether a run is going on: the control's own action checks it (the cooldown only marks the
   * control `aria-disabled`, which blocks nothing). */
  isRunning: () => boolean;
  /** What's left of the run in ms, 0 when none runs */
  getRemainingMs: () => number;
};

const SECOND = 1000;

/**
 * Creates a cooldown (p808 D6): an overlay for an ability's button or a hotbar slot, a sweep that
 * uncovers it clockwise and the seconds left, then a flash when it's ready. The sweep is a CSS
 * animation from the start time, so a frame costs no script; the seconds are written once a
 * second.
 * - Parts: `.aekCooldown` (`data-state="running" | "ready"`), `.aekCooldown__sweep` (the shade),
 *   `.aekCooldown__time` (the seconds, tabular).
 * - Custom properties (read on any ancestor): `--aek-cooldown-shade` (the covered part, default
 *   the text colour at 30 %: darker on a light theme, lighter on a dark one, so it shows on
 *   either; a dark scrim vanished on the dark theme's surfaces), `--aek-cooldown-color` (the
 *   seconds, default `--aek-text`).
 * - Assistive tech: the sweep and the seconds are `aria-hidden`; the `target` gets
 *   `aria-disabled="true"` and an `aria-describedby` text, "Ready in 3 seconds", written once a
 *   second, while it runs, both put back after.
 * - Motion: the sweep turns smoothly; under reduced motion it steps once a second, since the time
 *   left is information (p808 D4), and the ready flash doesn't play.
 * @example
 * ```ts
 * import { createButton, createCooldown } from 'aekasha/ui';
 *
 * const dash = createButton({ label: 'Dash', onClick: () => useDash() });
 * dash.cmp.updateStyle({ position: 'relative' });
 * const cooldown = createCooldown({ target: dash.cmp });
 * dash.cmp.add(cooldown.cmp);
 * const useDash = () => {
 *   if (cooldown.isRunning()) return;
 *   cooldown.start(4000);
 * };
 * ```
 */
export const createCooldown = (props: CooldownProps): Cooldown => {
  const target = props.target ? ('elem' in props.target ? props.target.elem : props.target) : null;
  let endTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let run = 0;
  let shownSeconds = -1;
  let savedDisabled: string | null = null;
  let savedDescribedBy: string | null = null;
  let isTargetMarked = false;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekCooldown', props.class),
    attr: { ...props.attr, 'aria-hidden': 'true' },
    onRemoveCmp: () => stop(),
  });
  const elem = cmp.elem;
  const sweep = document.createElement('span');
  sweep.className = 'aekCooldown__sweep';
  const time = document.createElement('span');
  time.className = 'aekCooldown__time';
  // The target's description: outside the overlay's aria-hidden (an id reference reads a hidden
  // element's text) and hidden, so it isn't part of the target's name
  const description = document.createElement('span');
  description.id = `${cmp.id}__description`;
  description.hidden = true;
  elem.append(sweep, time);

  const getRemainingMs = () => (endTime ? Math.max(0, endTime - performance.now()) : 0);

  const markTarget = () => {
    if (!target || isTargetMarked) return;
    isTargetMarked = true;
    savedDisabled = target.getAttribute('aria-disabled');
    savedDescribedBy = target.getAttribute('aria-describedby');
    target.setAttribute('aria-disabled', 'true');
    target.setAttribute(
      'aria-describedby',
      savedDescribedBy ? `${savedDescribedBy} ${description.id}` : description.id
    );
    target.append(description);
  };

  const unmarkTarget = () => {
    if (!target || !isTargetMarked) return;
    isTargetMarked = false;
    description.remove();
    if (savedDisabled === null) target.removeAttribute('aria-disabled');
    else target.setAttribute('aria-disabled', savedDisabled);
    if (savedDescribedBy === null) target.removeAttribute('aria-describedby');
    else target.setAttribute('aria-describedby', savedDescribedBy);
  };

  /** Writes the seconds left, then waits for the next whole second or the end */
  const tick = () => {
    timer = null;
    const remaining = getRemainingMs();
    if (remaining <= 0) {
      stop();
      elem.setAttribute('data-state', 'ready');
      props.onReady?.();
      return;
    }
    const seconds = Math.ceil(remaining / SECOND);
    if (seconds !== shownSeconds) {
      shownSeconds = seconds;
      time.textContent = String(seconds);
      description.textContent = `Ready in ${seconds} second${seconds === 1 ? '' : 's'}`;
    }
    timer = setTimeout(tick, remaining - (seconds - 1) * SECOND);
  };

  /** Ends a run: the timer, the target's marks, the sweep */
  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    endTime = 0;
    shownSeconds = -1;
    time.textContent = '';
    elem.removeAttribute('data-run');
    elem.removeAttribute('data-state');
    unmarkTarget();
  }

  return {
    cmp,
    start: (durationMs, elapsedMs = 0) => {
      if (timer) clearTimeout(timer);
      const duration = Math.max(0, durationMs);
      const elapsed = Math.min(duration, Math.max(0, elapsedMs));
      endTime = performance.now() + duration - elapsed;
      shownSeconds = -1;
      // Steps of a second under reduced motion: the time left stays visible
      const isStill = getMotionFactor(elem) === 0;
      sweep.style.animationDuration = `${duration}ms`;
      sweep.style.animationDelay = `${-elapsed}ms`;
      sweep.style.animationTimingFunction = isStill
        ? `steps(${Math.max(1, Math.ceil(duration / SECOND))}, end)`
        : 'linear';
      // The other name restarts the sweep
      run = run === 1 ? 2 : 1;
      elem.setAttribute('data-run', String(run));
      elem.setAttribute('data-state', 'running');
      markTarget();
      tick();
    },
    cancel: () => stop(),
    isRunning: () => endTime !== 0,
    getRemainingMs,
  };
};
