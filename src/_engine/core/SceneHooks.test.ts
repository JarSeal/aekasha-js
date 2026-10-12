import { afterEach, describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import type { SceneData } from './Scene';
import {
  addSceneHooks,
  getSceneRetainedTextures,
  runSceneBeforeAssetsHooksAsync,
  runSceneDeletedHooks,
  runSceneEnteredHooksAsync,
  runSceneExitHooks,
  runSceneLoadSettledHooks,
  runSceneLoadStartHooks,
  runSceneRegisteredHooks,
  type SceneHooks,
} from './SceneHooks';

const removers: (() => void)[] = [];
const add = (hooks: SceneHooks) => removers.push(addSceneHooks(hooks));

afterEach(() => {
  removers.splice(0).forEach((remove) => remove());
});

describe('scene hooks', () => {
  it('runs a phase in install order, and exit in reverse', () => {
    const calls: string[] = [];
    add({ loadStart: () => calls.push('a:start'), exit: (id) => calls.push(`a:exit:${id}`) });
    add({ exit: (id) => calls.push(`b:exit:${id}`) });
    add({ loadStart: () => calls.push('c:start'), loadSettled: () => calls.push('c:settled') });
    runSceneLoadStartHooks();
    runSceneExitHooks('prev');
    runSceneLoadSettledHooks();
    expect(calls).toEqual(['a:start', 'c:start', 'b:exit:prev', 'a:exit:prev', 'c:settled']);
  });

  it('awaits each hook of an awaited phase before the next', async () => {
    const calls: string[] = [];
    add({
      beforeAssets: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push('a');
      },
    });
    add({ beforeAssets: () => void calls.push('b') });
    await runSceneBeforeAssetsHooksAsync();
    expect(calls).toEqual(['a', 'b']);
  });

  it('rejects with a failing hook, and the hooks after it do not run', async () => {
    const calls: string[] = [];
    add({
      entered: () => {
        throw new Error('nope');
      },
    });
    add({ entered: () => void calls.push('after') });
    await expect(runSceneEnteredHooksAsync()).rejects.toThrow('nope');
    expect(calls).toEqual([]);
  });

  it('removes hooks with the remover', () => {
    const calls: string[] = [];
    const remove = addSceneHooks({ loadStart: () => calls.push('x') });
    remove();
    runSceneLoadStartHooks();
    expect(calls).toEqual([]);
  });

  it('runs the scene data phases in install order', () => {
    const calls: string[] = [];
    const data = { id: 's1', sceneFile: '' } as SceneData;
    add({ sceneRegistered: (id, d) => calls.push(`a:reg:${id}:${d.id}`) });
    add({
      sceneRegistered: (id) => calls.push(`b:reg:${id}`),
      sceneDeleted: (id) => calls.push(`b:del:${id}`),
    });
    add({ sceneDeleted: (id) => calls.push(`c:del:${id}`) });
    runSceneRegisteredHooks('s1', data);
    runSceneDeletedHooks('s1');
    expect(calls).toEqual(['a:reg:s1:s1', 'b:reg:s1', 'b:del:s1', 'c:del:s1']);
  });

  it("collects every feature's retained textures, once each", () => {
    const t1 = {} as THREE.Texture;
    const t2 = {} as THREE.Texture;
    add({ retainedTextures: () => [t1] });
    add({ loadStart: () => {} });
    add({ retainedTextures: () => [t1, t2] });
    expect([...getSceneRetainedTextures()]).toEqual([t1, t2]);
  });
});
