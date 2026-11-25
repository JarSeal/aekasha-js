import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevDataGatheredEvent, DevFileRead, DevFilesStatus, DevFileWrite } from './DevFiles';

// The dev files, the scene, the toasts and the on-screen tools are this test's
const files = vi.hoisted(() => ({
  status: { available: true, server: {} } as unknown as DevFilesStatus,
  historySize: 20,
  disk: new Map<string, { sha256: string; json: unknown }>(),
  writes: [] as DevFileWrite[][],
  writeError: null as Error | null,
  unchanged: false,
  gatherListeners: new Set<(event: DevDataGatheredEvent) => void>(),
}));
vi.mock(import('./DevFiles'), async (importOriginal) => ({
  ...(await importOriginal()),
  getDevFilesStatus: async () => files.status,
  getDevFilesSaveHistorySize: () => files.historySize,
  readDevFile: async (path: string) => {
    const file = files.disk.get(path);
    return file
      ? ({ path, bytes: new Uint8Array(), ...structuredClone(file) } as DevFileRead)
      : null;
  },
  writeDevFiles: async (writes: DevFileWrite[]) => {
    files.writes.push(writes);
    if (files.writeError) throw files.writeError;
    return {
      results: writes.map((write) => ({
        path: write.path,
        sha256: 'new',
        previousHash: write.expectedHash ?? null,
        status: files.unchanged ? ('unchanged' as const) : ('updated' as const),
      })),
    };
  },
  onDevDataGathered: (fn: (event: DevDataGatheredEvent) => void) => {
    files.gatherListeners.add(fn);
    return () => files.gatherListeners.delete(fn);
  },
}));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'sceneA',
}));
const toasts = vi.hoisted(() => [] as { type?: string; title?: unknown; message?: unknown }[]);
vi.mock(import('./DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  addDebugToast: (props: { type?: string; title?: unknown; message?: unknown }) => {
    toasts.push(props);
    return null;
  },
}));
const tools = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock(import('./OnScreenTools'), async (importOriginal) => ({
  ...(await importOriginal()),
  updateOnScreenTools: tools.update,
}));

import { DevFilesError } from './DevFiles';
import {
  registerSaveSource,
  setSaveSourcesReady,
  type SaveChange,
  type SaveSource,
} from './SaveData';
import {
  _getSaveSceneDisabledReason,
  _isSaving,
  _refreshSaveStatus,
  _saveSceneAsync,
  SAVING_TEXT,
  SAVING_TIMEOUT_MS,
} from './_dbg__SaveData';

const PATH_A = 'src/app/skyboxes/sky.skybox.json';
const PATH_B = 'src/app/postFx/bloom.postFx.json';

/** A change saving `entry` into `path` for `sceneId`, over the file's latest entry */
const createChange = (
  props: Partial<SaveChange> & { entry?: Record<string, unknown> } = {}
): SaveChange => {
  const { entry = { turbidity: 4 }, ...rest } = props;
  const sceneId = rest.sceneId ?? 'sceneA';
  return {
    id: `${sceneId}:${rest.path ?? PATH_A}`,
    label: 'A change',
    scope: 'SCENE',
    sceneId,
    path: PATH_A,
    summary: Object.keys(entry),
    build: () => ({ saveData: { sceneId, entry } }),
    ...rest,
  };
};

let removeSources: (() => void)[] = [];
const addSource = (changes: SaveChange[], props: Partial<SaveSource> = {}) => {
  const source: SaveSource = {
    id: `source${removeSources.length}`,
    label: 'Source',
    collect: () => changes,
    onSaved: vi.fn(),
    ...props,
  };
  removeSources.push(registerSaveSource(source));
  return source;
};

const gather = (event: Partial<DevDataGatheredEvent>) => {
  for (const fn of [...files.gatherListeners]) {
    fn({ status: 'done', files: [PATH_A], assetErrors: [], willReload: true, ...event });
  }
};

beforeEach(async () => {
  files.status = { available: true, server: {} } as unknown as DevFilesStatus;
  files.historySize = 20;
  files.disk = new Map([
    [PATH_A, { sha256: 'hashA', json: { id: 'sky' } }],
    [PATH_B, { sha256: 'hashB', json: { id: 'bloom' } }],
  ]);
  files.writes = [];
  files.writeError = null;
  files.unchanged = false;
  toasts.length = 0;
  tools.update.mockClear();
  await _refreshSaveStatus();
});

