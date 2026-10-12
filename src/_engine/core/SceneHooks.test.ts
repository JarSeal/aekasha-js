import { afterEach, describe, expect, it } from 'vitest';
import {
  addSceneHooks,
  runSceneBeforeAssetsHooksAsync,
  runSceneEnteredHooksAsync,
  runSceneExitHooks,
  runSceneLoadSettledHooks,
  runSceneLoadStartHooks,
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
});
