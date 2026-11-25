import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The generated data and the tab's saves are this test's
const persisted = vi.hoisted(() => ({ count: 0 }));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  persistDebuggerTabValue: () => {
    persisted.count++;
  },
}));
/** The dev data's scenes (their latest entries applied) */
const createScenes = () => ({
  largeWorld: {
    spatialDomains: [{ id: 'DEFAULT', cellSize: 24 }] as Record<string, unknown>[],
    __sourcePath: 'src/app/scenes/largeWorld/largeWorld.scene.json',
  },
  other: {
    spatialDomains: [{ id: 'DEFAULT', cellSize: 24 }] as Record<string, unknown>[],
    __sourcePath: 'src/app/scenes/other/other.scene.json',
  },
});
const devData = vi.hoisted(() => ({ scenes: {} as Record<string, unknown> }));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () => devData as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import { spatialGridTabState, type DomainDebugSettings } from './_dbg__SpatialGridSettings';
import {
  registerSpatialGridSaveSource,
  SPATIAL_GRID_SAVE_SOURCE_ID,
} from './_dbg__SpatialGridSave';

const SCENE = { id: 'largeWorld', sceneFile: 'scenes/largeWorld/largeWorld.ts' };
const settings = (cellSizeByScene: Record<string, number>): DomainDebugSettings => ({
  cellSizeByScene,
  showCells: false,
  cellsColor: 0,
  showOversized: false,
  oversizedColor: 0,
});

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerSpatialGridSaveSource();
  return _getSaveSources().find((source) => source.id === SPATIAL_GRID_SAVE_SOURCE_ID)!;
};
/** The change of `sceneId`'s domain `domainId` */
const getChange = (sceneId: string, domainId: string) =>
  getSource()
    .collect()
    .find((change) => change.id === `${sceneId}:${domainId}`)!;

beforeEach(() => {
  devData.scenes = createScenes();
});

afterEach(() => {
  removeSource?.();
  removeSource = null;
  spatialGridTabState.domains = {};
  persisted.count = 0;
});

describe('the spatial domains’ cell sizes’ save source (p355 §2.5)', () => {
  it('lists a scene’s cell size that differs from its JSON’s, or why it can’t be saved', () => {
    spatialGridTabState.domains = {
      DEFAULT: settings({ largeWorld: 30, other: 24, gone: 12 }),
      FOLIAGE: settings({ largeWorld: 8 }),
    };
    const changes = getSource().collect();
    // `other` has 24 already: no change
    expect(
      changes.map(({ id, label, path, unsaveable, summary }) => ({
        id,
        label,
        path,
        unsaveable,
        summary,
      }))
    ).toEqual([
      {
        id: 'largeWorld:DEFAULT',
        label: 'Spatial domain "DEFAULT" cell size',
        path: 'src/app/scenes/largeWorld/largeWorld.scene.json',
        unsaveable: undefined,
        summary: ['spatialDomains.DEFAULT.cellSize'],
      },
      {
        id: 'gone:DEFAULT',
        label: 'Spatial domain "DEFAULT" cell size',
        path: null,
        unsaveable: 'scene not found',
        summary: ['spatialDomains.DEFAULT.cellSize'],
      },
      {
        id: 'largeWorld:FOLIAGE',
        label: 'Spatial domain "FOLIAGE" cell size',
        path: null,
        unsaveable: "not in the scene JSON's spatialDomains (registered in code)",
        summary: ['spatialDomains.FOLIAGE.cellSize'],
      },
    ]);
  });

  it('builds the domain’s item, only the fields that differ from the file’s', () => {
    spatialGridTabState.domains = { DEFAULT: settings({ largeWorld: 30 }) };
    const json = { ...SCENE, spatialDomains: [{ id: 'DEFAULT', cellSize: 24, update: 'STATIC' }] };
    expect(getChange('largeWorld', 'DEFAULT').build({ json })).toEqual({
      saveData: {
        sceneId: 'largeWorld',
        entry: { spatialDomains: [{ id: 'DEFAULT', cellSize: 30 }] },
      },
    });
  });

  it('puts the item in the latest entry’s list in its place, the rest kept', () => {
    spatialGridTabState.domains = { DEFAULT: settings({ largeWorld: 30 }) };
    const json = {
      ...SCENE,
      spatialDomains: [{ id: 'DEFAULT', cellSize: 24 }],
      __saveData: {
        largeWorld: [
          {
            postFxEnabled: false,
            spatialDomains: [
              { id: 'DEFAULT', cellSize: 28, update: 'STATIC' },
              { id: 'ROCKS', cellSize: 8, maxMembers: 50 },
            ],
            __meta: {},
          },
        ],
      },
    };
    expect(getChange('largeWorld', 'DEFAULT').build({ json })).toEqual({
      saveData: {
        sceneId: 'largeWorld',
        entry: {
          postFxEnabled: false,
          spatialDomains: [
            { id: 'DEFAULT', cellSize: 30, update: 'STATIC' },
            { id: 'ROCKS', cellSize: 8, maxMembers: 50 },
          ],
        },
      },
    });
  });

  it('keeps the fields another domain than DEFAULT needs in an entry', () => {
    spatialGridTabState.domains = { FOLIAGE: settings({ largeWorld: 12 }) };
    const json = {
      ...SCENE,
      spatialDomains: [{ id: 'FOLIAGE', cellSize: 10, maxMembers: 100, update: 'STATIC' }],
    };
    devData.scenes = {
      largeWorld: {
        spatialDomains: [{ id: 'FOLIAGE', cellSize: 10, maxMembers: 100, update: 'STATIC' }],
        __sourcePath: 'src/app/scenes/largeWorld/largeWorld.scene.json',
      },
    };
    const change = getChange('largeWorld', 'FOLIAGE');
    expect(change.build({ json })).toEqual({
      saveData: {
        sceneId: 'largeWorld',
        entry: { spatialDomains: [{ id: 'FOLIAGE', cellSize: 12, maxMembers: 100 }] },
      },
    });
  });

  it('a cell size back to the file’s drops the item, an emptied list and an empty entry', () => {
    spatialGridTabState.domains = { DEFAULT: settings({ largeWorld: 24 }) };
    const json = { ...SCENE, spatialDomains: [{ id: 'DEFAULT', cellSize: 24 }] };
    // The scene has the latest entry's 28
    (devData.scenes.largeWorld as { spatialDomains: unknown[] }).spatialDomains = [
      { id: 'DEFAULT', cellSize: 28 },
    ];
    const change = getChange('largeWorld', 'DEFAULT');
    // The latest entry's 28 goes: an empty entry replaces it
    const withEntry = {
      ...json,
      __saveData: { largeWorld: [{ spatialDomains: [{ id: 'DEFAULT', cellSize: 28 }] }] },
    };
    expect(change.build({ json: withEntry })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: {} },
    });
    // No entry to replace: nothing to write
    expect(change.build({ json })).toBeNull();
  });

  it('drops the saved scenes’ cell sizes, the rest kept', () => {
    spatialGridTabState.domains = { DEFAULT: settings({ largeWorld: 30, gone: 12 }) };
    const source = getSource();
    source.onSaved(source.collect().filter((change) => change.sceneId === 'largeWorld'));
    expect(spatialGridTabState.domains.DEFAULT.cellSizeByScene).toEqual({ gone: 12 });
    expect(persisted.count).toBe(1);
  });
});
