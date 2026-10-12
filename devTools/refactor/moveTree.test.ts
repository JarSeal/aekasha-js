import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseModuleSource, resolveSpecifier } from './importGraph';
import { buildPathMap } from './moveApply';
import { MOVE_EDITS } from './moveEdits';
import type { MoveEntry } from './moveRules';
import { rewriteTree } from './moveTree';

const ROOT = path.resolve(__dirname, '../..');

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
    const { changed, created, leftovers, errors } = rewriteTree(map, texts, []);
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

describe("today's tree", () => {
  /** Every tracked text file; the binaries (models, images, the Blender files) aside */
  const readTree = () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
      .trim()
      .split('\n');
    const texts = new Map<string, string>();
    for (const file of files) {
      const full = path.join(ROOT, file);
      if (!fs.existsSync(full)) continue;
      const bytes = fs.readFileSync(full);
      if (!bytes.includes(0)) texts.set(file, bytes.toString('utf-8'));
    }
    const moveMap = JSON.parse(texts.get('devTools/refactor/moveMap.json') as string).files;
    return { map: buildPathMap({ files, moveMap, plan: 'p608' }), texts };
  };

  it('rewrites without an error, the edit table included, and lands every split export', () => {
    const { map, texts } = readTree();
    expect(map.errors).toEqual([]);
    const { changed, created, errors } = rewriteTree(map, texts, MOVE_EDITS);
    expect(errors).toEqual([]);

    // A target is a new module, or a moved file's text (with the parts, or its own: `isOnlyObject3D`)
    const textOf = (target: string) => {
      const owner = map.oldPathOf(target) as string;
      return created.get(target) ?? changed.get(owner) ?? (texts.get(owner) as string);
    };
    expect(map.splits.size).toBe(2);
    const missing: string[] = [];
    for (const [source, split] of map.splits) {
      for (const [name, target] of Object.entries(split)) {
        const { exports } = parseModuleSource(target, textOf(target));
        if (!exports.local.includes(name) && !exports.named[name]) {
          missing.push(`${source}: ${name} isn't exported by ${target}`);
        }
      }
    }
    expect(missing).toEqual([]);

    const unresolved: string[] = [];
    for (const [target, text] of created) {
      for (const { specifier } of parseModuleSource(target, text).imports) {
        if (!specifier.startsWith('.')) continue;
        const found = resolveSpecifier(target, specifier, { exists: (f) => map.newFiles.has(f) });
        if (!found) unresolved.push(`${target}: '${specifier}'`);
      }
    }
    expect(unresolved).toEqual([]);
  });
});
