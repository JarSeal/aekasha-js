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

// The characters, and the window's looper: run by hand
const stubs = vi.hoisted(() => ({
  characters: new Map<string, unknown>(),
  loopers: [] as (() => void)[],
}));
vi.mock(import('../Character'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCharacterById: ((id: string) => stubs.characters.get(id)) as never,
}));
vi.mock(import('../../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'charScene',
  createSceneMainLooper: ((fn: () => void) => stubs.loopers.push(fn) - 1) as never,
  deleteSceneMainLooper: (() => undefined) as never,
}));
// No 3D gizmos in Node (their lines need a renderer)
vi.mock(import('./_dbg__CharacterGizmos'), async (importOriginal) => ({
  ...(await importOriginal()),
  acquireCharacterGizmos: (() => null) as never,
  releaseCharacterGizmos: (() => undefined) as never,
  setCharacterGizmosFrozen: (() => undefined) as never,
}));
vi.mock(import('../../physics/PhysicsStepping'), async (importOriginal) => ({
  ...(await importOriginal()),
  getPhysicsSnapshotStepIndex: () => 101,
}));

import { dispatchKey, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { initEnvironment } from '../../../kernel/config/Config';
import {
  _getUndoRedoHistory,
  _initUndoRedo,
  _redoLastAction,
  _undoLastAction,
} from '../../../debug/_dbg__UndoRedo';
import { CHAR_CONFIG_LS_KEY } from './_dbg__CharacterConfigOverrides';
import { _createCharacterStateWindowContent } from './_dbg__CharacterStateWindow';

// p806 D10, D11: the Character state window on the UI kit's property grids: its groups as
// folders, the read-only rows as monitors flashed by the window's refresh, the Properties rows as
// fields saved and recorded at a gesture's end, and the freeze

beforeAll(async () => {
  await stubKitDomAsync();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
  _initUndoRedo();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  for (const key of Object.keys(ls)) ls.removeItem(key);
  stubs.characters.clear();
  stubs.loopers.length = 0;
  _initUndoRedo();
});

const createCharacter = (id = 'hero') => {
  const values: Record<string, unknown> = {
    height: 1.6,
    maxVelocity: 3.7,
    maxWalkableAngle: Math.PI / 4,
    turnToMoveDirection: false,
  };
  const controller = {
    state: {
      isGrounded: true,
      velocity: { x: 1, y: 0, z: 0, length: 1 },
      charRotation: Math.PI / 2,
    } as Record<string, unknown>,
    config: {
      values,
      initial: { ...values },
      bakedKeys: new Set(['height']),
      onChange: vi.fn(),
      applyDefaults: vi.fn(),
    },
    internal: { jumpStep: 90, isJumping: false, touchingWallColliders: [4, 7] } as Record<
      string,
      unknown
    >,
  };
  const character = { id, name: 'Tester', controller };
  stubs.characters.set(id, character);
  return character;
};

const openWindow = (id = 'hero') => {
  const cmp = _createCharacterStateWindowContent({ id });
  built.push(cmp);
  // In the document: the grid reads the fields that show, and the update stops a detached window
  document.body.append(cmp.elem);
  return cmp.elem;
};

/** Runs the window's update (its scene looper) once. */
const update = () => {
  for (const looper of stubs.loopers) looper();
};

const getField = (root: HTMLElement, label: string) => {
  const field = [...root.querySelectorAll<HTMLElement>('.aekField')].find(
    (elem) => elem.querySelector('.aekField__label')?.textContent === label
  );
  if (!field) throw new Error(`No field "${label}"`);
  return field;
};
const getText = (root: HTMLElement, label: string) =>
  getField(root, label).querySelector('.aekMonitor__value')?.textContent;
const getFolderTitles = (root: HTMLElement) =>
  [...root.querySelectorAll('.aekFolder__title')].map((elem) => elem.textContent);

describe('the Character state window', () => {
  it('shows the groups as folders, open as the 5.x settings saved them, with their rows as text', () => {
    // A 5.x settings object: no `notes`, no `gizmos`
    ls.setItem(
      'AEK_charStateWin',
      JSON.stringify({ intervalMs: 0, flash: true, groupsOpen: { internal: true } })
    );
    createCharacter();
    const root = openWindow();
    expect(getFolderTitles(root)).toEqual(['State (3)', 'Properties (4)', 'Internal memory (3)']);
    expect(getText(root, 'isGrounded')).toBe('true');
    expect(getText(root, 'velocity')).toBe('x 1.000  y 0.000  z 0.000  len 1.000');
    expect(getText(root, 'charRotation')).toBe('1.571 rad (90.0°)');
    // 101 - 1 - 90 steps at 60 Hz
    expect(getText(root, 'jumpStep')).toBe('10 steps (167 ms) ago');
    expect(getText(root, 'touchingWallColliders')).toBe('(2) 4, 7');
    // A baked key is a monitor, named by the group's note
    expect(getText(root, 'height')).toBe('1.6');
    expect(root.textContent).toContain('height are sized into the colliders at creation');
    expect(getField(root, 'maxVelocity').querySelector('input')?.value).toBe('3.7');
    // A degree key is edited in degrees
    expect(getField(root, 'maxWalkableAngle').querySelector('input')?.value).toBe('45');
  });

  it("flashes a read-only row the update's refresh finds changed, and follows the Flash setting", () => {
    const character = createCharacter();
    const root = openWindow();
    const row = getField(root, 'isGrounded');
    expect(row.hasAttribute('data-flash')).toBe(false);
    character.controller.state.isGrounded = false;
    update();
    expect(getText(root, 'isGrounded')).toBe('false');
    expect(row.hasAttribute('data-flash')).toBe(true);
    // A State number never flashes
    character.controller.state.charRotation = 0;
    update();
    expect(getField(root, 'charRotation').hasAttribute('data-flash')).toBe(false);

    getField(root, 'Flash changes').querySelector('input')!.click();
    expect(JSON.parse(ls.getItem('AEK_charStateWin')!).flash).toBe(false);
    row.removeAttribute('data-flash');
    character.controller.state.isGrounded = true;
    update();
    expect(getText(root, 'isGrounded')).toBe('true');
    expect(row.hasAttribute('data-flash')).toBe(false);
  });

  it('keeps the freeze-time values, then reads the live ones without a flash', () => {
    const character = createCharacter();
    const root = openWindow();
    const freeze = root.querySelector<HTMLButtonElement>('[aria-label="Freeze updates"]')!;
    freeze.click();
    expect(freeze.getAttribute('aria-pressed')).toBe('true');
    character.controller.state.isGrounded = false;
    character.controller.internal.isJumping = true;
    update();
    expect(getText(root, 'isGrounded')).toBe('true');
    // A shut folder opened while frozen shows the freeze's moment too
    const internal = [...root.querySelectorAll<HTMLButtonElement>('.aekFolder__toggle')].find(
      (button) => button.textContent?.startsWith('Internal memory')
    )!;
    internal.click();
    expect(getText(root, 'isJumping')).toBe('false');

    freeze.click();
    expect(getText(root, 'isGrounded')).toBe('false');
    expect(getField(root, 'isGrounded').hasAttribute('data-flash')).toBe(false);
  });

  it('writes a key step live, then saves and records it at its keyup, coalesced, and undoes it', () => {
    const character = createCharacter();
    const root = openWindow();
    const input = getField(root, 'maxVelocity').querySelector('input')!;
    dispatchKey(input, 'keydown', 'ArrowUp');
    expect(character.controller.config.values.maxVelocity).toBeCloseTo(3.8);
    expect(character.controller.config.onChange).toHaveBeenCalledWith('maxVelocity');
    expect(ls.getItem(CHAR_CONFIG_LS_KEY)).toBeNull();
    dispatchKey(input, 'keyup', 'ArrowUp');
    const saved = JSON.parse(ls.getItem(CHAR_CONFIG_LS_KEY)!);
    expect(saved.charScene.hero._maxVelocity).toBeCloseTo(3.8);
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Character Tester: maxVelocity (from 3.7)');
    expect(root.textContent).toContain('1 changed');

    _undoLastAction();
    expect(character.controller.config.values.maxVelocity).toBe(3.7);
    expect(input.value).toBe('3.7');
    expect(root.textContent).toContain('No changes');
    _redoLastAction();
    expect(character.controller.config.values.maxVelocity).toBeCloseTo(3.8);
  });

  it("resets every changed key with Reset all, as one undo step, and a field's reset button as a reset", () => {
    const character = createCharacter();
    const root = openWindow();
    getField(root, 'turnToMoveDirection').querySelector('input')!.click();
    expect(character.controller.config.values.turnToMoveDirection).toBe(true);
    expect(_getUndoRedoHistory().at(-1)?.label).toBe(
      'Character Tester: turnToMoveDirection → true'
    );
    const angle = getField(root, 'maxWalkableAngle');
    dispatchKey(angle.querySelector('input')!, 'keydown', 'ArrowUp');
    dispatchKey(angle.querySelector('input')!, 'keyup', 'ArrowUp');
    expect(character.controller.config.values.maxWalkableAngle).toBeCloseTo((46 * Math.PI) / 180);
    expect(root.textContent).toContain('2 changed');

    // The reset button writes the creation-time value exactly
    angle.querySelector<HTMLButtonElement>('.aekField__reset')!.click();
    expect(character.controller.config.values.maxWalkableAngle).toBe(Math.PI / 4);
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Character Tester: reset maxWalkableAngle');

    const resetAll = [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Reset all')
    )!;
    resetAll.click();
    expect(character.controller.config.values.turnToMoveDirection).toBe(false);
    expect(_getUndoRedoHistory().at(-1)?.label).toBe('Character Tester: reset all (1)');
    expect(resetAll.getAttribute('aria-disabled')).toBe('true');
    _undoLastAction();
    expect(character.controller.config.values.turnToMoveDirection).toBe(true);
  });

  it('rebuilds the groups when a key comes, and says when the character is gone', async () => {
    const character = createCharacter();
    const root = openWindow();
    character.controller.state.isSliding = false;
    update();
    expect(getFolderTitles(root)[0]).toBe('State (4)');
    expect(getText(root, 'isSliding')).toBe('false');

    stubs.characters.clear();
    update();
    expect(root.textContent).toContain('Character not found (deleted?)');
    expect(root.querySelector('.aekFolder')).toBeNull();
    await Promise.resolve();
  });
});
