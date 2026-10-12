import { describe, expect, it } from 'vitest';
import { buildPathMap } from './moveApply';
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
