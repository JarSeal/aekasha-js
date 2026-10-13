/**
 * The Smallest Build Possible's profiles (p611 D2): the builds `yarn sbp` measures and the budgets
 * they must stay within (gzip bytes; `devTools/sbp/config.ts`' `SbpBudgets`). The embed profiles
 * (`banner`) come with p611 Phase 4.
 *
 * A budget is the size it was set at plus about 4% (at least 1 KiB), rounded up to a whole KiB.
 * Over it fails `yarn sbp` and `yarn build`: shrink the build, or raise the budget in the same
 * change that explains the growth. Well under it is reported: lower it to the new size plus the
 * same margin.
 */
import { KIB, type SbpProfile } from './devTools/sbp/config';

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
        '_engine/kernel/ecs': 15 * KIB,
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
];

export default profiles;
