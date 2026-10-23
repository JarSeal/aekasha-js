/**
 * A seeded pseudo-random number generator (mulberry32): the same seed gives the same sequence on
 * every run and machine, which `Math.random()` can't. Simulation code draws from a named stream
 * ({@link _engine/utils/RandomStreams!getRandomStream}) instead, so a scene draws the same numbers
 * on every visit.
 * @param seed any number, used as an unsigned 32-bit integer
 * @returns a function returning the next number of the sequence, in [0, 1)
 * @example
 * ```ts
 * import { createSeededRandom } from 'aekasha';
 *
 * const random = createSeededRandom(42);
 * const x = random() * 10; // the same on every run
 * ```
 */
export const createSeededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
