import { describe, expect, it } from 'vitest';
import { buildPathMap } from './moveApply';
import type { MoveEntry } from './moveRules';
import { rewriteTree } from './moveTree';

const E = 'src/_engine/';

const setup = () => {
  const moveMap: Record<string, MoveEntry> = {
    [`${E}core/Scene.ts`]: { to: `${E}kernel/scene/Scene.ts`, action: 'move', plan: 'p608' },
    [`${E}core/ECS.ts`]: { to: `${E}kernel/ecs/ECS.ts`, action: 'move', plan: 'p608' },
    [`${E}utils/object3DHelpers.ts`]: {
      to: `${E}kernel/render/Object3DHelpers.ts`,
      action: 'move',
      plan: 'p608',
    },
    [`${E}utils/helpers.ts`]: {
      to: `${E}utils/helpers.ts`,
      action: 'split',
      plan: 'p608',
      split: {
        isMesh: `${E}kernel/render/Object3DHelpers.ts`,
        roundTo: `${E}utils/Numbers.ts`,
      },
    },
  };
  const texts = new Map([
    [
      `${E}core/Scene.ts`,
      [
        '// see core/ECS.ts',
        "import { a } from './ECS';",
        "import { isMesh, roundTo } from '../utils/helpers';",
        "const p = 'src/_engine/core/ECS.ts';",
      ].join('\n'),
    ],
    [`${E}core/ECS.ts`, 'export const a = 1;\n'],
    [
      `${E}utils/object3DHelpers.ts`,
      "import { a } from '../core/ECS';\n\nexport const isObject3D = () => a;\n",
    ],
    [
      `${E}utils/helpers.ts`,
      [
        "import { a } from '../core/ECS';",
        '',
        '/** Whether it is a mesh (core/Scene.ts asks) */',
        'export const isMesh = () => a > 0;',
        '',
        'export const roundTo = (v: number) => Math.round(v);',
      ].join('\n'),
    ],
    ['CHANGELOG.md', 'core/Scene.ts'],
  ]);
  return { map: buildPathMap({ files: texts.keys(), moveMap, plan: 'p608' }), texts };
};

describe('rewriteTree', () => {
  it("runs a module's specifiers, then its comments, then the splits, and reports what's left", () => {
    const { map, texts } = setup();
    const { changed, created, leftovers, errors } = rewriteTree(map, texts);
    expect(errors).toEqual([]);
    expect(Object.fromEntries(changed)).toEqual({
      [`${E}core/Scene.ts`]: [
        '// see kernel/ecs/ECS.ts',
        "import { a } from '../ecs/ECS';",
        "import { isMesh } from '../render/Object3DHelpers';",
        "import { roundTo } from '../../utils/Numbers';",
        "const p = 'src/_engine/core/ECS.ts';",
      ].join('\n'),
      // The moved file a split appends to: its own rewrite, then the part (its comment rewritten)
      [`${E}utils/object3DHelpers.ts`]: [
        "import { a } from '../ecs/ECS';",
        '',
        'export const isObject3D = () => a;',
        '',
        '/** Whether it is a mesh (kernel/scene/Scene.ts asks) */',
        'export const isMesh = () => a > 0;',
        '',
      ].join('\n'),
    });
    expect(Object.fromEntries(created)).toEqual({
      [`${E}utils/Numbers.ts`]: 'export const roundTo = (v: number) => Math.round(v);\n',
    });
    expect(leftovers).toEqual([
      { file: `${E}kernel/scene/Scene.ts`, line: 5, path: 'src/_engine/core/ECS.ts' },
    ]);
  });
});
