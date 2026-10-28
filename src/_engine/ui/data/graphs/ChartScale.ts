// A chart axis' scale (p805 D9): nice ticks over a range, the nice ceiling the time series' auto
// range grows to (Phase 5 section 3), and a tick's text. Pure: no DOM, nothing at load.

/**
 * An axis' ticks: its range (the first and last tick), the step between them, the values and the
 * decimals a tick's text needs
 * @internal
 */
export type ChartTicks = {
  min: number;
  max: number;
  step: number;
  values: number[];
  decimals: number;
};

/** The nice factors a step is made of, times a power of ten */
const NICE_FACTORS = [1, 2, 2.5, 5, 10];

/** The decimals a value at this step needs (2.5 → 1, 0.25 → 2, 20 → 0) */
const getStepDecimals = (step: number) => {
  for (let decimals = 0; decimals < 15; decimals++) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return decimals;
  }
  return 15;
};

/**
 * The nice step (1, 2, 2.5 or 5 times a power of ten) that cuts `span` into about `count` parts,
 * never fewer
 * @internal
 */
export const getNiceStep = (span: number, count: number) => {
  const raw = span / Math.max(1, count);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const factor = NICE_FACTORS.find((f) => f * magnitude >= raw * (1 - 1e-9)) ?? 10;
  return factor * magnitude;
};

/**
 * The smallest nice number (1, 2, 2.5 or 5 times a power of ten) at or above `value`: the auto
 * range's ceiling, so a rescale is rare. 0 or below gives 1.
 * @internal
 */
export const getNiceCeiling = (value: number) => (value > 0 ? getNiceStep(value, 1) : 1);

/** A value rounded to its decimals, without a negative zero */
const roundTo = (value: number, decimals: number) => Number(value.toFixed(decimals)) || 0;

/**
 * Nice ticks over `[min, max]`: the range widened to the step's multiples, about `count` steps
 * (default 5). `includeZero` widens it to 0 (a bar's baseline). An empty or one-value range gets
 * one of its own: `[0, 1]` for nothing or 0, else a step around the value.
 * @internal
 */
export const getNiceTicks = (
  min: number,
  max: number,
  opts: { count?: number; includeZero?: boolean } = {}
): ChartTicks => {
  const count = opts.count ?? 5;
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : lo;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (opts.includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else {
      const pad = getNiceStep(Math.abs(lo), 1);
      lo = opts.includeZero && lo > 0 ? 0 : lo - pad;
      hi = opts.includeZero && hi < 0 ? 0 : hi + pad;
    }
  }
  const step = getNiceStep(hi - lo, count);
  const decimals = getStepDecimals(step);
  const first = roundTo(Math.floor(lo / step + 1e-9) * step, decimals);
  const last = roundTo(Math.ceil(hi / step - 1e-9) * step, decimals);
  const values: number[] = [];
  const steps = Math.round((last - first) / step);
  for (let i = 0; i <= steps; i++) values.push(roundTo(first + i * step, decimals));
  return { min: first, max: last, step, values, decimals };
};

/**
 * A tick's text at its axis' decimals (`1,000` style grouping left to `yFormat`): '0', '2.5', '-10'
 * @internal
 */
export const formatTick = (value: number, decimals: number) =>
  roundTo(value, decimals).toFixed(decimals);
