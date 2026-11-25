import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../ui/testing/KitDom';

// localStorage before anything reads it (the storage helpers check it once)
vi.hoisted(() => {
  const items: { [key: string]: string } = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items[key] ?? null,
    setItem: (key: string, value: string) => (items[key] = String(value)),
    removeItem: (key: string) => delete items[key],
  });
});

// The rows go in the HUD root; the scenes and the undo history are this test's
const hud = vi.hoisted(() => ({ root: null as CMPHandle | null }));
vi.mock(import('../ui/core/HUD'), async (importOriginal) => ({
  ...(await importOriginal()),
  getHUDRootCMP: () => hud.root as CMPHandle,
}));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'sceneA',
  getGeneratedAppData: () =>
    ({ scenes: { sceneA: { name: 'Scene A' }, sceneB: {} } }) as unknown as ReturnType<
      typeof import('../kernel/scene/Scene').getGeneratedAppData
    >,
}));
const history = vi.hoisted(() => ({ canUndo: false, undo: vi.fn() }));
vi.mock(import('./UndoRedo'), async (importOriginal) => ({
  ...(await importOriginal()),
  canUndo: () => history.canUndo,
  canRedo: () => false,
  undoLastAction: history.undo,
}));
// No ECS world: no cameras
vi.mock(import('../kernel/camera/Camera'), async (importOriginal) => ({
  ...(await importOriginal()),
  getAllCamerasAsArray: () => [],
  getMainAppCameraId: () => null,
  isDebugCameraActive: () => false,
  isAnyCameraHelperVisible: () => false,
}));
const about = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock(import('./_dbg__About'), () => ({ openAboutDialog: about.open }));
// The saves' states are this test's (`_dbg__SaveData.test.ts` has the saves)
const save = vi.hoisted(() => ({
  isSaving: false,
  reason: 'Nothing to save in this scene' as string | null,
  specificReason: 'Nothing to save' as string | null,
  save: vi.fn(),
  openSpecific: vi.fn(),
}));
vi.mock(import('./_dbg__SaveData'), async (importOriginal) => ({
  ...(await importOriginal()),
  _isSaving: () => save.isSaving,
  _getSaveSceneDisabledReason: () => (save.isSaving ? 'Saving…' : save.reason),
  _refreshSaveStatus: vi.fn(),
  _saveSceneAsync: save.save,
  _getSaveSpecificDisabledReason: () => (save.isSaving ? 'Saving…' : save.specificReason),
  _openSaveSpecificAsync: save.openSpecific,
}));

import type { CMPHandle } from '../ui/core/CMPTypes';
import { CMP } from '../ui/core/CMP';
import { initEnvironment } from '../kernel/config/Config';
import { getReadOnlyLoopState } from '../kernel/loop/MainLoop';
import { registerBuiltInIcons } from '../ui/core/icons/SvgIcon';
import { DEBUGGER_ROOT_ATTR } from '../ui/overlays/OverlayStack';
import {
  _getOnScreenToolsTestInfo,
  _InitOnScreenTools,
  _setOnScreenToolsDisabled,
  _toggleOnScreenDropDown,
  _updateOnScreenTools,
} from './_dbg__OnScreenTools';

const LOADING = 'Loading the scene…';

const getToolbars = () =>
  _getOnScreenToolsTestInfo().rows.flatMap((row) => [
    ...row.elem.querySelectorAll<HTMLElement>('[role="toolbar"]'),
  ]);
const getToolbar = (name: string) =>
  getToolbars().find((toolbar) => toolbar.getAttribute('aria-label') === name) as HTMLElement;
/** A tool by its accessible name: a button's label, a drop-down trigger's text */
const getTool = (name: string) =>
  getToolbars()
    .flatMap((toolbar) => [...toolbar.querySelectorAll<HTMLElement>('button')])
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name) as HTMLElement;
const getControls = () =>
  getToolbars().flatMap((toolbar) => [
    ...toolbar.querySelectorAll<HTMLElement>('.aekButton, .aekDropDownTrigger'),
  ]);
