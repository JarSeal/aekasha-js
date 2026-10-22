import type { JSONOutput } from 'typedoc';
import { describe, expect, it } from 'vitest';
import { linkNamedReferences } from './extract';
import { Kind } from './model';

const MAP_FILE = 'src/_engine/kernel/ecs/ECSCoreComponents.ts';

/** `ComponentDataMap` (merged by `declare module 'aekasha'`) and a type parameter `K` */
const createProject = () => {
  const byName = (qualifiedName: string, packageName = 'pkg', packagePath = MAP_FILE) => ({
    type: 'reference',
    target: { packageName, packagePath, qualifiedName },
    name: qualifiedName,
    package: packageName,
  });
  const merged = byName('ComponentDataMap');
  const typeParameter = { ...byName('K'), refersToTypeParameter: true };
  const foreign = byName('Mesh', 'three', 'src/objects/Mesh.d.ts');
  const project = {
    id: 0,
    name: 'pkg',
    variant: 'project',
    kind: 1,
    flags: {},
    packageName: 'pkg',
    children: [
      {
        id: 1,
        name: '_engine/kernel/ecs/ECSCoreComponents',
        variant: 'declaration',
        kind: Kind.Module,
        flags: {},
        children: [
          {
            id: 2,
            name: 'ComponentDataMap',
            variant: 'declaration',
            kind: Kind.Interface,
            flags: {},
          },
          {
            id: 3,
            name: 'getComponent',
            variant: 'declaration',
            kind: Kind.Function,
            flags: {},
            signatures: [
              {
                id: 4,
                name: 'getComponent',
                variant: 'signature',
                kind: Kind.CallSignature,
                flags: {},
                typeParameters: [
                  { id: 5, name: 'K', variant: 'typeParam', kind: Kind.TypeParameter, flags: {} },
                ],
                parameters: [
                  {
                    id: 6,
                    name: 'key',
                    variant: 'param',
                    kind: Kind.Parameter,
                    flags: {},
                    type: typeParameter,
                  },
                ],
                type: { type: 'array', elementType: merged },
              },
            ],
          },
          {
            id: 7,
            name: 'mesh',
            variant: 'declaration',
            kind: Kind.Variable,
            flags: {},
            type: foreign,
          },
        ],
      },
    ],
    symbolIdMap: {
      2: { packageName: 'pkg', packagePath: MAP_FILE, qualifiedName: 'ComponentDataMap' },
      // A type parameter of the same file and name as the reference to it
      5: { packageName: 'pkg', packagePath: MAP_FILE, qualifiedName: 'K' },
    },
  };
  return {
    project: project as unknown as JSONOutput.ProjectReflection,
    merged,
    typeParameter,
    foreign,
  };
};

describe('linkNamedReferences', () => {
  it("gives a reference by name to a merged interface that interface's reflection", () => {
    const { project, merged, typeParameter, foreign } = createProject();
    expect(linkNamedReferences(project)).toBe(1);
    expect(merged.target).toBe(2);
    // A type parameter and another package's type stay by name
    expect(typeParameter.target).toEqual({
      packageName: 'pkg',
      packagePath: MAP_FILE,
      qualifiedName: 'K',
    });
    expect(typeof foreign.target).toBe('object');
  });
});
