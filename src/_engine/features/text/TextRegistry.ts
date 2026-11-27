// p392 D1: the live texts by id, and the queue of texts changed since the feature's system last
// ran. Texts belong to no ECS world, so both are module-wide.
import type { TextObject } from './TextObject';

const texts = new Map<string, TextObject>();
let autoIdCounter = 0;

/** The texts changed since the last drain, each once (its `isQueued` says so) */
const queue: TextObject[] = [];

/**
 * A text id no live text has (`text_<n>`), for a text created without an `id`. For `createText`.
 * @internal
 */
export const nextTextId = () => {
  let id: string;
  do id = `text_${autoIdCounter++}`;
  while (texts.has(id));
  return id;
};

/**
 * Adds a created text to the registry. For `createText`.
 * @internal
 */
export const registerText = (text: TextObject) => texts.set(text.id, text);

/**
 * Takes a disposed text out of the registry. For `TextObject.dispose`.
 * @internal
 */
export const unregisterText = (id: string) => texts.delete(id);

/**
 * The live text with `id`, if any.
 * @internal
 */
export const getRegisteredText = (id: string) => texts.get(id);

/**
 * Every live text, by id (the registry's own map: don't change it while iterating it).
 * @internal
 */
export const getRegisteredTexts = (): ReadonlyMap<string, TextObject> => texts;

/**
 * Queues a changed text for the feature's system (once until the next drain). A disposed text is
 * queued too, so its glyphs leave their batch.
 * @internal
 */
export const queueTextUpdate = (text: TextObject) => {
  if (text.isQueued) return;
  text.isQueued = true;
  queue.push(text);
};

/**
 * The queued texts, in the order they were first changed. The caller handles each, then calls
 * `clearTextUpdateQueue`.
 * @internal
 */
export const getTextUpdateQueue = (): readonly TextObject[] => queue;

/**
 * Empties the queue (its texts' `isQueued` cleared), keeping the array.
 * @internal
 */
export const clearTextUpdateQueue = () => {
  for (const text of queue) text.isQueued = false;
  queue.length = 0;
};
