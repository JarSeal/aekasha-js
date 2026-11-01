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
  getCurrentSceneId: () => 'lightScene',
}));

import type * as THREE from 'three/webgpu';
import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { createRootScene } from '../../scene/Scene';
import { createLightEntity } from '../Light';
import { _getUndoRedoHistory, _initUndoRedo, _undoLastAction } from '../../../debug/_dbg__UndoRedo';
import { createEditLightContent } from './_dbg__LightEditWindow';

// p806 D10: the light edit window on the UI kit's property grid, its changes saved and recorded
// for undo at a gesture's end, as Tweakpane's were

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  world = new ECSWorld();
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
  const cmp = createEditLightContent({ id: appId });
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
const getLabels = (root: Element) =>
  [...root.querySelectorAll('.aekField__label')].map((label) => label.textContent);
const getMonitorText = (root: Element, label: string) =>
  getField(root, label).querySelector('.aekMonitor__value')?.textContent;
const isDisabled = (root: Element, label: string) =>
  getField(root, label).hasAttribute('data-disabled');
const getSaved = (appId: string) =>
  (
    JSON.parse(ls.getItem('AEK_debugLights') ?? '{}') as Record<string, unknown> & {
      lightScene?: { lights: Record<string, Record<string, unknown>> };
    }
  ).lightScene?.lights[appId];

const createSun = (appId: string) => {
  const entityId = createLightEntity(
    { type: 'DIRECTIONAL', intensity: 2, castShadow: false },
    { appId }
  );
  const light = world.getComponent(entityId, ComponentType.OBJECT3D)!
    .value as THREE.DirectionalLight;
  return { entityId, light };
};

describe('the light edit window (p806 D10)', () => {
  it("builds a grid of the light's fields, its shadow items and its info rows", () => {
    const { entityId } = createSun('gridSun');
    const root = openWindow('gridSun');
    expect(root.querySelector('.aekPropertyGrid')).not.toBeNull();
    expect(getLabels(root)).toEqual(
      expect.arrayContaining([
        'Enabled',
        'Color',
        'Intensity',
        'Position',
        'Target position',
        'Cast shadow',
        'Shadow bias',
        'Shadow map width',
        'Near',
        'Left',
        'Entity ID',
        'App ID',
        'Type',
      ])
    );
    expect(getMonitorText(root, 'Entity ID')).toBe(String(entityId));
    expect(getMonitorText(root, 'App ID')).toBe('gridSun');
    expect(getMonitorText(root, 'Type')).toBe('DirectionalLight');
    // The info is text, never HTML holding values
    expect(root.querySelector('.winSmallLabel')).toBeNull();
    world.deleteEntity(entityId);
  });

  it('enables the shadow fields when the light casts a shadow, saved and recorded', () => {
    const { entityId, light } = createSun('shadowSun');
    const root = openWindow('shadowSun');
    expect(isDisabled(root, 'Shadow bias')).toBe(true);
    expect(isDisabled(root, 'Shadow map width')).toBe(true);

    getField(root, 'Cast shadow').querySelector<HTMLInputElement>('input')!.click();
    expect(light.castShadow).toBe(true);
    expect(isDisabled(root, 'Shadow bias')).toBe(false);
    expect(isDisabled(root, 'Shadow map width')).toBe(false);
    expect(getSaved('shadowSun')?.castShadow).toBe(true);
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Light shadowSun: cast shadow');
    world.deleteEntity(entityId);
  });

  it("saves and records a key step at the gesture's end, with the value before it", () => {
    const { entityId, light } = createSun('stepSun');
    const root = openWindow('stepSun');
    const input = getField(root, 'Intensity').querySelector('input')!;
    input.focus();
    dispatchKey(input, 'keydown', 'ArrowUp');
    // Applied on every write, saved and recorded only on the keyup
    expect(light.intensity).toBeCloseTo(2.01);
    expect(getSaved('stepSun')?.intensity).toBeUndefined();
    expect(_getUndoRedoHistory()).toHaveLength(0);

    dispatchKey(input, 'keyup', 'ArrowUp');
    expect(getSaved('stepSun')?.intensity).toBeCloseTo(2.01);
    expect(_getUndoRedoHistory()).toHaveLength(1);

    expect(_undoLastAction()).toBe(true);
    expect(light.intensity).toBe(2);
    expect(getSaved('stepSun')?.intensity).toBe(2);
    world.deleteEntity(entityId);
  });

  it("saves the shadow folders' open states, and opens them as saved", () => {
    const { entityId } = createSun('folderSun');
    const root = openWindow('folderSun');
    const toggles = [...root.querySelectorAll<HTMLButtonElement>('.aekFolder__toggle')];
    const shadowToggle = toggles.find((toggle) => toggle.textContent === 'Shadow')!;
    expect(shadowToggle.getAttribute('aria-expanded')).toBe('false');
    shadowToggle.click();
    expect(getSaved('folderSun')?._shadowFolderOpen).toBe(true);

    const reopened = openWindow('folderSun');
    const reopenedToggle = [
      ...reopened.querySelectorAll<HTMLButtonElement>('.aekFolder__toggle'),
    ].find((toggle) => toggle.textContent === 'Shadow')!;
    expect(reopenedToggle.getAttribute('aria-expanded')).toBe('true');
    world.deleteEntity(entityId);
  });

  it('enables the clear button once a change is saved, and clears the saved values', () => {
    const { entityId } = createSun('clearSun');
    const root = openWindow('clearSun');
    const clearButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Clear local storage'
    )!;
    expect(clearButton.disabled).toBe(true);
    getField(root, 'Enabled').querySelector<HTMLInputElement>('input')!.click();
    expect(clearButton.disabled).toBe(false);

    clearButton.click();
    expect(getSaved('clearSun')).toBeUndefined();
    expect(clearButton.disabled).toBe(true);
    world.deleteEntity(entityId);
  });
});