afterEach(() => {
  for (const remove of removeSources) remove();
  removeSources = [];
  // A test that left a save waiting ends it
  if (_isSaving()) gather({ status: 'failed', files: [PATH_A, PATH_B] });
  vi.useRealTimers();
});

describe('"Save scene"’s state (p355 §2.2)', () => {
  it('is off until the boot has run the features’ debug hooks (their sources)', async () => {
    addSource([createChange()]);
    expect(_getSaveSceneDisabledReason()).toBe('The debugger is still starting');
    await _saveSceneAsync();
    expect(files.writes).toEqual([]);
    expect(toasts.at(-1)).toMatchObject({
      type: 'warning',
      message: 'The debugger is still starting',
    });
    setSaveSourcesReady();
    expect(_getSaveSceneDisabledReason()).toBeNull();
  });

  it('is off without the dev files, with saving off, and with nothing to save in this scene', async () => {
    files.status = {
      available: false,
      reason: 'NOT_ENABLED',
      message: 'The dev file routes are off',
      server: null,
    };
    await _refreshSaveStatus();
    addSource([createChange()]);
    expect(_getSaveSceneDisabledReason()).toBe('The dev file routes are off');

    files.status = { available: true, server: {} } as unknown as DevFilesStatus;
    await _refreshSaveStatus();
    files.historySize = 0;
    expect(_getSaveSceneDisabledReason()).toMatch(/^Saving is off: the save history size is 0/);
    files.historySize = -1;
    expect(_getSaveSceneDisabledReason()).toBeNull();
  });

  it('counts only this scene’s saveable changes and the global ones', () => {
    addSource([
      createChange({ sceneId: 'sceneB' }),
      createChange({ path: null, unsaveable: 'made in code' }),
      createChange({ unsaveable: 'not in this scene' }),
    ]);
    expect(_getSaveSceneDisabledReason()).toBe('Nothing to save in this scene');
    addSource([createChange({ scope: 'GLOBAL', sceneId: undefined, build: () => ({ json: {} }) })]);
    expect(_getSaveSceneDisabledReason()).toBeNull();
  });

  it('says why when a source fails to list its changes', () => {
    addSource([], {
      label: 'Sky boxes',
      collect: () => {
        throw new Error('broken');
      },
    });
    expect(_getSaveSceneDisabledReason()).toBe('Sky boxes failed to list its changes: broken');
  });
});

