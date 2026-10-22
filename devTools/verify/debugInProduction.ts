import { type BuildModule, type EmittedAsset, MAIN_BUILD } from '../sbp/bundleModel';

/**
 * The production build's debug check (p607 D7), run by `yarn verify:baselines` on the build it
 * measures: with `__AEK_DEBUG__` false, no debug code may reach `dist/`. Unlike the baselines it
 * isn't a diff: a finding is never something to record.
 *
 * - A file named `_dbg__*` in `dist/assets/` (a chunk, its CSS, an orphan chunk nothing loads).
 * - A debug module with rendered code in a chunk of the main build or a worker build (the module
 *   sizes, `sbp/moduleSizesPlugin.ts`, p619 V7): a `_dbg__*` module, or any module under an engine
 *   folder named `debug` without regard to case (`debug/`, `kernel/<area>/debug/`,
 *   `features/<name>/debug/`), the entry `debug/index.ts` aside (p608 D4). A debug
 *   folder holds nothing that ships: a wrapper's body folds out, so one still there is called from
 *   code that ships.
 * - A file Vite emitted for a debug module (p611 D5): a `?url` (or `new URL`) asset whose source
 *   is in a debug folder, or whose every importer is a debug module. Its importer is tree-shaken,
 *   so it's never loaded, but Vite emits the file when it loads the module that imports it,
 *   before tree-shaking.
 * - A feature's `ctx.onDebug` / `ctx.onDebugAfterStart` call left in a script (p612 D9): the
 *   context's functions fold to nothing, but an ungated call stays with the closure it's handed and
 *   every debug wrapper the closure names. Property names aren't minified, so the call is found by
 *   its text (`n.onDebug(xne)`); the context's own definitions (`onDebug:r=>{}`) aren't calls.
 */

/** A script of the build: its name without the content hash and its code */
export type BuildScript = { file: string; code: string };

const DEBUG_ENTRY = '/src/_engine/debug/index.ts';
const DEBUG_HOOK_CALL = /\.onDebug(?:AfterStart)?\(/g;
const DEBUG_HOOK_EXCERPT = 40;

const isDebugModule = (id: string) =>
  /(^|\/)_dbg__[^/]*$/.test(id) ||
  (/^\/src\/_engine\/(?:[^/]+\/)*debug\//i.test(id) && id !== DEBUG_ENTRY);

/**
 * Lists the debug code a production build holds, one line each, sorted.
 * @param build.files the names in `dist/assets/` without their content hash (`assets/index.js`)
 * @param build.modules every module with code in the build, the worker builds' too
 * @param build.assets the files Vite emitted for modules
 * @param build.scripts the build's scripts, for the ungated debug hook calls (none: not checked)
 * @returns the findings; empty when the build holds no debug code
 */
export const findDebugCodeInBuild = (build: {
  files: string[];
  modules: BuildModule[];
  assets: EmittedAsset[];
  scripts?: BuildScript[];
}): string[] => {
  const { files, modules, assets, scripts = [] } = build;
  const findings: string[] = [];
  for (const file of files) {
    if (/^_dbg__/.test(file.slice(file.lastIndexOf('/') + 1))) {
      findings.push(`debug chunk ${file}`);
    }
  }
  for (const { id, build, chunks } of modules) {
    if (!isDebugModule(id)) continue;
    const inChunks = Object.entries(chunks)
      .filter(([, rendered]) => rendered > 0)
      .map(([chunk]) => chunk)
      .sort();
    const worker = build === MAIN_BUILD ? '' : ` (the ${build} worker)`;
    if (inChunks.length) {
      findings.push(`debug module ${id.slice(1)} in ${inChunks.join(', ')}${worker}`);
    }
  }
  for (const { file, id, importers } of assets) {
    if (isDebugModule(id)) {
      findings.push(`debug asset ${file} (${id.slice(1)})`);
    } else if (importers.length && importers.every(isDebugModule)) {
      findings.push(
        `debug asset ${file} (${id.slice(1)}, imported only by ${importers.map((i) => i.slice(1)).join(', ')})`
      );
    }
  }
  for (const { file, code } of scripts) {
    for (const { index } of code.matchAll(DEBUG_HOOK_CALL)) {
      // From the receiver: the identifier before the dot
      let start = index;
      while (start > 0 && /[\w$]/.test(code[start - 1])) start--;
      const excerpt = code.slice(start, index + DEBUG_HOOK_EXCERPT);
      findings.push(`ungated debug hook call in ${file}: ${excerpt}…`);
    }
  }
  return findings.sort();
};
