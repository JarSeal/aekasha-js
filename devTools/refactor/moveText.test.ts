import { describe, expect, it } from 'vitest';
import { buildPathMap } from './moveApply';
import type { MoveEntry } from './moveRules';
import { createTextContext, findLeftovers, getTextKind, rewriteText } from './moveText';

const E = 'src/_engine/';

const FILES: Record<string, MoveEntry | null> = {
  [`${E}InitApp.ts`]: { to: `${E}kernel/init/InitEngine.ts`, action: 'move', plan: 'p608' },
  [`${E}core/Scene.ts`]: { to: `${E}kernel/scene/Scene.ts`, action: 'move', plan: 'p608' },
  [`${E}core/ECS.ts`]: { to: `${E}kernel/ecs/ECS.ts`, action: 'move', plan: 'p608' },
  [`${E}core/ECS/ECSRegistry.ts`]: {
    to: `${E}kernel/ecs/ECSRegistry.ts`,
    action: 'move',
    plan: 'p608',
  },
  [`${E}core/SkyBox/SkyBox.ts`]: {
    to: `${E}features/skybox/SkyBox.ts`,
    action: 'move',
    plan: 'p608',
  },
  [`${E}core/SkyBox/layers/sun.ts`]: {
    to: `${E}features/skybox/layers/Sun.ts`,
    action: 'move',
    plan: 'p608',
  },
  [`${E}core/SkyBox/_dbg__SkyBox.ts`]: {
    to: `${E}features/skybox/debug/_dbg__SkyBox.ts`,
    action: 'move',
    plan: 'p608',
  },
  [`${E}core/Lod/LodChain.ts`]: {
    to: `${E}features/lod/LodChain.ts`,
    action: 'move',
    plan: 'p608',
  },
  [`${E}core/Lod/LodFade.ts`]: { to: `${E}kernel/render/LodFade.ts`, action: 'move', plan: 'p608' },
  [`${E}utils/helpers.ts`]: {
    to: `${E}utils/helpers.ts`,
    action: 'split',
    plan: 'p608',
    split: {
      useDebug: `${E}kernel/config/DebugModules.ts`,
      slerp: `${E}kernel/render/ThreeMath.ts`,
    },
  },
  [`${E}utils/materials/old.ts`]: { to: null, action: 'delete', plan: 'p608' },
  [`${E}debug/index.ts`]: { to: `${E}debug/index.ts`, action: 'keep', plan: 'p608' },
  'src/app/scene.ts': null,
  'readme.md': null,
  'CHANGELOG.md': null,
  'hub/pages/features/ecs/guide.md': null,
};

const setup = () => {
  const moveMap: Record<string, MoveEntry> = {};
  for (const [file, entry] of Object.entries(FILES)) if (entry) moveMap[file] = entry;
  const map = buildPathMap({ files: Object.keys(FILES), moveMap, plan: 'p608' });
  return { map, ctx: createTextContext(map) };
};

const run = (file: string, lines: string[]) => {
  const { text, errors } = rewriteText(setup().ctx, file, lines.join('\n'));
  return { lines: text.split('\n'), errors };
};

describe('getTextKind', () => {
  it("sorts the tree by D6's lists", () => {
    expect(getTextKind('.claude/CLAUDE.md')).toBe('text');
    expect(getTextKind(`${E}core/SkyBox/CLAUDE.md`)).toBe('text');
    expect(getTextKind('hub/pages/features/ecs/guide.md')).toBe('text');
    expect(getTextKind('docs/issues/some-bug.md')).toBe('text');
    expect(getTextKind('devTools/verify/scenes.ts')).toBe('text');
    expect(getTextKind('eslint.config.js')).toBe('text');
    expect(getTextKind(`${E}core/Scene.ts`)).toBe('comments');
    expect(getTextKind('hub/_assets/ts/hub.ts')).toBe('comments');
    expect(getTextKind('CHANGELOG.md')).toBe('history');
    expect(getTextKind('docs/plans/p608_engine-folder-restructure.md')).toBe('history');
    expect(getTextKind('hub/pages/documentation/migration/engine-5.md')).toBe('history');
    expect(getTextKind('devTools/refactor/moveRules.ts')).toBe('history');
    expect(getTextKind('devTools/verify/baselines/api.json')).toBe('history');
    expect(getTextKind('.claude/agents/perf-auditor.md')).toBe('scan');
    expect(getTextKind(`${E}styles/index.scss`)).toBe('scan');
  });
});

