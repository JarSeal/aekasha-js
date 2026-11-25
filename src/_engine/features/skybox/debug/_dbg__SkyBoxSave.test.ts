import { afterEach, describe, expect, it, vi } from 'vitest';

// The overrides in localStorage and the generated data are this test's
const store = vi.hoisted(() => ({
  overrides: {} as Record<string, Record<string, Record<string, unknown>>>,
}));
vi.mock(import('./_dbg__SkyBoxShared'), () => ({
  getAllSkyBoxOverrides: () => structuredClone(store.overrides) as never,
  setSkyBoxOverrides: (sceneId: string, skyBoxId: string, overrides: unknown) => {
    if (overrides === undefined) delete store.overrides[sceneId]?.[skyBoxId];
  },
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () =>
    ({
      scenes: {
        sceneA: {
          skyboxes: [{ id: 'dayNight' }, { id: 'inline' }],
          __sourcePath: 'src/app/scenes/sceneA/sceneA.scene.json',
          __inlineAssets: { skyboxes: ['inline'] },
        },
      },
      skyboxes: { dayNight: { __sourcePath: 'src/app/skyboxes/dayNight.skybox.json' } },
    }) as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import { registerSkyBoxSaveSource, SKYBOX_SAVE_SOURCE_ID } from './_dbg__SkyBoxSave';

const FILE = {
  id: 'dayNight',
  base: { type: 'COLOR', color: '#000000' },
  atmosphere: { turbidity: 2, rayleigh: 1 },
  suns: [{ elevation: 30 }, { elevation: 10 }],
  __saveData: {
    sceneA: [{ atmosphere: { rayleigh: 2 }, suns: { 1: { elevation: 12 } }, __meta: {} }],
  },
};

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerSkyBoxSaveSource();
  return _getSaveSources().find((source) => source.id === SKYBOX_SAVE_SOURCE_ID)!;
};

afterEach(() => {
  removeSource?.();
  removeSource = null;
  store.overrides = {};
});

describe('the sky boxes’ save source (p355 §2.1)', () => {
  it('lists each scene’s overridden sky box with its file, or why it has none', () => {
    store.overrides = {
      sceneA: { dayNight: { atmosphere: { turbidity: 4 } }, inline: { env: { size: 512 } } },
      sceneB: { dayNight: { stars: { density: 2 } } },
    };
    const changes = getSource().collect();
    expect(
      changes.map(({ id, path, unsaveable, extract, summary }) => ({
        id,
        path,
        unsaveable,
        extract,
        summary,
      }))
    ).toEqual([
      {
        id: 'sceneA:dayNight',
        path: 'src/app/skyboxes/dayNight.skybox.json',
        unsaveable: undefined,
        extract: undefined,
        summary: ['atmosphere.turbidity'],
      },
      {
        // Inline: its save moves it into a file of its own (p355 §2.6)
        id: 'sceneA:inline',
        path: 'src/app/scenes/sceneA/inline.skybox.json',
        unsaveable: undefined,
        extract: {
          scenePath: 'src/app/scenes/sceneA/sceneA.scene.json',
          list: 'skyboxes',
          id: 'inline',
        },
        summary: ['env.size'],
      },
      {
        id: 'sceneB:dayNight',
        path: null,
        unsaveable: 'scene not found',
        extract: undefined,
        summary: ['stars.density'],
      },
    ]);
  });

  it('builds the entry from the latest one with the overrides deep-merged, the file’s values dropped', () => {
    store.overrides = {
      sceneA: {
        dayNight: {
          atmosphere: { turbidity: 4, rayleigh: 1 },
          suns: { 0: { elevation: 45 } },
        },
      },
    };
    const [change] = getSource().collect();
    expect(change.build({ json: structuredClone(FILE) })).toEqual({
      saveData: {
        sceneId: 'sceneA',
        // rayleigh back to the file's 1: dropped; the latest entry's second sun kept
        entry: {
          atmosphere: { turbidity: 4 },
          suns: { 0: { elevation: 45 }, 1: { elevation: 12 } },
        },
      },
    });
  });

  it('a whole list replaces the latest entry’s; back to the file’s values is an empty entry', () => {
    store.overrides = { sceneA: { dayNight: { suns: [{ elevation: 5 }] } } };
    const [change] = getSource().collect();
    expect(change.build({ json: structuredClone(FILE) })).toEqual({
      saveData: {
        sceneId: 'sceneA',
        entry: { atmosphere: { rayleigh: 2 }, suns: [{ elevation: 5 }] },
      },
    });
    store.overrides = {
      sceneA: { dayNight: { atmosphere: { rayleigh: 1 }, suns: { 1: { elevation: 10 } } } },
    };
    expect(
      getSource()
        .collect()[0]
        .build({ json: structuredClone(FILE) })
    ).toEqual({
      saveData: { sceneId: 'sceneA', entry: {} },
    });
  });

  it('builds an inline sky box’s entry over the item as the scene JSON has it (p355 §2.6)', () => {
    store.overrides = { sceneA: { inline: { env: { environmentIntensity: 0.3, size: 512 } } } };
    const change = getSource()
      .collect()
      .find(({ id }) => id === 'sceneA:inline')!;
    const item = { id: 'inline', base: { type: 'COLOR', color: '#000000' }, env: { size: 512 } };
    expect(change.build({ json: item })).toEqual({
      saveData: { sceneId: 'sceneA', entry: { env: { environmentIntensity: 0.3 } } },
    });
  });

  it('drops the saved sky boxes’ overrides, the others kept', () => {
    store.overrides = {
      sceneA: { dayNight: { atmosphere: { turbidity: 4 } } },
      sceneB: { dayNight: { stars: { density: 2 } } },
    };
    const source = getSource();
    source.onSaved(source.collect().filter((change) => change.sceneId === 'sceneA'));
    expect(store.overrides).toEqual({
      sceneA: {},
      sceneB: { dayNight: { stars: { density: 2 } } },
    });
  });
});
