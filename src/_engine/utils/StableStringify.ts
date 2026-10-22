// No imports: the data and asset pipelines (Node) use it too.

/**
 * A value as JSON with its object keys sorted (by code unit), so equal values give equal strings
 * whatever their keys' order: for cache keys and content hashes. `undefined` is `null` as an
 * array item or the whole value, and left out as an object value.
 * @internal
 * @param value Plain data: objects, arrays, strings, numbers, booleans, null
 * @param replace Turns a value into what is written, before the rest (eg. a colour into its hex)
 * @returns the JSON text
 */
export const stableStringify = (value: unknown, replace?: (value: unknown) => unknown): string => {
  if (value === undefined) return 'null';
  const replaced = replace ? replace(value) : value;
  if (replaced === null || typeof replaced !== 'object') return JSON.stringify(replaced);
  if (Array.isArray(replaced)) {
    return `[${replaced.map((item) => stableStringify(item, replace)).join(',')}]`;
  }
  const entries = Object.entries(replaced as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item, replace)}`).join(',')}}`;
};
