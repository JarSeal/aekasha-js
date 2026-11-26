import { afterEach, describe, expect, it, vi } from 'vitest';

// The overrides in localStorage and the generated data are this test's
const store = vi.hoisted(() => ({
  overrides: {} as Record<string, Record<string, Record<string, unknown>>>,
}));
vi.mock(import('./_dbg__FogEdits'), () => ({
  getAllFogOverrides: () => structuredClone(store.overrides) as never,
  setFogOverrides: (sceneId: string, fogId: string, overrides: unknown) => {
    if (overrides === undefined) delete store.overrides[sceneId]?.[fogId];
  },
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () =>
    ({
      scenes: {
        sceneA: {
          fogs: [{ id: 'valley' }, { id: 'inline' }],
          __sourcePath: 'src/app/scenes/sceneA/sceneA.scene.json',
          __inlineAssets: { fogs: ['inline'] },
        },
      },
      fogs: { valley: { __sourcePath: 'src/app/fogs/valley.fog.json' } },
    }) as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import { FOG_SAVE_SOURCE_ID, registerFogSaveSource } from './_dbg__FogSave';

const FILE = {
  id: 'valley',
  mode: 'HEIGHT',
  height: { density: 0.03, falloff: 0.2 },
  __saveData: { sceneA: [{ height: { falloff: 0.3 }, colorSource: 'MANUAL', __meta: {} }] },
};

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerFogSaveSource();
  return _getSaveSources().find((source) => source.id === FOG_SAVE_SOURCE_ID)!;
};

afterEach(() => {
  removeSource?.();
  removeSource = null;
  store.overrides = {};
});

describe('the fogs’ save source (p106 D8)', () => {
  it('lists each scene’s overridden fog with its file, or why it has none', () => {
    store.overrides = {
      sceneA: { valley: { height: { density: 0.05 } }, inline: { mode: 'EXP2' } },
      sceneB: { valley: { background: 'FOG_COLOR' } },
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
        id: 'sceneA:valley',
        path: 'src/app/fogs/valley.fog.json',
        unsaveable: undefined,
        extract: undefined,
        summary: ['height.density'],
      },
      {
        // Inline: its save moves it into a file of its own (p355 §2.6)
        id: 'sceneA:inline',
        path: 'src/app/scenes/sceneA/inline.fog.json',
        unsaveable: undefined,
        extract: {
          scenePath: 'src/app/scenes/sceneA/sceneA.scene.json',
          list: 'fogs',
          id: 'inline',
        },
        summary: ['mode'],
      },
      {
        id: 'sceneB:valley',
        path: null,
        unsaveable: 'scene not found',
        extract: undefined,
        summary: ['background'],
      },
    ]);
  });

  it('builds the entry from the latest one with the overrides deep-merged, the file’s values dropped', () => {
    store.overrides = { sceneA: { valley: { height: { density: 0.03, maxOpacity: 0.8 } } } };
    const [change] = getSource().collect();
    expect(change.build({ json: structuredClone(FILE) })).toEqual({
      saveData: {
        sceneId: 'sceneA',
        // density back to the file's 0.03: dropped; the latest entry's values kept
        entry: { height: { falloff: 0.3, maxOpacity: 0.8 }, colorSource: 'MANUAL' },
      },
    });
  });

  it('writes an empty entry over the latest when the overrides are the file’s values', () => {
    store.overrides = { sceneA: { valley: { height: { falloff: 0.2 }, colorSource: 'SKY' } } };
    const [change] = getSource().collect();
    // `SKY` is the default the file doesn't set: it stays, as a sky box's does
    expect(change.build({ json: structuredClone(FILE) })).toEqual({
      saveData: { sceneId: 'sceneA', entry: { colorSource: 'SKY' } },
    });
  });

  it('builds an inline fog’s entry over the item as the scene JSON has it (p355 §2.6)', () => {
    store.overrides = { sceneA: { inline: { mode: 'EXP2', exp2: { density: 0.01 } } } };
    const change = getSource()
      .collect()
      .find(({ id }) => id === 'sceneA:inline')!;
    const item = { id: 'inline', mode: 'LINEAR', exp2: { density: 0.01 } };
    expect(change.build({ json: item })).toEqual({
      saveData: { sceneId: 'sceneA', entry: { mode: 'EXP2' } },
    });
  });

  it('drops the saved fogs’ overrides, the others kept', () => {
    store.overrides = {
      sceneA: { valley: { height: { density: 0.05 } } },
      sceneB: { valley: { background: 'FOG_COLOR' } },
    };
    const source = getSource();
    source.onSaved(source.collect().filter((change) => change.sceneId === 'sceneA'));
    expect(store.overrides).toEqual({
      sceneA: {},
      sceneB: { valley: { background: 'FOG_COLOR' } },
    });
  });
});