const getMenu = () => document.querySelector<HTMLElement>('.aekMenu');
const click = (elem: HTMLElement) =>
  elem.dispatchEvent(new window.Event('click', { bubbles: true }));

beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  registerBuiltInIcons();
  hud.root = CMP({ id: 'hudRoot', idAttr: true });
  document.body.appendChild(hud.root.elem);
  _InitOnScreenTools();
});

describe('the on-screen tools (p806 D7)', () => {
  it('are kit toolbars in three debugger roots, each one tab stop', () => {
    const { rows } = _getOnScreenToolsTestInfo();
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.elem.hasAttribute(DEBUGGER_ROOT_ATTR)).toBe(true);
    expect(getToolbars().map((t) => t.getAttribute('aria-label'))).toEqual([
      'Debugger',
      'Play',
      'Scene and camera',
    ]);
    const play = getToolbar('Play');
    const stops = [...play.querySelectorAll('button')].map((b) => b.getAttribute('tabindex'));
    expect(stops).toEqual(['0', '-1', '-1']);
    // A toggle says its state; its tooltip names its key
    const mainLoop = getTool('Play the main loop');
    expect(mainLoop.getAttribute('aria-pressed')).toBe(String(getReadOnlyLoopState().masterPlay));
    expect(getTool('Scene A')).toBeTruthy();
    // Nothing to undo
    expect(getTool('Undo').getAttribute('aria-disabled')).toBe('true');
    expect(getTool('Ækasha menu').hasAttribute('aria-disabled')).toBe(false);
  });

  it('refresh in place: a pressed toggle keeps its element and the focus', () => {
    const pause = getTool('Pause the app loop');
    const wasPressed = pause.getAttribute('aria-pressed');
    pause.focus();
    click(pause);
    expect(getTool('Pause the app loop')).toBe(pause);
    expect(pause.getAttribute('aria-pressed')).not.toBe(wasPressed);
    expect(document.activeElement).toBe(pause);
    click(pause);
    expect(pause.getAttribute('aria-pressed')).toBe(wasPressed);

    history.canUndo = true;
    _updateOnScreenTools('UNDO');
    const undo = getTool('Undo');
    expect(undo.hasAttribute('aria-disabled')).toBe(false);
    click(undo);
    expect(history.undo).toHaveBeenCalledTimes(1);
    history.canUndo = false;
    _updateOnScreenTools('UNDO');
    expect(getTool('Undo')).toBe(undo);
  });

  it('move the focus with the arrows inside a group', () => {
    const aekasha = getTool('Ækasha menu');
    aekasha.focus();
    dispatchKey(aekasha, 'keydown', 'ArrowRight');
    // Undo is aria-disabled, still a stop
    expect(document.activeElement).toBe(getTool('Undo'));
  });

  it('are all aria-disabled during a scene load, their tooltips saying why, and back after', () => {
    _toggleOnScreenDropDown('SCENE');
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    const pause = getTool('Pause the app loop');
    pause.focus();
    const pressed = pause.getAttribute('aria-pressed');

    _setOnScreenToolsDisabled(true);
    expect(_getOnScreenToolsTestInfo().isDisabled).toBe(true);
    const controls = getControls();
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) {
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.hasAttribute('disabled')).toBe(false);
    }
    // The open drop-down closed; the focus stayed
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(pause);
    expect(getTool('Scene A').getAttribute('title')).toBe(LOADING);
    // Their described-by tooltip is the reason
    expect(pause.getAttribute('aria-describedby')).toMatch(/\S/);
    click(pause);
    click(getTool('Ækasha menu'));
    expect(pause.getAttribute('aria-pressed')).toBe(pressed);
    expect(getMenu()).toBeNull();
    _toggleOnScreenDropDown('SCENE');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    // A refresh meanwhile keeps them disabled
    _updateOnScreenTools();
    expect(getTool('Ækasha menu').getAttribute('aria-disabled')).toBe('true');

    _setOnScreenToolsDisabled(false);
    expect(getTool('Ækasha menu').hasAttribute('aria-disabled')).toBe(false);
    expect(getTool('Scene A').getAttribute('title')).toBe('Change scene (P)');
    // Nothing to undo still
    expect(getTool('Undo').getAttribute('aria-disabled')).toBe('true');
    click(getTool('Ækasha menu'));
    expect(getMenu()).not.toBeNull();
    click(getTool('Ækasha menu'));
    expect(getMenu()).toBeNull();
  });
});

