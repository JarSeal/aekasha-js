import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
const ls = vi.hoisted(() => {
  type Items = { [key: string]: string };
  const storage = Object.create({
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
  vi.stubGlobal('localStorage', storage);
  return storage;
});

// The current scene: the saved values' and the undo history's bucket
vi.mock(import('../../scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'cameraScene',
}));

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { createFeatureHost } from '../../init/Features';
import { createRootScene } from '../../scene/Scene';
import { createCameraEntity, installCameras } from '../Camera';
import { _getUndoRedoHistory, _initUndoRedo, _undoLastAction } from '../../../debug/_dbg__UndoRedo';
import { createEditCameraContent } from './_dbg__CameraEditWindow';

// p806 D10: the camera edit window on the UI kit's property grid, its changes saved and recorded
// for undo at a gesture's end, as Tweakpane's were

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  world = new ECSWorld();
  installCameras(createFeatureHost({}).ctx);
  createRootScene();
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  for (const key of Object.keys(ls)) ls.removeItem(key);
  _initUndoRedo();
});

const openWindow = (appId: string) => {
  const cmp = createEditCameraContent({ id: appId });
  document.body.append(cmp.elem);
  built.push(cmp);
  return cmp.elem;
};

const getField = (root: Element, label: string) => {
  const field = [...root.querySelectorAll<HTMLElement>('.aekField')].find(
    (elem) => elem.querySelector('.aekField__label')?.textContent === label
  );
  if (!field) throw new Error(`No field "${label}"`);
  return field;
};
const getButton = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === text
  )!;
const getSaved = (appId: string) =>
  (
    JSON.parse(ls.getItem('AEK_debugCams') ?? '{}') as Record<string, unknown> & {
      cameraScene?: { cams: Record<string, Record<string, unknown>> };
    }
  ).cameraScene?.cams[appId];

describe('the camera edit window (p806 D10)', () => {
  it("disables Delete with its reason while it's the only camera", () => {
    const only = createCameraEntity({ type: 'PERSPECTIVE' }, { appId: 'onlyCam' });
    const root = openWindow('onlyCam');
    const deleteButton = getButton(root, 'Delete camera');
    // A tab stop while disabled, its reason the tooltip
    expect(deleteButton.getAttribute('aria-disabled')).toBe('true');
    expect(deleteButton.disabled).toBe(false);
    deleteButton.click();
    expect(world.isAlive(only)).toBe(true);

    // Another camera: this one can go
    const other = createCameraEntity({ type: 'PERSPECTIVE' }, { appId: 'otherCam' });
    const otherRoot = openWindow('otherCam');
    expect(getButton(otherRoot, 'Delete camera').getAttribute('aria-disabled')).toBeNull();
    world.deleteEntity(other);
  });

  it('names the fov after the responsive aspect without a rebuild', () => {
    createCameraEntity({ type: 'PERSPECTIVE', responsiveAspect: false }, { appId: 'fovCam' });
    const root = openWindow('fovCam');
    expect(getField(root, 'Fov').hidden).toBe(false);
    expect(getField(root, 'Fov (base, @ ref aspect)').hidden).toBe(true);

    const toggle = getField(root, 'Responsive aspect').querySelector('input')!;
    toggle.click();
    expect(getField(root, 'Fov').hidden).toBe(true);
    expect(getField(root, 'Fov (base, @ ref aspect)').hidden).toBe(false);
    expect(getSaved('fovCam')?.responsiveAspect).toBe(true);
    // The same element: the focus would stay on it
    expect(getField(root, 'Responsive aspect').querySelector('input')).toBe(toggle);
  });

  it("moves the camera on each step, saved and recorded at the gesture's end", () => {
    const entityId = createCameraEntity(
      { type: 'PERSPECTIVE', position: { x: 1, y: 2, z: 3 } },
      { appId: 'moveCam' }
    );
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
    const root = openWindow('moveCam');
    const xInput = getField(root, 'Position').querySelector('input')!;
    xInput.focus();
    dispatchKey(xInput, 'keydown', 'ArrowUp');
    expect(transform.position.x).toBe(2);
    expect(getSaved('moveCam')?.position).toBeUndefined();

    dispatchKey(xInput, 'keyup', 'ArrowUp');
    expect(getSaved('moveCam')?.position).toEqual({ x: 2, y: 2, z: 3 });
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Camera moveCam: position');

    expect(_undoLastAction()).toBe(true);
    expect(transform.position.x).toBe(1);
  });

  it("saves the lens folder's open state", () => {
    createCameraEntity({ type: 'ORTHOGRAPHIC' }, { appId: 'lensCam' });
    const root = openWindow('lensCam');
    const toggle = root.querySelector<HTMLButtonElement>('.aekFolder__toggle')!;
    expect(toggle.textContent).toBe('Lens settings');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(getSaved('lensCam')?._lensSettingsOpen).toBe(true);
    // An orthographic camera's base is its frustum size
    expect(getField(root, 'Frustum size').hidden).toBe(false);
  });
});
