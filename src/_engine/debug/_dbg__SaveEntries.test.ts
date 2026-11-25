import { describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({
  scenes: {
    sceneA: {
      skyboxes: [{ id: 'sky' }, { id: 'inlineSky' }, { id: 'takenSky' }, { id: 'clashSky' }],
      postFx: [{ id: 'ao' }, { id: 'inlinePass' }],
      cameras: [{ camProps: { type: 'PERSPECTIVE', fov: 50, appId: 'cam' } }],
      // An inline light whose app id is only its entity's
      lights: [{ lightProps: { type: 'AMBIENT' }, entityOpts: { appId: 'inlineLight' } }],
      __sourcePath: 'src/app/scenes/sceneA/sceneA.scene.json',
      __inlineAssets: { skyboxes: ['inlineSky', 'takenSky', 'clashSky'], lights: ['inlineLight'] },
    },
    // Gathered before the scenes had their file
    sceneB: { skyboxes: [{ id: 'bSky' }], __inlineAssets: { skyboxes: ['bSky'] } },
  },
  skyboxes: {
    sky: { __sourcePath: 'src/app/skyboxes/sky.skybox.json' },
    unused: {},
    // Another file has an inline sky box's id, and another one is at a move's new path
    takenSky: { __sourcePath: 'src/app/skyboxes/takenSky.skybox.json' },
    other: { __sourcePath: 'src/app/scenes/sceneA/clashSky.skybox.json' },
  },
  postFx: { ao: { __sourcePath: 'src/app/postFx/ao.postFx.json' } },
  cameras: { cam: { __sourcePath: 'src/app/cameras/cam.camera.json' } },
  lights: {},
}));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () => data as never,
}));

import {
  findSceneAssetFile,
  findSceneFile,
  getChangedKeys,
  getLatestSaveEntry,
  getSceneListItem,
  pruneFlatSaveEntry,
  pruneSaveEntry,
  toChangeFileFields,
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

  it('drops only top-level values the file has, each compared whole', () => {
    const base = { fov: 45, position: { x: 0, y: 1, z: 0 }, shadowMapSize: [512, 512] };
    expect(
      pruneFlatSaveEntry(
        { fov: 45, position: { x: 0, y: 2, z: 0 }, shadowMapSize: [512, 512], near: 0.1 },
        base
      )
    ).toEqual({
      // Whole: the gather merges the entry flat, so a partial position would replace the file's
      position: { x: 0, y: 2, z: 0 },
      // A default the file doesn't set stays
      near: 0.1,
    });
    expect(pruneFlatSaveEntry({ fov: 45 }, base)).toEqual({});
    expect(pruneFlatSaveEntry({ fov: 45 }, undefined)).toEqual({ fov: 45 });
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
    expect(findSceneAssetFile(SKY, 'sceneA', 'unused')).toEqual({
      unsaveable: 'not in the scene JSON',
    });
    expect(findSceneAssetFile(SKY, 'gone', 'sky')).toEqual({ unsaveable: 'scene not found' });
    expect(findSceneAssetFile({ list: 'postFx', registry: 'postFx' }, 'sceneA', 'ao')).toEqual({
      path: 'src/app/postFx/ao.postFx.json',
    });
    // Only cameras, lights and sky boxes move into files of their own
    expect(
      findSceneAssetFile({ list: 'postFx', registry: 'postFx' }, 'sceneA', 'inlinePass')
    ).toEqual({ unsaveable: 'inline in the scene JSON: it has no file of its own' });
  });

  it('moves an inline asset into a file in the scene’s folder, unless taken (p355 §2.6)', () => {
    expect(findSceneAssetFile(SKY, 'sceneA', 'inlineSky')).toEqual({
      path: 'src/app/scenes/sceneA/inlineSky.skybox.json',
      extract: {
        scenePath: 'src/app/scenes/sceneA/sceneA.scene.json',
        list: 'skyboxes',
        id: 'inlineSky',
      },
    });
    expect(findSceneAssetFile(SKY, 'sceneA', 'takenSky')).toEqual({
      unsaveable: 'id taken by src/app/skyboxes/takenSky.skybox.json',
    });
    expect(findSceneAssetFile(SKY, 'sceneA', 'clashSky')).toEqual({
      unsaveable: 'new file taken: src/app/scenes/sceneA/clashSky.skybox.json is "other"\'s',
    });
    expect(findSceneAssetFile(SKY, 'sceneB', 'bSky')).toEqual({
      unsaveable: 'the scene JSON has no file path',
    });
  });

  it('gives a change its file fields', () => {
    expect(toChangeFileFields({ unsaveable: 'made in code' })).toEqual({
      path: null,
      unsaveable: 'made in code',
    });
    expect(toChangeFileFields({ path: 'a.json' })).toEqual({ path: 'a.json' });
    const extract = { scenePath: 's.scene.json', list: 'lights', id: 'l' };
    expect(toChangeFileFields({ path: 'l.light.json', extract })).toEqual({
      path: 'l.light.json',
      extract,
    });
  });

  it('finds a camera or light by its app id: its props’, else its entity’s', () => {
    expect(findSceneAssetFile({ list: 'cameras', registry: 'cameras' }, 'sceneA', 'cam')).toEqual({
      path: 'src/app/cameras/cam.camera.json',
    });
    expect(
      findSceneAssetFile({ list: 'lights', registry: 'lights' }, 'sceneA', 'inlineLight')
    ).toMatchObject({
      path: 'src/app/scenes/sceneA/inlineLight.light.json',
      extract: { list: 'lights', id: 'inlineLight' },
    });
    expect(findSceneAssetFile({ list: 'lights', registry: 'lights' }, 'sceneA', 'code')).toEqual({
      unsaveable: 'not in the scene JSON',
    });
    expect(getSceneListItem('cameras', 'sceneA', 'cam')).toEqual({
      camProps: { type: 'PERSPECTIVE', fov: 50, appId: 'cam' },
    });
    expect(getSceneListItem('cameras', 'gone', 'cam')).toBeUndefined();
  });

  it('finds a scene’s own file, or says why there’s none (p355 §2.5)', () => {
    expect(findSceneFile('sceneA')).toEqual({ path: 'src/app/scenes/sceneA/sceneA.scene.json' });
    expect(findSceneFile('sceneB')).toEqual({ unsaveable: 'the scene JSON has no file path' });
    expect(findSceneFile('gone')).toEqual({ unsaveable: 'scene not found' });
  });
});
