import { describe, expect, it } from 'vitest';
import { buildPathMap, rewriteStylesheet, rewriteTypeScript } from './moveApply';
import type { MoveEntry } from './moveRules';

const E = 'src/_engine/';

const move = (to: string, plan: MoveEntry['plan'] = 'p608'): MoveEntry => ({
  to,
  action: 'move',
  plan,
});

describe('buildPathMap', () => {
  const files = [
    `${E}core/Scene.ts`,
    `${E}core/Lod/LodChain.ts`,
    `${E}utils/assert.ts`,
    `${E}utils/helpers.ts`,
    `${E}utils/old.ts`,
    `${E}index.ts`,
    'src/toolkit/ecs/Spin.ts',
    'devTools/tool.ts',
  ];
  const moveMap: Record<string, MoveEntry> = {
    [`${E}core/Scene.ts`]: move(`${E}kernel/scene/Scene.ts`),
    [`${E}core/Lod/LodChain.ts`]: move(`${E}features/lod/LodChain.ts`),
    [`${E}utils/assert.ts`]: move(`${E}utils/Assert.ts`),
    [`${E}utils/helpers.ts`]: {
      to: `${E}utils/helpers.ts`,
      action: 'split',
      plan: 'p608',
      split: { a: `${E}kernel/scene/Scene.ts`, b: `${E}utils/Numbers.ts` },
    },
    [`${E}utils/old.ts`]: { to: null, action: 'delete', plan: 'p608' },
    [`${E}index.ts`]: { to: `${E}index.ts`, action: 'keep', plan: 'p608' },
    'src/toolkit/ecs/Spin.ts': move('src/toolkit/ecs/spin/Spin.ts', 'p609'),
  };

  it("maps every file: moves, case-only renames, keeps, the other plan's and unlisted files", () => {
    const map = buildPathMap({ files, moveMap, plan: 'p608' });
    expect(map.errors).toEqual([]);
    expect(map.newPathOf(`${E}core/Scene.ts`)).toBe(`${E}kernel/scene/Scene.ts`);
    expect(map.newPathOf(`${E}utils/assert.ts`)).toBe(`${E}utils/Assert.ts`);
    expect(map.newPathOf(`${E}index.ts`)).toBe(`${E}index.ts`);
    expect(map.newPathOf('src/toolkit/ecs/Spin.ts')).toBe('src/toolkit/ecs/Spin.ts');
    expect(map.newPathOf('devTools/tool.ts')).toBe('devTools/tool.ts');
    expect(map.newPathOf(`${E}utils/old.ts`)).toBeNull();
    expect(map.newPathOf(`${E}utils/helpers.ts`)).toBeNull();
    expect(map.newPathOf(`${E}core/Missing.ts`)).toBeUndefined();
    expect(map.renames).toEqual([
      [`${E}core/Scene.ts`, `${E}kernel/scene/Scene.ts`],
      [`${E}core/Lod/LodChain.ts`, `${E}features/lod/LodChain.ts`],
      [`${E}utils/assert.ts`, `${E}utils/Assert.ts`],
    ]);
    expect(map.deletes).toEqual([`${E}utils/old.ts`]);
    expect(map.splits.get(`${E}utils/helpers.ts`)).toEqual({
      a: `${E}kernel/scene/Scene.ts`,
      b: `${E}utils/Numbers.ts`,
    });
  });

  it('builds the tree after the move and its inverse', () => {
    const map = buildPathMap({ files, moveMap, plan: 'p608' });
    expect([...map.newFiles].sort()).toEqual(
      [
        `${E}kernel/scene/Scene.ts`,
        `${E}features/lod/LodChain.ts`,
        `${E}utils/Assert.ts`,
        `${E}utils/Numbers.ts`,
        `${E}index.ts`,
        'src/toolkit/ecs/Spin.ts',
        'devTools/tool.ts',
      ].sort()
    );
    // A split target that's a moved file's path is that file's; one of its own is the split file's
    expect(map.oldPathOf(`${E}kernel/scene/Scene.ts`)).toBe(`${E}core/Scene.ts`);
    expect(map.oldPathOf(`${E}utils/Numbers.ts`)).toBe(`${E}utils/helpers.ts`);
    expect(map.oldPathOf(`${E}index.ts`)).toBe(`${E}index.ts`);
    expect(map.oldPathOf(`${E}core/Scene.ts`)).toBeUndefined();
  });

  it('applies the other plan only when asked', () => {
    const map = buildPathMap({ files, moveMap, plan: 'p609' });
    expect(map.errors).toEqual([]);
    expect(map.newPathOf('src/toolkit/ecs/Spin.ts')).toBe('src/toolkit/ecs/spin/Spin.ts');
    expect(map.newPathOf(`${E}core/Scene.ts`)).toBe(`${E}core/Scene.ts`);
    expect(map.renames).toEqual([['src/toolkit/ecs/Spin.ts', 'src/toolkit/ecs/spin/Spin.ts']]);
  });

  it('reports what the tree contradicts: a stale entry, a shared or taken target, a case clash', () => {
    const map = buildPathMap({
      files: [`${E}a.ts`, `${E}b.ts`, `${E}c.ts`, `${E}Stays.ts`, `${E}d.ts`, `${E}e.ts`],
      moveMap: {
        [`${E}gone.ts`]: move(`${E}x/Gone.ts`),
        [`${E}a.ts`]: move(`${E}x/A.ts`),
        [`${E}b.ts`]: move(`${E}x/A.ts`),
        [`${E}c.ts`]: move(`${E}Stays.ts`),
        [`${E}d.ts`]: move(`${E}x/a.ts`),
        [`${E}e.ts`]: { to: `${E}e.ts`, action: 'merge', plan: 'p608' },
      },
      plan: 'p608',
    });
    expect(map.errors).toEqual([
      `${E}gone.ts is in the map but not in the tree: regenerate the map (moveMap.ts)`,
      `${E}e.ts: the codemod has no rule for 'merge'`,
      `${E}b.ts and ${E}a.ts both land on ${E}x/A.ts`,
      `${E}c.ts moves onto ${E}Stays.ts, which stays`,
      `${E}x/a.ts (from ${E}d.ts) and ${E}x/A.ts differ only by case`,
    ]);
  });
});

