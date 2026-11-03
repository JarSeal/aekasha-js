import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ActionBinding } from '../../../kernel/input/ActionTypes';
import type { InputPromptBinding } from '../InputPrompt';
import {
  applySlotInput,
  canSlotTake,
  findSlotConflict,
  getCellSlots,
  getSlotInput,
  getSlotInputs,
  isSameBindings,
  isSlotBoundTo,
  replaceSlotInput,
} from './ControlsBindings';

const JUMP: InputPromptBinding[] = [
  { device: 'KEYBOARD', keys: [' ', 'w'] },
  { device: 'GAMEPAD', button: 'SOUTH' },
];
const MOVE: InputPromptBinding[] = [
  { device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
  { device: 'GAMEPAD', stick: 'LEFT' },
];
const ZOOM: InputPromptBinding[] = [{ device: 'KEYBOARD', negative: ['-'], positive: ['='] }];
const FIRE: InputPromptBinding[] = [{ device: 'MOUSE', button: 'LEFT' }];

describe('the controls page’s bindings (p808 D9)', () => {
  it('takes the action map’s bindings as they are', () => {
    // A map's `getBindings` passes as the page's bindings, and its new ones go back to `setBindings`
    expectTypeOf<ActionBinding>().toExtend<InputPromptBinding>();
  });

  it('finds a cell’s slots: a button’s one, an axis’ two, a composite’s four', () => {
    expect(getCellSlots(JUMP, 'KEYBOARD_MOUSE')).toEqual({
      slots: [{ index: 0, part: 'keys' }],
      fixed: -1,
    });
    expect(getCellSlots(JUMP, 'GAMEPAD').slots).toEqual([{ index: 1, part: null }]);
    expect(getCellSlots(FIRE, 'KEYBOARD_MOUSE').slots).toEqual([{ index: 0, part: null }]);
    expect(getCellSlots(MOVE, 'KEYBOARD_MOUSE').slots.map((slot) => slot.part)).toEqual([
      'up',
      'left',
      'down',
      'right',
    ]);
    expect(getCellSlots(ZOOM, 'KEYBOARD_MOUSE').slots.map((slot) => slot.part)).toEqual([
      'negative',
      'positive',
    ]);
    // A stick is shown, not rebound
    expect(getCellSlots(MOVE, 'GAMEPAD')).toEqual({ slots: [], fixed: 1 });
    // None in the column: an empty slot for a button, nothing for an axis
    expect(getCellSlots(FIRE, 'GAMEPAD').slots).toEqual([{ index: -1, part: null }]);
    expect(getCellSlots(ZOOM, 'GAMEPAD', 'AXIS_1D').slots).toEqual([]);
    // Touch has no column
    expect(getCellSlots([{ device: 'TOUCH', gesture: 'TAP' }], 'KEYBOARD_MOUSE').slots).toEqual([
      { index: -1, part: null },
    ]);
  });

  it('reads a slot’s input: its part’s first key, a chord’s key with its modifiers', () => {
    const left = { index: 0, part: 'left' as const };
    expect(getSlotInputs(MOVE, left)).toEqual([{ device: 'KEYBOARD', key: 'a' }]);
    expect(
      getSlotInputs([{ device: 'KEYBOARD', keys: [{ key: 's', ctrl: true }] }], {
        index: 0,
        part: 'keys',
      })
    ).toEqual([
      { device: 'KEYBOARD', key: 'Control' },
      { device: 'KEYBOARD', key: 's' },
    ]);
    expect(getSlotInputs(JUMP, { index: -1, part: null })).toEqual([]);
    expect(getSlotInput(JUMP, { index: 0, part: 'keys' })).toEqual({
      device: 'KEYBOARD',
      key: ' ',
    });
    expect(getSlotInput(FIRE, { index: 0, part: null })).toEqual({
      device: 'MOUSE',
      button: 'LEFT',
    });
    expect(getSlotInput(JUMP, { index: 1, part: null })).toEqual({
      device: 'GAMEPAD',
      button: 'SOUTH',
    });
  });

  it('matches an input by any key of the part, case aside, and a chord by its key', () => {
    const keys = { index: 0, part: 'keys' as const };
    expect(isSlotBoundTo(JUMP, keys, { device: 'KEYBOARD', key: 'W' })).toBe(true);
    expect(isSlotBoundTo(JUMP, keys, { device: 'KEYBOARD', key: 'e' })).toBe(false);
    expect(
      isSlotBoundTo([{ device: 'KEYBOARD', keys: [{ key: 's', ctrl: true }] }], keys, {
        device: 'KEYBOARD',
        key: 's',
      })
    ).toBe(true);
    expect(isSlotBoundTo(FIRE, { index: 0, part: null }, { device: 'MOUSE', button: 'LEFT' })).toBe(
      true
    );
  });

  it('lets a part take a key only, and a column its own device', () => {
    const key = { device: 'KEYBOARD', key: 'f' } as const;
    const mouse = { device: 'MOUSE', button: 'RIGHT' } as const;
    const pad = { device: 'GAMEPAD', button: 'NORTH' } as const;
    expect(canSlotTake({ index: 0, part: 'keys' }, 'KEYBOARD_MOUSE', mouse)).toBe(true);
    expect(canSlotTake({ index: 0, part: 'up' }, 'KEYBOARD_MOUSE', mouse)).toBe(false);
    expect(canSlotTake({ index: 0, part: 'up' }, 'KEYBOARD_MOUSE', key)).toBe(true);
    expect(canSlotTake({ index: 0, part: null }, 'KEYBOARD_MOUSE', pad)).toBe(false);
    expect(canSlotTake({ index: 1, part: null }, 'GAMEPAD', pad)).toBe(true);
    expect(canSlotTake({ index: 1, part: null }, 'GAMEPAD', key)).toBe(false);
  });

  it('applies an input as a new list: the slot’s keys become the key, a part its key', () => {
    const withModifiers: InputPromptBinding[] = [
      { device: 'KEYBOARD', keys: [' '], ignoreModifiers: false } as InputPromptBinding,
    ];
    expect(
      applySlotInput(withModifiers, { index: 0, part: 'keys' }, { device: 'KEYBOARD', key: 'f' })
    ).toEqual([{ device: 'KEYBOARD', keys: ['f'], ignoreModifiers: false }]);
    const next = applySlotInput(
      JUMP,
      { index: 0, part: 'keys' },
      { device: 'MOUSE', button: 'RIGHT' }
    );
    expect(next).toEqual([{ device: 'MOUSE', button: 'RIGHT' }, JUMP[1]]);
    expect(JUMP[0]).toEqual({ device: 'KEYBOARD', keys: [' ', 'w'] });
    expect(
      applySlotInput(
        FIRE,
        { index: -1, part: null },
        { device: 'GAMEPAD', button: 'RIGHT_TRIGGER' }
      )
    ).toEqual([FIRE[0], { device: 'GAMEPAD', button: 'RIGHT_TRIGGER' }]);
    expect(
      applySlotInput(MOVE, { index: 0, part: 'up' }, { device: 'KEYBOARD', key: 'i' })?.[0]
    ).toEqual({ device: 'KEYBOARD', up: ['i'], down: ['s'], left: ['a'], right: ['d'] });
    expect(
      applySlotInput(MOVE, { index: 0, part: 'up' }, { device: 'MOUSE', button: 'LEFT' })
    ).toBe(null);
  });

  it('finds another slot bound to the input, in another action or the same one', () => {
    const actions = [
      { index: 0, bindings: JUMP },
      { index: 1, bindings: MOVE },
      { index: 2, bindings: FIRE },
    ];
    const w = { device: 'KEYBOARD', key: 'w' } as const;
    // Jump's keys have W, Move's up has it
    expect(
      findSlotConflict(
        actions,
        'KEYBOARD_MOUSE',
        { actionIndex: 0, slot: { index: 0, part: 'keys' } },
        w
      )
    ).toEqual({ actionIndex: 1, slot: { index: 0, part: 'up' } });
    // Move's down to W: its own up
    expect(
      findSlotConflict(
        actions,
        'KEYBOARD_MOUSE',
        { actionIndex: 1, slot: { index: 0, part: 'down' } },
        w
      )
    ).toEqual({ actionIndex: 0, slot: { index: 0, part: 'keys' } });
    expect(
      findSlotConflict(
        actions.slice(1),
        'KEYBOARD_MOUSE',
        { actionIndex: 1, slot: { index: 0, part: 'down' } },
        w
      )
    ).toEqual({ actionIndex: 1, slot: { index: 0, part: 'up' } });
    // The rebound slot itself isn't one, nor another column
    expect(
      findSlotConflict(
        actions,
        'KEYBOARD_MOUSE',
        { actionIndex: 1, slot: { index: 0, part: 'up' } },
        w
      )
    ).toEqual({ actionIndex: 0, slot: { index: 0, part: 'keys' } });
    expect(
      findSlotConflict(
        actions,
        'GAMEPAD',
        { actionIndex: 2, slot: { index: -1, part: null } },
        { device: 'GAMEPAD', button: 'EAST' }
      )
    ).toBeNull();
  });

  it('swaps an input out of a slot: in place in its keys, or the binding replaced', () => {
    const w = { device: 'KEYBOARD', key: 'W' } as const;
    // A key for a key, the others kept
    expect(
      replaceSlotInput(JUMP, { index: 0, part: 'keys' }, w, { device: 'KEYBOARD', key: 'e' })?.[0]
    ).toEqual({ device: 'KEYBOARD', keys: [' ', 'e'] });
    expect(
      replaceSlotInput(MOVE, { index: 0, part: 'up' }, w, { device: 'KEYBOARD', key: 'i' })?.[0]
    ).toEqual({ device: 'KEYBOARD', up: ['i'], down: ['s'], left: ['a'], right: ['d'] });
    // Nothing in its place: the key dropped, a binding left with none removed
    expect(replaceSlotInput(JUMP, { index: 0, part: 'keys' }, w, null)?.[0]).toEqual({
      device: 'KEYBOARD',
      keys: [' '],
    });
    expect(
      replaceSlotInput(FIRE, { index: 0, part: null }, { device: 'MOUSE', button: 'LEFT' }, null)
    ).toEqual([]);
    // A part can't be left empty, nor take a mouse button
    expect(replaceSlotInput(MOVE, { index: 0, part: 'up' }, w, null)).toBeNull();
    expect(
      replaceSlotInput(MOVE, { index: 0, part: 'up' }, w, { device: 'MOUSE', button: 'LEFT' })
    ).toBeNull();
    // A mouse button for a key: the binding replaced
    expect(
      replaceSlotInput(
        FIRE,
        { index: 0, part: null },
        { device: 'MOUSE', button: 'LEFT' },
        {
          device: 'KEYBOARD',
          key: 'f',
        }
      )
    ).toEqual([{ device: 'KEYBOARD', keys: ['f'] }]);
  });

  it('compares lists as data', () => {
    expect(isSameBindings(JUMP, [...JUMP])).toBe(true);
    expect(isSameBindings(JUMP, FIRE)).toBe(false);
  });
});
