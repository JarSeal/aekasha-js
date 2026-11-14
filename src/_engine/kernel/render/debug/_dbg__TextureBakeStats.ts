import { createBakeStats, type BakeStats } from '../../../debug/_dbg__BakeStats';

/**
 * The texture baker's stats (p304 D1, debug only): a bake stats tracker per bake id
 * (`debug/_dbg__BakeStats.ts`: the bake count, the CPU and the GPU ms, the bakes per second),
 * made on the id's first bake and kept for the page's life, so a scene visited again keeps
 * counting. Loaded by `TextureBaker.ts` through the debug loader, so a production build has none
 * of it; `getTextureBakeStats` reads it.
 */

const statsById = new Map<string, BakeStats>();

/** Around every render of a bake (each of its layers): the renders between them are its GPU
 * time. */
export const onTextureBakeStart = (id: string) => {
  let stats = statsById.get(id);
  if (!stats) {
    stats = createBakeStats();
    statsById.set(id, stats);
  }
  stats.hooks.onBakeStart();
};

/** A bake's end, with its CPU time. */
export const onTextureBakeEnd = (id: string, cpuMs: number) => {
  statsById.get(id)?.hooks.onBakeEnd(cpuMs);
};

/** The id's stats, or undefined before its first bake. */
export const getTextureBakeStatsView = (id: string) => statsById.get(id)?.view;
