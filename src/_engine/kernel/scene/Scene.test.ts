import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// The first scene with children starts the main loop, which needs a renderer
vi.mock('../loop/MainLoop', () => ({ initMainLoop: vi.fn() }));

import {
  createRootScene,
  createScene,
  createSceneAppLooper,
  createSceneMainLooper,
  deleteAllSceneLoopers,
  deleteSceneAppLooper,
  deleteSceneMainLooper,
  getRootScene,
  registerOnAllSceneEnterings,
  registerOnAllSceneEnters,
  registerOnAllSceneExits,
  registerOnSceneEnter,
  registerOnSceneExit,
  runOnAllSceneEnters,
  runOnAllSceneExits,
  runOnSceneEnter,
  runOnSceneExit,
  runSceneAppLoopers,
  runSceneMainLateLoopers,
  runSceneMainLoopers,
  setCurrentScene,
  setLoadingSceneId,
} from './Scene';

/** Runs every looper list once */
const runAll = () => {
  runSceneMainLoopers(0, false);
  runSceneMainLateLoopers(0);
  runSceneAppLoopers(0);
};

beforeAll(() => createRootScene());

afterEach(() => {
  setCurrentScene(null);
  setLoadingSceneId(null);
});

describe('scene loopers', () => {
  it("runs only the current scene's loopers, each list in its own run", () => {
    createScene('loopA');
    createScene('loopB');
    const calls: string[] = [];
    createSceneMainLooper(() => calls.push('a:main'), 'loopA');
    createSceneMainLooper(() => calls.push('a:late'), 'loopA', true);
    createSceneAppLooper(() => calls.push('a:app'), 'loopA');
    createSceneAppLooper(() => calls.push('b:app'), 'loopB');

    runAll();
    expect(calls).toEqual([]);

    setCurrentScene('loopA');
    runAll();
    expect(calls).toEqual(['a:main', 'a:late', 'a:app']);

    calls.length = 0;
    setCurrentScene('loopB');
    runAll();
    expect(calls).toEqual(['b:app']);
  });

  it('refreshes the running list when the current scene gains or loses a looper', () => {
    createScene('loopRefresh');
    setCurrentScene('loopRefresh');
    const calls: number[] = [];
    const first = createSceneMainLooper(() => calls.push(1));
    const second = createSceneMainLooper(() => calls.push(2));
    runSceneMainLoopers(0, false);
    expect(calls).toEqual([1, 2]);

    calls.length = 0;
    deleteSceneMainLooper(first);
    runSceneMainLoopers(0, false);
    expect(calls).toEqual([2]);
    expect([first, second]).toEqual([0, 1]);

    calls.length = 0;
    runSceneMainLoopers(0, true);
    expect(calls).toEqual([]);
  });

  it('deletes by index without shifting the later indexes', () => {
    createScene('loopIndexes');
    setCurrentScene('loopIndexes');
    const calls: number[] = [];
    const indexes = [0, 1, 2, 3].map((n) => createSceneAppLooper(() => calls.push(n)));
    deleteSceneAppLooper([indexes[0], indexes[2]]);
    deleteSceneAppLooper(indexes[3]);
    runSceneAppLoopers(0);
    expect(calls).toEqual([1]);
  });

  it('skips an index of an earlier visit after the scene exits', () => {
    createScene('loopVisits');
    setCurrentScene('loopVisits');
    const calls: string[] = [];
    const old = createSceneMainLooper(() => calls.push('old'));
    deleteAllSceneLoopers('loopVisits');
    runSceneMainLoopers(0, false);
    expect(calls).toEqual([]);

    const next = createSceneMainLooper(() => calls.push('next'));
    expect(next).not.toBe(old);
    deleteSceneMainLooper(old);
    runSceneMainLoopers(0, false);
    expect(calls).toEqual(['next']);

    deleteSceneMainLooper(next);
    runSceneMainLoopers(0, false);
    expect(calls).toEqual(['next']);
  });

  it('defaults to the loading scene while its code runs, and starts it once current', () => {
    createScene('loopPrev');
    createScene('loopLoading');
    setCurrentScene('loopPrev');
    setLoadingSceneId('loopLoading');
    const calls: string[] = [];
    createSceneMainLooper(() => calls.push('loading'));
    runSceneMainLoopers(0, false);
    expect(calls).toEqual([]);

    setCurrentScene('loopLoading');
    setLoadingSceneId(null);
    runSceneMainLoopers(0, false);
    expect(calls).toEqual(['loading']);
  });

  it('returns -1 with no scene to add to', () => {
    expect(createSceneMainLooper(() => {})).toBe(-1);
    expect(createSceneAppLooper(() => {})).toBe(-1);
  });
});

describe('scene listeners', () => {
  it('removes a listener with its remover', () => {
    const calls: string[] = [];
    const removers = [
      registerOnSceneEnter('lsA', () => calls.push('enter')),
      registerOnSceneExit('lsA', () => calls.push('exit')),
      registerOnAllSceneEnters('lsTest', () => calls.push('allEnter')),
      registerOnAllSceneExits('lsTest', () => calls.push('allExit')),
    ];
    runOnSceneEnter('lsA');
    runOnSceneExit('lsA');
    runOnAllSceneEnters();
    runOnAllSceneExits();
    expect(calls).toEqual(['enter', 'exit', 'allEnter', 'allExit']);

    calls.length = 0;
    removers.forEach((remove) => remove());
    runOnSceneEnter('lsA');
    runOnSceneExit('lsA');
    runOnAllSceneEnters();
    runOnAllSceneExits();
    expect(calls).toEqual([]);
  });

  it('keeps a replacing listener when the replaced one is removed', () => {
    const calls: string[] = [];
    const removeFirst = registerOnAllSceneEnters('lsReplace', () => calls.push('first'));
    const removeSecond = registerOnAllSceneEnters('lsReplace', () => calls.push('second'));
    removeFirst();
    runOnAllSceneEnters();
    expect(calls).toEqual(['second']);
    removeSecond();
  });

  it('skips a listener another one removes during the run', () => {
    const calls: string[] = [];
    let removeLater = () => {};
    const removeFirst = registerOnAllSceneExits('lsRun1', () => {
      calls.push('first');
      removeLater();
    });
    removeLater = registerOnAllSceneExits('lsRun2', () => calls.push('later'));
    runOnAllSceneExits();
    expect(calls).toEqual(['first']);
    removeFirst();
  });

  it('keeps the deprecated name as the same function', () => {
    expect(registerOnAllSceneEnterings).toBe(registerOnAllSceneEnters);
  });
});

describe('setCurrentScene', () => {
  it('takes a background colour of 0 (black)', () => {
    createScene('bgBlack', { backgroundColor: 0 });
    setCurrentScene('bgBlack');
    const background = getRootScene()?.background;
    expect(background).toBeInstanceOf(THREE.Color);
    expect((background as THREE.Color).getHex()).toBe(0);
  });

  it("takes the JSON's { r, g, b } background colour", () => {
    createScene('bgJson', { backgroundColor: { r: 0, g: 255, b: 0 } });
    setCurrentScene('bgJson');
    expect((getRootScene()?.background as THREE.Color).getHex()).toBe(0x00ff00);
  });

  it('clears the background of a scene without one', () => {
    createScene('bgRed', { backgroundColor: '#ff0000' });
    createScene('bgNone');
    setCurrentScene('bgRed');
    setCurrentScene('bgNone');
    expect(getRootScene()?.background).toBeNull();
  });
});
