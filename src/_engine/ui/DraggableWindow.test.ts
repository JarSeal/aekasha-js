import { describe, expect, it, vi } from 'vitest';
import type { SceneHooks } from '../kernel/scene/SceneHooks';

const fns = vi.hoisted(() => ({
  addSceneHooks: vi.fn<(hooks: SceneHooks) => () => void>(() => () => {}),
  addBootAfterStartHook: vi.fn<(hook: () => void) => boolean>(() => true),
}));

vi.mock(import('../kernel/scene/SceneHooks'), () => ({ addSceneHooks: fns.addSceneHooks }));
vi.mock(import('../kernel/init/BootHooks'), () => ({
  addBootAfterStartHook: fns.addBootAfterStartHook,
}));

import { getDraggableWindow, registerDraggableWindow } from './DraggableWindow';

describe('draggable windows: the scene and boot hooks (p613 D5)', () => {
  it('adds them on the first use, once, never at module load', () => {
    expect(fns.addSceneHooks).not.toHaveBeenCalled();
    expect(fns.addBootAfterStartHook).not.toHaveBeenCalled();

    registerDraggableWindow('hooksTestWindow', { keepInViews: true });
    registerDraggableWindow('hooksTestWindow2', { keepInViews: true });
    getDraggableWindow('hooksTestWindow');

    expect(fns.addSceneHooks).toHaveBeenCalledTimes(1);
    expect(fns.addBootAfterStartHook).toHaveBeenCalledTimes(1);
    const hooks = fns.addSceneHooks.mock.calls[0][0];
    expect(Object.keys(hooks).sort()).toEqual(['entered', 'loadSettled', 'loadStart']);
  });
});
