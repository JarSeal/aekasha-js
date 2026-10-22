import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ENTRY_FILES } from '../aliases';
import { ROOT } from '../paths';
import { readLayoutTree } from './layoutTree';
import { checkLayout, getLayoutErrors, getLayoutZone } from './layout';
import { findLayoutRule, getLayoutRules, toModuleFileName } from './layoutRules';

// The repo's layout (p619 D9): the working tree's files, tracked or new (ignored ones aside),
// against `layoutRules.ts` and the layers' import rules. `npx tsx devTools/layout/layoutReport.ts`
// writes the whole picture, the allowed type-only edges included.

describe('the working tree', () => {
  it('follows the layout', () => {
    const tree = readLayoutTree();
    const check = checkLayout({ ...tree, aliases: ENTRY_FILES });
    expect(getLayoutErrors(check)).toEqual([]);
    // Something was read: the rules apply to the engine, the toolkit and the app
    expect(check.moduleCount).toBeGreaterThan(500);
    expect(fs.existsSync(path.join(ROOT, 'src/_engine/index.ts'))).toBe(true);
  });
});

/** A tree of modules, each `path → source`; every path is a file of the tree */
const check = (sources: Record<string, string>, aliases: Record<string, string> = {}) =>
  getLayoutErrors(
    checkLayout({
      files: Object.keys(sources),
      sources: new Map(Object.entries(sources).filter(([f]) => f.endsWith('.ts'))),
      aliases,
    })
  );

describe('checkLayout', () => {
  it('fails on a file no rule covers, a module named in camelCase and a case clash', () => {
    expect(
      check({
        'src/_engine/kernel/ecs/ECS.ts': '',
        'src/_engine/Stray.ts': '',
        'src/_engine/kernel/ecs/helper.ts': '',
        'src/app/scenes/a/A.ts': '',
        'src/app/scenes/a/a.ts': '',
        'src/app/loose.json': '',
      })
    ).toEqual([
      'src/_engine/Stray.ts: no rule in devTools/layout/layoutRules.ts covers it',
      'src/app/loose.json: no rule in devTools/layout/layoutRules.ts covers it',
      "src/_engine/kernel/ecs/helper.ts: a module's name is PascalCase (p602 D7)",
      'src/app/scenes/a/A.ts and src/app/scenes/a/a.ts differ only in case',
    ]);
  });

  it('allows a kernel type import of a feature, and fails a runtime one through an entry', () => {
    const tree = {
      'src/_engine/features/physics/index.ts': "export { a, type T } from './P';",
      'src/_engine/features/physics/P.ts': 'export const a = 1;\nexport type T = number;',
      'src/_engine/kernel/ecs/Types.ts': "import type { T } from '../../features/physics/P';",
      'src/_engine/kernel/ecs/Uses.ts': "import { T } from '../../features/physics/P';",
      'src/_engine/kernel/ecs/Runs.ts': "import { a } from 'aekasha/physics';",
    };
    expect(check(tree, { 'aekasha/physics': 'src/_engine/features/physics/index.ts' })).toEqual([
      'Kernel → feature: src/_engine/kernel/ecs/Runs.ts:1 imports src/_engine/features/physics/index.ts (runtime)',
    ]);
  });

  it("allows the assets worker's job imports and a debug module's", () => {
    expect(
      check({
        'src/_engine/features/lod/worker/Job.ts': 'export const run = 1;',
        'src/_engine/kernel/assets/worker/Switch.ts':
          "const load = () => import('../../../features/lod/worker/Job');",
        'src/_engine/kernel/render/debug/_dbg__R.ts':
          "import { run } from '../../../features/lod/worker/Job';",
      })
    ).toEqual([]);
  });

  it('fails a feature cycle, but not through types or debug code', () => {
    const tree = {
      'src/_engine/features/a/A.ts': "import { b } from '../b/B';\nexport const a = 1;",
      'src/_engine/features/b/B.ts': "import { a } from '../a/A';\nexport const b = 1;",
    };
    expect(check(tree)).toEqual(['a feature cycle: a ↔ b']);
    expect(
      check({ ...tree, 'src/_engine/features/b/B.ts': "import type { a } from '../a/A';" })
    ).toEqual([]);
    expect(
      check({
        ...tree,
        'src/_engine/features/b/B.ts': 'export const b = 1;',
        'src/_engine/features/b/debug/_dbg__B.ts': "import { a } from '../../a/A';",
      })
    ).toEqual([]);
  });

  it('keeps the engine off the app, the toolkit and the generated data, types included', () => {
    expect(
      check({
        'src/app/shared/Thing.ts': 'export type Thing = number;',
        'src/_engine/kernel/ecs/X.ts': "import type { Thing } from '../../../app/shared/Thing';",
      })
    ).toEqual([
      'Engine → app: src/_engine/kernel/ecs/X.ts:1 imports src/app/shared/Thing.ts (type)',
    ]);
  });

  it('keeps utils pure and the boundaries to their layers, listing type-only edges', () => {
    const tree = {
      'src/_engine/utils/U.ts': "import { Vector3 } from 'three';",
      'src/_engine/kernel/ecs/E.ts': 'export type E = 1;\nexport const e = 1;',
      'src/_engine/schemas/S.ts': "import type { E } from '../kernel/ecs/E';",
      'src/_engine/ui/W.ts': "import { e } from '../kernel/ecs/E';",
    };
    const result = checkLayout({
      files: Object.keys(tree),
      sources: new Map(Object.entries(tree)),
      aliases: {},
    });
    expect(getLayoutErrors(result)).toEqual([
      'ui → kernel: src/_engine/ui/W.ts:1 imports src/_engine/kernel/ecs/E.ts (runtime)',
      "utils is pure: src/_engine/utils/U.ts:1 imports 'three'",
    ]);
    expect(result.violations.get('schemas → kernel')).toHaveLength(1);
  });

  it('fails an unresolved relative import', () => {
    expect(check({ 'src/app/shared/A.ts': "import { x } from './Missing';" })).toEqual([
      "an unresolved import: src/app/shared/A.ts:1 './Missing'",
    ]);
  });
});

