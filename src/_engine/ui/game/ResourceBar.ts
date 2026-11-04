import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import './ResourceBar.scss';
import '../styles/kit.scss';

/** A status role a threshold puts the bar in. */
export type ResourceBarState = 'danger' | 'warning' | 'success' | 'info';

/** A range of the bar with its own status: below a share of the maximum. */
export type ResourceBarThreshold = {
  /** The share of the maximum (0-1) the value is under for this status (`0.25`: under 25 %). */
  below: number;
  /** The status role it draws in. */
  state: ResourceBarState;
  /** A word for it, shown next to the label and read with the value ('Low'): colour is never the
   * only signal (p800 D6). */
  text: string;
};

/** What {@link createResourceBar} draws. */
export type ResourceBarProps = {
  /** Its name, visible and read ('Health', 'Stamina'). */
  label: string;
  /** Shows the label to assistive tech only (a bar whose place says what it is). Default false. */
  hideLabel?: boolean;
  /** Its value from 0 to `max` (default `max`: full). */
  value?: number;
  /** The value at full (default 100). */
  max?: number;
  /** Draws dividers across the bar in this many parts (a health bar of 10 hearts). Default 1. */
  segments?: number;
  /** Status ranges (`[{ below: 0.25, state: 'danger', text: 'Low' }]`): the lowest that holds
   * applies. */
  thresholds?: readonly ResourceBarThreshold[];
  /** Shows the value after the label: `'fraction'` ('72 / 100'), `'percent'` ('72 %'). Default
   * none. */
  showValue?: 'fraction' | 'percent';
  /** A heal of at least this share of the maximum flashes the bar (default 0.05: a slow regen
   * doesn't). */
  flashAbove?: number;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A resource bar {@link createResourceBar} made: its CMP and its setters, each writing it in
 * place. */
export type ResourceBar = {
  /** Its element (`.aekResourceBar`): add it where it goes. */
  cmp: CMPHandle;
  /** Sets its value (clamped to 0 and the maximum). A drop leaves the damage trail behind; a rise
   * fills and, from `flashAbove`, flashes. Writes nothing when the shown value is unchanged, so a
   * value set every frame is fine. */
  setValue: (value: number) => void;
  /** Its value */
  getValue: () => number;
  /** Sets its maximum (more health from a level up): the value is clamped to it. */
  setMax: (max: number) => void;
  /** Changes its label. */
  setLabel: (label: string) => void;
};

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

/**
 * Creates a resource bar (p808 D6): a value in a known range a game shows all the time, health,
 * stamina, mana, a shield. A drop leaves a damage trail (the lost part holds, then shrinks), a
 * heal fills and flashes, thresholds put it in a status with a word, and dividers draw its
 * segments. Not a task's progress: that's the progress bar.
 * - Parts: `.aekResourceBar` (`data-state` in a threshold, `data-change="damage" | "heal"`, the
 *   last change), `.aekResourceBar__header` with `.aekResourceBar__label`, `.aekResourceBar__status`
 *   (the threshold's text) and `.aekResourceBar__value` (`showValue`), `.aekResourceBar__track`
 *   (the `role="meter"`), `.aekResourceBar__trail`, `.aekResourceBar__fill`,
 *   `.aekResourceBar__segments` (the dividers) and `.aekResourceBar__flash`.
 * - Custom properties (read on any ancestor): `--aek-resource-bar-color` (the fill, default the
 *   accent; a threshold's state colours it with its role), `--aek-resource-bar-trail-color`
 *   (default `--aek-text-muted`), `--aek-resource-bar-height` (default `--aek-space-4`),
 *   `--aek-resource-bar-radius` (default `--aek-radius-sm`), `--aek-resource-bar-trail-delay`
 *   (how long the lost part holds, default 400 ms).
 * - ARIA: the track is a `role="meter"` named by the label, with `aria-valuemin`, `aria-valuemax`,
 *   `aria-valuenow` and `aria-valuetext` ('72 of 100', with the threshold's text: '18 of 100,
 *   Low'), written when the rounded value changes. The shown value is `aria-hidden`.
 * - Motion: the trail holds `--aek-resource-bar-trail-delay`, then shrinks over
 *   `--aek-motion-slow`; a heal fills over `--aek-motion-fast` and flashes once. Under reduced
 *   motion each jumps (the delay and durations are 0) and nothing flashes.
 * @example
 * ```ts
 * import { createResourceBar, getHUDRootCMP } from 'aekasha/ui';
 *
 * const health = createResourceBar({
 *   label: 'Health',
 *   max: 120,
 *   segments: 6,
 *   showValue: 'fraction',
 *   thresholds: [{ below: 0.25, state: 'danger', text: 'Low' }],
 * });
 * getHUDRootCMP().add(health.cmp);
 * health.setValue(42); // took a hit: the lost part trails behind
 * ```
 */
export const createResourceBar = (props: ResourceBarProps): ResourceBar => {
  let max = Math.max(Number.MIN_VALUE, props.max ?? 100);
  const segments = Math.max(1, Math.floor(props.segments ?? 1));
  const flashAbove = props.flashAbove ?? 0.05;
  // The lowest threshold first: the first that holds applies
  const thresholds = [...(props.thresholds ?? [])].sort((a, b) => a.below - b.below);

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekResourceBar', props.class),
    attr: { ...props.attr, ...(props.hideLabel ? { 'data-label-hidden': '' } : {}) },
  });
  const elem = cmp.elem;

  const header = createPart('aekResourceBar__header');
  const labelElem = createPart(
    props.hideLabel ? 'aekResourceBar__label aekVisuallyHidden' : 'aekResourceBar__label'
  );
  labelElem.id = `${cmp.id}__label`;
  labelElem.textContent = props.label;
  const statusElem = createPart('aekResourceBar__status');
  statusElem.setAttribute('aria-hidden', 'true');
  statusElem.hidden = true;
  header.append(labelElem, statusElem);
  const valueElem = props.showValue ? createPart('aekResourceBar__value') : null;
  if (valueElem) {
    valueElem.setAttribute('aria-hidden', 'true');
    header.append(valueElem);
  }

  const track = createPart('aekResourceBar__track');
  track.setAttribute('role', 'meter');
  track.setAttribute('aria-labelledby', labelElem.id);
  track.setAttribute('aria-valuemin', '0');
  const trail = createPart('aekResourceBar__trail');
  const fill = createPart('aekResourceBar__fill');
  const flash = createPart('aekResourceBar__flash');
  track.append(trail, fill, flash);
  if (segments > 1) {
    track.append(createPart('aekResourceBar__segments'));
    elem.style.setProperty('--aek-resource-bar-segments', String(segments));
  }
  elem.append(header, track);

  let value = NaN;
  let shownRatio = NaN;
  let shownRounded = NaN;
  let shownPercent = NaN;
  let shownState: ResourceBarThreshold | null = null;
  let change: 'damage' | 'heal' | '' = '';
  let flashRun = 0;

  const writeTexts = () => {
    const rounded = Math.round(value);
    const roundedMax = Math.round(max);
    const status = shownState ? `, ${shownState.text}` : '';
    track.setAttribute('aria-valuemax', String(roundedMax));
    track.setAttribute('aria-valuenow', String(rounded));
    track.setAttribute('aria-valuetext', `${rounded} of ${roundedMax}${status}`);
    if (valueElem) {
      valueElem.textContent =
        props.showValue === 'percent'
          ? `${Math.round(shownRatio * 100)} %`
          : `${rounded} / ${roundedMax}`;
    }
    shownRounded = rounded;
    shownPercent = Math.round(shownRatio * 100);
  };

  /** The threshold the ratio is in, the lowest first */
  const findThreshold = (ratio: number) => {
    for (const threshold of thresholds) {
      if (ratio < threshold.below) return threshold;
    }
    return null;
  };

  const write = (next: number, isInitial: boolean) => {
    const clamped = Math.min(max, Math.max(0, Number.isFinite(next) ? next : 0));
    const ratio = clamped / max;
    if (ratio === shownRatio && clamped === value) return;
    const previous = value;
    value = clamped;
    if (!isInitial && ratio !== shownRatio) {
      const nextChange = ratio < shownRatio ? 'damage' : 'heal';
      if (nextChange !== change) {
        change = nextChange;
        elem.setAttribute('data-change', change);
      }
      // A heal from flashAbove flashes: the animation restarts by alternating its two names
      if (change === 'heal' && clamped - previous >= flashAbove * max) {
        flashRun = flashRun === 1 ? 2 : 1;
        flash.setAttribute('data-run', String(flashRun));
      }
    }
    if (ratio !== shownRatio) {
      shownRatio = ratio;
      fill.style.transform = `scaleX(${ratio})`;
      // The trail eases to the value after its delay (CSS); under the fill when it's a heal
      trail.style.transform = `scaleX(${ratio})`;
    }
    const threshold = findThreshold(ratio);
    if (threshold !== shownState) {
      shownState = threshold;
      if (threshold) elem.setAttribute('data-state', threshold.state);
      else elem.removeAttribute('data-state');
      statusElem.textContent = threshold?.text ?? '';
      statusElem.hidden = !threshold;
      writeTexts();
      return;
    }
    if (Math.round(clamped) !== shownRounded || Math.round(ratio * 100) !== shownPercent) {
      writeTexts();
    }
  };

  write(props.value ?? max, true);

  return {
    cmp,
    setValue: (next) => write(next, false),
    getValue: () => value,
    setMax: (next) => {
      max = Math.max(Number.MIN_VALUE, next);
      shownRatio = NaN;
      const current = value;
      value = NaN;
      write(current, true);
    },
    setLabel: (label) => {
      labelElem.textContent = label;
    },
  };
};
