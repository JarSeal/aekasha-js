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

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { ECSWorld } from '../ECS';
import { _initECSDebugGUI, createEditECSWorldContent } from './_dbg__ECS';

// p806 D10: the ECS world window on the UI kit's property grid: the count refreshed by the entity
// listener, a storage change saved and the app reloaded at a gesture's end

const reload = vi.fn();
let world: ECSWorld;
let secondWorld: ECSWorld;
beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  world = new ECSWorld();
  secondWorld = new ECSWorld({ id: 'second', name: 'Second world' });
  // Registers the entity count listener
  _initECSDebugGUI();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  for (const key of Object.keys(ls)) ls.removeItem(key);
  reload.mockClear();
});

const openWindow = (id: string) => {
  const cmp = createEditECSWorldContent({ id });
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
  );

describe('the ECS world window (p806 D10)', () => {
  it("refreshes the entity count when the world's entities change", () => {
    const root = openWindow('second');
    const count = getField(root, 'Entity count');
    const before = secondWorld.getEntityCount();
    expect(count.textContent).toContain(String(before));
    secondWorld.createEntity();
    expect(count.textContent).toContain(String(before + 1));
    expect(getField(root, 'Name').textContent).toContain('Second world');
  });

  it("saves max entities and reloads at the gesture's end only", () => {
    const root = openWindow('second');
    expect(getButton(root, 'Clear local storage')?.disabled).toBe(true);
    const input = getField(root, 'Max entities').querySelector('input')!;
    input.focus();
    dispatchKey(input, 'keydown', 'ArrowUp');
    expect(reload).not.toHaveBeenCalled();
    dispatchKey(input, 'keyup', 'ArrowUp');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ls.getItem('AEK_ecs')!).second.maxEntities).toBe(
      secondWorld.maxEntities + 1000
    );
  });

  it('offers Delete world for a world other than the default', () => {
    expect(getButton(openWindow(world.id), 'Delete world')).toBeUndefined();
    expect(getButton(openWindow('second'), 'Delete world')).toBeDefined();
  });
});
