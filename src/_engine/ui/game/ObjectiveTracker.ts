import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import type { HudPlacement } from './HudPlacement';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { announce } from '../components/Announcer';
import './ObjectiveTracker.scss';
import '../styles/kit.scss';

/** A step of an objective ('Find the cave', under 'Rescue the scout'). */
export type ObjectiveTrackerStep = {
  /** What it says. */
  text: string;
  /** Done: checked and struck through (default false). */
  done?: boolean;
};

/** What {@link ObjectiveTracker}'s `setObjective` shows. */
export type ObjectiveTrackerObjective = {
  /** What it says ('Collect crystals'). */
  text: string;
  /** A count after the text ('3 / 5'). */
  count?: { value: number; total: number };
  /** Its steps, under it, in order. */
  steps?: readonly ObjectiveTrackerStep[];
};

/** What {@link createObjectiveTracker} draws. */
export type ObjectiveTrackerProps = {
  /** Its title, over the objectives and naming their list (default 'Objectives'). */
  title?: string;
  /** Shows the title to assistive tech only. Default false. */
  hideTitle?: boolean;
  /** The title as a heading of this level (default a paragraph): a heading lets a screen reader
   * jump to it. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** A corner of the HUD's bounds it's fixed in (default `'top-left'`), or `'inline'`. */
  placement?: HudPlacement;
  /** How long a completed objective stays, checked and struck through, before it fades out, in ms
   * (default 2500; not times the motion factor: it's information). */
  completeHoldMs?: number;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An objective tracker {@link createObjectiveTracker} made: its CMP and its controls. */
export type ObjectiveTracker = {
  /** Its element (`.aekObjectiveTracker`), `hidden` while it has no objective: add it to the HUD
   * root, or into a panel for `'inline'`. `cmp.remove()` clears its timers. */
  cmp: CMPHandle;
  /** Adds an objective at the end, or changes the one with `id` in place (a completed one becomes
   * active again). A new one, a new count and a step done are read. */
  setObjective: (id: string, objective: ObjectiveTrackerObjective) => void;
  /** Completes an objective: checked, struck through and read, then removed after
   * `completeHoldMs`. Does nothing for an unknown or already completed one. */
  complete: (id: string) => void;
  /** Removes an objective now, without the completion. */
  removeObjective: (id: string) => void;
  /** Whether an objective with `id` is shown (a completed one until it's gone). */
  hasObjective: (id: string) => boolean;
  /** Changes its title. */
  setTitle: (title: string) => void;
};

type StepRow = {
  elem: HTMLLIElement;
  textElem: HTMLElement;
  spokenElem: HTMLElement;
  text: string;
  isDone: boolean;
};

type ObjectiveRow = {
  elem: HTMLLIElement;
  textElem: HTMLElement;
  countElem: HTMLElement;
  spokenElem: HTMLElement;
  stepsElem: HTMLUListElement | null;
  steps: StepRow[];
  text: string;
  /** The shown count, `''` without one */
  countText: string;
  state: 'active' | 'complete' | 'leaving';
  timer: ReturnType<typeof setTimeout> | null;
};

const COMPLETE_HOLD_MS = 2500;
/** The fade out: `--aek-motion-base`, times the motion factor */
const LEAVE_MS = 200;

const createPart = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/** A box that a completion turns into a check (CSS), decorative */
const createCheck = () => {
  const check = createPart('span', 'aekObjectiveTracker__check');
  check.setAttribute('aria-hidden', 'true');
  return check;
};

/**
 * Creates an objective tracker (p808 D10): the objectives a game shows the player, each with an
 * optional count ('Collect crystals 3 / 5') and steps under it. The game sets them; a completed
 * one is checked and struck through, then fades out. It shows what it's given: the quests are the
 * game's.
 * - Parts: `.aekObjectiveTracker` (`data-placement`, `hidden` while empty),
 *   `.aekObjectiveTracker__title`, `.aekObjectiveTracker__list` (the `ul`),
 *   `.aekObjectiveTracker__objective` (an `li`, `data-key`, `data-state="active" | "complete" |
 *   "leaving"`) with `__check` (a box, a check when complete), `__text`, `__count` and `__spoken`,
 *   and `.aekObjectiveTracker__steps` with an `.aekObjectiveTracker__step` per step (`data-done`).
 * - Custom properties (read on any ancestor): `--aek-objective-tracker-bg` (default the raised
 *   surface at 88 %), `--aek-objective-tracker-width` (its maximum width),
 *   `--aek-objective-tracker-check-color` (a done check, default `--aek-success`),
 *   `--aek-objective-tracker-inset` (its distance from the corner, default `--aek-space-5`),
 *   `--aek-objective-tracker-z` (default `--aek-z-window`).
 * - Assistive tech: the list (`role="list"`: a list without bullets keeps its role in Safari) is
 *   named by the title; a row's count and check are `aria-hidden`, and its `__spoken` text says
 *   them (', 3 of 5', ', done'). A new objective, a new count, a step done and a completion are
 *   read politely, once, those that come together as one text.
 * - Motion: a check pops in over `--aek-motion-base` and a completed objective fades out over it;
 *   under reduced motion neither (the hold stays: it's information).
 * @example
 * ```ts
 * import { createObjectiveTracker, getHUDRootCMP } from 'aekasha/ui';
 *
 * const tracker = createObjectiveTracker({ title: 'The lost scout', headingLevel: 2 });
 * getHUDRootCMP().add(tracker.cmp);
 * tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 0, total: 5 } });
 * tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 1, total: 5 } });
 * tracker.complete('crystals');
 * ```
 */
export const createObjectiveTracker = (props: ObjectiveTrackerProps = {}): ObjectiveTracker => {
  const completeHoldMs = Math.max(0, props.completeHoldMs ?? COMPLETE_HOLD_MS);
  const rows = new Map<string, ObjectiveRow>();

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekObjectiveTracker', props.class),
    attr: { ...props.attr, 'data-placement': props.placement ?? 'top-left', hidden: '' },
    onRemoveCmp: () => {
      for (const row of rows.values()) clearRowTimer(row);
      rows.clear();
    },
  });
  const elem = cmp.elem;

  const titleElem = createPart(
    props.headingLevel ? `h${props.headingLevel}` : 'p',
    props.hideTitle ? 'aekObjectiveTracker__title aekVisuallyHidden' : 'aekObjectiveTracker__title'
  ) as HTMLElement;
  titleElem.id = `${cmp.id}__title`;
  titleElem.textContent = props.title ?? 'Objectives';
  const list = createPart('ul', 'aekObjectiveTracker__list');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-labelledby', titleElem.id);
  elem.append(titleElem, list);

  function clearRowTimer(row: ObjectiveRow) {
    if (row.timer) clearTimeout(row.timer);
    row.timer = null;
  }

  const syncEmpty = () => {
    elem.hidden = rows.size === 0;
  };

  const say = (text: string) => announce(elem, text, { append: true });

  const writeSpoken = (row: ObjectiveRow, count: ObjectiveTrackerObjective['count']) => {
    const counted = count ? `, ${count.value} of ${count.total}` : '';
    row.spokenElem.textContent = `${counted}${row.state === 'active' ? '' : ', done'}`;
  };

  const createStep = (): StepRow => {
    const stepElem = createPart('li', 'aekObjectiveTracker__step');
    const textElem = createPart('span', 'aekObjectiveTracker__text');
    const spokenElem = createPart('span', 'aekObjectiveTracker__spoken aekVisuallyHidden');
    stepElem.append(createCheck(), textElem, spokenElem);
    return { elem: stepElem, textElem, spokenElem, text: '', isDone: false };
  };

  /** Writes the steps in place by their index, reading a step newly done (not on a new row) */
  const writeSteps = (
    row: ObjectiveRow,
    steps: readonly ObjectiveTrackerStep[],
    isNew: boolean
  ) => {
    if (steps.length && !row.stepsElem) {
      row.stepsElem = createPart('ul', 'aekObjectiveTracker__steps');
      row.stepsElem.setAttribute('role', 'list');
      row.elem.append(row.stepsElem);
    }
    while (row.steps.length > steps.length) row.steps.pop()?.elem.remove();
    steps.forEach((step, index) => {
      let stepRow = row.steps[index];
      if (!stepRow) {
        stepRow = createStep();
        row.steps.push(stepRow);
        row.stepsElem?.append(stepRow.elem);
      }
      if (stepRow.text !== step.text) {
        stepRow.text = step.text;
        stepRow.textElem.textContent = step.text;
      }
      const isDone = step.done === true;
      if (stepRow.isDone === isDone) return;
      stepRow.isDone = isDone;
      if (isDone) stepRow.elem.setAttribute('data-done', '');
      else stepRow.elem.removeAttribute('data-done');
      stepRow.spokenElem.textContent = isDone ? ', done' : '';
      if (isDone && !isNew) say(`${step.text}, done`);
    });
    if (!steps.length && row.stepsElem) {
      row.stepsElem.remove();
      row.stepsElem = null;
    }
  };

  const createRow = (id: string): ObjectiveRow => {
    const rowElem = createPart('li', 'aekObjectiveTracker__objective');
    rowElem.setAttribute('data-key', id);
    rowElem.setAttribute('data-state', 'active');
    const head = createPart('span', 'aekObjectiveTracker__head');
    const textElem = createPart('span', 'aekObjectiveTracker__text');
    const countElem = createPart('span', 'aekObjectiveTracker__count');
    countElem.setAttribute('aria-hidden', 'true');
    countElem.hidden = true;
    const spokenElem = createPart('span', 'aekObjectiveTracker__spoken aekVisuallyHidden');
    head.append(createCheck(), textElem, countElem, spokenElem);
    rowElem.append(head);
    return {
      elem: rowElem,
      textElem,
      countElem,
      spokenElem,
      stepsElem: null,
      steps: [],
      text: '',
      countText: '',
      state: 'active',
      timer: null,
    };
  };

  const setState = (row: ObjectiveRow, state: ObjectiveRow['state']) => {
    row.state = state;
    row.elem.setAttribute('data-state', state);
  };

  const removeRow = (id: string) => {
    const row = rows.get(id);
    if (!row) return;
    clearRowTimer(row);
    rows.delete(id);
    row.elem.remove();
    syncEmpty();
  };

  /** Fades a completed objective out, then removes it */
  const leave = (id: string, row: ObjectiveRow) => {
    const ms = LEAVE_MS * getMotionFactor(elem);
    if (ms <= 0) {
      removeRow(id);
      return;
    }
    setState(row, 'leaving');
    row.timer = setTimeout(() => removeRow(id), ms);
  };

  const setObjective = (id: string, objective: ObjectiveTrackerObjective) => {
    let row = rows.get(id);
    const isNew = !row;
    if (!row) {
      row = createRow(id);
      rows.set(id, row);
      list.append(row.elem);
      syncEmpty();
    } else if (row.state !== 'active') {
      clearRowTimer(row);
      setState(row, 'active');
    }
    if (row.text !== objective.text) {
      row.text = objective.text;
      row.textElem.textContent = objective.text;
    }
    const { count } = objective;
    const countText = count ? `${count.value} / ${count.total}` : '';
    const isCountChanged = countText !== row.countText;
    if (isCountChanged) {
      row.countText = countText;
      row.countElem.textContent = countText;
      row.countElem.hidden = !count;
    }
    writeSpoken(row, count);
    writeSteps(row, objective.steps ?? [], isNew);
    const counted = count ? `, ${count.value} of ${count.total}` : '';
    if (isNew) say(`New objective: ${objective.text}${counted}`);
    else if (isCountChanged && count) say(`${objective.text}${counted}`);
  };

  return {
    cmp,
    setObjective,
    complete: (id) => {
      const row = rows.get(id);
      if (!row || row.state !== 'active') return;
      setState(row, 'complete');
      row.spokenElem.textContent += ', done';
      say(`Objective complete: ${row.text}`);
      row.timer = setTimeout(() => leave(id, row), completeHoldMs);
    },
    removeObjective: removeRow,
    hasObjective: (id) => rows.has(id),
    setTitle: (title) => {
      titleElem.textContent = title;
    },
  };
};
