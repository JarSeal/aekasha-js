import { describe, expect, it } from 'vitest';
import { buildPathMap } from './moveApply';
import { applyEditTable, checkEdit, getProtectedTexts, type MoveEdit } from './moveEdits';
import type { MoveEntry } from './moveRules';
import { createTextContext, rewriteText } from './moveText';

const E = 'src/_engine/';

const MOVES: Record<string, string | null> = {
  [`${E}core/Physics/EngineRapier.ts`]: `${E}features/physics/backends/EngineRapier.ts`,
  [`${E}core/Physics/PhysicsUtils.ts`]: `${E}features/physics/PhysicsUtils.ts`,
  [`${E}core/PhysicsFeature.ts`]: `${E}features/physics/PhysicsFeature.ts`,
  [`${E}core/Debug/_dbg__PhysicsAPI.ts`]: `${E}features/physics/debug/_dbg__PhysicsAPI.ts`,
  [`${E}workers/physicsWorker.ts`]: `${E}features/physics/worker/PhysicsWorker.ts`,
  [`${E}workers/physicsWorker.test.ts`]: `${E}features/physics/worker/PhysicsWorker.test.ts`,
  [`${E}workers/assetsWorker.ts`]: `${E}kernel/assets/worker/AssetsWorker.ts`,
  [`${E}core/MainLoop.ts`]: `${E}kernel/loop/MainLoop.ts`,
  [`${E}features/physics/index.ts`]: null,
  'eslint.config.js': null,
  'hub/pages/features/lod/guide.md': null,
};

const setup = () => {
  const moveMap: Record<string, MoveEntry> = {};
  for (const [from, to] of Object.entries(MOVES)) {
    if (to) moveMap[from] = { to, action: 'move', plan: 'p608' };
  }
  return buildPathMap({ files: Object.keys(MOVES), moveMap, plan: 'p608' });
};

const edit = (fields: Partial<MoveEdit>): MoveEdit => ({
  plan: 'p608',
  file: 'eslint.config.js',
  find: '',
  replace: '',
  why: 'test',
  ...fields,
});

describe('checkEdit', () => {
  const globs = (ignores: string[]) =>
    edit({
      find: "const S = ['src/_engine/core/Physics/**/*.ts', 'src/_engine/workers/physicsWorker.ts'];",
      replace: `const S = ['src/_engine/features/physics/**/*.ts'];\nconst I = [${ignores.map((i) => `'${i}'`).join(', ')}];`,
      check: {
        kind: 'globs',
        before: {
          files: ['src/_engine/core/Physics/**/*.ts', 'src/_engine/workers/physicsWorker.ts'],
        },
        after: { files: ['src/_engine/features/physics/**/*.ts'], ignores },
      },
    });

  it('passes a glob set that matches the same files after the move, its ignores included', () => {
    const ignores = [
      'src/_engine/features/*/index.ts',
      'src/_engine/features/*/debug/**',
      'src/_engine/features/physics/PhysicsFeature.ts',
      'src/_engine/features/physics/worker/PhysicsWorker.test.ts',
    ];
    expect(checkEdit(setup(), globs(ignores))).toEqual([]);
  });

  it('names the files a glob set misses or adds, and patterns its texts don’t quote', () => {
    const at =
      "eslint.config.js: 'const S = ['src/_engine/core/Physics/**/*.ts', 'src/_engine/workers/physicsWorker.ts'];'";
    expect(checkEdit(setup(), globs(['src/_engine/features/*/index.ts']))).toEqual([
      `${at}: its globs after the move adds ${E}features/physics/PhysicsFeature.ts, ${E}features/physics/debug/_dbg__PhysicsAPI.ts, ${E}features/physics/worker/PhysicsWorker.test.ts`,
    ]);
    const unquoted = globs([]);
    unquoted.replace = "const S = ['src/_engine/features/**/*.ts'];";
    expect(checkEdit(setup(), unquoted)[0]).toBe(
      `${at}: its replacement doesn't quote exactly the patterns after the move`
    );
  });

  it("checks a regex's files, and that the texts hold it", () => {
    const before = /^src\/_engine\/workers\/(physicsWorker|assetsWorker)\.ts$/;
    const after =
      /^src\/_engine\/(features\/physics\/worker\/PhysicsWorker|kernel\/assets\/worker\/AssetsWorker)\.ts$/;
    const regex = (to: RegExp) =>
      edit({
        file: 'devTools/x.test.ts',
        find: `  /${before.source}/,`,
        replace: `  /${to.source}/,`,
        check: { kind: 'regex', before, after: to },
      });
    expect(checkEdit(setup(), regex(after))).toEqual([]);
    expect(checkEdit(setup(), regex(/^src\/_engine\/features\/physics\/worker\/\w+\.ts$/))).toEqual(
      [
        `devTools/x.test.ts: '  /${before.source}/,': its regex after the move misses ${E}kernel/assets/worker/AssetsWorker.ts`,
      ]
    );
  });

  it('maps paths in strings from the engine or the file’s own folder, in order', () => {
    const file = `${E}workers/physicsWorker.test.ts`;
    const engine = (replace: string) =>
      edit({
        file,
        find: "const F = ['core/MainLoop.ts', 'core/PhysicsFeature.ts'];",
        replace,
        check: { kind: 'paths', base: 'engine' },
      });
    expect(
      checkEdit(
        setup(),
        engine("['kernel/loop/MainLoop.ts', 'features/physics/PhysicsFeature.ts']")
      )
    ).toEqual([]);
    const at = `${file}: 'const F = ['core/MainLoop.ts', 'core/PhysicsFeature.ts'];'`;
    expect(
      checkEdit(
        setup(),
        engine("['features/physics/PhysicsFeature.ts', 'kernel/loop/MainLoop.ts']")
      )
    ).toEqual([
      `${at}: 'features/physics/PhysicsFeature.ts' names ${E}features/physics/PhysicsFeature.ts, not ${E}kernel/loop/MainLoop.ts`,
      `${at}: 'kernel/loop/MainLoop.ts' names ${E}kernel/loop/MainLoop.ts, not ${E}features/physics/PhysicsFeature.ts`,
    ]);
    const own = (replace: string) =>
      edit({
        file,
        find: "resolve(__dirname, 'physicsWorker.ts')",
        replace,
        check: { kind: 'paths', base: 'file' },
      });
    expect(checkEdit(setup(), own("resolve(__dirname, 'PhysicsWorker.ts')"))).toEqual([]);
    expect(checkEdit(setup(), own("resolve(__dirname, 'physicsWorker.ts')"))).toEqual([
      `${file}: 'resolve(__dirname, 'physicsWorker.ts')': 'physicsWorker.ts' names ${E}features/physics/worker/physicsWorker.ts, not ${E}features/physics/worker/PhysicsWorker.ts`,
    ]);
  });
});

