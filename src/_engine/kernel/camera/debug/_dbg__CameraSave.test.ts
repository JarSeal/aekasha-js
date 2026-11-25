import { afterEach, describe, expect, it, vi } from 'vitest';
import { LS_KEY, type CamDebugLSData } from './CameraDebugStorage';

// `AEK_debugCams` and the generated data are this test's
const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock(import('../../../utils/LocalAndSessionStorage'), async (importOriginal) => ({
  ...(await importOriginal()),
  lsGetItem: (key: string) => structuredClone(store.data[key] ?? {}) as never,
  lsSetItem: (key: string, value: unknown) => {
    store.data[key] = structuredClone(value);
  },
  lsRemoveItem: (key: string) => {
    delete store.data[key];
  },
}));
vi.mock(import('../../scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getGeneratedAppData: () =>
    ({
      scenes: {
        largeWorld: {
          // The file's camera with the latest entry's far in it
          cameras: [
            {
              camProps: {
                type: 'PERSPECTIVE',
                fov: 60,
                far: 800,
                position: { x: 0, y: 60, z: 120 },
                appId: 'overview',
              },
            },
          ],
        },
      },
      cameras: { overview: { __sourcePath: 'src/app/cameras/overview.camera.json' } },
    }) as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import { DEFAULT_DEBUG_CAM_PROPS } from './_dbg__DebugCamera';
import { CAMERA_SAVE_SOURCE_ID, registerCameraSaveSource } from './_dbg__CameraSave';

const FILE = {
  camProps: { type: 'PERSPECTIVE', fov: 60, far: 1000, position: { x: 0, y: 60, z: 120 } },
  __saveData: { largeWorld: [{ far: 800, __meta: {} }] },
};

const setCams = (data: CamDebugLSData) => {
  store.data[LS_KEY] = data;
};
const scene = (cams: CamDebugLSData[string]['cams']) => ({
  cams,
  debugCam: { ...DEFAULT_DEBUG_CAM_PROPS },
});

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerCameraSaveSource();
  return _getSaveSources().find((source) => source.id === CAMERA_SAVE_SOURCE_ID)!;
};

afterEach(() => {
  removeSource?.();
  removeSource = null;
  store.data = {};
});

describe('the cameras’ save source (p355 §2.1)', () => {
  it('saves the changed values over the latest entry, flat, without the preferences', () => {
    setCams({
      largeWorld: scene({
        overview: {
          helperVisible: true,
          _lensSettingsOpen: true,
          fov: 50,
          // The camera's own: not a change, and dropped from the entry
          far: 800,
          position: { x: 0, y: 70, z: 120 },
        },
      }),
    });
    const [change] = getSource().collect();
    expect(change).toMatchObject({
      label: 'Camera "overview"',
      sceneId: 'largeWorld',
      path: 'src/app/cameras/overview.camera.json',
      summary: ['fov', 'position'],
    });
    expect(change.unsaveable).toBeUndefined();
    expect(change.build({ json: structuredClone(FILE) })).toEqual({
      saveData: {
        sceneId: 'largeWorld',
        // The latest entry's far kept; the position whole
        entry: { far: 800, fov: 50, position: { x: 0, y: 70, z: 120 } },
      },
    });
  });

  it('a value back to the file’s drops it from the entry', () => {
    setCams({ largeWorld: scene({ overview: { helperVisible: false, far: 1000 } }) });
    const [change] = getSource().collect();
    expect(change.summary).toEqual(['far']);
    expect(change.build({ json: structuredClone(FILE) })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: {} },
    });
  });

  it('lists no change for preferences alone, or values the camera has', () => {
    setCams({
      largeWorld: scene({
        overview: { helperVisible: true, _lensSettingsOpen: false, fov: 60 },
      }),
    });
    expect(getSource().collect()).toEqual([]);
  });

  it('a camera made in code, or of a scene that’s gone, is not saveable', () => {
    setCams({
      largeWorld: scene({ dynamic: { helperVisible: false, fov: 70 } }),
      gone: scene({ overview: { helperVisible: false, fov: 70 } }),
    });
    expect(
      getSource()
        .collect()
        .map(({ id, path, unsaveable }) => ({ id, path, unsaveable }))
    ).toEqual([
      { id: 'largeWorld:dynamic', path: null, unsaveable: 'not in the scene JSON' },
      { id: 'gone:overview', path: null, unsaveable: 'scene not found' },
    ]);
  });

  it('drops the saved values, the preferences, the debug camera and other changes kept', () => {
    setCams({
      largeWorld: scene({
        overview: { helperVisible: true, fov: 50 },
        other: { helperVisible: false, near: 1 },
      }),
      gone: scene({ overview: { helperVisible: false, fov: 70 } }),
    });
    const source = getSource();
    // The save passes only what it wrote: `other` (made in code) isn't
    source.onSaved(source.collect().filter((change) => !change.unsaveable));
    expect(store.data[LS_KEY]).toEqual({
      largeWorld: scene({
        overview: { helperVisible: true },
        other: { helperVisible: false, near: 1 },
      }),
      gone: scene({ overview: { helperVisible: false, fov: 70 } }),
    });
  });
});
