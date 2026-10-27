/**
 * `yarn verify:ui`'s pure parts (`ui.ts` is the CLI): its arguments, the states a demo box runs,
 * the settings each runs in, and the violations' grouping and allow list. Tested in Node
 * (`uiChecks.test.ts`).
 */
import type { UiCheckStep, UiDemoChecks, UiKeyStep } from '../../hub/_assets/ts/_componentChecks';
import type { UiAllowedViolation } from './ui.config';

export const UI_USAGE =
  'yarn verify:ui [--url <hub url>] [--no-build] [--only <piece>[,<piece>…]] [--update] [--headed]';

/** `noBuild`: serve the last run's Hub build as it is (without `--url`) */
export type UiArgs = {
  url: string;
  noBuild: boolean;
  only: string[];
  update: boolean;
  headed: boolean;
};

/** @throws on an unknown argument or one without its value */
export const parseUiArgs = (argv: string[]): UiArgs => {
  const args: UiArgs = { url: '', noBuild: false, only: [], update: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--url' && value) {
      args.url = value.endsWith('/') ? value : `${value}/`;
      i++;
    } else if (arg === '--only' && value) {
      args.only = value.split(',').filter(Boolean);
      i++;
    } else if (arg === '--no-build') args.noBuild = true;
    else if (arg === '--update') args.update = true;
    else if (arg === '--headed') args.headed = true;
    else throw new Error(`Unknown argument: ${arg} (usage: ${UI_USAGE})`);
  }
  return args;
};

/** The page the run opens, from the Hub's root URL: the public component library (p803 Phase 8) */
export const UI_PAGE_PATH = 'features/ui-kit/library/';

/** A theme and a density each state runs in (p803 D11: both themes, both densities) */
export type UiSetting = { theme: 'dark' | 'light'; density: '' | 'compact' };

export const UI_SETTINGS: UiSetting[] = [
  { theme: 'dark', density: '' },
  { theme: 'light', density: '' },
  { theme: 'dark', density: 'compact' },
  { theme: 'light', density: 'compact' },
];

export const formatSetting = (s: UiSetting) => (s.density ? `${s.theme} ${s.density}` : s.theme);

/** A name in a file name: lower case, a run of anything else than a letter or digit a `-` */
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A state's screenshot in a setting, relative to the baseline and last-run folders:
 * `toaster/info-2.light-compact.png` */
export const getSnapshotFile = (piece: string, stateName: string, setting: UiSetting) =>
  `${piece}/${slugify(stateName)}.${slugify(formatSetting(setting))}.png`;

/** A step the runner takes: the table's, or the box's button at this index */
export type UiRunStep = UiCheckStep | { button: number };

/** A state a demo box runs: its name (unique in the box) and the steps that open it */
export type UiState = { name: string; steps: UiRunStep[] };

/** The box as the page shows it, before any step */
export const BOX_STATE_NAME = 'the box';

/**
 * A box's states: the box itself, a state per button (named by its text, a repeated text
 * numbered: `Info`, `Info 2`), then the checks table's
 * @throws when two states' names make the same file name (a table state's name taken)
 */
export const getDemoStates = (buttonTexts: string[], checks: UiDemoChecks | undefined) => {
  const states: UiState[] = [{ name: BOX_STATE_NAME, steps: [] }];
  const seen = new Map<string, number>();
  buttonTexts.forEach((text, button) => {
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    states.push({ name: n > 1 ? `${text} ${n}` : text, steps: [{ button }] });
  });
  states.push(...(checks?.states ?? []));
  const names = new Map<string, string>();
  for (const { name } of states) {
    const taken = names.get(slugify(name));
    if (taken !== undefined) throw new Error(`Two states named "${taken}" and "${name}"`);
    names.set(slugify(name), name);
  }
  return states;
};

/** A step in a line of output: `press Escape`, `expectCount #hudRoot .toast = 0` */
export const describeStep = (step: UiRunStep | UiKeyStep) => {
  if ('button' in step) return `button ${step.button + 1}`;
  if ('click' in step) return `click "${step.click}"`;
  if ('clickHud' in step) return `clickHud ${step.clickHud}`;
  if ('focusHud' in step) return `focusHud ${step.focusHud}`;
  if ('focusBox' in step) return `focusBox "${step.focusBox}"`;
  if ('clickInBox' in step) return `clickInBox ${step.clickInBox}`;
  if ('focusInBox' in step) return `focusInBox ${step.focusInBox}`;
  if ('press' in step) return `press ${step.press}`;
  if ('keyDown' in step) return `keyDown ${step.keyDown}`;
  if ('keyUp' in step) return `keyUp ${step.keyUp}`;
  if ('expectFocus' in step) return `expectFocus ${step.expectFocus}`;
  if ('expectFocusBox' in step) return `expectFocusBox "${step.expectFocusBox}"`;
  if ('expectAttr' in step) {
    return `expectAttr ${step.expectAttr} ${step.name}=${step.value === null ? 'absent' : `"${step.value}"`}`;
  }
  if ('expectCount' in step) return `expectCount ${step.expectCount} = ${step.count}`;
  if ('expectText' in step) return `expectText ${step.expectText} "${step.text}"`;
  if ('expectValue' in step) return `expectValue ${step.expectValue} "${step.value}"`;
  if ('expectStyle' in step) {
    return `expectStyle ${step.expectStyle} ${step.name}="${step.value}"`;
  }
  return `expectActiveOption "${step.expectActiveOption}"`;
};

/** A problem and the settings it came up in, in the order first seen */
export const groupProblems = (bySetting: { setting: string; problems: string[] }[]) => {
  const byProblem = new Map<string, string[]>();
  for (const { setting, problems } of bySetting) {
    for (const problem of problems) {
      const settings = byProblem.get(problem) ?? [];
      if (!settings.includes(setting)) settings.push(setting);
      byProblem.set(problem, settings);
    }
  }
  return [...byProblem].map(([problem, settings]) => ({ problem, settings }));
};

/** An axe-core violation as the page returns it: the rule and the nodes' selectors */
export type UiViolation = { rule: string; impact: string; help: string; targets: string[] };

/** A rule's violations in one state, over the settings it was found in */
export type UiStateViolation = UiViolation & { settings: string[] };

/** Merges a state's violations from each setting by rule: the settings and targets joined */
export const groupViolations = (bySetting: { setting: string; violations: UiViolation[] }[]) => {
  const byRule = new Map<string, UiStateViolation>();
  for (const { setting, violations } of bySetting) {
    for (const v of violations) {
      const found = byRule.get(v.rule);
      if (!found) {
        byRule.set(v.rule, { ...v, targets: [...v.targets], settings: [setting] });
        continue;
      }
      if (!found.settings.includes(setting)) found.settings.push(setting);
      for (const target of v.targets) {
        if (!found.targets.includes(target)) found.targets.push(target);
      }
    }
  }
  return [...byRule.values()];
};

/** The allowance that covers a rule on a piece, if any */
export const findAllowance = (list: UiAllowedViolation[], rule: string, piece: string) =>
  list.find((a) => a.rule === rule && a.piece === piece);

/** The allowances for the pieces run that matched nothing: fixed, so they can go */
export const findStaleAllowances = (
  list: UiAllowedViolation[],
  piecesRun: string[],
  found: Set<string>
) => list.filter((a) => piecesRun.includes(a.piece) && !found.has(`${a.rule}@${a.piece}`));
