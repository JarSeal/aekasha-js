/**
 * The production build's debug check (p607 D7), run by `yarn verify:baselines` on the build it
 * measures: with `__AEK_DEBUG__` false, no debug code may reach `dist/`. Unlike the baselines it
 * isn't a diff: a finding is never something to record.
 *
 * - A file named `_dbg__*` in `dist/assets/` (a chunk, its CSS, an orphan chunk nothing loads).
 * - A debug module with rendered code in a chunk: a `_dbg__*` module, or any module under an engine
 *   folder named `debug` without regard to case (`debug/`, `kernel/<area>/debug/`,
 *   `features/<name>/debug/`, `core/Debug/`), the entry `debug/index.ts` aside (p608 D4). A debug
 *   folder holds nothing that ships: a wrapper's body folds out, so one still there is called from
 *   code that ships.
 */

/** A module of the build, as the visualizer lists it: its id (`/src/…`) and its rendered length
 * per chunk (chunk names without their content hash). A tree-shaken module has no chunks. */
export type BuildModule = { id: string; chunks: Record<string, number> };

const DEBUG_ENTRY = '/src/_engine/debug/index.ts';

const isDebugModule = (id: string) =>
  /(^|\/)_dbg__[^/]*$/.test(id) ||
  (/^\/src\/_engine\/(?:[^/]+\/)*debug\//i.test(id) && id !== DEBUG_ENTRY);

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
    if (!isDebugModule(id)) continue;
    const inChunks = Object.entries(chunks)
      .filter(([, rendered]) => rendered > 0)
      .map(([chunk]) => chunk)
      .sort();
    if (inChunks.length) findings.push(`debug module ${id.slice(1)} in ${inChunks.join(', ')}`);
  }
  return findings.sort();
};
