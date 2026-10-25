import path from 'node:path';
import type { Plugin } from 'vite';
import { SRC_DIR } from '../paths';
import { HUB_TS_DIR } from './paths';

/**
 * The UI kit without the engine in the Hub's script build (p802 Phase 4, §4's risk). The kit's
 * draggable windows import `addResizer` from the kernel's `MainLoop.ts`, which imports three, the
 * renderer and, through them, both workers: Vite bundles a worker when it transforms the file,
 * before tree-shaking can drop it, so the build wrote Rapier, Draco and Basis next to the Hub's
 * scripts (and failed outright with Vite's default IIFE workers). The Hub resolves that module to
 * a stand-in of its own instead.
 *
 * The other kernel modules the kit imports (`devTools/layout/layout.ts`' `UI_KERNEL_HOOKS`) are
 * taken as they are: `SceneHooks.ts` and `BootHooks.ts` import nothing, and `Config.ts` only
 * storage. Their hooks are added on a window's first use and never run, since the Hub has no boot
 * and no scene loads. p803 cuts the kit's kernel imports (p800 D1), and this goes with them.
 */

/** A kernel module → the Hub's stand-in for it; each a `UI_KERNEL_HOOKS` module */
export const HUB_KIT_KERNEL_STAND_INS: Readonly<Record<string, string>> = {
  [path.join(SRC_DIR, '_engine', 'kernel', 'loop', 'MainLoop.ts')]: path.join(
    HUB_TS_DIR,
    '_kitKernel.ts'
  ),
};

/** The stand-ins' module names (`MainLoop`): only an import naming one is resolved to check it */
const STAND_IN_NAMES = new Set(
  Object.keys(HUB_KIT_KERNEL_STAND_INS).map((file) => path.basename(file, '.ts'))
);

/** Resolves an import of a `HUB_KIT_KERNEL_STAND_INS` module to its stand-in */
export const hubKitKernelPlugin = (): Plugin => ({
  name: 'aek-hub-kit-kernel',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!importer || !STAND_IN_NAMES.has(path.basename(source, '.ts'))) return null;
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return (resolved && HUB_KIT_KERNEL_STAND_INS[resolved.id]) ?? null;
  },
});
