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

// The scene's chain: one pass per test, its param writes kept
const chain = vi.hoisted(() => ({
  passes: [] as import('../PostFX').PostFxPassInfo[],
  writes: [] as { key: string; value: unknown }[],
}));
vi.mock(import('../PostFX'), async (importOriginal) => ({
  ...(await importOriginal()),
  getPostFxPasses: () => chain.passes,
  setPostFxPassParam: (_id: string, key: string, value: unknown) => {
    chain.writes.push({ key, value });
    chain.passes[0].params[key] = value;
  },
  setPostFxPassEnabled: (_id: string, enabled: boolean) => {
    chain.passes[0].enabled = enabled;
  },
}));
// The current scene: the undo history's bucket
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'fxScene',
}));

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { _getUndoRedoHistory, _initUndoRedo } from '../../../debug/_dbg__UndoRedo';
import type { PostFxPassInfo } from '../PostFX';
import { createEditPostFxPassContent } from './_dbg__PostFX';

// p806 D10: a PostFX pass's edit window on the UI kit's property grid, each param's field from its
// value and paramsMeta (getParamField), an edit recorded at its gesture's end

beforeAll(async () => {
  await stubKitDomAsync();
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  for (const key of Object.keys(ls)) ls.removeItem(key);
  chain.writes.length = 0;
  _initUndoRedo();
});

const openWindow = (pass: Partial<PostFxPassInfo>) => {
  chain.passes = [
    { id: 'fx', index: 0, enabled: true, params: {}, liveParams: 'setParam', ...pass },
  ];
  const cmp = createEditPostFxPassContent({ id: 'fx' });
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

describe('the PostFX pass window (p806 D10)', () => {
  it("makes each param's field from its value and paramsMeta", () => {
    const root = openWindow({
      params: {
        strength: 0.5,
        offset: { x: 1, y: 2 },
        tint: { r: 255, g: 128, b: 0 },
        mode: 'ADD',
        curve: [1, 2, 3, 4, 5],
        secret: 1,
      },
      paramsMeta: {
        strength: { label: 'Strength', min: 0, max: 2, step: 0.1 },
        offset: { min: -5, max: 5, step: 1 },
        mode: { options: { Add: 'ADD', Multiply: 'MUL' } },
        secret: { hidden: true },
      },
    });
    expect(getField(root, 'Strength').dataset.kind).toBe('slider');
    expect(getField(root, 'offset').querySelectorAll('input')).toHaveLength(2);
    expect(getField(root, 'tint').dataset.kind).toBe('color');
    // A 0..255 colour is shown as the colour it is
    expect(getField(root, 'tint').querySelector('input')!.value.toLowerCase()).toBe('#ff8000');
    expect(getField(root, 'mode').dataset.kind).toBe('select');
    expect(getField(root, 'curve (JSON, readonly)').textContent).toContain('[1,2,3,4,5]');
    expect(() => getField(root, 'secret')).toThrow();
    // The info rows, as text
    expect(getField(root, 'Param edits').textContent).toContain('Live');
  });

  it('follows a live drag and records the gesture once, with its prev', () => {
    const root = openWindow({ params: { strength: 0.5 }, paramsMeta: { strength: { step: 0.1 } } });
    const input = getField(root, 'strength').querySelector('input')!;
    input.focus();
    dispatchKey(input, 'keydown', 'ArrowUp');
    dispatchKey(input, 'keydown', 'ArrowUp');
    expect(chain.writes.map((write) => write.value)).toEqual([0.6, 0.7]);
    expect(_getUndoRedoHistory()).toHaveLength(0);

    dispatchKey(input, 'keyup', 'ArrowUp');
    const entry = _getUndoRedoHistory().at(-1);
    expect(entry?.label).toBe('PostFX fx: strength');
    expect(entry?.payload).toMatchObject({ key: 'strength', prev: 0.5, next: 0.7 });
  });

  it("says when a pass without live params takes its edits, and doesn't follow the drag", () => {
    const root = openWindow({ params: { samples: 16 }, liveParams: 'rebuild' });
    expect(root.querySelector('p')?.textContent).toContain('no live param updates');
    const input = getField(root, 'samples').querySelector('input')!;
    input.focus();
    dispatchKey(input, 'keydown', 'ArrowUp');
    expect(chain.writes).toHaveLength(0);
    dispatchKey(input, 'keyup', 'ArrowUp');
    expect(chain.writes.map((write) => write.value)).toEqual([17]);
  });
});
