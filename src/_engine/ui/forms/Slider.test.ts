import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { FieldChange } from './Field';
import { createSlider, type SliderProps } from './Slider';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: number; prev: number; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A box at `left` with `width` (linkedom lays nothing out) */
const stubRect = (elem: Element, left: number, width: number) => {
  elem.getBoundingClientRect = () =>
    ({
      left,
      top: 0,
      right: left + width,
      bottom: 24,
      x: left,
      y: 0,
      width,
      height: 24,
    }) as DOMRect;
};

/** A 0-100 slider bound to `target.value`, its rail 100 px wide from x 0, with its onChange
 * calls */
const makeSlider = (props: Partial<SliderProps> = {}, start = 50) => {
  const target = { value: start };
  const calls: Change[] = [];
  const slider = createSlider({
    label: 'Volume',
    target,
    key: 'value',
    min: 0,
    max: 100,
    onChange: (value: number, { prev, last, source }: FieldChange<number>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as SliderProps);
  getHUDRootCMP().add(slider.cmp);
  removers.push(() => slider.cmp.remove());
  const root = slider.cmp.elem;
  const track = root.querySelector<HTMLElement>('.aekSlider')!;
  const rail = root.querySelector<HTMLElement>('.aekSlider__rail')!;
  const thumb = root.querySelector<HTMLElement>('.aekSlider__thumb')!;
  const fill = root.querySelector<HTMLElement>('.aekSlider__fill')!;
  const bubble = root.querySelector<HTMLElement>('.aekSlider__bubble')!;
  const input = root.querySelector<HTMLInputElement>('input');
  const label = root.querySelector<HTMLElement>('.aekField__label')!;
  stubRect(rail, 0, 100);
  /** The thumb's box where it's drawn: 24 px around its place on the rail */
  const placeThumb = () => stubRect(thumb, parseFloat(thumb.style.left) - 12, 24);
  return {
    slider,
    target,
    calls,
    root,
    track,
    rail,
    thumb,
    fill,
    bubble,
    input,
    label,
    placeThumb,
  };
};

const user = (value: number, prev: number, last: boolean) => ({
  value,
  prev,
  last,
  source: 'user',
});

describe('the slider with its spin button (p804 D7)', () => {
  it('is a number field with an aria-hidden track; the thumb and fill sit at the value', () => {
    const { root, track, thumb, fill, input, label } = makeSlider({ unit: '%' }, 25);
    expect(root.getAttribute('data-kind')).toBe('slider');
    expect(track.getAttribute('aria-hidden')).toBe('true');
    expect(input!.getAttribute('role')).toBe('spinbutton');
    expect(input!.getAttribute('aria-valuenow')).toBe('25');
    expect(input!.getAttribute('aria-valuemin')).toBe('0');
    expect(input!.getAttribute('aria-valuemax')).toBe('100');
    expect(input!.getAttribute('aria-valuetext')).toBe('25.00 %');
    expect(label.getAttribute('for')).toBe(input!.id);
    // The thumb isn't a control of its own here
    expect(thumb.hasAttribute('role')).toBe(false);
    expect(thumb.hasAttribute('tabindex')).toBe(false);
    expect(thumb.style.left).toBe('25%');
    expect(fill.style.width).toBe('25%');
  });

  it('a drag on the track: the press and each move with last: false, the release last: true', () => {
    const { track, target, calls, bubble } = makeSlider({ step: 1, unit: '%' }, 50);
    dispatchPointer(track, 'pointerdown', { clientX: 20 });
    expect(track.hasAttribute('data-dragging')).toBe(true);
    expect(track.hasPointerCapture(1)).toBe(true);
    dispatchPointer(track, 'pointermove', { clientX: 30 });
    dispatchPointer(track, 'pointermove', { clientX: 42 });
    expect(target.value).toBe(42);
    expect(bubble.textContent).toBe('42 %');
    dispatchPointer(track, 'pointerup', { clientX: 42 });
    expect(track.hasAttribute('data-dragging')).toBe(false);
    expect(calls).toEqual([
      user(20, 50, false),
      user(30, 20, false),
      user(42, 30, false),
      user(42, 50, true),
    ]);
  });

  it('a click on the track is a drag without a move (D3)', () => {
    const { track, calls } = makeSlider({ step: 1 }, 50);
    dispatchPointer(track, 'pointerdown', { clientX: 70 });
    dispatchPointer(track, 'pointerup', { clientX: 70 });
    expect(calls).toEqual([user(70, 50, false), user(70, 50, true)]);
  });

  it('a press on the thumb drags it from where it was grabbed, without a jump', () => {
    const { track, thumb, calls, placeThumb } = makeSlider({ step: 1 }, 50);
    placeThumb();
    // 4 px right of the thumb's centre
    dispatchPointer(thumb, 'pointerdown', { clientX: 54 });
    dispatchPointer(track, 'pointermove', { clientX: 64 });
    dispatchPointer(track, 'pointerup', { clientX: 64 });
    expect(calls).toEqual([user(60, 50, false), user(60, 50, true)]);
  });

  it('snaps to the step’s grid, Alt to a tenth of it; clamps past the ends', () => {
    const { track, target } = makeSlider({ step: 10 }, 50);
    dispatchPointer(track, 'pointerdown', { clientX: 23 });
    expect(target.value).toBe(20);
    dispatchPointer(track, 'pointermove', { clientX: 23, altKey: true });
    expect(target.value).toBe(23);
    dispatchPointer(track, 'pointermove', { clientX: 140 });
    expect(target.value).toBe(100);
    dispatchPointer(track, 'pointermove', { clientX: -40 });
    expect(target.value).toBe(0);
    dispatchPointer(track, 'pointerup');
  });

  it('a lost capture or a pointercancel ends the drag with last: true', () => {
    const { track, calls } = makeSlider({ step: 1 }, 50);
    dispatchPointer(track, 'pointerdown', { clientX: 10 });
    dispatchPointer(track, 'pointercancel');
    expect(calls.at(-1)).toEqual(user(10, 50, true));
    expect(track.hasAttribute('data-dragging')).toBe(false);
  });

  it('the spin button’s keys move the thumb', () => {
    const { input, thumb, calls } = makeSlider({ step: 5 }, 50);
    dispatchKey(input!, 'keydown', 'ArrowUp');
    dispatchKey(input!, 'keyup', 'ArrowUp');
    expect(thumb.style.left).toBe('55%');
    expect(calls).toEqual([user(55, 50, false), user(55, 50, true)]);
    // A text input's horizontal arrows move its caret
    const right = dispatchKey(input!, 'keydown', 'ArrowRight');
    expect(right.defaultPrevented).toBe(false);
  });

  it('a press on the track puts typed text back and leaves the focus where it was', () => {
    const { track, input, target } = makeSlider({ step: 1 }, 50);
    input!.focus();
    input!.value = '9';
    input!.dispatchEvent(new window.Event('input', { bubbles: true }));
    const down = dispatchPointer(track, 'pointerdown', { clientX: 30 });
    expect(down.defaultPrevented).toBe(true);
    expect(input!.value).toBe('30');
    expect(target.value).toBe(30);
    dispatchPointer(track, 'pointerup');
  });

  it('a disabled slider takes no press; disabling ends a drag with last: true', () => {
    const { slider, track, target, calls } = makeSlider({ step: 1 }, 50);
    dispatchPointer(track, 'pointerdown', { clientX: 20 });
    slider.setDisabled(true);
    expect(calls).toEqual([user(20, 50, false), user(20, 50, true)]);
    expect(track.hasAttribute('data-dragging')).toBe(false);
    dispatchPointer(track, 'pointerup');
    dispatchPointer(track, 'pointerdown', { clientX: 80 });
    expect(target.value).toBe(20);
    expect(calls).toHaveLength(2);
  });

  it('a refresh that reads a new value moves the thumb and flashes the box', () => {
    const scheduler = createBindingScheduler();
    const { root, target, thumb, calls } = makeSlider({ scheduler }, 50);
    target.value = 80;
    scheduler.refresh();
    expect(thumb.style.left).toBe('80%');
    expect(root.querySelector('.aekField__box')!.hasAttribute('data-flash')).toBe(true);
    expect(calls).toEqual([]);
    scheduler.dispose();
  });

  it('a value outside the range draws the thumb at the end', () => {
    const { thumb } = makeSlider({}, 140);
    expect(thumb.style.left).toBe('100%');
  });
});

describe('the slider’s ticks', () => {
  it('a count marks even places from min to max, both ends included', () => {
    const { root, track } = makeSlider({ ticks: 5 });
    const ticks = [...root.querySelectorAll<HTMLElement>('.aekSlider__tick')];
    expect(ticks.map((tick) => tick.style.left)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    expect(root.querySelector('.aekSlider__ticks')!.getAttribute('aria-hidden')).toBe('true');
    expect(track.hasAttribute('data-tick-labels')).toBe(false);
  });

  it('values mark their places with their labels; one out of the range is left out', () => {
    const { root, track } = makeSlider({
      ticks: [0, { value: 50, label: 'Half' }, 120, { value: 100, label: 'Full' }],
    });
    const ticks = [...root.querySelectorAll<HTMLElement>('.aekSlider__tick')];
    expect(ticks.map((tick) => tick.style.left)).toEqual(['0%', '50%', '100%']);
    expect(ticks.map((tick) => tick.textContent)).toEqual(['', 'Half', 'Full']);
    expect(track.hasAttribute('data-tick-labels')).toBe(true);
  });
});

describe('the slider without its spin button (showInput: false)', () => {
  it('the thumb is the APG slider, labelled by the label; a click on the label focuses it', () => {
    const { root, thumb, input, label, track } = makeSlider(
      { showInput: false, step: 1, unit: '%', id: 'volume' },
      30
    );
    expect(input).toBe(null);
    expect(track.hasAttribute('aria-hidden')).toBe(false);
    expect(thumb.getAttribute('role')).toBe('slider');
    expect(thumb.getAttribute('tabindex')).toBe('0');
    expect(thumb.id).toBe('volume');
    expect(thumb.getAttribute('aria-valuenow')).toBe('30');
    expect(thumb.getAttribute('aria-valuemin')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax')).toBe('100');
    expect(thumb.getAttribute('aria-valuetext')).toBe('30 %');
    expect(label.tagName).toBe('SPAN');
    expect(thumb.getAttribute('aria-labelledby')).toBe(label.id);
    expect(root.querySelector('label')).toBe(null);
    label.dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(document.activeElement).toBe(thumb);
  });

  it('the four arrows, PageUp / PageDown, Home / End and the modifiers; each keyup last: true', () => {
    const { thumb, target, calls } = makeSlider({ showInput: false, step: 1 }, 50);
    const press = (key: string, init = {}) => {
      const down = dispatchKey(thumb, 'keydown', key, init);
      const up = dispatchKey(thumb, 'keyup', key, init);
      return { down, up };
    };
    const { down, up } = press('ArrowRight');
    expect(down.defaultPrevented).toBe(true);
    expect(down.cancelBubble).toBe(true);
    expect(up.cancelBubble).toBe(true);
    expect(target.value).toBe(51);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(target.value).toBe(49);
    press('ArrowUp', { shiftKey: true });
    expect(target.value).toBe(59);
    press('PageDown');
    expect(target.value).toBe(49);
    press('ArrowDown', { altKey: true });
    expect(target.value).toBe(48.9);
    press('End');
    expect(target.value).toBe(100);
    press('Home');
    expect(target.value).toBe(0);
    expect(calls.slice(0, 2)).toEqual([user(51, 50, false), user(51, 50, true)]);
    expect(thumb.getAttribute('aria-valuenow')).toBe('0');
    // Other keys go on
    expect(dispatchKey(thumb, 'keydown', 'Enter').defaultPrevented).toBe(false);
  });

  it('a held key writes each repeat and one last: true on its keyup; a blur ends it too', () => {
    const { thumb, calls } = makeSlider({ showInput: false, step: 1 }, 50);
    thumb.focus();
    dispatchKey(thumb, 'keydown', 'ArrowRight');
    dispatchKey(thumb, 'keydown', 'ArrowRight', { repeat: true });
    thumb.blur();
    expect(calls).toEqual([user(51, 50, false), user(52, 51, false), user(52, 50, true)]);
  });

  it('a press on the track focuses the thumb', () => {
    const { track, thumb } = makeSlider({ showInput: false, step: 1 }, 50);
    dispatchPointer(track, 'pointerdown', { clientX: 20 });
    expect(document.activeElement).toBe(thumb);
    dispatchPointer(track, 'pointerup');
  });

  it('disabled: aria-disabled, out of the tab order, no keys', () => {
    const { slider, thumb, target } = makeSlider({ showInput: false, step: 1 }, 50);
    slider.setDisabled(true);
    expect(thumb.getAttribute('aria-disabled')).toBe('true');
    expect(thumb.hasAttribute('tabindex')).toBe(false);
    dispatchKey(thumb, 'keydown', 'ArrowRight');
    expect(target.value).toBe(50);
    slider.setDisabled(false);
    expect(thumb.hasAttribute('aria-disabled')).toBe(false);
    expect(thumb.getAttribute('tabindex')).toBe('0');
  });

  it('a change from outside flashes the thumb', () => {
    const scheduler = createBindingScheduler();
    const { target, thumb } = makeSlider({ showInput: false, scheduler }, 50);
    target.value = 10;
    scheduler.refresh();
    expect(thumb.hasAttribute('data-flash')).toBe(true);
    expect(thumb.getAttribute('aria-valuenow')).toBe('10');
    scheduler.dispose();
  });
});

describe('the slider’s disposal', () => {
  it('leaves no listener, mid-drag too, and gives up the pointer', () => {
    for (const showInput of [true, false]) {
      const { slider, track, thumb, input, label } = makeSlider({ showInput, step: 1 });
      dispatchPointer(track, 'pointerdown', { clientX: 20 });
      if (showInput) dispatchKey(input!, 'keydown', 'ArrowUp');
      else dispatchKey(thumb, 'keydown', 'ArrowUp');
      slider.cmp.remove();
      expect(track.hasPointerCapture(1)).toBe(false);
      expect(countListeners(track)).toBe(0);
      expect(countListeners(thumb)).toBe(0);
      expect(countListeners(label)).toBe(0);
      if (input) expect(countListeners(input)).toBe(0);
    }
  });
});
