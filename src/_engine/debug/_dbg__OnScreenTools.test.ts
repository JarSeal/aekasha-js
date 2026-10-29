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
    expect(getTool('About Ækasha').hasAttribute('aria-disabled')).toBe(false);
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
    const about = getTool('About Ækasha');
    about.focus();
    dispatchKey(about, 'keydown', 'ArrowRight');
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
    click(getTool('About Ækasha'));
    expect(pause.getAttribute('aria-pressed')).toBe(pressed);
    expect(about.open).not.toHaveBeenCalled();
    _toggleOnScreenDropDown('SCENE');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    // A refresh meanwhile keeps them disabled
    _updateOnScreenTools();
    expect(getTool('About Ækasha').getAttribute('aria-disabled')).toBe('true');

    _setOnScreenToolsDisabled(false);
    expect(getTool('About Ækasha').hasAttribute('aria-disabled')).toBe(false);
    expect(getTool('Scene A').getAttribute('title')).toBe('Change scene (P)');
    // Nothing to undo still
    expect(getTool('Undo').getAttribute('aria-disabled')).toBe('true');
    click(getTool('About Ækasha'));
    expect(about.open).toHaveBeenCalledTimes(1);
  });
});
