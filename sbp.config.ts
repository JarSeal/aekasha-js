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
        'assets/index.css': 4 * KIB,
        'assets/rapier.js': 843 * KIB,
        'assets/PhysicsWorker.js': 11 * KIB,
        'assets/AssetsSwitchGLTF.js': 53 * KIB,
      },
      groups: {
        three: 642 * KIB,
        '_engine/features/character': 7 * KIB,
        '_engine/features/instancing': 5 * KIB,
        '_engine/features/lines': 10 * KIB,
        '_engine/features/lod': 9 * KIB,
        '_engine/features/physics': 36 * KIB,
        '_engine/features/postfx': 3 * KIB,
        '_engine/features/skybox': 28 * KIB,
        '_engine/features/spatial': 10 * KIB,
        '_engine/features/viewports': 4 * KIB,
        '_engine/kernel/assets': 27 * KIB,
        // p612's JSDoc (a group counts its comments: sizes before minification); its code +0.4 KiB
        '_engine/kernel/ecs': 17 * KIB,
        '_engine/kernel/input': 13 * KIB,
        '_engine/kernel/scene': 8 * KIB,
        '_engine/ui': 15 * KIB,
        app: 15 * KIB,
        toolkit: 10 * KIB,
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
        'assets/banner.css': 3 * KIB,
      },
      groups: {
        three: 633 * KIB,
        '_engine/kernel/assets': 25 * KIB,
        // p612's JSDoc counts: a group is measured before minification
        '_engine/kernel/ecs': 17 * KIB,
        '_engine/kernel/scene': 7 * KIB,
        '_engine/ui': 15 * KIB,
        app: 3 * KIB,
        // The floor's promise: no feature reaches the initial chunks
        ...Object.fromEntries(FEATURE_GROUPS.map((group) => [group, 0])),
      },
    },
  },
  // #endregion banner-profile
];

export default profiles;
