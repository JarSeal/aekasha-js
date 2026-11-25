import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostFxPassesLSData, PostFxSettingsLSData } from './_dbg__PostFXStore';

// The overrides in localStorage and the generated data are this test's
const store = vi.hoisted(() => ({
  data: {} as PostFxPassesLSData,
  settings: {} as PostFxSettingsLSData,
}));
vi.mock(import('./_dbg__PostFXStore'), () => ({
  LS_KEY: 'AEK_debugPostFx' as const,
  SETTINGS_LS_KEY: 'AEK_debugPostFxSettings' as const,
  readPassesLS: () => structuredClone(store.data),
  writePassesLSOrRemove: (data: PostFxPassesLSData) => {
    store.data = data;
  },
  readSettingsLS: () => structuredClone(store.settings),
  writeSettingsLSOrRemove: (data: PostFxSettingsLSData) => {
    store.settings = data;
  },
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () =>
    ({
      scenes: {
        largeWorld: {
          postFx: [{ id: 'ambientOcclusion' }],
          __sourcePath: 'src/app/scenes/largeWorld/largeWorld.scene.json',
        },
      },
      postFx: {
        ambientOcclusion: { __sourcePath: 'src/app/postFx/ambientOcclusion.postFx.json' },
      },
    }) as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import {
  POSTFX_ENABLED_SAVE_SOURCE_ID,
  POSTFX_SAVE_SOURCE_ID,
  registerPostFxEnabledSaveSource,
  registerPostFxSaveSource,
} from './_dbg__PostFXSave';

const FILE = {
  id: 'ambientOcclusion',
  params: { radius: 0.25, samples: 16, scale: 1 },
  __saveData: { largeWorld: [{ params: { scale: 2 }, __meta: {} }] },
};

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerPostFxSaveSource();
  return _getSaveSources().find((source) => source.id === POSTFX_SAVE_SOURCE_ID)!;
};

let removeEnabledSource: (() => void) | null = null;
const getEnabledSource = () => {
  removeEnabledSource ??= registerPostFxEnabledSaveSource();
  return _getSaveSources().find((source) => source.id === POSTFX_ENABLED_SAVE_SOURCE_ID)!;
};

afterEach(() => {
  removeSource?.();
  removeSource = null;
  removeEnabledSource?.();
  removeEnabledSource = null;
  store.data = {};
  store.settings = {};
});

describe('the PostFX passes’ save source (p355 §2.1)', () => {
  it('builds the entry: `enabled` replaced, `params` merged over the latest one’s by key', () => {
    store.data = {
      largeWorld: { ambientOcclusion: { params: { radius: 0.5, samples: 16 } } },
      gone: { ambientOcclusion: { enabled: false } },
    };
    const changes = getSource().collect();
    expect(changes.map(({ path, unsaveable }) => ({ path, unsaveable }))).toEqual([
      { path: 'src/app/postFx/ambientOcclusion.postFx.json', unsaveable: undefined },
      { path: null, unsaveable: 'scene not found' },
    ]);
    expect(changes[0].summary).toEqual(['params.radius', 'params.samples']);
    // samples is the file's 16: dropped; the latest entry's scale kept
    expect(changes[0].build({ json: structuredClone(FILE) })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: { params: { scale: 2, radius: 0.5 } } },
    });
  });

  it('a pass switched off is saved; `enabled` back to the default true is dropped', () => {
    store.data = { largeWorld: { ambientOcclusion: { enabled: false } } };
    const json = { id: 'ambientOcclusion', params: {} };
    expect(getSource().collect()[0].build({ json })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: { enabled: false } },
    });
    store.data = { largeWorld: { ambientOcclusion: { enabled: true } } };
    expect(getSource().collect()[0].build({ json })).toBeNull();
  });

  it('drops the saved passes’ overrides, the others kept', () => {
    store.data = {
      largeWorld: { ambientOcclusion: { params: { radius: 0.5 } } },
      gone: { ambientOcclusion: { enabled: false } },
    };
    const source = getSource();
    source.onSaved(source.collect().filter((change) => change.sceneId === 'largeWorld'));
    expect(store.data).toEqual({
      largeWorld: {},
      gone: { ambientOcclusion: { enabled: false } },
    });
  });
});

describe('the scenes’ PostFX switch’s save source (p355 §2.5)', () => {
  const SCENE = { id: 'largeWorld', sceneFile: 'scenes/largeWorld/largeWorld.ts' };

  it('saves a switch into the scene JSON’s own entry, over the latest one', () => {
    store.settings = { measureEnabled: true, postFxEnabled: { largeWorld: false, gone: true } };
    const changes = getEnabledSource().collect();
    expect(
      changes.map(({ label, path, unsaveable, summary }) => ({ label, path, unsaveable, summary }))
    ).toEqual([
      {
        label: 'PostFX switched off',
        path: 'src/app/scenes/largeWorld/largeWorld.scene.json',
        unsaveable: undefined,
        summary: ['postFxEnabled'],
      },
      {
        label: 'PostFX switched on',
        path: null,
        unsaveable: 'scene not found',
        summary: ['postFxEnabled'],
      },
    ]);
    const json = {
      ...SCENE,
      __saveData: { largeWorld: [{ backgroundColor: '#123456', __meta: {} }] },
    };
    expect(changes[0].build({ json })).toEqual({
      saveData: {
        sceneId: 'largeWorld',
        entry: { backgroundColor: '#123456', postFxEnabled: false },
      },
    });
  });

  it('a switch back to the file’s value (true by default) is dropped from the entry', () => {
    store.settings = { postFxEnabled: { largeWorld: true } };
    const [change] = getEnabledSource().collect();
    // The latest entry switched it off: the new one doesn't
    const json = {
      ...SCENE,
      __saveData: { largeWorld: [{ postFxEnabled: false, backgroundColor: '#123456' }] },
    };
    expect(change.build({ json })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: { backgroundColor: '#123456' } },
    });
    // An entry left empty replaces the latest one
    const onlySwitch = { ...SCENE, __saveData: { largeWorld: [{ postFxEnabled: false }] } };
    expect(change.build({ json: onlySwitch })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: {} },
    });
    // No entry to replace: nothing to write
    expect(change.build({ json: SCENE })).toBeNull();
    // The file's own false
    store.settings = { postFxEnabled: { largeWorld: false } };
    expect(
      getEnabledSource()
        .collect()[0]
        .build({ json: { ...SCENE, postFxEnabled: false } })
    ).toBeNull();
  });

  it('drops the saved scenes’ switches, the rest of the settings kept', () => {
    store.settings = { measureEnabled: true, postFxEnabled: { largeWorld: false, gone: true } };
    const source = getEnabledSource();
    source.onSaved(source.collect().filter((change) => change.sceneId === 'largeWorld'));
    expect(store.settings).toEqual({ measureEnabled: true, postFxEnabled: { gone: true } });
  });
});
