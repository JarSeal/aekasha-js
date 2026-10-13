import { createSeededRandom } from './SeededRandom';

/** The world seed until {@link setRandomSeed} sets one. */
const DEFAULT_RANDOM_SEED = 0x9e3779b9;

let worldSeed = DEFAULT_RANDOM_SEED;
/** Stream name → its generator, created on its first draw since the last reset. */
const streams = new Map<string, () => number>();

/** FNV-1a over the name's UTF-16 code units, mixed with the world seed: a stream's seed. */
const getStreamSeed = (name: string) => {
  let hash = 0x811c9dc5 ^ worldSeed;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * The named random stream `name`: a seeded generator ({@link createSeededRandom}) seeded from the
 * world seed and the name, so its sequence doesn't depend on what other streams drew. Every scene
 * load restarts every stream, so a scene draws the same numbers on every visit. Simulation code
 * draws from a stream, never from `Math.random`.
 * @param name the stream's name, eg. `'loot'` or `'character:player'`
 * @returns the stream: each call returns the next number, in [0, 1)
 * @remarks A load or {@link setRandomSeed} replaces the stream: get it again when drawing (a map
 * lookup) instead of keeping it across scene loads, or the old sequence goes on.
 * @example
 * ```ts
 * import { getRandomStream } from 'aekasha';
 *
 * const isCritical = getRandomStream('combat')() < 0.1;
 * ```
 */
export const getRandomStream = (name: string): (() => number) => {
  let stream = streams.get(name);
  if (!stream) {
    stream = createSeededRandom(getStreamSeed(name));
    streams.set(name, stream);
  }
  return stream;
};

/**
 * Sets the world seed every stream is seeded from (eg. a save game's or a match's), and restarts
 * every stream with it.
 * @param seed any number, used as an unsigned 32-bit integer
 */
export const setRandomSeed = (seed: number) => {
  worldSeed = seed >>> 0;
  streams.clear();
};

/** The world seed the streams are seeded from (a default until {@link setRandomSeed}). */
export const getRandomSeed = () => worldSeed;

/**
 * Restarts every stream from its seed. `loadScene` calls it, right before the physics world is
 * replaced.
 * @internal
 */
export const resetRandomStreams = () => {
  streams.clear();
};
