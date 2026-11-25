import { describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({
  scenes: {
    sceneA: { skyboxes: [{ id: 'sky' }, { id: 'inlineSky' }], postFx: [{ id: 'ao' }] },
  },
  skyboxes: { sky: { __sourcePath: 'src/app/skyboxes/sky.skybox.json' }, unused: {} },
  postFx: { ao: { __sourcePath: 'src/app/postFx/ao.postFx.json' } },
}));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () => data as never,
}));

import {
  findSceneAssetFile,
  getChangedKeys,
  getLatestSaveEntry,
  pruneSaveEntry,
  toSaveEntryWrite,
} from './_dbg__SaveEntries';

const SKY = { list: 'skyboxes', registry: 'skyboxes' } as const;

describe('save entries (p355 §2.1)', () => {
  it('reads a scene’s latest entry without its stamp', () => {
    const json = {
      __saveData: { sceneA: [{ a: 1, __meta: { date: 'd' } }, { a: 0 }] },
    };
    expect(getLatestSaveEntry(json, 'sceneA')).toEqual({ a: 1 });
    expect(getLatestSaveEntry(json, 'sceneB')).toBeUndefined();
    expect(getLatestSaveEntry({}, 'sceneA')).toBeUndefined();
  });

  it('drops the values the file has, deep, a list by index or whole', () => {
    const base = {
      atmosphere: { turbidity: 2, rayleigh: 1 },
      suns: [{ elevation: 30, size: 1 }],
      moons: [{ phase: 0.5 }],
    };
    const entry = {
      atmosphere: { turbidity: 2, rayleigh: 3 },
      suns: { 0: { elevation: 30, size: 2 } },
      moons: [{ phase: 0.5 }],
      env: { size: 256 },
    };
    expect(pruneSaveEntry(entry, base)).toEqual({
      atmosphere: { rayleigh: 3 },
      suns: { 0: { size: 2 } },
      // A default the file doesn't set stays
      env: { size: 256 },
    });
    expect(pruneSaveEntry({ atmosphere: { turbidity: 2 } }, base)).toEqual({});
  });

  it('keeps an object the file doesn’t have, empty too: its key turns a layer on', () => {
    expect(pruneSaveEntry({ clouds: {} }, {})).toEqual({ clouds: {} });
    expect(pruneSaveEntry({ clouds: { coverage: 0.5 } }, { clouds: { coverage: 0.5 } })).toEqual(
      {}
    );
  });

  it('lists the changed keys, a list as one', () => {
    expect(
      getChangedKeys({ atmosphere: { turbidity: 2 }, suns: { 0: { size: 1 } }, moons: [1] })
    ).toEqual(['atmosphere.turbidity', 'suns.0.size', 'moons']);
  });

  it('writes an empty entry only over one the scene has', () => {
    expect(toSaveEntryWrite({}, 'sceneA', {})).toBeNull();
    const json = { __saveData: { sceneA: [{ a: 1 }] } };
    expect(toSaveEntryWrite(json, 'sceneA', {})).toEqual({
      saveData: { sceneId: 'sceneA', entry: {} },
    });
    expect(toSaveEntryWrite({}, 'sceneA', { a: 2 })).toEqual({
      saveData: { sceneId: 'sceneA', entry: { a: 2 } },
    });
  });

  it('finds the file of a scene’s asset, or says why there’s none', () => {
    expect(findSceneAssetFile(SKY, 'sceneA', 'sky')).toEqual({
      path: 'src/app/skyboxes/sky.skybox.json',
    });
    expect(findSceneAssetFile(SKY, 'sceneA', 'inlineSky')).toEqual({
      unsaveable: 'inline in the scene JSON: it has no file of its own',
    });
    expect(findSceneAssetFile(SKY, 'sceneA', 'unused')).toEqual({
      unsaveable: 'not in the scene JSON',
    });
    expect(findSceneAssetFile(SKY, 'gone', 'sky')).toEqual({ unsaveable: 'scene not found' });
    expect(findSceneAssetFile({ list: 'postFx', registry: 'postFx' }, 'sceneA', 'ao')).toEqual({
      path: 'src/app/postFx/ao.postFx.json',
    });
  });
});
