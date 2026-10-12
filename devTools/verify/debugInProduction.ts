/**
 * The production build's debug check (p607 D7), run by `yarn verify:baselines` on the build it
 * measures: with `__AEK_DEBUG__` false, no debug code may reach `dist/`. Unlike the baselines it
 * isn't a diff: a finding is never something to record.
 *
 * - A file named `_dbg__*` in `dist/assets/` (a chunk, its CSS, an orphan chunk nothing loads).
 * - A debug module (`_dbg__*`, anything under `src/_engine/core/Debug/`) with rendered code in a
 *   chunk.
 * - A debug wrapper (`src/_engine/debug/*.ts`, the entry `index.ts` aside) with rendered code in a
 *   chunk: its body folds out, so a wrapper still there is called from code that ships.
 */

/** A module of the build, as the visualizer lists it: its id (`/src/…`) and its rendered length
 * per chunk (chunk names without their content hash). A tree-shaken module has no chunks. */
export type BuildModule = { id: string; chunks: Record<string, number> };

const isDebugModule = (id: string) =>
  /(^|\/)_dbg__[^/]*$/.test(id) || id.startsWith('/src/_engine/core/Debug/');

const isDebugWrapper = (id: string) =>
  /^\/src\/_engine\/debug\/[^/]+\.ts$/.test(id) && id !== '/src/_engine/debug/index.ts';

/**
 * Lists the debug code a production build holds, one line each, sorted.
 * @param files the names in `dist/assets/` without their content hash (`assets/index.js`)
 * @param modules every module the visualizer lists, tree-shaken ones included
 * @returns the findings; empty when the build holds no debug code
 */
export const findDebugCodeInBuild = (files: string[], modules: BuildModule[]): string[] => {
  const findings: string[] = [];
  for (const file of files) {
    if (/^_dbg__/.test(file.slice(file.lastIndexOf('/') + 1))) {
      findings.push(`debug chunk ${file}`);
    }
  }
  for (const { id, chunks } of modules) {
    const what = isDebugModule(id) ? 'debug module' : isDebugWrapper(id) ? 'debug wrapper' : null;
    if (!what) continue;
    const inChunks = Object.entries(chunks)
      .filter(([, rendered]) => rendered > 0)
      .map(([chunk]) => chunk)
      .sort();
    if (inChunks.length) findings.push(`${what} ${id.slice(1)} in ${inChunks.join(', ')}`);
  }
  return findings.sort();
};
