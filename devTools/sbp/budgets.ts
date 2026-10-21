/**
 * A profile's budgets checked against its build (p611 D2, Phase 2): over a budget, or a budget on a
 * chunk the build doesn't have, fails `yarn sbp` (and so `yarn build`, as the asset pipeline's
 * budgets fail its production gather); well under one is reported with a tighter value.
 */
import type { ModuleSizesFile, Size } from './bundleModel';
import type { SplitGroupSize } from './bundleSplit';
import { KIB, type SbpBudgets, isWellUnderBudget } from './config';

/** Which of `SbpBudgets`' lists a budget is from */
export type BudgetKind = 'initial' | 'chunk' | 'group' | 'module';

/** One budget checked against the build */
export type BudgetCheck = {
  kind: BudgetKind;
  /** The chunk's key, the group, the module path; `initial` for the initial budget */
  key: string;
  /** Gzip bytes */
  budget: number;
  /** Gzip bytes; null for a chunk the build doesn't have */
  size: number | null;
  /** `missing`: a chunk budget with no file in the build */
  status: 'within' | 'wellUnder' | 'over' | 'missing';
};

/** What a profile's measured build gives the budgets */
export type BudgetInput = {
  initialGzip: number;
  /** Every file of `dist/assets/` by its key, initial and lazy */
  chunks: Record<string, Size>;
  groups: Record<string, SplitGroupSize>;
  sizes: ModuleSizesFile;
  /** The hashed names of the initial files (`BundleSplit.initialFiles`) */
  initialFiles: Set<string>;
};

/** Whether a check fails the run */
export const isBudgetFailure = (check: BudgetCheck) =>
  check.status === 'over' || check.status === 'missing';

/** A budget for a size, as `sbp.config.ts` sets them: about 4% (at least 1 KiB) over it, rounded
 * up to a whole KiB */
export const suggestBudget = (size: number) =>
  Math.max(Math.ceil((size * 1.04) / KIB), Math.ceil((size + KIB) / KIB)) * KIB;

/** The gzip of the modules under a path from `src/` (a file, or a folder ending in `/`) in the
 * initial chunks: each module's minified code gzipped alone, summed (a little over a group's,
 * which gzips its modules' code together) */
export const measureModulesUnder = (
  sizes: ModuleSizesFile,
  initialFiles: Set<string>,
  srcPath: string
) => {
  const id = `/src/${srcPath}`;
  const isUnder = srcPath.endsWith('/')
    ? (moduleId: string) => moduleId.startsWith(id)
    : (moduleId: string) => moduleId === id || moduleId.startsWith(`${id}?`);
  let gzip = 0;
  for (const module of sizes.modules) {
    if (!isUnder(module.id)) continue;
    for (const [file, size] of Object.entries(module.chunks)) {
      if (initialFiles.has(file)) gzip += size.gzip;
    }
  }
  return gzip;
};

const check = (
  kind: BudgetKind,
  key: string,
  budget: number,
  size: number | null
): BudgetCheck => ({
  kind,
  key,
  budget,
  size,
  status:
    size === null
      ? 'missing'
      : size > budget
        ? 'over'
        : isWellUnderBudget(size, budget)
          ? 'wellUnder'
          : 'within',
});

/** Checks every budget, in `sbp.config.ts`' order: the initial one, the chunks, the groups, the
 * modules */
export const checkBudgets = (budgets: SbpBudgets, input: BudgetInput): BudgetCheck[] => [
  ...(budgets.initial === undefined
    ? []
    : [check('initial', 'initial', budgets.initial, input.initialGzip)]),
  ...Object.entries(budgets.chunks ?? {}).map(([key, budget]) =>
    check('chunk', key, budget, input.chunks[key]?.gzip ?? null)
  ),
  ...Object.entries(budgets.groups ?? {}).map(([key, budget]) =>
    check('group', key, budget, input.groups[key]?.initial.gzip ?? 0)
  ),
  ...Object.entries(budgets.modules ?? {}).map(([key, budget]) =>
    check('module', key, budget, measureModulesUnder(input.sizes, input.initialFiles, key))
  ),
];
