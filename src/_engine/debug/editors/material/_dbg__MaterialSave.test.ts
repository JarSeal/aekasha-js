import { afterEach, describe, expect, it, vi } from 'vitest';

// The records in LocalStorage, the generated data and the current scene are this test's
const store = vi.hoisted(() => ({ data: {} as Record<string, unknown>, sceneId: 'sceneA' }));
vi.mock(import('../../../utils/LocalAndSessionStorage'), async (importOriginal) => ({
  ...(await importOriginal()),
  lsGetItem: (key: string, defaultValue?: unknown) =>
    structuredClone(store.data[key] ?? defaultValue) as never,
  lsSetItem: (key: string, value: unknown) => {
    store.data[key] = structuredClone(value);
  },
  lsRemoveItem: (key: string) => {
    delete store.data[key];
  },
  lsGetKeysWithPrefix: (prefix: string) =>
    Object.keys(store.data).filter((key) => key.startsWith(prefix)),
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => store.sceneId,
  getGeneratedAppData: () =>
    ({
      scenes: {
        sceneA: {
          materials: [
            { id: 'glow', type: 'STANDARDNODEMATERIAL', inputs: { strength: 2 } },
            { id: 'grid', type: 'STANDARDNODEMATERIAL', nodes: { colorNode: {} } },
          ],
        },
        sceneB: { materials: [] },
      },
      materials: {
        glow: { id: 'glow', __sourcePath: 'src/app/materials/glow.material.json' },
        grid: { id: 'grid', __sourcePath: 'src/app/materials/grid.material.json' },
        rock: { id: 'rock', __sourcePath: 'src/app/materials/rock.material.json' },
      },
    }) as never,
}));

import { _getSaveSources } from '../../SaveData';
import {
  MATERIAL_SAVE_SOURCE_ID,
  mergeMaterialEntry,
  pruneMaterialEntry,
  registerMaterialSaveSource,
} from './_dbg__MaterialSave';

const RECORD = 'AEK_debugMatEditorMat_';

const GLOW_FILE = {
  id: 'glow',
  type: 'STANDARDNODEMATERIAL',
  tslFile: 'glow.tsl.ts',
  inputs: { color: '#ff0000', strength: 1, offset: { x: 0, y: 0, z: 0 } },
  params: { roughness: 0.5 },
  __saveData: { sceneA: [{ inputs: { strength: 2 }, __meta: { date: 'x' } }] },
};

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerMaterialSaveSource();
  return _getSaveSources().find((source) => source.id === MATERIAL_SAVE_SOURCE_ID)!;
};

afterEach(() => {
  removeSource?.();
  removeSource = null;
  store.data = {};
  store.sceneId = 'sceneA';
});

describe('mergeMaterialEntry and pruneMaterialEntry', () => {
  it('merges `params` and `inputs` by key and `nodes` by socket, values whole', () => {
    const latest = {
      params: { roughness: 0.2 },
      nodes: { colorNode: { scale: 2, tint: '#ffffff' }, emissiveNode: { glow: 1 } },
      side: 'DOUBLE',
    };
    expect(
      mergeMaterialEntry(latest, {
        params: { metalness: 1 },
        nodes: { colorNode: { scale: { x: 1, y: 2 } } },
        inputs: { glow: 0.5 },
      })
    ).toEqual({
      params: { roughness: 0.2, metalness: 1 },
      nodes: { colorNode: { scale: { x: 1, y: 2 }, tint: '#ffffff' }, emissiveNode: { glow: 1 } },
      inputs: { glow: 0.5 },
      side: 'DOUBLE',
    });
  });

  it('drops a value the file has, comparing a vector whole, and an emptied group', () => {
    const file = {
      params: { roughness: 0.5 },
      inputs: { offset: { x: 0, y: 0, z: 0 } },
      nodes: { colorNode: { scale: 1 } },
      side: 'FRONT',
    };
    expect(
      pruneMaterialEntry(
        {
          params: { roughness: 0.5 },
          // y differs: the vector stays whole
          inputs: { offset: { x: 0, y: 1, z: 0 } },
          nodes: { colorNode: { scale: 1 } },
          side: 'FRONT',
          transparent: true,
        },
        file
      )
    ).toEqual({ inputs: { offset: { x: 0, y: 1, z: 0 } }, transparent: true });
  });
});

