/**
 * `yarn sbp`'s profiles (p611 D2), listed in `sbp.config.ts` at the repo root: what a build holds
 * and which scenes it serves. Budgets join them in Phase 2, the embed profiles in Phase 4.
 */

/** A build `yarn sbp` measures */
export type SbpProfile = {
  /** `--profile <id>`, and the key of `.cache/sbp/report.json` */
  id: string;
  /** The build's entry from the repo root: `src/index.html` is the template app's `yarn build` */
  entry: string;
  /** The scene ids it serves (their `__features` go next to the feature view); all when omitted */
  scenes?: string[];
};

/** The app's full-page build, its every scene: what `yarn build` makes */
export const APP_ENTRY = 'src/index.html';

/** Checks the profiles' shape; returns the problems, one line each */
export const checkSbpProfiles = (profiles: readonly SbpProfile[]): string[] => {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (!/^[a-z][A-Za-z0-9-]*$/.test(profile.id)) {
      problems.push(`profile id ${JSON.stringify(profile.id)}: a letter, then letters, digits, -`);
    }
    if (ids.has(profile.id)) problems.push(`profile ${profile.id} listed twice`);
    ids.add(profile.id);
    if (profile.entry !== APP_ENTRY) {
      problems.push(
        `profile ${profile.id}: only ${APP_ENTRY} builds so far (embeds: p611 Phase 4)`
      );
    }
  }
  return problems;
};