describe('rewriteText', () => {
  it('rewrites full and engine-relative paths, with or without `.ts`, in their form', () => {
    expect(
      run('readme.md', [
        '- `src/_engine/core/Scene.ts` and src/_engine/core/Scene, `core/Scene.ts`, core/Scene.',
        '- `InitApp.ts` (InitApp alone is a word), core/SkyBox/layers/sun.ts:12',
        "- import { x } from '../core/Scene'; src/_engine/core/Scene.tsx; xcore/Scene",
        '- core/Scene/ is a folder; src/_engine/debug/index.ts stays',
      ]).lines
    ).toEqual([
      '- `src/_engine/kernel/scene/Scene.ts` and src/_engine/kernel/scene/Scene, `kernel/scene/Scene.ts`, kernel/scene/Scene.',
      '- `kernel/init/InitEngine.ts` (InitApp alone is a word), features/skybox/layers/Sun.ts:12',
      "- import { x } from '../core/Scene'; src/_engine/core/Scene.tsx; xcore/Scene",
      '- core/Scene/ is a folder; src/_engine/debug/index.ts stays',
    ]);
  });

  it("rewrites only a module's comments, TypeDoc's module links included", () => {
    const { lines, errors } = run(`${E}core/Scene.ts`, [
      '/**',
      ' * Set by {@link _engine/InitApp!InitEngine} (`core/Scene.ts` itself); see http://x.dev//a',
      ' */',
      "const where = 'core/Scene.ts'; // core/ECS.ts",
      '/* {@linkcode _engine/utils/helpers!useDebug} */',
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      '/**',
      ' * Set by {@link _engine/kernel/init/InitEngine!InitEngine} (`kernel/scene/Scene.ts` itself); see http://x.dev//a',
      ' */',
      "const where = 'core/Scene.ts'; // kernel/ecs/ECS.ts",
      '/* {@linkcode _engine/kernel/config/DebugModules!useDebug} */',
    ]);
  });

  it("rewrites `hub:` API links to their module's or folder's page, with the anchor", () => {
    const { lines, errors } = run('hub/pages/features/ecs/guide.md', [
      '[Scene](hub:documentation/engine/core/Scene#loadScene)',
      '[ECS](hub:documentation/engine/core/ECS/), [sky](hub:documentation/engine/core/SkyBox)',
      '[useDebug](hub:documentation/engine/utils/helpers#useDebug), [all](hub:documentation/engine)',
      '[debug](hub:documentation/engine/debug), [not API](hub:documentation/code-blocks/)',
    ]);
    expect(errors).toEqual([]);
    expect(lines).toEqual([
      '[Scene](hub:documentation/engine/kernel/scene/Scene#loadScene)',
      '[ECS](hub:documentation/engine/kernel/ecs/ECS/), [sky](hub:documentation/engine/features/skybox)',
      '[useDebug](hub:documentation/engine/kernel/config/DebugModules#useDebug), [all](hub:documentation/engine)',
      '[debug](hub:documentation/engine/debug), [not API](hub:documentation/code-blocks/)',
    ]);
  });

  it("reports a `hub:` link whose page doesn't follow, and leaves the text as it was", () => {
    const source = [
      '[Lod](hub:documentation/engine/core/Lod)',
      '[helpers](hub:documentation/engine/utils/helpers)',
      '[old](hub:documentation/engine/utils/materials/old#x), core/Scene.ts',
    ];
    const { lines, errors } = run('hub/pages/features/ecs/guide.md', source);
    expect(lines).toEqual(source);
    const F = 'hub/pages/features/ecs/guide.md';
    expect(errors).toEqual([
      `${F}:1 hub: link: the page of ${E}core/Lod/, whose modules land in ${E}features/lod/ 1, ${E}kernel/render/ 1`,
      `${F}:2 hub: link: the page of ${E}utils/helpers.ts, which is split: link an export's anchor`,
      `${F}:3 hub: link: the page of ${E}utils/materials/old.ts, which is deleted`,
    ]);
  });

  it('leaves history alone', () => {
    expect(run('CHANGELOG.md', ['`core/Scene.ts`']).lines).toEqual(['`core/Scene.ts`']);
  });
});

describe('findLeftovers', () => {
  it('names every old path left, deleted and split files included, but not in history', () => {
    const { ctx } = setup();
    const text = [
      'utils/helpers.ts and src/_engine/utils/materials/old.ts',
      'kernel/scene/Scene.ts is new; core/Scene.ts was missed',
    ].join('\n');
    expect(findLeftovers(ctx, 'readme.md', text)).toEqual([
      { file: 'readme.md', line: 1, path: 'utils/helpers.ts' },
      { file: 'readme.md', line: 1, path: 'src/_engine/utils/materials/old.ts' },
      { file: 'readme.md', line: 2, path: 'core/Scene.ts' },
    ]);
    expect(findLeftovers(ctx, 'CHANGELOG.md', text)).toEqual([]);
  });
});