/** A tree before the move: each file → its target (a string), `null` (staying, unlisted) or a split */
const TREE: Record<string, string | null | Record<string, string>> = {
  [`${E}core/Scene.ts`]: `${E}kernel/scene/Scene.ts`,
  [`${E}core/Stay.ts`]: null,
  [`${E}core/Lod/LodChain.ts`]: `${E}features/lod/LodChain.ts`,
  [`${E}core/Lod/LodLevels.ts`]: `${E}features/lod/LodLevels.ts`,
  [`${E}core/Lod/LodFade.ts`]: `${E}kernel/render/LodFade.ts`,
  [`${E}core/Spatial/Grid.ts`]: `${E}features/spatial/Grid.ts`,
  [`${E}core/Spatial/cells/cell.ts`]: `${E}features/spatial/cells/Cell.ts`,
  [`${E}core/Debug/_dbg__Scene.ts`]: `${E}kernel/scene/debug/_dbg__Scene.ts`,
  [`${E}core/Debug/icon.svg`]: `${E}debug/icons/icon.svg`,
  [`${E}core/Debug/model.glb`]: `${E}debug/symbols/model.glb`,
  [`${E}utils/assert.ts`]: `${E}utils/Assert.ts`,
  [`${E}utils/helpers.ts`]: {
    roundTo: `${E}utils/Numbers.ts`,
    NumberLike: `${E}utils/Numbers.ts`,
    isMainThread: `${E}kernel/loop/Workers.ts`,
  },
  [`${E}workers/physicsWorker.ts`]: `${E}features/physics/worker/PhysicsWorker.ts`,
  [`${E}features/lod/index.ts`]: null,
  [`${E}types/typings.d.ts`]: null,
  [`${E}moduleLoad.test.ts`]: `${E}ModuleLoad.test.ts`,
  'src/app/scene.ts': null,
  'src/app/textures/red.png': null,
  'devTools/tool.ts': null,
  'vite.config.ts': null,
};

