import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createAngleDial, type AngleDialProps } from './AngleDial';
import type { FieldChange } from './Field';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: number; prev: number; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

const DEG = Math.PI / 180;

/** A dial bound to `target.value` (radians unless the props say), its face 100 px square from
 * the page's origin (linkedom lays nothing out), with its onChange calls */
const makeDial = (props: Partial<AngleDialProps> = {}, start = Math.PI / 4) => {
  const target = { value: start };
  const calls: Change[] = [];
  const field = createAngleDial({
    label: 'Heading',
    target,
    key: 'value',
    onChange: (value: number, { prev, last, source }: FieldChange<number>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as AngleDialProps);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const dial = root.querySelector<HTMLElement>('.aekAngleDial')!;
  if (dial) {
    dial.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      }) as DOMRect;
  }
  const hand = root.querySelector<HTMLElement>('.aekAngleDial__hand')!;
  const input = root.querySelector<HTMLInputElement>('input');
  const label = root.querySelector<HTMLElement>('.aekField__label')!;
  return { field, target, calls, root, dial, hand, input, label };
};

/** A pointer at `degrees` round the face's centre (50, 50), 40 px out, in the maths' sense */
const at = (degrees: number) => ({
  clientX: 50 + Math.cos(degrees * DEG) * 40,
  clientY: 50 - Math.sin(degrees * DEG) * 40,
});

const user = (value: number, prev: number, last: boolean) => ({
  value: expect.closeTo(value, 10) as unknown as number,
  prev: expect.closeTo(prev, 10) as unknown as number,
  last,
  source: 'user',
});

describe('the angle dial with its spin button (p804 D8)', () => {
  it('is an angle part in degrees after an aria-hidden dial, its hand at the angle', () => {
    const { root, dial, hand, input, label } = makeDial();
    expect(root.getAttribute('data-kind')).toBe('angle');
    expect(dial.getAttribute('aria-hidden')).toBe('true');
    expect(dial.hasAttribute('role')).toBe(false);
    expect(dial.getAttribute('data-convention')).toBe('math');
    expect(input!.getAttribute('role')).toBe('spinbutton');
    expect(input!.getAttribute('aria-valuenow')).toBe('45');
    expect(input!.getAttribute('aria-valuemin')).toBe('-180');
    expect(input!.getAttribute('aria-valuemax')).toBe('180');
    expect(input!.getAttribute('aria-valuetext')).toBe('45 °');
    expect(input!.value).toBe('45');
    expect(label.getAttribute('for')).toBe(input!.id);
    // Anticlockwise from the right: CSS turns clockwise
    expect(hand.style.transform).toBe('rotate(-45deg)');
  });

  it('a key step in degrees writes radians, in D3’s order; typed units and the wrap', () => {
    const { input, target, calls } = makeDial({ step: Math.PI / 8 });
    dispatchKey(input!, 'keydown', 'ArrowUp');
    expect(input!.value).toBe('67.5');
    expect(target.value).toBeCloseTo((3 * Math.PI) / 8, 10);
    dispatchKey(input!, 'keyup', 'ArrowUp');
    expect(calls).toEqual([
      user((3 * Math.PI) / 8, Math.PI / 4, false),
      user((3 * Math.PI) / 8, Math.PI / 4, true),
    ]);
    input!.value = '0.5 turn';
    input!.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchKey(input!, 'keydown', 'Enter');
    // 180° wraps to -180°, the same angle
    expect(target.value).toBeCloseTo(-Math.PI, 10);
  });

  it('a drag turns the hand to the pointer and round, across ±180° as it wraps', () => {
    const { dial, target, calls, hand } = makeDial();
    dispatchPointer(dial, 'pointerdown', at(0));
    expect(dial.hasAttribute('data-dragging')).toBe(true);
    expect(target.value).toBeCloseTo(0, 10);
    dispatchPointer(dial, 'pointermove', at(90));
    expect(hand.style.transform).toBe('rotate(-90deg)');
    dispatchPointer(dial, 'pointermove', at(170));
    // Past 180°: wrapped to -170°
    dispatchPointer(dial, 'pointermove', at(190));
    expect(target.value).toBeCloseTo(-170 * DEG, 10);
    dispatchPointer(dial, 'pointerup', at(190));
    expect(dial.hasAttribute('data-dragging')).toBe(false);
    expect(calls).toEqual([
      user(0, Math.PI / 4, false),
      user(90 * DEG, 0, false),
      user(170 * DEG, 90 * DEG, false),
      user(-170 * DEG, 170 * DEG, false),
      user(-170 * DEG, Math.PI / 4, true),
    ]);
  });

  it('Shift snaps a drag to 15°, Alt drags on a tenth of the step', () => {
    const { dial, target } = makeDial({ step: 10 * DEG });
    dispatchPointer(dial, 'pointerdown', { ...at(52), shiftKey: true });
    expect(target.value).toBeCloseTo(45 * DEG, 10);
    dispatchPointer(dial, 'pointermove', { ...at(58), shiftKey: true });
    expect(target.value).toBeCloseTo(60 * DEG, 10);
    dispatchPointer(dial, 'pointermove', at(52));
    expect(target.value).toBeCloseTo(50 * DEG, 10);
    dispatchPointer(dial, 'pointermove', { ...at(52), altKey: true });
    expect(target.value).toBeCloseTo(52 * DEG, 10);
    dispatchPointer(dial, 'pointerup', at(52));
  });

  it('a compass in degrees: 0 at the top, clockwise; 0 to 360 wraps at 360', () => {
    const { dial, target, hand, input } = makeDial(
      { angleUnit: 'degrees', min: 0, max: 360, convention: 'compass' },
      90
    );
    expect(dial.getAttribute('data-convention')).toBe('compass');
    expect(input!.value).toBe('90');
    expect(hand.style.transform).toBe('rotate(0deg)');
    // The top, then the left: 270, clockwise from the top
    dispatchPointer(dial, 'pointerdown', { clientX: 50, clientY: 0 });
    expect(target.value).toBe(0);
    dispatchPointer(dial, 'pointermove', { clientX: 0, clientY: 50 });
    expect(target.value).toBe(270);
    expect(hand.style.transform).toBe('rotate(180deg)');
    dispatchPointer(dial, 'pointerup', { clientX: 0, clientY: 50 });
  });

  it('without wrap a drag holds at an end, and follows the pointer back at once', () => {
    const { dial, target } = makeDial({ min: 0, max: Math.PI / 2, wrap: false }, 80 * DEG);
    dispatchPointer(dial, 'pointerdown', at(80));
    dispatchPointer(dial, 'pointermove', at(100));
    expect(target.value).toBeCloseTo(90 * DEG, 10);
    dispatchPointer(dial, 'pointermove', at(150));
    expect(target.value).toBeCloseTo(90 * DEG, 10);
    dispatchPointer(dial, 'pointermove', at(85));
    expect(target.value).toBeCloseTo(85 * DEG, 10);
    dispatchPointer(dial, 'pointerup', at(85));
  });

  it('a press ends typed text and a key’s gesture, and keeps the focus', () => {
    const { dial, input, target, calls } = makeDial();
    input!.focus();
    dispatchKey(input!, 'keydown', 'ArrowUp');
    input!.value = '12';
    input!.dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchPointer(dial, 'pointerdown', at(0));
    expect(calls.map((call) => call.last)).toEqual([false, true, false]);
    expect(input!.value).toBe('0');
    expect(document.activeElement).toBe(input);
    dispatchPointer(dial, 'pointerup', at(0));
    expect(target.value).toBeCloseTo(0, 10);
  });

  it('readonly is a monitor of the degrees', () => {
    const { root } = makeDial({ readonly: true }, Math.PI / 2);
    expect(root.getAttribute('data-kind')).toBe('monitor');
    expect(root.textContent).toContain('90°');
  });

  it('removed mid-drag, it leaves no listener and writes nothing more', () => {
    const { field, dial, input, calls } = makeDial();
    dispatchPointer(dial, 'pointerdown', at(0));
    field.cmp.remove();
    expect(countListeners(dial)).toBe(0);
    expect(countListeners(input!)).toBe(0);
    expect(calls.map((call) => call.last)).toEqual([false]);
  });
});

