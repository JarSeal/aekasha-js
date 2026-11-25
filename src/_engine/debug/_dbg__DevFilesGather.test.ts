import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevDataGatheredEvent } from './DevFilesProtocol';

// p355 §2.4 item 1: the gather toasts. Which gather is this page's, the note for the reload, and
// the toasts; the toaster and the CMPs are stand-ins.

const storage = vi.hoisted(() => {
  const items: { [key: string]: string } = {};
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => items[key] ?? null,
    setItem: (key: string, value: string) => (items[key] = String(value)),
    removeItem: (key: string) => delete items[key],
  });
  return items;
});

const toasts = vi.hoisted(() => ({ added: [] as { type?: string; title?: unknown }[] }));
vi.mock(import('./DebuggerGUI'), () => ({
  addDebugToast: (props: { type?: string; title?: unknown }) => {
    toasts.added.push(props);
    return null;
  },
}));
const options = vi.hoisted(() => ({ gatherToasts: true }));
const NOTE_KEY = 'AEK_devFilesGatherNote';
vi.mock(import('./DevFiles'), () => ({
  DEV_FILES_GATHER_NOTE_KEY: 'AEK_devFilesGatherNote' as const,
  isDevFilesOptionOn: (option: string) => option === 'gatherToasts' && options.gatherToasts,
}));
vi.mock(import('../ui/core/CMP'), () => {
  const stub = (): unknown => ({ add: stub });
  return { CMP: stub } as never;
});

import {
  _clearWrittenPaths,
  _handleOwnGather,
  _rememberWrittenPaths,
  _showGatherNoteAfterReload,
  _takeOwnGatherFiles,
  WRITTEN_PATHS_TTL_MS,
} from './_dbg__DevFilesGather';

const MAT = 'src/app/materials/rock.material.json';
const SKY = 'src/app/skyboxes/day.skybox.json';

const gather = (props: Partial<DevDataGatheredEvent> = {}): DevDataGatheredEvent => ({
  status: 'done',
  files: [MAT],
  assetErrors: [],
  willReload: true,
  ...props,
});

beforeEach(() => {
  _clearWrittenPaths();
  for (const key of Object.keys(storage)) delete storage[key];
  toasts.added.length = 0;
  options.gatherToasts = true;
});

describe("a gather is this page's", () => {
  it('when it names a path the page wrote, once, within 60 s', () => {
    _rememberWrittenPaths([MAT], 0);
    expect(_takeOwnGatherFiles(gather({ files: [MAT, SKY] }), 1000)).toEqual([MAT]);
    // A write toasts once
    expect(_takeOwnGatherFiles(gather(), 2000)).toEqual([]);

    _rememberWrittenPaths([MAT], 0);
    expect(_takeOwnGatherFiles(gather(), WRITTEN_PATHS_TTL_MS)).toEqual([]);
  });

  it("an editor save's gather names none", () => {
    _rememberWrittenPaths([MAT]);
    _handleOwnGather(gather({ files: [SKY] }));
    expect(toasts.added).toEqual([]);
    expect(storage).toEqual({});
  });
});

describe('the toasts', () => {
  it('a gather the reload follows leaves a note, shown after the reload', () => {
    _rememberWrittenPaths([MAT, SKY]);
    _handleOwnGather(gather({ files: [MAT] }));
    _handleOwnGather(gather({ files: [SKY], assetErrors: [{ id: 'rock', reason: 'no ktx' }] }));
    expect(toasts.added).toEqual([]);
    expect(JSON.parse(storage[NOTE_KEY])).toEqual({
      files: [MAT, SKY],
      assetErrors: [{ id: 'rock', reason: 'no ktx' }],
    });

    _showGatherNoteAfterReload();
    expect(toasts.added.map((toast) => [toast.type, toast.title])).toEqual([
      ['success', 'Saved 2 files'],
      ['warning', 'The gather used the sources of assets that failed to build'],
    ]);
    expect(storage).toEqual({});
  });

  it('a gather without a reload toasts at once', () => {
    _rememberWrittenPaths([MAT]);
    _handleOwnGather(gather({ willReload: false }));
    expect(toasts.added.map((toast) => toast.title)).toEqual(['Saved 1 file']);
  });

  it('a failed gather is an alert at once', () => {
    _rememberWrittenPaths([MAT]);
    _handleOwnGather(gather({ status: 'failed', willReload: false, message: 'Bad JSON' }));
    expect(toasts.added).toMatchObject([{ type: 'alert', message: 'Bad JSON' }]);
  });

  it('none with the setting off', () => {
    options.gatherToasts = false;
    _rememberWrittenPaths([MAT]);
    _handleOwnGather(gather({ status: 'failed' }));
    _handleOwnGather(gather());
    expect(toasts.added).toEqual([]);
    expect(storage).toEqual({});
  });

  it('an unreadable note is dropped', () => {
    storage[NOTE_KEY] = '{ nope';
    _showGatherNoteAfterReload();
    expect(toasts.added).toEqual([]);
    expect(storage).toEqual({});
  });
});
