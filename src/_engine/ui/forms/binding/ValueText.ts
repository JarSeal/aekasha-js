// A number's shown text and the value rules behind it (p804 D6): its decimals, the rounding that
// keeps float noise out of what's written, the step grid, the range, and the text.

/** What decides a number's decimals, its grid and its range: a number part's props. */
export type NumberRules = {
  /** The smallest value (the grid starts here when it's set). */
  min?: number;
  /** The largest value. */
  max?: number;
  /** The step: keys and drags move by it, and a value snaps to its grid from `min` (else 0). */
  step?: number;
  /** The decimals shown (default: `step`'s, or the value's own, at least 2, as Tweakpane). */
  precision?: number;
  /** Wraps at the range (an angle) instead of clamping to it; needs `min` and `max`. */
  wrap?: boolean;
};

/** A step that is one: a 0 or negative step is none */
const hasStep = (rules: NumberRules): rules is NumberRules & { step: number } =>
  rules.step !== undefined && rules.step > 0;

/** Tweakpane's count, so a ported field shows the same: no more than 10 */
const MAX_DECIMALS = 10;

/**
 * The decimals a number has, at most 10 (`0.25` 2, `Math.PI / 8` 10, `1e-12` 0): Tweakpane's
 * count, so a step shows as many decimals as it did there.
 * @internal
 */
export const getDecimalDigits = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  const text = value.toFixed(MAX_DECIMALS);
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  let end = text.length;
  while (end > dot + 1 && text[end - 1] === '0') end--;
  return end - dot - 1;
};

/**
 * The decimals a number part shows: `precision`, else `step`'s, else the value's own and at least
 * 2 (Tweakpane's rule).
 * @internal
 */
export const getShownDecimals = (rules: NumberRules, value: number) => {
  if (rules.precision !== undefined) return rules.precision;
  if (hasStep(rules)) return getDecimalDigits(rules.step);
  return Math.max(getDecimalDigits(value), 2);
};

/**
 * The decimals a written value is rounded to: the most of `step`'s, `min`'s and `max`'s (so a
 * value on the grid, or clamped to an end, survives it), or without a `step` the shown decimals'
 * with the ends'.
 */
const getRoundingDecimals = (rules: NumberRules, value: number) => {
  const ends = Math.max(
    rules.min === undefined ? 0 : getDecimalDigits(rules.min),
    rules.max === undefined ? 0 : getDecimalDigits(rules.max)
  );
  const own = hasStep(rules)
    ? getDecimalDigits(rules.step)
    : rules.precision ?? getDecimalDigits(value);
  return Math.max(own, ends);
};

/**
 * The decimals `constrainNumber` rounds to under `rules` when they don't depend on the value (a
 * `step` or a `precision` sets them), else undefined: worked out once by a part's steps, not per
 * key or pointer move.
 * @internal
 */
export const getFixedRoundingDecimals = (rules: NumberRules) =>
  hasStep(rules) || rules.precision !== undefined ? getRoundingDecimals(rules, 0) : undefined;

/**
 * Rounds to `decimals`, halves away from zero: `1.0999999999999999` to 1 decimal is `1.1`, the
 * same number as the literal (an integer over a power of ten is the nearest float to the decimal).
 * @internal
 */
export const roundToDecimals = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  // The epsilon takes a half that float made a hair less (1.005 * 100 is 100.49999999999999)
  const scaled = Math.round(Math.abs(value) * factor * (1 + Number.EPSILON));
  const rounded = (Math.sign(value) * scaled) / factor;
  return Number.isFinite(rounded) ? rounded + 0 : value;
};

/**
 * A typed, stepped or dragged number made a value (p804 D6): snapped to the step's grid (from
 * `min`, else 0), wrapped (`wrap`) or clamped to the range, then rounded so no float noise is
 * written (`1 + 0.1` is `1.1`). `decimals` is `getFixedRoundingDecimals`' answer when the caller
 * kept it.
 * @internal
 */
export const constrainNumber = (value: number, rules: NumberRules, decimals?: number) => {
  const { min, max } = rules;
  let next = value;
  if (hasStep(rules)) {
    const origin = min ?? 0;
    next = origin + Math.round((next - origin) / rules.step) * rules.step;
  }
  if (rules.wrap && min !== undefined && max !== undefined && max > min) {
    const span = max - min;
    next = min + ((((next - min) % span) + span) % span);
  } else {
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
  }
  return roundToDecimals(next, decimals ?? getRoundingDecimals(rules, next));
};

/**
 * A number as text with `decimals`, never `-0`.
 * @internal
 */
export const formatNumber = (value: number, decimals: number) =>
  // `+ 0` makes -0 a 0, which `toFixed` would write as "-0.00"
  (value + 0 === 0 ? 0 : value).toFixed(decimals);

/** How a number part writes its value: its rules and the app's own text. */
export type ValueTextOptions = NumberRules & {
  /** The value's text (Tweakpane's `format`), in place of the decimals'. */
  format?: (value: number) => string;
  /** The unit shown after the value, and said after it (`aria-valuetext`). */
  unit?: string;
};

/**
 * A number part's text maker (p804 D6): `format`'s text, else the value with its shown decimals,
 * worked out once when `precision` or `step` sets them (a field draws on every change, D4: one
 * `toFixed` per draw). The unit isn't in the text (the field shows it after the text, and says it
 * with `getSpokenText`).
 * @internal
 */
export const createValueFormatter = (options: ValueTextOptions) => {
  const { format, unit } = options;
  const fixedDecimals =
    options.precision ?? (hasStep(options) ? getDecimalDigits(options.step) : undefined);
  return {
    getText: (value: number) =>
      format
        ? format(value)
        : formatNumber(value, fixedDecimals ?? Math.max(getDecimalDigits(value), 2)),
    /** What assistive tech says (`aria-valuetext`): the text and the unit */
    getSpokenText: (text: string) => (unit ? `${text} ${unit}` : text),
  };
};