describe('the material editor’s save source (p355 Phase 6)', () => {
  it('lists each edited material as a change of the current scene', () => {
    store.data = {
      [`${RECORD}glow`]: { overrides: { inputs: { color: '#00ff00' } }, settings: { x: 1 } },
      [`${RECORD}grid`]: { overrides: { nodes: { colorNode: { scale: 3 } } } },
      [`${RECORD}rock`]: { overrides: { params: { roughness: 1 } } },
      [`${RECORD}gone`]: { overrides: { params: { roughness: 1 } } },
      // Only its camera: no change
      [`${RECORD}camOnly`]: { camera: { fov: 40 } },
    };
    const changes = getSource().collect();
    expect(
      changes.map(({ label, sceneId, path, unsaveable, summary }) => ({
        label,
        sceneId,
        path,
        unsaveable,
        summary,
      }))
    ).toEqual([
      {
        label: 'Material "glow"',
        sceneId: 'sceneA',
        path: 'src/app/materials/glow.material.json',
        unsaveable: undefined,
        summary: ['inputs.color'],
      },
      {
        label: 'Material "grid"',
        sceneId: 'sceneA',
        path: 'src/app/materials/grid.material.json',
        unsaveable: undefined,
        summary: ['nodes.colorNode.scale'],
      },
      {
        label: 'Material "rock"',
        sceneId: 'sceneA',
        path: null,
        unsaveable: 'not in this scene',
        summary: ['params.roughness'],
      },
      {
        label: 'Material "gone"',
        sceneId: 'sceneA',
        path: null,
        unsaveable: 'material not found',
        summary: ['params.roughness'],
      },
    ]);
  });

  it('builds the entry over the latest one, the file’s values dropped', () => {
    store.data = {
      [`${RECORD}glow`]: {
        overrides: { inputs: { color: '#00ff00', offset: { x: 0, y: 1, z: 0 } } },
      },
    };
    const [change] = getSource().collect();
    expect(change.build({ json: structuredClone(GLOW_FILE) })).toEqual({
      saveData: {
        sceneId: 'sceneA',
        entry: { inputs: { strength: 2, color: '#00ff00', offset: { x: 0, y: 1, z: 0 } } },
      },
    });
  });

  it('an edit back to the file’s value takes it out of the entry', () => {
    // The editor's base is the scene's strength 2: the file's 1 is an override
    store.data = { [`${RECORD}glow`]: { overrides: { inputs: { strength: 1 } } } };
    const [change] = getSource().collect();
    expect(change.build({ json: structuredClone(GLOW_FILE) })).toEqual({
      saveData: { sceneId: 'sceneA', entry: {} },
    });
    // No latest entry: nothing to write
    const { __saveData: _saveData, ...withoutEntry } = GLOW_FILE;
    expect(change.build({ json: withoutEntry })).toBeNull();
  });

  it('in a scene that doesn’t list it, every material is Not saveable', () => {
    store.sceneId = 'sceneB';
    store.data = { [`${RECORD}glow`]: { overrides: { inputs: { color: '#00ff00' } } } };
    expect(getSource().collect()[0]).toMatchObject({
      sceneId: 'sceneB',
      path: null,
      unsaveable: 'not in this scene',
    });
  });

  it('drops the saved overrides; the settings, the camera and the unsaved records stay', () => {
    store.data = {
      [`${RECORD}glow`]: {
        overrides: { inputs: { color: '#00ff00' }, params: { roughness: 1 } },
        settings: { autoRotate: false },
        camera: { fov: 40 },
      },
      [`${RECORD}grid`]: { overrides: { nodes: { colorNode: { scale: 3 } } } },
      [`${RECORD}rock`]: { overrides: { params: { roughness: 1 } } },
    };
    const source = getSource();
    const changes = source.collect();
    // An override added after the collect stays
    store.data[`${RECORD}grid`] = { overrides: { nodes: { colorNode: { scale: 3, tint: 1 } } } };
    source.onSaved(changes.filter((change) => !change.unsaveable));
    expect(store.data).toEqual({
      [`${RECORD}glow`]: { settings: { autoRotate: false }, camera: { fov: 40 } },
      [`${RECORD}grid`]: { overrides: { nodes: { colorNode: { tint: 1 } } } },
      [`${RECORD}rock`]: { overrides: { params: { roughness: 1 } } },
    });
  });
});