describe('"Save scene" (p355 §2.1)', () => {
  it('writes one entry per file from a fresh read, against its hash, in one commit', async () => {
    const seen: unknown[] = [];
    const sky = addSource([
      createChange({
        build: (file) => {
          seen.push(structuredClone(file.json));
          (file.json as { id: string }).id = 'changed';
          return { saveData: { sceneId: 'sceneA', entry: { turbidity: 4 } } };
        },
      }),
      // Another scene's change stays
      createChange({ sceneId: 'sceneB' }),
    ]);
    const postFx = addSource([createChange({ path: PATH_B, entry: { params: { strength: 2 } } })]);
    await _saveSceneAsync();
    // The build got a copy of the file as it is now
    expect(seen).toEqual([{ id: 'sky' }]);
    expect(files.disk.get(PATH_A)?.json).toEqual({ id: 'sky' });
    expect(files.writes).toEqual([
      [
        {
          path: PATH_A,
          expectedHash: 'hashA',
          saveData: { sceneId: 'sceneA', entry: { turbidity: 4 } },
        },
        {
          path: PATH_B,
          expectedHash: 'hashB',
          saveData: { sceneId: 'sceneA', entry: { params: { strength: 2 } } },
        },
      ],
    ]);
    expect((sky.onSaved as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(1);
    expect(postFx.onSaved).toHaveBeenCalledTimes(1);
  });

  it('merges two changes of one file for one scene into one entry', async () => {
    addSource([createChange({ entry: { atmosphere: { turbidity: 4 } } })]);
    addSource([createChange({ entry: { atmosphere: { rayleigh: 2 }, suns: { 0: { size: 1 } } } })]);
    await _saveSceneAsync();
    expect(files.writes[0]).toEqual([
      {
        path: PATH_A,
        expectedHash: 'hashA',
        saveData: {
          sceneId: 'sceneA',
          entry: { atmosphere: { turbidity: 4, rayleigh: 2 }, suns: { 0: { size: 1 } } },
        },
      },
    ]);
  });

  it('stays on from its start to the reload; a failed gather ends it', async () => {
    addSource([createChange()]);
    const saving = _saveSceneAsync();
    expect(_isSaving()).toBe(true);
    expect(_getSaveSceneDisabledReason()).toBe(SAVING_TEXT);
    expect(tools.update).toHaveBeenCalledWith('UNDO');
    await saving;
    expect(_isSaving()).toBe(true);
    // Another save meanwhile only toasts
    await _saveSceneAsync();
    expect(files.writes).toHaveLength(1);
    expect(toasts.at(-1)?.title).toBe(SAVING_TEXT);
    // Another file's gather isn't this save's; a gather with a reload keeps it until the reload
    gather({ status: 'failed', files: ['src/app/other.json'] });
    gather({ status: 'done', willReload: true });
    expect(_isSaving()).toBe(true);
    gather({ status: 'failed', message: 'Schema error' });
    expect(_isSaving()).toBe(false);
    expect(files.gatherListeners.size).toBe(0);
  });

  it('ends at a gather without a reload, or after 30 s without one', async () => {
    addSource([createChange()]);
    await _saveSceneAsync();
    gather({ status: 'done', willReload: false });
    expect(_isSaving()).toBe(false);

    vi.useFakeTimers();
    await _saveSceneAsync();
    vi.advanceTimersByTime(SAVING_TIMEOUT_MS - 1);
    expect(_isSaving()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(_isSaving()).toBe(false);
    expect(toasts.at(-1)).toMatchObject({ type: 'warning', title: 'No gather after the save' });
    expect(files.gatherListeners.size).toBe(0);
  });

  it('a failed commit ends it with an alert and keeps the changes', async () => {
    const source = addSource([createChange()]);
    files.writeError = new DevFilesError('CONFLICT', `${PATH_A} changed on disk`);
    await _saveSceneAsync();
    expect(_isSaving()).toBe(false);
    expect(source.onSaved).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toMatchObject({
      type: 'alert',
      title: 'Not saved',
      message: `CONFLICT: ${PATH_A} changed on disk`,
    });
    expect(files.gatherListeners.size).toBe(0);

    files.writeError = new DevFilesError('CANCELLED', 'cancelled');
    await _saveSceneAsync();
    expect(toasts.at(-1)).toMatchObject({ type: 'info', title: 'Not saved' });
  });

  it('a missing file or saving off fails it before anything is written', async () => {
    addSource([createChange({ path: 'src/app/gone.skybox.json' })]);
    await _saveSceneAsync();
    expect(files.writes).toEqual([]);
    expect(toasts.at(-1)?.message).toBe("src/app/gone.skybox.json doesn't exist");
    files.historySize = 0;
    await _saveSceneAsync();
    expect(files.writes).toEqual([]);
    expect(String(toasts.at(-1)?.message)).toMatch(/^Saving is off/);
    expect(toasts.at(-1)?.type).toBe('warning');
    expect(_isSaving()).toBe(false);
  });

  it('nothing to write, or every file unchanged: the changes are dropped and it ends', async () => {
    await _saveSceneAsync();
    expect(toasts.at(-1)?.title).toBe('Nothing to save');

    const source = addSource([createChange({ build: () => null })]);
    await _saveSceneAsync();
    expect(files.writes).toEqual([]);
    expect(source.onSaved).toHaveBeenCalledTimes(1);
    expect(_isSaving()).toBe(false);

    source.collect = () => [createChange()];
    files.unchanged = true;
    await _saveSceneAsync();
    expect(files.writes).toHaveLength(1);
    expect(source.onSaved).toHaveBeenCalledTimes(2);
    expect(_isSaving()).toBe(false);
    expect(toasts.at(-1)).toMatchObject({ message: 'The files have these changes already' });
  });
});
