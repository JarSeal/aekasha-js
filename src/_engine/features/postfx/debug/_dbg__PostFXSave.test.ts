import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostFxPassesLSData } from './_dbg__PostFXStore';

// The overrides in localStorage and the generated data are this test's
const store = vi.hoisted(() => ({ data: {} as PostFxPassesLSData }));
vi.mock(import('./_dbg__PostFXStore'), () => ({
  LS_KEY: 'AEK_debugPostFx' as const,
  readPassesLS: () => structuredClone(store.data),
  writePassesLSOrRemove: (data: PostFxPassesLSData) => {
    store.data = data;
  },
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () =>
    ({
      scenes: { largeWorld: { postFx: [{ id: 'ambientOcclusion' }] } },
      postFx: {
        ambientOcclusion: { __sourcePath: 'src/app/postFx/ambientOcclusion.postFx.json' },
      },
    }) as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import { POSTFX_SAVE_SOURCE_ID, registerPostFxSaveSource } from './_dbg__PostFXSave';

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

afterEach(() => {
  removeSource?.();
  removeSource = null;
  store.data = {};
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
