/**
 * The Hub's script build's own `define` (`devTools/hub/assets.ts`' `buildScripts`): true in a
 * `dev` build, false in `public`, which drops what it guards
 */
declare const __HUB_DEV__: boolean;

/**
 * V8's, which the engine's GPU memory debug module sets. The engine's check has it from
 * `@types/node`; the Hub's (`types: []`, browser code) reaches that module through the UI kit's
 * kernel import and gets only this name, not node's globals.
 */
interface ErrorConstructor {
  stackTraceLimit: number;
}
