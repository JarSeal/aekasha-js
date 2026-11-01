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

// The current scene: the undo history's bucket
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'physicsScene',
}));

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { _getUndoRedoHistory, _initUndoRedo, _undoLastAction } from '../../../debug/_dbg__UndoRedo';
import { RigidBodyTypeAPI, type RigidBodyAPI } from '../types/PhysicsBodyTypes';
import { ShapeType, type ColliderAPI } from '../types/PhysicsColliderTypes';
import {
  getEntityWireframeColor,
  setEntityWireframeColor,
  WIREFRAME_COLOR_STATES,
} from './_dbg__PhysicsDebugDraw';
import { createEditPhysicsEntityContent } from './_dbg__PhysicsEntityWindow';

// p806 D10: the physics entity window on the UI kit's property grid. Its pose fields edit a copy
// the Set buttons apply and record for undo, as Tweakpane's did

let world: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  world = new ECSWorld();
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  for (const key of Object.keys(ls)) ls.removeItem(key);
  _initUndoRedo();
});

type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };

/** A rigid body's stand-in: its pose, and what the window calls */
const createBody = (position: Vec) => {
  const pose = { position, rotation: { x: 0, y: 0, z: 0, w: 1 } as Quat };
  const body = {
    pose,
    translation: () => ({ ...pose.position }),
    rotation: () => ({ ...pose.rotation }),
    setTranslation: (next: Vec) => (pose.position = { ...next }),
    setRotation: (next: Quat) => (pose.rotation = { ...next }),
    setLinvel: vi.fn(),
    setAngvel: vi.fn(),
    bodyTypeSync: () => RigidBodyTypeAPI.Dynamic,
  };
  return body;
};

const createPhysicsEntity = (appId: string | undefined, colliders: ColliderAPI[] = []) => {
  const entityId = world.createEntity({ appId });
  const body = createBody({ x: 1, y: 2, z: 3 });
  world.addComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL, body as unknown as RigidBodyAPI);
  if (colliders.length) world.addComponent(entityId, ComponentType.COLLIDER, colliders);
  return { entityId, body };
};

const openWindow = (entityId: number, appId?: string) => {
  const cmp = createEditPhysicsEntityContent({ entityId, appId });
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

describe('the physics entity window (p806 D10)', () => {
  it('shows the info rows as text, the collider shapes once they resolve', async () => {
    const collider = { shapeType: async () => ShapeType.Cuboid } as unknown as ColliderAPI;
    const { entityId } = createPhysicsEntity('infoBox', [collider]);
    const root = openWindow(entityId, 'infoBox');
    expect(getField(root, 'App ID').textContent).toContain('infoBox');
    expect(getField(root, 'Type').textContent).toContain('Dynamic body');
    expect(getField(root, 'Collider').textContent).toContain('Loading…');
    await Promise.resolve();
    await Promise.resolve();
    expect(getField(root, 'Collider').textContent).toContain('Cuboid');
  });

  it('applies a rotation step only on "Set rotation", recorded and undone', () => {
    const { entityId, body } = createPhysicsEntity('turnBox');
    const root = openWindow(entityId, 'turnBox');
    const xAngle = getField(root, 'Rotation').querySelector('input')!;
    xAngle.focus();
    dispatchKey(xAngle, 'keydown', 'ArrowUp');
    dispatchKey(xAngle, 'keyup', 'ArrowUp');
    // In degrees: the step is π / 8
    expect(xAngle.value).toBe('22.5');
    expect(body.pose.rotation.w).toBe(1);

    getButton(root, 'Set rotation').click();
    expect(body.pose.rotation.x).toBeCloseTo(Math.sin(Math.PI / 16));
    expect(body.pose.rotation.w).toBeCloseTo(Math.cos(Math.PI / 16));
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Physics entity turnBox: rotation');

    expect(_undoLastAction()).toBe(true);
    expect(body.pose.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('sets the position and cancels the velocities, re-reading the body on "Update"', () => {
    const { entityId, body } = createPhysicsEntity('moveBox');
    const root = openWindow(entityId, 'moveBox');
    const xInput = getField(root, 'Position').querySelector('input')!;
    xInput.focus();
    dispatchKey(xInput, 'keydown', 'ArrowUp');
    dispatchKey(xInput, 'keyup', 'ArrowUp');
    expect(body.pose.position.x).toBe(1);

    getButton(root, 'Set position and cancel velocities').click();
    expect(body.pose.position).toEqual({ x: 2, y: 2, z: 3 });
    expect(body.setLinvel).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, true);
    expect(body.setAngvel).toHaveBeenCalledWith({ x: 0, y: 0, z: 0 }, true);

    // The body moved on (it simulates): the field reads it again only when asked
    body.setTranslation({ x: 5, y: 2, z: 3 });
    expect(xInput.value).toBe('2.00');
    getButton(root, 'Update position input').click();
    expect(xInput.value).toBe('5.00');
  });

  it('toggles the wireframe and resets a colour override, saving the folder state', () => {
    const { entityId } = createPhysicsEntity('wireBox');
    const root = openWindow(entityId, 'wireBox');
    const toggle = root.querySelector<HTMLButtonElement>('.aekFolder__toggle')!;
    expect(toggle.textContent).toBe('Debug wireframe');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(JSON.parse(ls.getItem('AEK_debugPhysicsApiUI')!)).toMatchObject({
      entityWireframeFolderExpanded: true,
    });

    getField(root, 'Show wireframe').querySelector('input')!.click();
    expect(world.hasComponent(entityId, ComponentType.DEBUG_PHYSICS_WIREFRAME)).toBe(true);
    expect(JSON.parse(ls.getItem('AEK_debugPhysicsApiEntities')!)).toEqual({
      wireBox: { visible: true },
    });

    // An entity without an app id says its settings are the session's
    expect(() => getField(root, 'Persistence')).toThrow();
    const session = createPhysicsEntity(undefined);
    expect(getField(openWindow(session.entityId), 'Persistence').textContent).toContain(
      'Session only'
    );

    const resets = [...root.querySelectorAll('button')].filter(
      (button) => button.textContent === 'Reset to default'
    );
    expect(resets).toHaveLength(WIREFRAME_COLOR_STATES.length);
    // An override, then its reset: the entity tracks the global palette again
    const [first, second] = WIREFRAME_COLOR_STATES;
    setEntityWireframeColor(entityId, world, first, 0xff0000);
    setEntityWireframeColor(entityId, world, second, 0x00ff00);
    resets[0].click();
    expect(getEntityWireframeColor(entityId, first)).toBeUndefined();
    expect(getEntityWireframeColor(entityId, second)).toBe(0x00ff00);
    getButton(root, 'Reset all to default').click();
    expect(getEntityWireframeColor(entityId, second)).toBeUndefined();
  });

  it('deletes the entity', () => {
    const { entityId } = createPhysicsEntity('doomedBox');
    const root = openWindow(entityId, 'doomedBox');
    getButton(root, 'Delete physics entity').click();
    expect(world.isAlive(entityId)).toBe(false);
  });
});
