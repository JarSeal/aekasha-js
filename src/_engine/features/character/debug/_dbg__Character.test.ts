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

// The characters: one stand-in, deleted through the mock
const characters = vi.hoisted(() => ({
  byId: new Map<string, unknown>(),
  deleted: [] as string[],
}));
vi.mock(import('../Character'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCharacterById: ((id: string) => characters.byId.get(id)) as never,
  deleteCharacter: ((id: string) => {
    characters.deleted.push(id);
  }) as never,
}));
// The current scene: the undo history's bucket
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'charScene',
}));

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../../../kernel/ecs/ECS';
import { ComponentType } from '../../../kernel/ecs/ECSCoreComponents';
import { _getUndoRedoHistory, _initUndoRedo, _undoLastAction } from '../../../debug/_dbg__UndoRedo';
import type { RigidBodyAPI } from '../../physics/types/PhysicsBodyTypes';
import { createEditCharacterContent } from './_dbg__Character';

// p806 D10: the character edit window on the UI kit's property grid: the shared pose rows
// (_dbg__BodyPoseItems.ts) recorded per character, its buttons and its info rows as text

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
  characters.byId.clear();
  characters.deleted.length = 0;
  _initUndoRedo();
});

const createCharacter = (id: string) => {
  const entityId = world.createEntity({ appId: id });
  const pose = { position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
  const body = {
    translation: () => ({ ...pose.position }),
    rotation: () => ({ ...pose.rotation }),
    setTranslation: (next: typeof pose.position) => (pose.position = { ...next }),
    setRotation: (next: typeof pose.rotation) => (pose.rotation = { ...next }),
    setLinvel: vi.fn(),
    setAngvel: vi.fn(),
  };
  world.addComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL, body as unknown as RigidBodyAPI);
  characters.byId.set(id, {
    id,
    name: 'Hero',
    entityId,
    visualId: 'heroMesh',
    bodyKind: 'HUMANOID_CAPSULE',
    controlMode: 'PLAYER',
    controller: { kind: 'DYNAMIC_CHARACTER' },
    brain: undefined,
    keyBindingIds: [],
    mouseBindingIds: [],
  });
  return { pose };
};

const openWindow = (id: string) => {
  const cmp = createEditCharacterContent({ id });
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

describe('the character window (p806 D10)', () => {
  it('shows the info rows as text, without the empty binding rows', () => {
    createCharacter('hero');
    const root = openWindow('hero');
    expect(getField(root, 'Name').textContent).toContain('Hero');
    expect(getField(root, 'Controller').textContent).toContain('DYNAMIC_CHARACTER');
    expect(getField(root, 'Brain').textContent).toContain('- (code)');
    expect(() => getField(root, 'Key binding IDs')).toThrow();
  });

  it('records a set position per character, undone', () => {
    const { pose } = createCharacter('mover');
    const root = openWindow('mover');
    const xInput = getField(root, 'Position').querySelector('input')!;
    xInput.focus();
    dispatchKey(xInput, 'keydown', 'ArrowUp');
    dispatchKey(xInput, 'keyup', 'ArrowUp');
    getButton(root, 'Set position').click();
    expect(pose.position.x).toBe(2);
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Character mover: position');
    expect(_undoLastAction()).toBe(true);
    expect(pose.position.x).toBe(1);
  });

  it('removes the character', () => {
    createCharacter('doomed');
    getButton(openWindow('doomed'), 'Remove character (this page load only)').click();
    expect(characters.deleted).toEqual(['doomed']);
  });
});
