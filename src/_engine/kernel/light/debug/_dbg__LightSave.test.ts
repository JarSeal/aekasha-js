import { afterEach, describe, expect, it, vi } from 'vitest';
import { LS_LIGHTS_KEY, type LightDebugLSData } from './LightDebugStorage';

// `AEK_debugLights` and the generated data are this test's
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
          lights: [
            // The file's sun with the latest entry's intensity in it
            {
              lightProps: {
                type: 'DIRECTIONAL',
                color: 'orange',
                intensity: 2,
                position: { x: 30, y: 40, z: 20 },
                appId: 'sun',
              },
            },
            { lightProps: { type: 'AMBIENT', enabled: false, appId: 'fill' } },
          ],
        },
      },
      lights: {
        sun: { __sourcePath: 'src/app/lights/sun.light.json' },
        fill: { __sourcePath: 'src/app/lights/fill.light.json' },
      },
    }) as never,
}));

import { _getSaveSources } from '../../../debug/SaveData';
import { LIGHT_SAVE_SOURCE_ID, registerLightSaveSource } from './_dbg__LightSave';

const SUN_FILE = {
  lightProps: {
    type: 'DIRECTIONAL',
    color: 'orange',
    intensity: 3,
    position: { x: 30, y: 40, z: 20 },
  },
  __saveData: { largeWorld: [{ intensity: 2, __meta: {} }] },
};

const PREFS = { helperVisible: false, symbolVisible: true };

const setLights = (lights: LightDebugLSData[string]['lights']) => {
  store.data[LS_LIGHTS_KEY] = { largeWorld: { globalHelpersVisible: false, lights } };
};

let removeSource: (() => void) | null = null;
const getSource = () => {
  removeSource ??= registerLightSaveSource();
  return _getSaveSources().find((source) => source.id === LIGHT_SAVE_SOURCE_ID)!;
};

afterEach(() => {
  removeSource?.();
  removeSource = null;
  store.data = {};
});

describe('the lights’ save source (p355 §2.1)', () => {
  it('saves a colour as #rrggbb over the latest entry, flat, without the preferences', () => {
    setLights({
      sun: {
        ...PREFS,
        _shadowFolderOpen: true,
        color: 0xff0000,
        position: { x: 30, y: 50, z: 20 },
        // The light's own: not a change
        intensity: 2,
      },
    });
    const [change] = getSource().collect();
    expect(change).toMatchObject({
      label: 'Light "sun"',
      path: 'src/app/lights/sun.light.json',
      summary: ['color', 'position'],
    });
    expect(change.build({ json: structuredClone(SUN_FILE) })).toEqual({
      saveData: {
        sceneId: 'largeWorld',
        entry: { intensity: 2, color: '#ff0000', position: { x: 30, y: 50, z: 20 } },
      },
    });
  });

  it('compares colours as colours: the file’s "orange" is 0xffa500', () => {
    setLights({ sun: { ...PREFS, color: 0xffa500 } });
    expect(getSource().collect()).toEqual([]);
  });

  it('lists no change for preferences alone or an old record’s `enabled: true` (i165)', () => {
    setLights({ sun: { ...PREFS, enabled: true, helperVisible: true } });
    expect(getSource().collect()).toEqual([]);
  });

  it('`enabled` is a change against the light’s, its default true', () => {
    setLights({ sun: { ...PREFS, enabled: false }, fill: { ...PREFS, enabled: true } });
    const changes = getSource().collect();
    expect(changes.map(({ id, summary }) => ({ id, summary }))).toEqual([
      { id: 'largeWorld:sun', summary: ['enabled'] },
      { id: 'largeWorld:fill', summary: ['enabled'] },
    ]);
    const fillFile = { lightProps: { type: 'AMBIENT', enabled: false } };
    expect(changes[1].build({ json: fillFile })).toEqual({
      saveData: { sceneId: 'largeWorld', entry: { enabled: true } },
    });
  });

  it('a light made in code is not saveable', () => {
    setLights({ lantern0: { ...PREFS, intensity: 6 } });
    expect(getSource().collect()).toMatchObject([
      { id: 'largeWorld:lantern0', path: null, unsaveable: 'not in the scene JSON' },
    ]);
  });

  it('drops the saved values, the preferences and the other changes kept', () => {
    setLights({
      sun: { ...PREFS, helperVisible: true, color: 0xff0000 },
      lantern0: { ...PREFS, intensity: 6 },
    });
    const source = getSource();
    source.onSaved(source.collect().filter((change) => !change.unsaveable));
    expect(store.data[LS_LIGHTS_KEY]).toEqual({
      largeWorld: {
        globalHelpersVisible: false,
        lights: { sun: { ...PREFS, helperVisible: true }, lantern0: { ...PREFS, intensity: 6 } },
      },
    });
  });
});