describe('the Æ menu (p355 §2.2)', () => {
  const getItems = () => [...(getMenu()?.querySelectorAll<HTMLElement>('.aekMenu__item') ?? [])];
  const getItem = (label: string) =>
    getItems().find((item) => item.textContent?.startsWith(label)) as HTMLElement;

  it('is the Æ button’s menu: Save scene, Save specific data…, a separator, About Ækasha', () => {
    const aekasha = getTool('Ækasha menu');
    expect(aekasha.getAttribute('aria-haspopup')).toBe('menu');
    aekasha.focus();
    click(aekasha);
    expect(getMenu()?.getAttribute('aria-label')).toBe('Ækasha menu');
    expect(getItems().map((item) => item.querySelector('.aekMenu__label')?.textContent)).toEqual([
      'Save scene',
      'Save specific data…',
      'About Ækasha',
    ]);
    expect(getMenu()?.querySelectorAll('[role="separator"]')).toHaveLength(1);
    // The save key's hint: the platform's chord (not a Mac here), not both
    expect(getItem('Save scene').getAttribute('aria-keyshortcuts')).toBe('Control+S');
    expect(getItem('Save specific data…').getAttribute('aria-keyshortcuts')).toBe(
      'Control+Shift+S'
    );
    click(getItem('About Ækasha'));
    expect(getMenu()).toBeNull();
    expect(about.open).toHaveBeenCalledTimes(1);
  });

  it('disables Save scene with its reason, read on every open', () => {
    click(getTool('Ækasha menu'));
    const saveItem = getItem('Save scene');
    expect(saveItem.getAttribute('aria-disabled')).toBe('true');
    expect(saveItem.getAttribute('aria-describedby')).toMatch(/\S/);
    click(saveItem);
    expect(save.save).not.toHaveBeenCalled();
    click(getTool('Ækasha menu'));

    save.reason = null;
    click(getTool('Ækasha menu'));
    expect(getItem('Save scene').hasAttribute('aria-disabled')).toBe(false);
    click(getItem('Save scene'));
    expect(getMenu()).toBeNull();
    expect(save.save).toHaveBeenCalledTimes(1);
  });

  it('keeps Save specific data… on while another scene has a change, Save scene off', () => {
    click(getTool('Ækasha menu'));
    expect(getItem('Save specific data…').getAttribute('aria-disabled')).toBe('true');
    click(getTool('Ækasha menu'));

    save.reason = 'Nothing to save in this scene';
    save.specificReason = null;
    click(getTool('Ækasha menu'));
    expect(getItem('Save scene').getAttribute('aria-disabled')).toBe('true');
    expect(getItem('Save specific data…').hasAttribute('aria-disabled')).toBe(false);
    click(getItem('Save specific data…'));
    expect(getMenu()).toBeNull();
    expect(save.openSpecific).toHaveBeenCalledTimes(1);
  });

  it('while a save runs: the Æ button is busy and disabled, its menu closed and off', () => {
    const aekasha = getTool('Ækasha menu');
    click(aekasha);
    expect(getMenu()).not.toBeNull();
    save.isSaving = true;
    _updateOnScreenTools('UNDO');
    expect(getTool('Ækasha menu')).toBe(aekasha);
    expect(aekasha.getAttribute('aria-busy')).toBe('true');
    expect(aekasha.getAttribute('aria-disabled')).toBe('true');
    expect(getMenu()).toBeNull();
    click(aekasha);
    dispatchKey(aekasha, 'keydown', 'ArrowDown');
    expect(getMenu()).toBeNull();

    save.isSaving = false;
    _updateOnScreenTools('UNDO');
    expect(aekasha.hasAttribute('aria-busy')).toBe(false);
    expect(aekasha.hasAttribute('aria-disabled')).toBe(false);
    click(aekasha);
    expect(getMenu()).not.toBeNull();
    click(aekasha);
  });
});
