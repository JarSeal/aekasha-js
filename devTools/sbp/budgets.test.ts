import { describe, expect, it } from 'vitest';
import { isBudgetFailure, measureModulesUnder, suggestBudget } from './budgets';
import { KIB } from './config';
import { type Colors, formatReport, measureProfile } from './report';
import { DATA, MAIN, createTestBundle } from './testBuild';

const NO_COLORS: Colors = { red: '', green: '', yellow: '', dim: '', reset: '' };

// The fixture's sizes: the initial files 15 (`assets/index.js`), `assets/GLTFLoader.js` 20, the
// physics group 25 (PhysicsFeature.ts 10, PhysicsAPI.ts 15)
const measure = () =>
  measureProfile({
    profile: {
      id: 'test',
      entry: 'src/test.html',
      budgets: {
        initial: 15,
        chunks: { 'assets/index.js': 14, 'assets/Gone.js': 100, 'assets/GLTFLoader.js': 10 * KIB },
        groups: { '_engine/features/physics': 25, nope: 0 },
        modules: {
          '_engine/features/physics/': 24,
          '_engine/features/physics/PhysicsAPI.ts': 15,
        },
      },
    },
    collected: createTestBundle(),
    scenes: {},
    dataFeatures: [],
  });

describe('checkBudgets', () => {
  it('checks each budget in the config’s order', () => {
    expect(measure().report.budgets).toEqual([
      { kind: 'initial', key: 'initial', budget: 15, size: 15, status: 'within' },
      { kind: 'chunk', key: 'assets/index.js', budget: 14, size: 15, status: 'over' },
      { kind: 'chunk', key: 'assets/Gone.js', budget: 100, size: null, status: 'missing' },
      {
        kind: 'chunk',
        key: 'assets/GLTFLoader.js',
        budget: 10 * KIB,
        size: 20,
        status: 'wellUnder',
      },
      { kind: 'group', key: '_engine/features/physics', budget: 25, size: 25, status: 'within' },
      // A group with no code in the initial chunks is 0
      { kind: 'group', key: 'nope', budget: 0, size: 0, status: 'within' },
      { kind: 'module', key: '_engine/features/physics/', budget: 24, size: 25, status: 'over' },
      {
        kind: 'module',
        key: '_engine/features/physics/PhysicsAPI.ts',
        budget: 15,
        size: 15,
        status: 'within',
      },
    ]);
    expect(
      measure()
        .report.budgets!.filter(isBudgetFailure)
        .map((c) => c.key)
    ).toEqual(['assets/index.js', 'assets/Gone.js', '_engine/features/physics/']);
  });

  it('is null for a profile without budgets', () => {
    const { report } = measureProfile({
      profile: { id: 'test', entry: 'src/test.html' },
      collected: createTestBundle(),
      scenes: {},
      dataFeatures: [],
    });
    expect(report.budgets).toBeNull();
  });
});

describe('measureModulesUnder', () => {
  it('sums a file or a folder, initial chunks only', () => {
    const initial = new Set([MAIN]);
    expect(measureModulesUnder(DATA, initial, '_engine/features/physics/PhysicsAPI.ts')).toBe(15);
    // Not a prefix of another file's name
    expect(measureModulesUnder(DATA, initial, '_engine/features/physics/Physics')).toBe(0);
    expect(measureModulesUnder(DATA, initial, '_engine/kernel/')).toBe(25);
    expect(measureModulesUnder(DATA, new Set(), '_engine/kernel/')).toBe(0);
  });
});

describe('suggestBudget', () => {
  it('adds about 4%, at least 1 KiB, rounded up to a whole KiB', () => {
    expect(suggestBudget(100 * KIB)).toBe(104 * KIB);
    expect(suggestBudget(0)).toBe(KIB);
    expect(suggestBudget(2000)).toBe(3 * KIB);
  });
});

describe('the budgets’ text', () => {
  it('lists the failures and the budgets to lower', () => {
    const lines = formatReport(measure().report, NO_COLORS);
    expect(
      lines.slice(lines.indexOf('budgets (gzip, sbp.config.ts): 8 checked, 3 failed, 1 well under'))
    ).toEqual([
      'budgets (gzip, sbp.config.ts): 8 checked, 3 failed, 1 well under',
      '  ✗ chunk assets/index.js: 0.0 kB, budget 0.0 kB, over by 0.0 kB',
      '  ✗ chunk assets/Gone.js: no such file in the build (rename or remove its budget)',
      '  · chunk assets/GLTFLoader.js: 0.0 kB, budget 10.0 kB, well under: lower it to 2 * KIB',
      '  ✗ modules under _engine/features/physics/: 0.0 kB, budget 0.0 kB, over by 0.0 kB',
      '  Over a budget: shrink the build (yarn sbp --why <group | module>), or raise the budget in the change that explains the growth.',
    ]);
  });
});
