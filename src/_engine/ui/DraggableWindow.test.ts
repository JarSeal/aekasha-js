import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SceneHooks } from '../kernel/scene/SceneHooks';

// The hooks the windows add, kept (the mocks' calls are cleared between tests)
const added = vi.hoisted(() => ({
  sceneHooks: null as SceneHooks | null,
  afterStart: null as (() => void) | null,
}));
const fns = vi.hoisted(() => ({
  addSceneHooks: vi.fn<(hooks: SceneHooks) => () => void>((hooks) => {
    added.sceneHooks = hooks;
    return () => {};
  }),
  addBootAfterStartHook: vi.fn<(hook: () => void) => boolean>((hook) => {
    added.afterStart = hook;
    return true;
  }),
}));

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
const storage = vi.hoisted(() => {
  type Items = { [key: string]: string };
  const ls = Object.create({
    getItem(this: Items, key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    },
    setItem(this: Items, key: string, value: string) {
      this[key] = String(value);
    },
    removeItem(this: Items, key: string) {
      delete this[key];
    },
  }) as Storage & Items;
  vi.stubGlobal('localStorage', ls);
  return ls;
});

vi.mock(import('../kernel/scene/SceneHooks'), () => ({ addSceneHooks: fns.addSceneHooks }));
vi.mock(import('../kernel/init/BootHooks'), () => ({
  addBootAfterStartHook: fns.addBootAfterStartHook,
}));

import { CMP } from './CMP';
import {
  closeDraggableWindow,
  getDraggableWindow,
  getKindWindowId,
  openDraggableWindow,
  registerDraggableWindow,
  registerDraggableWindowKind,
} from './DraggableWindow';
import { createHudContainer } from './HUD';

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

/** linkedom's document and window, with what it lacks for the windows' layout reads */
const stubDom = async () => {
  const { parseHTML } = await import('linkedom');
  const { document, window } = parseHTML(
    '<!doctype html><html><head></head><body><div id="hudSlot"></div></body></html>'
  );
  Object.assign(window, { innerWidth: 1280, innerHeight: 720 });
  Object.assign(window.HTMLElement.prototype, { getClientRects: () => [{}] });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  vi.stubGlobal('HTMLInputElement', window.HTMLInputElement);
  return document;
};

describe('draggable windows: open, reopen, kinds, scene changes, LS', () => {
  beforeAll(async () => {
    const document = await stubDom();
    createHudContainer(document.getElementById('hudSlot') as HTMLElement);
  });

  it('opens a window with its props, and mounts it in the HUD', () => {
    openDraggableWindow({ id: 'win1', title: 'One', size: { w: 200, h: 150 } });
    const win = getDraggableWindow('win1')!;
    expect(win).toMatchObject({ isOpen: true, title: 'One', isActive: true });
    expect(win.geometry).toMatchObject({ w: 200, h: 150 });
    expect(win.windowCMP?.elem.parentElement?.id).toBe('hudRoot');
    // A draggable window's centred position became px at mount
    expect(win.units?.position).toBeUndefined();
  });

  it("keeps the user's layout on a reopen unless reset; a passed flag or title wins", () => {
    openDraggableWindow({ id: 'win2', size: { w: 200, h: 150 }, disableCloseBtn: true });
    openDraggableWindow({ id: 'win2', size: { w: 400, h: 300 }, title: 'Two' });
    let win = getDraggableWindow('win2')!;
    expect(win.geometry).toMatchObject({ w: 200, h: 150 });
    expect(win).toMatchObject({ title: 'Two', disableCloseBtn: true });
    openDraggableWindow({ id: 'win2', size: { w: 400, h: 300 }, resetSize: true });
    openDraggableWindow({ id: 'win2', disableCloseBtn: false });
    win = getDraggableWindow('win2')!;
    expect(win.geometry).toMatchObject({ w: 400, h: 300 });
    expect(win.disableCloseBtn).toBe(false);
  });

  it("builds a kind's windows from its content, and removes one on close", () => {
    const onClose = vi.fn();
    registerDraggableWindowKind('edit', {
      content: (data) => CMP({ text: `entity ${String(data?.entityId)}` }),
      onClose,
    });
    const id = getKindWindowId('edit', 7);
    expect(id).toBe('edit_7');
    openDraggableWindow({ id, kind: 'edit', data: { entityId: 7 } });
    expect(getDraggableWindow(id)?.windowCMP?.elem.textContent).toContain('entity 7');
    closeDraggableWindow(id);
    expect(getDraggableWindow(id)).toBeUndefined();
    expect(onClose).toHaveBeenCalledWith(id);
  });

  it('suspends a scene window over a load, and keeps it when its target exists', () => {
    const target = { exists: true };
    registerDraggableWindow('sceneWin', {
      content: () => CMP({ text: 'scene' }),
      sceneTargetResolver: () => target.exists,
    });
    openDraggableWindow({ id: 'sceneWin', closeOnSceneChange: true });
    const hooks = added.sceneHooks!;

    hooks.loadStart!();
    expect(getDraggableWindow('sceneWin')).toMatchObject({ isOpen: true, windowCMP: undefined });
    hooks.entered!();
    expect(getDraggableWindow('sceneWin')?.windowCMP).toBeDefined();

    target.exists = false;
    hooks.loadStart!();
    hooks.entered!();
    expect(getDraggableWindow('sceneWin')?.isOpen).toBe(false);
  });

  it('closes the windows a failed load suspended', () => {
    registerDraggableWindow('failWin', {
      content: () => CMP({ text: 'fail' }),
      sceneTargetResolver: () => true,
    });
    openDraggableWindow({ id: 'failWin', closeOnSceneChange: true });
    const hooks = added.sceneHooks!;
    hooks.loadStart!();
    hooks.loadSettled!(); // no entered: the load failed
    expect(getDraggableWindow('failWin')?.isOpen).toBe(false);
  });

  it('saves a saveToLS window, and a fresh page restores it after the start', async () => {
    openDraggableWindow({
      id: 'savedWin',
      title: 'Saved',
      saveToLS: true,
      size: { w: 250, h: 180 },
    });
    const saved = JSON.parse(storage.getItem('AEK_popupWindows')!);
    expect(saved.savedWin).toMatchObject({ title: 'Saved', isOpen: true, saveToLS: true });
    expect(saved.win1).toBeUndefined(); // not saveToLS

    // A reload: the modules start over, LS stays
    vi.resetModules();
    const document = await stubDom();
    const hud = await import('./HUD');
    const cmp = await import('./CMP');
    const windows = await import('./DraggableWindow');
    hud.createHudContainer(document.getElementById('hudSlot') as HTMLElement);
    windows.registerDraggableWindow('savedWin', { content: () => cmp.CMP({ text: 'restored' }) });
    expect(windows.getDraggableWindow('savedWin')).toMatchObject({ isOpen: true, title: 'Saved' });
    expect(windows.getDraggableWindow('savedWin')?.windowCMP).toBeUndefined();

    // The boot's after-start step
    added.afterStart!();
    const restored = windows.getDraggableWindow('savedWin')!;
    expect(restored.windowCMP?.elem.textContent).toContain('restored');
    expect(restored.geometry).toMatchObject({ w: 250, h: 180 });
  });
});
