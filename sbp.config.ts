/**
 * The Smallest Build Possible's profiles (p611 D2): the builds `yarn sbp` measures and the budgets
 * they must stay within (gzip bytes; `devTools/sbp/config.ts`' `SbpBudgets`): the template app,
 * and the embeds (p611 D7), each an entry module the gatherer writes its scenes' data for
 * (`src/generated/profiles/<id>/`) and `yarn sbp --profile <id>` builds into `dist-embed/<id>/`.
 *
 * A budget is the size it was set at plus about 4% (at least 1 KiB), rounded up to a whole KiB.
 * Over it fails `yarn sbp` and `yarn build`: shrink the build, or raise the budget in the same
 * change that explains the growth. Well under it is reported: lower it to the new size plus the
 * same margin.
 */
import fs from 'fs';
import { KIB, type SbpProfile } from './devTools/sbp/config';

/** Every engine feature's group (p607: a folder each in `src/_engine/features/`), so a new
 * feature is budgeted at 0 for the banner too */
const FEATURE_GROUPS = fs
  .readdirSync(new URL('./src/_engine/features/', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `_engine/features/${entry.name}`);

const profiles: SbpProfile[] = [
  {
    // The template app: `src/index.html`, every scene
    id: 'app',
    entry: 'src/index.html',
    // Set from p611 Phase 1's report (initial 387.7 KiB gzip)
    budgets: {
      initial: 404 * KIB,
      chunks: {
        'assets/index.js': 401 * KIB,
        // p613 D5: the draggable windows' styles left with the windows. p801: the UI kit's design
        // tokens (`ui/styles/tokens.css`, in every build) took it from 0.9 to 2.3 KiB
        'assets/index.css': 4 * KIB,
        'assets/rapier.js': 843 * KIB,
        // The physics worker's own file (`assets/PhysicsWorker.js` is its 0.1 kB `?worker` wrapper)
        'assets/PhysicsWorker.js@PhysicsWorker': 11 * KIB,
        'assets/AssetsSwitchGLTF.js': 53 * KIB,
      },
      // Set from p619's report (the modules minified, a group's code gzipped per chunk; three
      // 254.5 KiB, physics 23.5 KiB)
      groups: {
        three: 265 * KIB,
        '_engine/features/character': 5 * KIB,
        '_engine/features/instancing': 4 * KIB,
        '_engine/features/lines': 6 * KIB,
        '_engine/features/lod': 7 * KIB,
        '_engine/features/physics': 25 * KIB,
        '_engine/features/postfx': 3 * KIB,
        '_engine/features/skybox': 19 * KIB,
        '_engine/features/spatial': 7 * KIB,
        '_engine/features/viewports': 3 * KIB,
        // p613 D4: the glTF import path loads on demand (`ImportRegistry.js`)
        '_engine/kernel/assets': 13 * KIB,
        '_engine/kernel/ecs': 9 * KIB,
        '_engine/kernel/input': 9 * KIB,
        '_engine/kernel/scene': 6 * KIB,
        // p613 D5: the draggable windows load only where they're used
        '_engine/ui': 5 * KIB,
        app: 14 * KIB,
        toolkit: 7 * KIB,
      },
      modules: {
        // The built-in icons register only in the debug env (p611 D10)
        '_engine/ui/icons/BuiltInIcons.ts': 0,
        '_engine/ui/icons/svg/': 0,
      },
    },
  },
  // #region banner-profile (shown in the Hub: hub/pages/features/smallest-build/)
  {
    // The banner embed (p611 D8): one code-made scene, no feature, built into dist-embed/banner/
    id: 'banner',
    entry: 'src/app/profiles/banner/banner.embed.ts',
    scenes: ['banner'],
    // Set from p611 Phase 4's report (initial 300.6 KiB gzip): the measured floor
    budgets: {
      initial: 313 * KIB,
      chunks: {
        // The entry only re-exports `mount` from the shared chunk
        'banner.embed.js': 2 * KIB,
        'assets/banner.embed.js': 311 * KIB,
        // p613 D5: the draggable windows' styles left with the windows. p801: the UI kit's design
        // tokens took it from 0.1 to 1.5 KiB
        'assets/banner.css': 3 * KIB,
      },
      // Set from p619's report (the modules minified, as the app's)
      groups: {
        three: 262 * KIB,
        // p613 D4: the glTF import path loads on demand (`ImportRegistry.js`)
        '_engine/kernel/assets': 11 * KIB,
        '_engine/kernel/ecs': 8 * KIB,
        '_engine/kernel/scene': 5 * KIB,
        // p613 D5: the draggable windows load only where they're used
        '_engine/ui': 5 * KIB,
        app: 2 * KIB,
        // The floor's promise: no feature reaches the initial chunks
        ...Object.fromEntries(FEATURE_GROUPS.map((group) => [group, 0])),
      },
    },
  },
  // #endregion banner-profile
  {
    // The UI kit in an embed (p801 D9): one code-made scene that opens a window, a toast and a
    // dialog with a drop-down, no feature, built into dist-embed/uiKit/; `yarn verify:embed` checks
    // the kit's sizes and bounds in it
    id: 'uiKit',
    entry: 'src/app/profiles/uiKit/uiKit.embed.ts',
    // Not `uiKit`: a scene file named like the entry would emit a second `assets/uiKit.css` (its
    // chunk's styles), which no file key tells apart from the entry's
    scenes: ['uiKitEmbed'],
    // Set from p801 Phase 3's report (initial 285.8 KiB gzip): the banner's floor, the kit lazy
    budgets: {
      initial: 298 * KIB,
      chunks: {
        // The entry only re-exports `mount` from the shared chunk
        'uiKit.embed.js': 2 * KIB,
        'assets/uiKit.embed.js': 296 * KIB,
        'assets/uiKit.css': 3 * KIB,
        // The scene's chunk: the kit's window, dialog, drop-down and toaster (10.2 KiB of it) and
        // their styles, loaded with the scene
        'assets/uiKitEmbed.js': 12 * KIB,
        'assets/uiKitEmbed.css': 3 * KIB,
      },
      groups: {
        three: 261 * KIB,
        '_engine/kernel/assets': 11 * KIB,
        '_engine/kernel/ecs': 8 * KIB,
        '_engine/kernel/scene': 5 * KIB,
        // The HUD root and CMP only: the components load with the scene
        '_engine/ui': 6 * KIB,
        app: 2 * KIB,
        // No feature reaches the initial chunks, as for the banner
        ...Object.fromEntries(FEATURE_GROUPS.map((group) => [group, 0])),
      },
    },
  },
];

export default profiles;
