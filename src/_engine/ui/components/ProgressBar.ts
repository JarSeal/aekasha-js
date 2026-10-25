import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import './ProgressBar.scss';
import '../styles/kit.scss';

/** What {@link createProgressBar} draws. */
export type ProgressBarProps = {
  /** Its visible label, and its accessible name ('Loading the level'). */
  label: string;
  /** Shows the label to assistive tech only (a health bar whose place says what it is). Default
   * false. */
  hideLabel?: boolean;
  /** Its value from `min` to `max`, or `null` (the default) for a wait of unknown length: it's
   * indeterminate. */
  value?: number | null;
  /** The value at empty (default 0). */
  min?: number;
  /** The value at full (default 100). */
  max?: number;
  /** Draws the track in this many parts, each filled in turn (a health bar of 5 hearts: 2.5 shows
   * half the third). Default 1. */
  segments?: number;
  /** Shows the value as a rounded percent after the label. Default false. */
  showValue?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A progress bar {@link createProgressBar} made: its CMP and its setters, each writing it in
 * place. */
export type ProgressBar = {
  /** Its element (`.aekProgress`): add it where it goes. */
  cmp: CMPHandle;
  /** Sets its value (clamped to `min` and `max`), or `null` for indeterminate. Writes the bar in
   * place: no layout, no new element, so a value set every frame is fine. */
  setValue: (value: number | null) => void;
  /** Its value, `null` while indeterminate */
  getValue: () => number | null;
  /** Changes its label. */
  setLabel: (label: string) => void;
};

const createPart = (className: string) => {
  const span = document.createElement('span');
  span.className = className;
  return span;
};

/**
 * Creates a progress bar (p803 D10): how far a task is (a download, a level's load, a health bar),
 * or that it's going on with no known end (indeterminate).
 * - Parts: `.aekProgress` (`data-indeterminate` while it is), `.aekProgress__header` with
 *   `.aekProgress__label` and `.aekProgress__value` (`showValue`), `.aekProgress__track` (the
 *   `role="progressbar"`; `data-segments` with `segments`), `.aekProgress__segment` (one per part,
 *   with `segments`) and `.aekProgress__fill` (in the track, or in each segment).
 * - Custom properties (read on any ancestor): `--aek-progress-color` (the fill, default the
 *   accent), `--aek-progress-track-color` (default `--aek-surface-hover`), `--aek-progress-height`
 *   (default `--aek-space-3`).
 * - ARIA: the track is the `role="progressbar"`, named by the label (`aria-labelledby`), with
 *   `aria-valuemin`, `aria-valuemax` and `aria-valuenow` (absent while indeterminate). The shown
 *   percent is `aria-hidden` (assistive tech reads the value from those).
 * - Motion: indeterminate, a bar slides along the track; under `prefers-reduced-motion` it's a
 *   still striped bar (and a segmented one is always). A value change eases over
 *   `--aek-motion-fast`.
 * @example
 * ```ts
 * const download = createProgressBar({ label: 'Downloading the level', showValue: true });
 * panel.add(download.cmp);
 * onDownloadProgress((loaded: number, total: number) => download.setValue((loaded / total) * 100));
 *
 * const health = createProgressBar({ label: 'Health', hideLabel: true, max: 5, segments: 5 });
 * health.setValue(2.5);
 * ```
 */
export const createProgressBar = (props: ProgressBarProps): ProgressBar => {
  const { min = 0, max = 100, showValue = false } = props;
  const segmentCount = Math.max(1, Math.floor(props.segments ?? 1));
  let value: number | null = null;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekProgress', props.class),
    attr: { ...props.attr, ...(props.hideLabel ? { 'data-label-hidden': '' } : {}) },
  });
  const elem = cmp.elem;

  const header = createPart('aekProgress__header');
  const labelElem = createPart(
    props.hideLabel ? 'aekProgress__label aekVisuallyHidden' : 'aekProgress__label'
  );
  labelElem.id = `${cmp.id}__label`;
  labelElem.textContent = props.label;
  header.append(labelElem);
  const valueElem = showValue ? createPart('aekProgress__value') : null;
  if (valueElem) {
    valueElem.setAttribute('aria-hidden', 'true');
    header.append(valueElem);
  }

  const track = createPart('aekProgress__track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-labelledby', labelElem.id);
  track.setAttribute('aria-valuemin', String(min));
  track.setAttribute('aria-valuemax', String(max));
  const fills: HTMLElement[] = [];
  if (segmentCount > 1) {
    track.setAttribute('data-segments', String(segmentCount));
    for (let i = 0; i < segmentCount; i++) {
      const segment = createPart('aekProgress__segment');
      const fill = createPart('aekProgress__fill');
      segment.append(fill);
      track.append(segment);
      fills.push(fill);
    }
  } else {
    fills.push(createPart('aekProgress__fill'));
    track.append(fills[0]);
  }
  elem.append(header, track);

  const setValue = (next: number | null) => {
    if (next === null || !Number.isFinite(next)) {
      value = null;
      elem.setAttribute('data-indeterminate', '');
      track.removeAttribute('aria-valuenow');
      for (const fill of fills) fill.style.transform = '';
      if (valueElem) valueElem.textContent = '';
      return;
    }
    value = Math.min(max, Math.max(min, next));
    const ratio = max > min ? (value - min) / (max - min) : 0;
    elem.removeAttribute('data-indeterminate');
    track.setAttribute('aria-valuenow', String(value));
    // Each part fills in turn: part i holds the ratio's share between i / n and (i + 1) / n
    for (let i = 0; i < fills.length; i++) {
      const share = Math.min(1, Math.max(0, ratio * fills.length - i));
      fills[i].style.transform = `scaleX(${share})`;
    }
    if (valueElem) valueElem.textContent = `${Math.round(ratio * 100)} %`;
  };
  setValue(props.value ?? null);

  return {
    cmp,
    setValue,
    getValue: () => value,
    setLabel: (label) => {
      labelElem.textContent = label;
    },
  };
};
