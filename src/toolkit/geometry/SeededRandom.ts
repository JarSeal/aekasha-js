import { createSeededRandom as createEngineSeededRandom } from 'aekasha';

// The toolkit's own name for createSeededRandom, which moved to the engine (p610): a declaration
// of its own, so the deprecation shows in the editor and on the Hub (a comment on an
// `export … from` line attaches to nothing).

/**
 * A seeded random number generator, `aekasha`'s `createSeededRandom` under its old toolkit name:
 * the same seed gives the same numbers in [0, 1).
 * @param seed any number, used as an unsigned 32-bit integer
 * @deprecated Import `createSeededRandom` from `aekasha` (removed in toolkit 3.0.0).
 */
export const createSeededRandom = (seed: number): (() => number) => createEngineSeededRandom(seed);