describe('applyEditTable', () => {
  it("applies its plan's entries in order, each as often as it says", () => {
    const texts: Record<string, string> = { 'eslint.config.js': 'a b a c' };
    const { changed, errors } = applyEditTable(
      setup(),
      [
        edit({ find: 'a', replace: 'x', count: 2 }),
        edit({ find: 'x c', replace: 'y' }),
        edit({ plan: 'p609', find: 'b', replace: 'z' }),
      ],
      (file) => texts[file]
    );
    expect(errors).toEqual([]);
    expect(Object.fromEntries(changed)).toEqual({ 'eslint.config.js': 'x b y' });
  });

  it("reports a find that isn't there as often as it says, and a file the tree hasn't got", () => {
    const { changed, errors } = applyEditTable(
      setup(),
      [
        edit({ find: 'a\nline two', replace: 'x' }),
        edit({ file: 'missing.md', find: 'a', replace: 'x' }),
      ],
      () => 'b'
    );
    expect(changed.size).toBe(0);
    expect(errors).toEqual([
      "eslint.config.js: 'a' occurs 0 times, the edit table says 1",
      'missing.md: not in the tree after the move (edit table)',
    ]);
  });
});

describe('the rewrite and the table', () => {
  it("leaves a find's text to the table: its paths and its links, errors included", () => {
    const map = setup();
    const find = '[Physics](hub:documentation/engine/core/Physics)';
    const protectedTexts = getProtectedTexts(
      [edit({ file: 'x.md', find }), edit({ plan: 'p609' })],
      'p608'
    );
    expect([...protectedTexts]).toEqual([['x.md', [find]]]);
    const file = 'hub/pages/features/lod/guide.md';
    const text = `${find}, src/_engine/core/MainLoop.ts\n'src/_engine/core/MainLoop.ts' ${find}`;
    const ctx = createTextContext(map);
    // Unprotected, the folder link's modules scatter (backends/ below the rest): an error
    expect(rewriteText(ctx, file, text).errors).toEqual([
      `${file}:1 hub: link: the page of ${E}core/Physics/, whose modules land in ${E}features/physics/backends/ 1, ${E}features/physics/ 1`,
      `${file}:2 hub: link: the page of ${E}core/Physics/, whose modules land in ${E}features/physics/backends/ 1, ${E}features/physics/ 1`,
    ]);
    expect(rewriteText(ctx, file, text, [find])).toEqual({
      text: `${find}, src/_engine/kernel/loop/MainLoop.ts\n'src/_engine/kernel/loop/MainLoop.ts' ${find}`,
      errors: [],
    });
    expect(rewriteText(ctx, file, text, ['src/_engine/core/MainLoop.ts']).text).toBe(text);
  });
});