describe('the rules', () => {
  it('names modules in PascalCase, keeping asset-id files and entries', () => {
    expect(toModuleFileName('atmosphere.ts')).toBe('Atmosphere.ts');
    expect(toModuleFileName('deepMerge.test.ts')).toBe('DeepMerge.test.ts');
    expect(toModuleFileName('_helperSchemas.ts')).toBe('_HelperSchemas.ts');
    expect(toModuleFileName('_dbg__thing.ts')).toBe('_dbg__Thing.ts');
    expect(toModuleFileName('asteroid.tsl.ts')).toBe('asteroid.tsl.ts');
    expect(toModuleFileName('index.ts')).toBe('index.ts');
    expect(toModuleFileName('typings.d.ts')).toBe('typings.d.ts');
    expect(toModuleFileName('DropDown.scss')).toBe('DropDown.scss');
  });

  it('takes the longest matching rule, and a subfolder rule only at its depth', () => {
    const rules = getLayoutRules(['src/app/scenes/a/a.scene.json']);
    expect(findLayoutRule(rules, 'src/_engine/index.ts')?.note).toMatch(/entry/);
    expect(findLayoutRule(rules, 'src/app/scenes/a/deep/x.ts')?.from).toBe('src/app/scenes/a/');
    expect(findLayoutRule(rules, 'src/app/scenes/loose.ts')).toBeUndefined();
  });

  it('zones a file by its path', () => {
    expect(getLayoutZone('src/_engine/kernel/render/debug/_dbg__R.ts')).toEqual({
      layer: 'kernel',
      area: 'render',
      isDebug: true,
    });
    expect(getLayoutZone('src/toolkit/ecs/effects/X.ts')).toMatchObject({ area: 'ecs' });
    expect(getLayoutZone('src/AppECSPlugins.ts').layer).toBe('app');
  });
});