describe('the angle dial without its spin button (the APG slider)', () => {
  it('is a slider in degrees, labelled by the label', () => {
    const { dial, label, root } = makeDial({ showInput: false });
    expect(root.querySelector('input')).toBe(null);
    expect(dial.getAttribute('role')).toBe('slider');
    expect(dial.getAttribute('tabindex')).toBe('0');
    expect(dial.hasAttribute('aria-hidden')).toBe(false);
    expect(dial.getAttribute('aria-valuenow')).toBe('45');
    expect(dial.getAttribute('aria-valuemin')).toBe('-180');
    expect(dial.getAttribute('aria-valuemax')).toBe('180');
    expect(dial.getAttribute('aria-valuetext')).toBe('45 °');
    expect(dial.getAttribute('aria-labelledby')).toBe(label.id);
  });

  it('its keys: the four arrows, Shift ×10, Home / End, each keyup last: true', () => {
    const { dial, target, calls } = makeDial({ showInput: false });
    dispatchKey(dial, 'keydown', 'ArrowRight');
    expect(dial.getAttribute('aria-valuenow')).toBe('46');
    dispatchKey(dial, 'keyup', 'ArrowRight');
    dispatchKey(dial, 'keydown', 'ArrowDown', { shiftKey: true });
    expect(target.value).toBeCloseTo(36 * DEG, 10);
    dispatchKey(dial, 'keyup', 'ArrowDown');
    dispatchKey(dial, 'keydown', 'Home');
    expect(target.value).toBeCloseTo(-Math.PI, 10);
    dispatchKey(dial, 'keyup', 'Home');
    expect(calls.map((call) => call.last)).toEqual([false, true, false, true, false, true]);
  });

  it('a press focuses it; disabled, it’s out of the tab order and takes nothing', () => {
    const { field, dial, target } = makeDial({ showInput: false });
    dispatchPointer(dial, 'pointerdown', at(0));
    expect(document.activeElement).toBe(dial);
    dispatchPointer(dial, 'pointerup', at(0));
    field.setDisabled(true);
    expect(dial.getAttribute('aria-disabled')).toBe('true');
    expect(dial.hasAttribute('tabindex')).toBe(false);
    dispatchKey(dial, 'keydown', 'ArrowRight');
    dispatchPointer(dial, 'pointerdown', at(90));
    expect(target.value).toBeCloseTo(0, 10);
    field.setDisabled(false);
    expect(dial.getAttribute('tabindex')).toBe('0');
  });
});
