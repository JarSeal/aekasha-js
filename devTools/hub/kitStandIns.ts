import path from 'node:path';
import type { Plugin } from 'vite';
import { SRC_DIR } from '../paths';
import { HUB_TS_DIR } from './paths';

/**
 * The UI kit without the engine in the Hub's script build (p802 Phase 4): the Hub resolves two of
 * the modules the kit's bundle reaches to stand-ins of its own (`hub/_assets/ts/_kit/`, each named
 * as the module it replaces).
 *
 * - `kernel/loop/MainLoop.ts` (§4's risk): the draggable windows import `addResizer` from it, and
 *   it imports three, the renderer and, through them, both workers. Vite bundles a worker when it
 *   transforms the file, before tree-shaking can drop it, so the build wrote Rapier, Draco and
 *   Basis next to the Hub's scripts (and failed outright with Vite's default IIFE workers).
 * - `utils/LocalAndSessionStorage.ts`: the dev Hub shares the app's origin and `localStorage`, and
 *   the windows write their whole saved state (`AEK_popupWindows`) on every finished change, so a
 *   demo window would replace the app's saved windows. The stand-in keeps it in memory.
 *
 * The kit's other kernel imports (`devTools/layout/layout.ts`' `UI_KERNEL_HOOKS`) are taken as they
 * are: `SceneHooks.ts` and `BootHooks.ts` import nothing, `Config.ts` only storage. Their hooks are
 * added on a window's first use and never run (the Hub has no boot and no scene loads), and the
 * env flags stay false, so a debug window (`isDebugWindow`) doesn't open. p803 cuts the kit's
 * kernel imports (p800 D1), and the `MainLoop.ts` stand-in goes with them.
 */

const KIT_DIR = path.join(HUB_TS_DIR, '_kit');

/** A module → the Hub's stand-in for it, in `hub/_assets/ts/_kit/` under the same name */
export const HUB_KIT_STAND_INS: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ['kernel', 'loop', 'MainLoop.ts'],
    ['utils', 'LocalAndSessionStorage.ts'],
  ].map((parts) => [
    path.join(SRC_DIR, '_engine', ...parts),
    path.join(KIT_DIR, parts[parts.length - 1]),
  ])
);

/** The stand-ins' module names (`MainLoop`): only an import naming one is resolved to check it */
const STAND_IN_NAMES = new Set(
  Object.keys(HUB_KIT_STAND_INS).map((file) => path.basename(file, '.ts'))
);

/** Resolves an import of a `HUB_KIT_STAND_INS` module to its stand-in */
export const hubKitStandInsPlugin = (): Plugin => ({
  name: 'aek-hub-kit-stand-ins',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !STAND_IN_NAMES.has(path.basename(source, '.ts'))) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return (resolved && HUB_KIT_STAND_INS[resolved.id]) ?? null;
  },
});
