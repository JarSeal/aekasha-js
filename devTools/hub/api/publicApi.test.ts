import { describe, expect, it } from 'vitest';
import { indexEntries } from './entries';
import type { ApiEntry } from './extract';
import { getApiLinks } from './links';
import { indexApiModel, Kind } from './model';
import { buildPublicApi } from './publicApi';
import { createModel } from './testModel';

const SCENE = 'src/_engine/kernel/scene/Scene.ts';
const RANDOM = 'src/_engine/utils/Random.ts';
const PHYSICS = 'src/_engine/features/physics/Physics.ts';
const ROCK = 'src/toolkit/geometry/Rock.ts';

const entry = (name: string, file: string, exports: [string, string][]): ApiEntry => ({
  entry: name as ApiEntry['entry'],
  file,
  exports: exports.map(([sourcePath, imported]) => ({ name: imported, imported, sourcePath })),
});

/**
 * `aekasha` (two folders), `aekasha/physics`, and `aekasha/toolkit/geometry`, which re-exports
 * `aekasha`'s `createSeededRandom`; `internalHelper` is on no entry
 */
const setup = (maxEntryPageNames?: number) => {
  const { decl, module, project } = createModel();
  const summary = { summary: [{ kind: 'text', text: 'Loads a scene.' }] };
  const parameter = { id: 900, name: 'id', variant: 'param', kind: Kind.Parameter, flags: {} };
  const loadScene = decl(SCENE, 3, 'loadScene', Kind.Function, {
    signatures: [
      {
        ...decl(SCENE, 3, 'loadScene', Kind.CallSignature),
        comment: summary,
        parameters: [parameter],
      },
    ],
  });
  const idMember = decl(SCENE, 9, 'id', Kind.Property);
  const sceneData = decl(SCENE, 8, 'SceneData', Kind.Interface, { children: [idMember] });
  const internalHelper = decl(SCENE, 12, 'internalHelper', Kind.Function);
  const random = decl(RANDOM, 2, 'createSeededRandom', Kind.Function);
  module(SCENE, [loadScene, sceneData, internalHelper]);
  module(RANDOM, [random]);
  module(PHYSICS, [decl(PHYSICS, 2, 'createBody', Kind.Function)]);
  module(ROCK, [decl(ROCK, 2, 'makeRock', Kind.Function)]);
  const index = indexApiModel(project());
  const entries = indexEntries(index, [
    entry('aekasha', 'src/_engine/index.ts', [
      [SCENE, 'loadScene'],
      [SCENE, 'SceneData'],
      [RANDOM, 'createSeededRandom'],
    ]),
    entry('aekasha/physics', 'src/_engine/features/physics/index.ts', [[PHYSICS, 'createBody']]),
    entry('aekasha/toolkit/geometry', 'src/toolkit/geometry/index.ts', [
      [ROCK, 'makeRock'],
      [RANDOM, 'createSeededRandom'],
    ]),
  ]);
  const api = buildPublicApi(entries, maxEntryPageNames);
  return { index, api, loadScene, idMember, internalHelper, random, parameter };
};

describe('buildPublicApi', () => {
  it('gives each entry a page at its specifier, and a group page for the toolkit', () => {
    const { api } = setup();
    expect(api.problems).toEqual([]);
    expect(api.pages.map((page) => [page.pagePath, page.kind])).toEqual([
      ['documentation/aekasha/', 'entry'],
      ['documentation/aekasha/physics/', 'entry'],
      ['documentation/aekasha/toolkit/', 'group'],
      ['documentation/aekasha/toolkit/geometry/', 'entry'],
    ]);
    expect(api.pages[2].children.map((page) => page.title)).toEqual(['aekasha/toolkit/geometry']);
    expect(api.roots.engine.map((page) => page.title)).toEqual(['aekasha', 'aekasha/physics']);
    expect(api.roots.toolkit.map((page) => page.title)).toEqual(['aekasha/toolkit/geometry']);
  });

  it('documents a name on its first entry; a second entry lists it as a re-export', () => {
    const { api, random, idMember, internalHelper } = setup();
    const home = { pagePath: 'documentation/aekasha/', anchor: 'createSeededRandom' };
    expect(api.targets.get(random.id)).toEqual(home);
    expect(api.targets.get(idMember.id)).toEqual({
      pagePath: 'documentation/aekasha/',
      anchor: 'SceneData.id',
    });
    expect(api.targets.has(internalHelper.id)).toBe(false);
    const listed = api.symbols.filter((symbol) => symbol.reflection.id === random.id);
    expect(listed.map((s) => [s.entry, s.isReexport, s.target])).toEqual([
      ['aekasha', false, home],
      ['aekasha/toolkit/geometry', true, home],
    ]);
    // The re-export doesn't count twice
    expect(api.coverage).toEqual({ documented: 1, total: 5 });
  });

  it('sections by module, functions before interfaces', () => {
    const { api } = setup();
    const [first, second] = api.pages[0].sections;
    expect(first.module.sourcePath).toBe(SCENE);
    expect(first.symbols.map((s) => s.name)).toEqual(['loadScene', 'SceneData']);
    expect(second.module.sourcePath).toBe(RANDOM);
  });

  it('splits an entry over the limit into a page per source folder', () => {
    const { api, loadScene, random } = setup(2);
    const aekasha = api.pages[0];
    expect(aekasha.sections).toEqual([]);
    expect(aekasha.children.map((page) => [page.pagePath, page.menu, page.sourcePath])).toEqual([
      ['documentation/aekasha/scene/', 'scene/', 'src/_engine/kernel/scene'],
      ['documentation/aekasha/utils/', 'utils/', 'src/_engine/utils'],
    ]);
    expect(api.targets.get(loadScene.id)?.pagePath).toBe('documentation/aekasha/scene/');
    expect(api.targets.get(random.id)?.pagePath).toBe('documentation/aekasha/utils/');
    expect(aekasha.coverage).toEqual({ documented: 1, total: 3 });
  });
});

describe('getApiLinks on the public API', () => {
  it('resolves a public name, and fails an internal one saying so', () => {
    const { index, api } = setup();
    const links = getApiLinks(index, api);
    expect(links.resolveName('loadScene')).toEqual({
      isOk: true,
      target: { pagePath: 'documentation/aekasha/', anchor: 'loadScene' },
    });
    expect(links.resolveName('createSeededRandom')).toMatchObject({
      isOk: true,
      target: { pagePath: 'documentation/aekasha/' },
    });
    const internal = links.resolveName('internalHelper');
    expect(internal.isOk).toBe(false);
    expect(!internal.isOk && internal.message).toBe(
      `api:internalHelper is internal (${SCENE}): it's on no entry, so it has no page`
    );
  });

  it("links a reflection to its nearest public owner's anchor, an internal one nowhere", () => {
    const { index, api, parameter, internalHelper } = setup();
    const links = getApiLinks(index, api);
    expect(links.resolveId(parameter.id)?.anchor).toBe('loadScene');
    expect(links.resolveId(internalHelper.id)).toBeUndefined();
  });
});