const treeMap = () => {
  const moveMap: Record<string, MoveEntry> = {};
  for (const [from, to] of Object.entries(TREE)) {
    if (typeof to === 'string') moveMap[from] = move(to);
    else if (to) moveMap[from] = { to: from, action: 'split', plan: 'p608', split: to };
  }
  return buildPathMap({ files: Object.keys(TREE), moveMap, plan: 'p608' });
};

/** One module's rewrite: its lines in, its lines out (or its errors) */
const rewrite = (file: string, lines: string[]) => {
  const { text, errors } = rewriteTypeScript(treeMap(), file, lines.join('\n'));
  return { lines: text.split('\n'), errors };
};

describe('rewriteTypeScript', () => {
  it('follows a moved importer, a moved target, both and neither', () => {
    const { lines, errors } = rewrite(`${E}core/Lod/LodChain.ts`, [
      "import { levels } from './LodLevels';",
      "import { createScene } from '../Scene';",
      "import { keep } from '../Stay';",
      "import * as THREE from 'three/webgpu';",
      "import { createMesh } from 'aekasha';",
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      "import { levels } from './LodLevels';",
      "import { createScene } from '../../kernel/scene/Scene';",
      "import { keep } from '../../core/Stay';",
      "import * as THREE from 'three/webgpu';",
      "import { createMesh } from 'aekasha';",
    ]);
    expect(
      rewrite('src/app/scene.ts', ["import { s } from '../_engine/core/Scene';"]).lines
    ).toEqual(["import { s } from '../_engine/kernel/scene/Scene';"]);
  });

  it('keeps the style: `.ts` written or not, `/index`, the query, a case-only rename', () => {
    const { lines, errors } = rewrite(`${E}core/Scene.ts`, [
      "import { a } from './Stay.ts';",
      "import { lod } from '../features/lod';",
      "import { lod2 } from '../features/lod/index';",
      "import icon from './Debug/icon.svg?raw';",
      "import modelUrl from './Debug/model.glb?url';",
      "import PhysicsWorker from '../workers/physicsWorker?worker';",
      "import { assert } from '../utils/assert';",
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      "import { a } from '../../core/Stay.ts';",
      "import { lod } from '../../features/lod';",
      "import { lod2 } from '../../features/lod/index';",
      "import icon from '../../debug/icons/icon.svg?raw';",
      "import modelUrl from '../../debug/symbols/model.glb?url';",
      "import PhysicsWorker from '../../features/physics/worker/PhysicsWorker?worker';",
      "import { assert } from '../../utils/Assert';",
    ]);
    expect(
      rewrite('devTools/tool.ts', ["import { x } from '../src/_engine/utils/assert';"]).lines
    ).toEqual(["import { x } from '../src/_engine/utils/Assert';"]);
  });

  it('rewrites every form that names a file, and only its string', () => {
    const { lines, errors } = rewrite(`${E}core/Scene.ts`, [
      "import type { T } from './Stay';",
      "export { chain } from './Lod/LodChain';",
      'export type { Level } from "./Lod/LodLevels";',
      "const gui = () => import('./Debug/_dbg__Scene');",
      "type Gui = typeof import('./Debug/_dbg__Scene');",
      "vi.mock('../utils/assert', () => ({}));",
      "const red = new URL('../../app/textures/red.png', import.meta.url);",
      "const notAPath = new URL('./Stay', document.baseURI);",
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      "import type { T } from '../../core/Stay';",
      "export { chain } from '../../features/lod/LodChain';",
      'export type { Level } from "../../features/lod/LodLevels";',
      "const gui = () => import('./debug/_dbg__Scene');",
      "type Gui = typeof import('./debug/_dbg__Scene');",
      "vi.mock('../../utils/Assert', () => ({}));",
      "const red = new URL('../../../app/textures/red.png', import.meta.url);",
      "const notAPath = new URL('./Stay', document.baseURI);",
    ]);
  });

  it('leaves a path to nothing alone unless its importer moves, and keeps a folder', () => {
    expect(rewrite('src/app/scene.ts', ["import { x } from './missing';"])).toEqual({
      lines: ["import { x } from './missing';"],
      errors: [],
    });
    expect(rewrite(`${E}core/Scene.ts`, ["import { x } from './missing';"]).errors).toEqual([
      `${E}core/Scene.ts:1 './missing' names no file: it can't follow its importer`,
    ]);
    const root = ["const root = new URL('.', import.meta.url);"];
    expect(rewrite('vite.config.ts', root)).toEqual({ lines: root, errors: [] });
    expect(
      rewrite(`${E}core/Scene.ts`, ["const app = new URL('../../app/', import.meta.url);"]).lines
    ).toEqual(["const app = new URL('../../../app/', import.meta.url);"]);
  });

  it('divides an import of a split file per target, in its place and kind', () => {
    const { lines, errors } = rewrite('src/app/scene.ts', [
      '  import { roundTo, type NumberLike, isMainThread as isMain } from "../_engine/utils/helpers";',
      "import type { NumberLike as N } from '../_engine/utils/helpers';",
      "export { isMainThread } from '../_engine/utils/helpers';",
      "type W = import('../_engine/utils/helpers').NumberLike;",
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      '  import { roundTo, type NumberLike } from "../_engine/utils/Numbers";',
      '  import { isMainThread as isMain } from "../_engine/kernel/loop/Workers";',
      "import type { NumberLike as N } from '../_engine/utils/Numbers';",
      "export { isMainThread } from '../_engine/kernel/loop/Workers';",
      "type W = import('../_engine/utils/Numbers').NumberLike;",
    ]);
  });

  it("reports what can't name a split file's targets, and the module stays as it was", () => {
    const source = [
      "import * as helpers from '../utils/helpers';",
      "import '../utils/helpers';",
      "export * from '../utils/helpers';",
      "const lazy = () => import('../utils/helpers');",
      "vi.mock('../utils/helpers');",
      "import { gone } from '../utils/helpers';",
    ];
    const { lines, errors } = rewrite(`${E}core/Scene.ts`, source);
    expect(lines).toEqual(source);
    const H = `${E}utils/helpers.ts`;
    expect(errors).toEqual([
      `${E}core/Scene.ts:1 a namespace import of ${H}, which is split: import its names`,
      `${E}core/Scene.ts:2 a side-effect import of ${H}, which is split: import its names`,
      `${E}core/Scene.ts:3 \`export *\` from ${H}, which is split: re-export its names`,
      `${E}core/Scene.ts:4 an \`import()\` of ${H}, which is split: name its exports`,
      `${E}core/Scene.ts:5 vi.mock of ${H}, which is split: name its exports`,
      `${E}core/Scene.ts:6 ${H}'s split has no target for gone`,
    ]);
  });

  it("moves a glob's patterns with their files, and checks the file set", () => {
    const { lines, errors } = rewrite(`${E}moduleLoad.test.ts`, [
      'const modules = import.meta.glob([',
      "  './**/*.ts',",
      "  '!./**/*.test.ts',",
      "  '!./workers/physicsWorker.ts',",
      ']);',
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      'const modules = import.meta.glob([',
      "  './**/*.ts',",
      "  '!./**/*.test.ts',",
      "  '!./features/physics/worker/PhysicsWorker.ts',",
      ']);',
    ]);
    // A folder that moved whole, its subfolders' names changing case
    expect(
      rewrite('src/app/scene.ts', ["import.meta.glob('../_engine/core/Spatial/**/*.ts');"]).lines
    ).toEqual(["import.meta.glob('../_engine/features/spatial/**/*.ts');"]);
  });

  it("reports a glob whose files don't land in one folder", () => {
    const { errors } = rewrite('src/app/scene.ts', [
      "import.meta.glob('../_engine/core/Lod/*.ts');",
    ]);
    expect(errors).toEqual([
      "src/app/scene.ts:1 glob pattern '../_engine/core/Lod/*.ts': its files don't land in one folder (edit table)",
    ]);
  });
});

