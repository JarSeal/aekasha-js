import { Euler, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createBinding,
  createObjectValueKind,
  getPrimitiveValueKind,
  type Binding,
  type BindingChange,
  type BindingSource,
} from './Binding';

type Call<T> = [T, BindingChange<T>];

/** A number binding on `{ value }` of a target, with its onChange calls */
const bindNumber = (start = 1) => {
  const target = { value: start };
  const calls: Call<number>[] = [];
  const binding = createBinding<number>({
    target,
    key: 'value',
    kind: getPrimitiveValueKind(),
    onChange: (value, change) => calls.push([value, change]),
  });
  return { target, calls, binding };
};

const user = (prev: number, last: boolean) => ({ prev, last, source: 'user' });

describe('the binding’s event order (p804 D3, pinned against Phase 0’s probe)', () => {
  it('a drag: the press and each move write with last: false, the release repeats with last: true', () => {
    const { target, calls, binding } = bindNumber(1);
    binding.step(2); // pointerdown on the track
    binding.step(3); // a move
    binding.step(4); // a move
    binding.commit(); // pointerup, no move since
    expect(target.value).toBe(4);
    expect(calls).toEqual([
      [2, user(1, false)],
      [3, user(2, false)],
      [4, user(3, false)],
      // prev: the value before the gesture (D3's difference from today's builder)
      [4, user(1, true)],
    ]);
  });

  it('a click on the track: a drag without a move', () => {
    const { calls, binding } = bindNumber(1);
    binding.step(5);
    binding.commit();
    expect(calls).toEqual([
      [5, user(1, false)],
      [5, user(1, true)],
    ]);
  });

  it('a key step: each keydown (repeats too) writes with last: false, its keyup last: true', () => {
    const { calls, binding } = bindNumber(1);
    binding.step(1.1); // keydown
    binding.step(1.2); // repeat
    binding.commit(); // keyup
    expect(calls).toEqual([
      [1.1, user(1, false)],
      [1.2, user(1.1, false)],
      [1.2, user(1, true)],
    ]);
  });

  it('a step that changes nothing (at the max) writes nothing, and its commit still fires', () => {
    const { calls, binding } = bindNumber(10);
    binding.step(10);
    expect(calls).toEqual([]);
    expect(binding.isInGesture()).toBe(true);
    binding.commit();
    expect(calls).toEqual([[10, user(10, true)]]);
    expect(binding.isInGesture()).toBe(false);
    // No gesture, no commit
    binding.commit();
    expect(calls).toHaveLength(1);
  });

  it('a click, a pick or typed text: one write with last: true', () => {
    const { target, calls, binding } = bindNumber(1);
    binding.change(3);
    expect(target.value).toBe(3);
    expect(calls).toEqual([[3, user(1, true)]]);
    // The same value again writes nothing
    binding.change(3);
    expect(calls).toHaveLength(1);
  });

  it('a change during a gesture is its last step and ends it', () => {
    const { calls, binding } = bindNumber(1);
    binding.step(2);
    binding.change(3);
    expect(calls).toEqual([
      [2, user(1, false)],
      [3, user(2, false)],
      [3, user(1, true)],
    ]);
  });

  it('setValue fires with source api, silent fires nothing', () => {
    const { target, calls, binding } = bindNumber(1);
    binding.setValue(2);
    expect(calls).toEqual([[2, { prev: 1, last: true, source: 'api' }]]);
    binding.setValue(5, { silent: true });
    expect(target.value).toBe(5);
    expect(binding.peek()).toBe(5);
    expect(calls).toHaveLength(1);
    // Equal to the bound value: nothing
    binding.setValue(5);
    expect(calls).toHaveLength(1);
  });

  it('setValue compares with the bound value, read first', () => {
    const { target, calls, binding } = bindNumber(1);
    target.value = 7;
    binding.setValue(1);
    expect(target.value).toBe(1);
    expect(calls).toEqual([[1, { prev: 7, last: true, source: 'api' }]]);
  });

  it('a refresh from the bound value never fires', () => {
    const { target, calls, binding } = bindNumber(1);
    target.value = 9;
    expect(binding.sync()).toBe(true);
    expect(binding.peek()).toBe(9);
    expect(binding.sync()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('the handler sees the value written and kept: a refresh from inside it reads no change', () => {
    let synced: boolean | null = null;
    const target = { value: 1 };
    const binding: Binding<number> = createBinding<number>({
      target,
      key: 'value',
      kind: getPrimitiveValueKind(),
      onChange: () => (synced = binding.sync()),
    });
    binding.change(2);
    expect(synced).toBe(false);
  });
});

describe('the three bindings (p804 D3)', () => {
  it('{ get, set } reads the getter and calls the setter', () => {
    let stored = 'a';
    const sets: string[] = [];
    const binding = createBinding<string>({
      get: () => stored,
      set: (value) => {
        sets.push(value);
        stored = value;
      },
      kind: getPrimitiveValueKind(),
    });
    expect(binding.peek()).toBe('a');
    binding.change('b');
    expect(sets).toEqual(['b']);
    stored = 'c';
    expect(binding.sync()).toBe(true);
    expect(binding.getValue()).toBe('c');
  });

  it('{ value } holds its own value, which nothing outside changes', () => {
    const calls: Call<boolean>[] = [];
    const binding = createBinding<boolean>({
      value: false,
      kind: getPrimitiveValueKind(),
      onChange: (value, change) => calls.push([value, change]),
    });
    expect(binding.getValue()).toBe(false);
    binding.change(true);
    expect(binding.getValue()).toBe(true);
    expect(binding.sync()).toBe(false);
    expect(calls).toEqual([[true, { prev: false, last: true, source: 'user' }]]);
  });

  it('accepts each source form as its type (a compile-time check)', () => {
    const sources: BindingSource<number>[] = [
      { target: { a: 1 }, key: 'a' },
      { get: () => 1, set: () => {} },
      { value: 1 },
    ];
    expect(sources).toHaveLength(3);
  });
});

describe('object values (p804 D3: written in place)', () => {
  const XYZ = createObjectValueKind<{ x: number; y: number; z: number }>(['x', 'y', 'z']);

  it('writes a THREE.Vector3 target in place: the instance stays', () => {
    const position = new Vector3(1, 2, 3);
    const target = { position };
    const calls: Call<{ x: number; y: number; z: number }>[] = [];
    const binding = createBinding({
      target,
      key: 'position',
      kind: XYZ,
      onChange: (value, change) => calls.push([value, change]),
    });
    binding.step({ x: 1, y: 5, z: 3 });
    binding.commit();
    expect(target.position).toBe(position);
    expect(position.toArray()).toEqual([1, 5, 3]);
    expect(calls).toEqual([
      [
        { x: 1, y: 5, z: 3 },
        { prev: { x: 1, y: 2, z: 3 }, last: false, source: 'user' },
      ],
      [
        { x: 1, y: 5, z: 3 },
        { prev: { x: 1, y: 2, z: 3 }, last: true, source: 'user' },
      ],
    ]);
    // The handler's values are its own: the binding's copy isn't one of them
    expect(calls[0][0]).not.toBe(binding.peek());
    expect(calls[0][0]).not.toBe(calls[1][0]);
  });

  it('writes a THREE.Euler through its accessors, which call its change callback', () => {
    const rotation = new Euler(0, 0, 0, 'YXZ');
    let changes = 0;
    rotation._onChange(() => changes++);
    const kind = createObjectValueKind<{ x: number; y: number; z: number; order: string }>([
      'x',
      'y',
      'z',
      'order',
    ]);
    const binding = createBinding({ target: { rotation }, key: 'rotation', kind });
    expect(binding.peek()).toEqual({ x: 0, y: 0, z: 0, order: 'YXZ' });
    binding.change({ x: 0, y: 1, z: 0, order: 'YXZ' });
    expect(rotation.y).toBe(1);
    expect(changes).toBeGreaterThan(0);
  });

  it('reads an object without allocating: the kept copy is filled in place', () => {
    const position = new Vector3(1, 2, 3);
    const binding = createBinding({ target: { position }, key: 'position', kind: XYZ });
    const kept = binding.peek();
    expect(binding.sync()).toBe(false);
    position.y = 7;
    expect(binding.sync()).toBe(true);
    expect(binding.peek()).toBe(kept);
    expect(kept).toEqual({ x: 1, y: 7, z: 3 });
  });

  it('{ get, set } gets a value of its own on each write', () => {
    const vector = { x: 0, y: 0, z: 0 };
    const sets: { x: number; y: number; z: number }[] = [];
    const binding = createBinding({ get: () => vector, set: (v) => sets.push(v), kind: XYZ });
    binding.step({ x: 1, y: 0, z: 0 });
    binding.step({ x: 2, y: 0, z: 0 });
    expect(sets).toEqual([
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]);
    expect(sets[0]).not.toBe(sets[1]);
    expect(vector).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('treats NaN as equal to itself, so a bound NaN isn’t a change on every read', () => {
    const target = { value: NaN };
    const binding = createBinding<number>({
      target,
      key: 'value',
      kind: getPrimitiveValueKind(),
    });
    expect(binding.sync()).toBe(false);
  });
});
