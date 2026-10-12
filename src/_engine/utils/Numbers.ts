/** Rounds the value to a specific scalingFactor such as 10, 100, or 1000,
 * where 10 would be 1 decimal, 100 would be 2 decimals etc. */
export const roundToDecimal = (value: number, scalingFactor: number) =>
  Math.round(value * scalingFactor) / scalingFactor;
