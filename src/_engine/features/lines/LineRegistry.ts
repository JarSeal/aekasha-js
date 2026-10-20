import type { LineObject } from './LineObject';

/**
 * Every live line, by id. Lines belong to no ECS world, so this is module-wide.
 * @internal
 */
const lines = new Map<string, LineObject>();
let autoIdCounter = 0;

/**
 * A line id no live line has (`line_<n>`), for a line created without an `id`. For `createLines`.
 * @internal
 */
export const nextLineId = () => {
  let id: string;
  do id = `line_${autoIdCounter++}`;
  while (lines.has(id));
  return id;
};

/**
 * Adds a created line to the registry. For `createLines`.
 * @internal
 */
export const registerLine = (line: LineObject) => lines.set(line.id, line);

/**
 * Takes a disposed line out of the registry. For `LineObject.dispose`.
 * @internal
 */
export const unregisterLine = (id: string) => lines.delete(id);

/**
 * The live line with `id`, if any. For Lines.ts' lookups.
 * @internal
 */
export const getRegisteredLine = (id: string) => lines.get(id);

/**
 * Every live line, by id (the registry's own map: don't change it). For Lines.ts.
 * @internal
 */
export const getRegisteredLines = () => lines;