describe('rewriteStylesheet', () => {
  const S = `${E}styles/`;
  const D = `${E}core/Debug/`;
  const map = () =>
    buildPathMap({
      files: [
        `${S}variables.scss`,
        `${S}index.scss`,
        `${S}normalize.scss`,
        `${S}debugger.scss`,
        `${S}mixins/_index.scss`,
        `${S}old.scss`,
        `${D}_tabButtons.scss`,
        `${D}Panel.module.scss`,
        `${D}Profiler/Profiler.module.scss`,
        `${E}core/UI/DropDown.scss`,
      ],
      moveMap: {
        [`${S}variables.scss`]: move(`${E}ui/styles/variables.scss`),
        [`${S}index.scss`]: move(`${E}ui/styles/index.scss`),
        [`${S}normalize.scss`]: move(`${E}ui/styles/normalize.scss`),
        [`${S}debugger.scss`]: move(`${E}debug/debugger.scss`),
        [`${S}mixins/_index.scss`]: move(`${E}ui/styles/mixins/_index.scss`),
        [`${S}old.scss`]: { to: null, action: 'delete', plan: 'p608' },
        [`${D}_tabButtons.scss`]: move(`${E}debug/_tabButtons.scss`),
        [`${D}Panel.module.scss`]: move(`${E}debug/Panel.module.scss`),
        [`${D}Profiler/Profiler.module.scss`]: move(`${E}debug/profiler/Profiler.module.scss`),
      },
      plan: 'p608',
    });
  const run = (file: string, lines: string[]) => {
    const { text, errors } = rewriteStylesheet(map(), file, lines.join('\n'));
    return { lines: text.split('\n'), errors };
  };

  it("keeps each URL's written form: the extension, a partial without its underscore, an index", () => {
    expect(
      run(`${D}Panel.module.scss`, [
        "@use 'sass:math';",
        "@use '../../styles/variables.scss';",
        "@use './tabButtons' as tabButtons;",
        "@use '../../styles/mixins' as *;",
        "@use 'some-package/theme';",
        '// @use "../../styles/old.scss";',
        ".panel { background: url('/debugger/stripes.png'); }",
      ])
    ).toEqual({
      lines: [
        "@use 'sass:math';",
        "@use '../ui/styles/variables.scss';",
        "@use './tabButtons' as tabButtons;",
        "@use '../ui/styles/mixins' as *;",
        "@use 'some-package/theme';",
        '// @use "../../styles/old.scss";',
        ".panel { background: url('/debugger/stripes.png'); }",
      ],
      errors: [],
    });
    expect(
      run(`${D}Profiler/Profiler.module.scss`, ["@use '../tabButtons' as tabButtons;"]).lines
    ).toEqual(["@use '../tabButtons' as tabButtons;"]);
  });

  it('rewrites `@forward` and every URL of an `@import`, for a stylesheet that stays too', () => {
    expect(
      run(`${S}index.scss`, ["@forward './normalize.scss';", "@forward './debugger.scss';"]).lines
    ).toEqual(["@forward './normalize.scss';", "@forward '../../debug/debugger.scss';"]);
    expect(
      run(`${E}core/UI/DropDown.scss`, [
        '@import "../../styles/variables", "../../styles/debugger";',
      ]).lines
    ).toEqual(['@import "../../ui/styles/variables", "../../debug/debugger";']);
  });

  it('reports a URL whose file is deleted, and leaves the stylesheet as it was', () => {
    const source = ["@use '../../styles/variables.scss';", "@use '../../styles/old';"];
    expect(run(`${D}Panel.module.scss`, source)).toEqual({
      lines: source,
      errors: [`${D}Panel.module.scss:2 '../../styles/old' loads ${S}old.scss, which is deleted`],
    });
  });
});
