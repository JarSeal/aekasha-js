// A number part's steps (p804 D6): the keys that move it, Shift's and Alt's modifiers and the
// constraint a stepped value goes through. The number field's spin button, the slider's thumb and
// (later) the range slider's thumbs share them.
import { constrainNumber, type NumberRules } from './binding/ValueText';

/** A key's step, as a count of `step`s */
const STEP_KEYS: Readonly<Record<string, number>> = {
  ArrowUp: 1,
  ArrowDown: -1,
  PageUp: 10,
  PageDown: -10,
};
/** The APG slider's keys add the horizontal arrows (a text input's move its caret) */
const SLIDER_STEP_KEYS: Readonly<Record<string, number>> = {
  ...STEP_KEYS,
  ArrowRight: 1,
  ArrowLeft: -1,
};

/**
 * Shift is ×10, Alt ×0.1 (p804 D6).
 * @internal
 */
export const getStepModifier = (e: { shiftKey: boolean; altKey: boolean }) =>
  e.shiftKey ? 10 : e.altKey ? 0.1 : 1;

/**
 * A number part's steps: what `createNumberSteps` gives.
 * @internal
 */
export type NumberSteps = {
  /** A value made one the part takes (`constrainNumber`); with a modifier under 1 (Alt) on a
   * tenth of the step's grid, which the grid itself would snap back */
  constrain: (value: number, modifier?: number) => number;
  /** The value a keydown moves to from `from()` (read only for a step key), constrained: the
   * arrows, PageUp / PageDown ×10, Home / End to `min` / `max` when they're set; null for any
   * other key */
  getKeyTarget: (e: KeyboardEvent, from: () => number) => number | null;
};

/**
 * Makes a number part's steps from its rules: the spin button's keys, or with `horizontal` the
 * APG slider's (ArrowLeft / ArrowRight too).
 * @internal
 */
export const createNumberSteps = (
  rules: NumberRules,
  options: { horizontal?: boolean } = {}
): NumberSteps => {
  const keys = options.horizontal ? SLIDER_STEP_KEYS : STEP_KEYS;
  // Alt's rules: made once, not per key or pointer move
  const fineRules = rules.step !== undefined ? { ...rules, step: rules.step / 10 } : rules;
  const constrain = (value: number, modifier = 1) =>
    constrainNumber(value, modifier < 1 ? fineRules : rules);
  return {
    constrain,
    getKeyTarget: (e, from) => {
      const steps = keys[e.key];
      if (steps !== undefined) {
        const modifier = getStepModifier(e);
        return constrain(from() + steps * (rules.step ?? 1) * modifier, modifier);
      }
      if (e.key === 'Home' && rules.min !== undefined) return rules.min;
      if (e.key === 'End' && rules.max !== undefined) return rules.max;
      return null;
    },
  };
};
