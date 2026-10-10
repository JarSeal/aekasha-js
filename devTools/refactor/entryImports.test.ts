import { describe, expect, it } from 'vitest';
import { migrateToEntryImports } from './entryImports';

const ENTRIES = {
  aek: 'src/_engine/index.ts',
  'aek/physics': 'src/_engine/features/physics/index.ts',
  'aek/toolkit/ecs': 'src/toolkit/ecs/index.ts',
};

const ENGINE = {
  'src/_engine/index.ts': [
    "export { createMesh, getMesh } from './core/Mesh';",
    "export type { MeshProps } from './core/Mesh';",
    "export { ECSWorld } from './core/ECS';",
    "export { renamedInner as renamed } from './core/Inner';",
  ].join('\n'),
  'src/_engine/features/physics/index.ts': "export { createBody } from '../../core/Physics';",
  'src/_engine/core/Mesh.ts':
    'export const createMesh = () => 1;\nexport const getMesh = () => 2;\nexport type MeshProps = {};\nexport const meshInternal = 3;',
  'src/_engine/core/ECS.ts': 'export class ECSWorld {}',
  'src/_engine/core/Inner.ts': 'export const renamedInner = 4;',
  'src/_engine/core/Physics.ts': 'export const createBody = () => 5;',
  'src/toolkit/ecs/index.ts': "export { registerHover } from './Hover';",
  'src/toolkit/ecs/Hover.ts':
    "import { ECSWorld } from '../../_engine/core/ECS';\nexport const registerHover = () => ECSWorld;",
  'src/toolkit/ecs/Spin.ts':
    "import { registerHover } from './Hover';\nexport const x = registerHover;",
  'src/toolkit/materials/grid.tsl.ts': 'export const colorNode = 1;',
};

const run = (files: Record<string, string>) => {
  const sources = new Map(Object.entries({ ...ENGINE, ...files }));
  return migrateToEntryImports({
    sources,
    files: [...sources.keys()],
    entries: ENTRIES,
    exists: (f) => sources.has(f),
  });
};

describe('migrateToEntryImports', () => {
  it('merges deep imports per entry, at the first one, keeping type and inline type', () => {
    const { changed, errors } = run({
      'src/app/scene.ts': [
        "import * as THREE from 'three/webgpu';",
        "import { createMesh, type MeshProps } from '../_engine/core/Mesh';",
        "import { createBody } from '../_engine/core/Physics';",
        "import { registerHover } from '../toolkit/ecs/Hover';",
        "import type { ECSWorld } from '../_engine/core/ECS';",
        "import { getMesh as fetchMesh } from '../_engine/core/Mesh';",
        "import { local } from './local';",
      ].join('\n'),
    });
    expect(errors).toEqual([]);
    expect(changed.get('src/app/scene.ts')).toBe(
      [
        "import * as THREE from 'three/webgpu';",
        "import { createMesh, type MeshProps, getMesh as fetchMesh } from 'aek';",
        "import type { ECSWorld } from 'aek';",
        "import { createBody } from 'aek/physics';",
        "import { registerHover } from 'aek/toolkit/ecs';",
        "import { local } from './local';",
      ].join('\n')
    );
  });

  it("uses the entry's name, merges an existing entry import and dedupes", () => {
    const { changed } = run({
      'src/app/a.ts': [
        "import { getMesh } from 'aek';",
        "import { renamedInner } from '../_engine/core/Inner';",
        "import type { ECSWorld } from '../_engine/core/ECS';",
        "import { ECSWorld as World } from '../_engine/core/ECS';",
        "import { getMesh } from '../_engine/core/Mesh';",
      ].join('\n'),
    });
    expect(changed.get('src/app/a.ts')).toBe(
      "import { getMesh, renamed as renamedInner, ECSWorld as World } from 'aek';\nimport type { ECSWorld } from 'aek';"
    );
  });

  it('turns a value import left with inline types only into `import type`', () => {
    const { changed } = run({
      'src/app/b.ts': "import { type MeshProps } from '../_engine/core/Mesh';",
    });
    expect(changed.get('src/app/b.ts')).toBe("import type { MeshProps } from 'aek';");
  });

  it('rewrites the toolkit, but not within a category, the engine or `.tsl.ts` assets', () => {
    const { changed, errors } = run({
      'src/generated/fns.ts': "import * as gridFn from '../toolkit/materials/grid.tsl.ts';",
      'src/app/entryByPath.ts': "import { createMesh } from '../_engine';",
    });
    expect(errors).toEqual([]);
    expect([...changed.keys()].sort()).toEqual([
      'src/app/entryByPath.ts',
      'src/toolkit/ecs/Hover.ts',
    ]);
    expect(changed.get('src/toolkit/ecs/Hover.ts')).toBe(
      "import { ECSWorld } from 'aek';\nexport const registerHover = () => ECSWorld;"
    );
    expect(changed.get('src/app/entryByPath.ts')).toBe("import { createMesh } from 'aek';");
  });

  it('rewrites re-exports apart from imports', () => {
    const { changed } = run({
      'src/app/re.ts':
        "export { createMesh } from '../_engine/core/Mesh';\nexport type { MeshProps } from '../_engine/core/Mesh';",
    });
    expect(changed.get('src/app/re.ts')).toBe(
      "export { createMesh } from 'aek';\nexport type { MeshProps } from 'aek';"
    );
  });

  it('reports what no entry can express and leaves the module alone', () => {
    const { changed, errors } = run({
      'src/app/bad.ts': [
        "import { createMesh, meshInternal } from '../_engine/core/Mesh';",
        "import * as Mesh from '../_engine/core/Mesh';",
        "import '../_engine/core/ECS';",
        "export * from '../_engine/core/Physics';",
        "const lazy = () => import('../_engine/core/Inner');",
      ].join('\n'),
    });
    expect(changed.has('src/app/bad.ts')).toBe(false);
    expect(errors).toEqual([
      'src/app/bad.ts:1 `meshInternal` (src/_engine/core/Mesh.ts) is in no entry',
      'src/app/bad.ts:2 default or namespace import of ../_engine/core/Mesh: import the names from an entry',
      'src/app/bad.ts:3 side-effect import of ../_engine/core/ECS: no entry can express it',
      'src/app/bad.ts:4 `export *` from ../_engine/core/Physics: re-export the names from an entry',
      'src/app/bad.ts:5 dynamic import of ../_engine/core/Inner: import the names from an entry',
    ]);
  });

  it('reports a name two entries export', () => {
    const sources = new Map(
      Object.entries({
        ...ENGINE,
        'src/_engine/features/physics/index.ts':
          "export { createBody } from '../../core/Physics';\nexport { getMesh } from '../../core/Mesh';",
        'src/app/c.ts': "import { getMesh } from '../_engine/core/Mesh';",
      })
    );
    const { errors } = migrateToEntryImports({
      sources,
      files: ['src/app/c.ts'],
      entries: ENTRIES,
      exists: (f) => sources.has(f),
    });
    expect(errors).toEqual([
      'src/app/c.ts:1 `getMesh` (src/_engine/core/Mesh.ts) is in several entries: aek, aek/physics',
    ]);
  });
});
