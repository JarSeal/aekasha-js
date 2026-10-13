/**
 * The Smallest Build Possible's profiles (p611 D2): the builds `yarn sbp` measures. Budgets come
 * with p611 Phase 2, the embed profiles (`banner`) with Phase 4.
 */
import type { SbpProfile } from './devTools/sbp/config';

const profiles: SbpProfile[] = [
  // The template app: `src/index.html`, every scene
  { id: 'app', entry: 'src/index.html' },
];

export default profiles;
