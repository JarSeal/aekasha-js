import { describe, expect, it } from 'vitest';
import {
  type ApiBaseline,
  diffApi,
  diffDocs,
  type DocsBaseline,
  type FolderDocs,
} from './baselinesDiff';

// p619 D14: `yarn verify:baselines`' API and docs diffs on small baselines

const api = (modules: ApiBaseline['modules'], entries?: ApiBaseline['entries']): ApiBaseline => ({
  formatVersion: 1,
  modules,
  ...(entries ? { entries } : {}),
});

const lines = (findings: { line: string; attention: boolean }[]) =>
  findings.map((f) => `${f.attention ? '!' : '·'} ${f.line}`);

describe('diffApi', () => {
  it('finds nothing in the same API', () => {
    const same = api({ 'a.ts': { f: 'Function' } }, { aekasha: ['f'] });
    expect(diffApi(same, same)).toEqual([]);
  });

  it('reads the same name and kind gone from one module and new in another as a move', () => {
    expect(
      lines(
        diffApi(
          api({ 'a.ts': { f: 'Function', g: 'Function' } }),
          api({ 'b.ts': { f: 'Function' } })
        )
      )
    ).toEqual(['! moved f (Function): a.ts → b.ts', '! removed g (Function) from a.ts']);
  });

  it('flags an added export and a changed kind', () => {
    expect(
      lines(
        diffApi(
          api({ 'a.ts': { T: 'TypeAlias' } }),
          api({ 'a.ts': { T: 'Interface', h: 'Variable' } })
        )
      )
    ).toEqual(['! added h (Variable) in a.ts', '! T in a.ts: TypeAlias → Interface']);
  });

  it("flags each entry's added and removed names, a new entry and a gone one", () => {
    const before = api({}, { aekasha: ['a', 'b'], 'aekasha/old': ['x'] });
    const after = api({}, { aekasha: ['a', 'c'], 'aekasha/new': ['y', 'z'] });
    expect(lines(diffApi(before, after))).toEqual([
      '! aekasha exports c',
      '! aekasha no longer exports b',
      '! new entry aekasha/new: 2 exports',
      '! gone: entry aekasha/old',
    ]);
  });
});

const folder = (exports: string[], documented: number, total: number): FolderDocs => ({
  exports: { documented, total },
  members: { documented: 0, total: 0 },
  undocumented: { exports, members: [] },
});

const docs = (folders: Record<string, FolderDocs>): DocsBaseline => ({
  formatVersion: 2,
  total: { exports: { documented: 0, total: 0 }, members: { documented: 0, total: 0 } },
  subtrees: {},
  folders,
});

describe('diffDocs', () => {
  const locations = new Map([['engine/x/A#b', 'src/_engine/x/A.ts:3']]);
  const diff = diffDocs(locations);

  it('flags a folder whose undocumented count grew, naming each new one with its line', () => {
    expect(
      lines(
        diff(
          docs({ 'engine/x': folder(['A#a'], 4, 5) }),
          docs({ 'engine/x': folder(['A#a', 'A#b'], 4, 6) })
        )
      )
    ).toEqual(['! engine/x: 1 → 2 undocumented exports\n      src/_engine/x/A.ts:3 A#b']);
  });

  it('starts a new folder at none', () => {
    expect(lines(diff(docs({}), docs({ 'engine/y': folder(['B#c'], 0, 1) })))).toEqual([
      '! engine/y: 0 → 1 undocumented exports (a new folder starts at none)\n      ? B#c',
    ]);
  });

  it('reports better coverage, deleted documented code and a swap without failing', () => {
    expect(
      lines(
        diff(docs({ 'engine/x': folder(['A#a'], 4, 5) }), docs({ 'engine/x': folder([], 5, 5) }))
      )
    ).toEqual(['· engine/x exports: 4 / 5 (80 %) → 5 / 5 (100 %) documented']);
    expect(
      lines(
        diff(
          docs({ 'engine/x': folder(['A#a'], 4, 5) }),
          docs({ 'engine/x': folder(['A#a'], 1, 2) })
        )
      )
    ).toEqual([
      '· engine/x exports: 4 / 5 (80 %) → 1 / 2 (50 %) documented (a lower share, no more undocumented)',
    ]);
    expect(
      lines(
        diff(
          docs({ 'engine/x': folder(['A#a'], 4, 5) }),
          docs({ 'engine/x': folder(['A#b'], 4, 5) })
        )
      )
    ).toEqual([
      '· engine/x: newly undocumented exports, as many fewer elsewhere\n      src/_engine/x/A.ts:3 A#b',
    ]);
  });

  it('reports a gone folder', () => {
    expect(lines(diff(docs({ 'engine/x': folder([], 1, 1) }), docs({})))).toEqual([
      '· engine/x: gone',
    ]);
  });

  it('counts a name listed twice (a value and a type of one name) twice', () => {
    expect(
      diff(
        docs({ 'engine/x': folder(['A#a'], 0, 1) }),
        docs({ 'engine/x': folder(['A#a', 'A#a'], 0, 2) })
      )[0].attention
    ).toBe(true);
  });
});
