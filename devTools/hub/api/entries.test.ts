import { describe, expect, it } from 'vitest';
import { findLeakedTypes, indexEntries } from './entries';
import type { ApiEntry } from './extract';
import { indexApiModel, Kind } from './model';
import { createModel } from './testModel';

const A = 'src/_engine/a/A.ts';
const B = 'src/_engine/b/B.ts';

const entry = (exports: [string, string][], name = 'aekasha'): ApiEntry => ({
  entry: name as ApiEntry['entry'],
  file: 'src/_engine/index.ts',
  exports: exports.map(([sourcePath, imported]) => ({ name: imported, imported, sourcePath })),
});

describe('indexEntries', () => {
  it("maps an entry's names to their declarations, through a re-export", () => {
    const { decl, module, project } = createModel();
    const value = decl(A, 3, 'Thing', Kind.Variable);
    const type = decl(A, 4, 'Thing', Kind.TypeAlias);
    module(A, [value, type]);
    module(B, [decl(B, 2, 'Thing', Kind.Reference, { target: value.id })]);
    const index = indexApiModel(project());
    const entries = indexEntries(index, [entry([[A, 'Thing']]), entry([[B, 'Thing']], 'other')]);
    expect(entries.problems).toEqual([]);
    expect(entries.entries[0].symbols.map((s) => s.reflection.id)).toEqual([value.id, type.id]);
    expect(entries.byId.get(value.id)?.map((s) => s.entry)).toEqual(['aekasha', 'other']);
    expect(entries.byId.has(type.id)).toBe(true);
  });

  it('lists a name tagged @internal', () => {
    const { decl, module, project } = createModel();
    const hidden = decl(A, 2, 'hidden', Kind.Function, {
      signatures: [
        {
          ...decl(A, 2, 'hidden', Kind.CallSignature),
          comment: { summary: [], modifierTags: ['@internal'] },
        },
      ],
    });
    module(A, [hidden, decl(A, 3, 'shown', Kind.Variable)]);
    const entries = indexEntries(indexApiModel(project()), [
      entry([
        [A, 'hidden'],
        [A, 'shown'],
      ]),
    ]);
    expect(entries.internal.map((s) => s.name)).toEqual(['hidden']);
  });

  it('reports a name the model lacks', () => {
    const { module, project } = createModel();
    module(A, []);
    const entries = indexEntries(indexApiModel(project()), [entry([[A, 'missing']])]);
    expect(entries.problems).toEqual([
      {
        file: 'src/_engine/index.ts',
        message: 'aekasha: `missing` (src/_engine/a/A.ts) isn’t in the API model',
      },
    ]);
  });
});

describe('findLeakedTypes', () => {
  /** `getThing(opts: Opts): Thing`, `Opts` and `Hidden` internal, `Thing` public */
  const setup = () => {
    const model = createModel();
    const { decl, ref, module } = model;
    const thing = decl(A, 2, 'Thing', Kind.Interface);
    const hidden = decl(B, 8, 'Hidden', Kind.TypeAlias, {
      type: { type: 'intrinsic', name: 'number' },
    });
    const opts = decl(B, 3, 'Opts', Kind.Interface, {
      children: [decl(B, 4, 'size', Kind.Property, { type: ref(hidden.id, 'Hidden') })],
    });
    const parameter = {
      id: 900,
      name: 'opts',
      variant: 'param',
      kind: Kind.Parameter,
      flags: {},
      type: ref(opts.id, 'Opts'),
    };
    const getThing = decl(A, 5, 'getThing', Kind.Function, {
      signatures: [
        {
          ...decl(A, 6, 'getThing', Kind.CallSignature),
          parameters: [parameter],
          type: ref(thing.id, 'Thing'),
        },
      ],
    });
    module(A, [thing, getThing]);
    module(B, [opts, hidden]);
    const exports: [string, string][] = [
      [A, 'Thing'],
      [A, 'getThing'],
    ];
    return { ...model, thing, opts, hidden, getThing, exports };
  };

  const leakedNames = (model: ReturnType<typeof setup>, exports = model.exports) => {
    const index = indexApiModel(model.project());
    return findLeakedTypes(index, indexEntries(index, [entry(exports)]));
  };

  it('finds a type a public signature names, and the types it names in turn', () => {
    const model = setup();
    const leaks = leakedNames(model);
    expect(leaks.map((l) => [l.name, l.sourcePath, l.line])).toEqual([
      ['Opts', B, 3],
      ['Hidden', B, 8],
    ]);
    const [opts, hidden] = leaks;
    // At the nearest source: the signature's (the parameter has none of its own)
    expect(opts.namedBy).toEqual([
      { name: 'getThing', entry: 'aekasha', id: model.getThing.id, fileName: A, line: 6 },
    ]);
    // Through `Opts`, which is on no entry itself, at its property's line
    expect(hidden.namedBy).toEqual([{ name: 'Opts', id: model.opts.id, fileName: B, line: 4 }]);
  });

  it('finds nothing once the named types are on an entry', () => {
    const model = setup();
    expect(leakedNames(model, [...model.exports, [B, 'Opts'], [B, 'Hidden']])).toEqual([]);
  });

  it('skips private and inherited members, type parameters, links and other packages', () => {
    const { decl, ref, module, project } = createModel();
    const hidden = decl(B, 2, 'Hidden', Kind.Interface);
    const foreign = { packageName: 'three', packagePath: 'src/Three.d.ts', qualifiedName: 'Mesh' };
    const cls = decl(A, 3, 'Box', Kind.Class, {
      typeParameters: [
        { id: 901, name: 'T', variant: 'typeParam', kind: Kind.TypeParameter, flags: {} },
      ],
      comment: {
        summary: [{ kind: 'inline-tag', tag: '@link', text: 'Hidden', target: hidden.id }],
      },
      children: [
        decl(A, 4, 'secret', Kind.Property, {
          flags: { isPrivate: true },
          type: ref(hidden.id, 'Hidden'),
        }),
        decl(A, 5, 'base', Kind.Property, {
          inheritedFrom: ref(-1, 'Base.base'),
          type: ref(hidden.id, 'Hidden'),
        }),
        decl(A, 6, 'value', Kind.Property, {
          type: ref(901, 'T', { refersToTypeParameter: true }),
        }),
        decl(A, 7, 'mesh', Kind.Property, { type: ref(foreign, 'Mesh') }),
      ],
    });
    module(A, [cls]);
    module(B, [hidden]);
    const index = indexApiModel(project());
    expect(findLeakedTypes(index, indexEntries(index, [entry([[A, 'Box']])]))).toEqual([]);
  });

  it('finds a type the model has no reflection for, by its name', () => {
    const { decl, ref, module, project } = createModel();
    const target = { packageName: 'pkg', packagePath: B, qualifiedName: 'Unexported' };
    module(A, [decl(A, 2, 'Alias', Kind.TypeAlias, { type: ref(target, 'Unexported') })]);
    const index = indexApiModel(project());
    const leaks = findLeakedTypes(index, indexEntries(index, [entry([[A, 'Alias']])]));
    expect(leaks.map((l) => [l.key, l.name, l.namedBy[0].line])).toEqual([
      [`${B}#Unexported`, 'Unexported', 2],
    ]);
  });
});
