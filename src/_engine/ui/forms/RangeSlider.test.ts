import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { countListeners, dispatchKey, dispatchPointer, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { FieldChange } from './Field';
import { createRangeSlider, type RangeSliderProps, type RangeValue } from './RangeSlider';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: RangeValue; prev: RangeValue; last: boolean };

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

/** A 0-100 range slider (step 1) bound to `target.range`, its rail 100 px wide from x 0 */
const makeRange = (props: Partial<RangeSliderProps> = {}, start = { min: 20, max: 80 }) => {
  const target = { range: { ...start } };
  const calls: Change[] = [];
  const slider = createRangeSlider({
    label: 'Price',
    target,
    key: 'range',
    min: 0,
    max: 100,
    step: 1,
    onChange: (value: RangeValue, { prev, last }: FieldChange<RangeValue>) =>
      calls.push({ value, prev, last }),
    ...props,
  } as RangeSliderProps);
  getHUDRootCMP().add(slider.cmp);
  removers.push(() => slider.cmp.remove());
  const root = slider.cmp.elem;
  const track = root.querySelector<HTMLElement>('.aekSlider')!;
  const rail = root.querySelector<HTMLElement>('.aekSlider__rail')!;
  const [low, high] = [...root.querySelectorAll<HTMLElement>('.aekSlider__thumb')];
  const span = root.querySelector<HTMLElement>('.aekRangeSlider__span')!;
  const label = root.querySelector<HTMLElement>('.aekField__label')!;
  stubRect(rail, 0, 100);
  /** A thumb's box where it's drawn: 24 px around its place on the rail */
  const placeThumb = (thumb: HTMLElement) => stubRect(thumb, parseFloat(thumb.style.left) - 12, 24);
  const press = (elem: HTMLElement, key: string, init = {}) => {
    const down = dispatchKey(elem, 'keydown', key, init);
    dispatchKey(elem, 'keyup', key, init);
    return down;
  };
  const drag = (from: HTMLElement, ...xs: number[]) => {
    dispatchPointer(from, 'pointerdown', { clientX: xs[0] });
    for (const x of xs.slice(1)) dispatchPointer(track, 'pointermove', { clientX: x });
    dispatchPointer(track, 'pointerup', { clientX: xs.at(-1) });
  };
  return { slider, target, calls, root, track, low, high, span, label, placeThumb, press, drag };
};

const range = (min: number, max: number) => ({ min, max });

describe('the range slider’s parts and ARIA (p804 D7)', () => {
  it('a group of three sliders: the thumbs and the span, in that tab order', () => {
    const { root, track, low, high, span, label } = makeRange({ unit: '€', id: 'price' });
    expect(root.getAttribute('data-kind')).toBe('range');
    expect(track.getAttribute('role')).toBe('group');
    expect(track.getAttribute('aria-labelledby')).toBe(label.id);
    const stops = [...root.querySelectorAll('[tabindex="0"]')];
    expect(stops).toEqual([low, high, span]);
    expect(low.id).toBe('price-min');
    expect(high.id).toBe('price-max');
    expect(span.id).toBe('price-range');
    for (const stop of stops) expect(stop.getAttribute('role')).toBe('slider');
    expect(low.getAttribute('aria-label')).toBe('Minimum Price');
    expect(high.getAttribute('aria-label')).toBe('Maximum Price');
    expect(span.getAttribute('aria-label')).toBe('Price');
    expect(span.getAttribute('aria-roledescription')).toBe('range');
  });

  it('each thumb’s ends are the other’s value with the gap; the span’s value is its start', () => {
    const { low, high, span } = makeRange({ minGap: 10, unit: '€' });
    expect(low.getAttribute('aria-valuenow')).toBe('20');
    expect(low.getAttribute('aria-valuemin')).toBe('0');
    expect(low.getAttribute('aria-valuemax')).toBe('70');
    expect(low.getAttribute('aria-valuetext')).toBe('20 €');
    expect(high.getAttribute('aria-valuenow')).toBe('80');
    expect(high.getAttribute('aria-valuemin')).toBe('30');
    expect(high.getAttribute('aria-valuemax')).toBe('100');
    expect(span.getAttribute('aria-valuenow')).toBe('20');
    expect(span.getAttribute('aria-valuemin')).toBe('0');
    expect(span.getAttribute('aria-valuemax')).toBe('40');
    expect(span.getAttribute('aria-valuetext')).toBe('20 € to 80 €');
  });

  it('the thumbs and the span sit at the value', () => {
    const { low, high, span } = makeRange({}, { min: 25, max: 60 });
    expect(low.style.left).toBe('25%');
    expect(high.style.left).toBe('60%');
    expect(span.style.left).toBe('25%');
    expect(span.style.width).toBe('35%');
  });
});

describe('the range slider’s keys', () => {
  it('a thumb steps with the APG slider’s keys, each keyup last: true; written in place', () => {
    const { low, target, calls, press } = makeRange();
    const bound = target.range;
    const down = press(low, 'ArrowRight');
    expect(down.defaultPrevented).toBe(true);
    expect(down.cancelBubble).toBe(true);
    expect(target.range).toBe(bound);
    expect(target.range).toEqual(range(21, 80));
    expect(calls).toEqual([
      { value: range(21, 80), prev: range(20, 80), last: false },
      { value: range(21, 80), prev: range(20, 80), last: true },
    ]);
    press(low, 'ArrowDown', { shiftKey: true });
    expect(target.range).toEqual(range(11, 80));
    press(low, 'PageUp');
    expect(target.range).toEqual(range(21, 80));
  });

  it('a thumb stops at the other less the gap; Home and End are its own ends', () => {
    const { low, high, target, press } = makeRange({ minGap: 10 });
    press(low, 'End');
    expect(target.range).toEqual(range(70, 80));
    press(low, 'ArrowRight');
    expect(target.range).toEqual(range(70, 80));
    press(high, 'Home');
    expect(target.range).toEqual(range(70, 80));
    press(high, 'End');
    expect(target.range).toEqual(range(70, 100));
    press(low, 'Home');
    expect(target.range).toEqual(range(0, 100));
    expect(high.getAttribute('aria-valuemin')).toBe('10');
  });

  it('the span moves both, its width kept; Home and End take it to the track’s ends', () => {
    const { span, target, press } = makeRange();
    press(span, 'ArrowRight');
    expect(target.range).toEqual(range(21, 81));
    press(span, 'ArrowLeft', { shiftKey: true });
    expect(target.range).toEqual(range(11, 71));
    press(span, 'End');
    expect(target.range).toEqual(range(40, 100));
    press(span, 'ArrowRight');
    expect(target.range).toEqual(range(40, 100));
    press(span, 'Home');
    expect(target.range).toEqual(range(0, 60));
    // Other keys go on
    expect(dispatchKey(span, 'keydown', 'Enter').defaultPrevented).toBe(false);
  });

  it('a held key writes each repeat and one last: true on its keyup; a blur ends it too', () => {
    const { high, calls } = makeRange();
    high.focus();
    dispatchKey(high, 'keydown', 'ArrowLeft');
    dispatchKey(high, 'keydown', 'ArrowLeft', { repeat: true });
    high.blur();
    expect(calls.map((call) => [call.value.max, call.last])).toEqual([
      [79, false],
      [78, false],
      [78, true],
    ]);
    expect(calls[2].prev).toEqual(range(20, 80));
  });
});

describe('the range slider’s pointer', () => {
  it('a press on the rail moves the nearer thumb there and drags it, focusing it', () => {
    const { track, low, high, target, calls, drag } = makeRange();
    drag(track, 10, 15);
    expect(target.range).toEqual(range(15, 80));
    expect(document.activeElement).toBe(low);
    expect(calls.map((call) => call.last)).toEqual([false, false, true]);
    expect(calls[2].prev).toEqual(range(20, 80));
    // Nearer the maximum
    drag(track, 60);
    expect(target.range).toEqual(range(15, 60));
    expect(document.activeElement).toBe(high);
  });

  it('a dragged thumb stops at the other less the gap', () => {
    const { track, target, drag } = makeRange({ minGap: 5 });
    drag(track, 25, 95);
    expect(target.range).toEqual(range(75, 80));
  });

  it('a press on a thumb keeps its grab offset; only its bubble shows while it moves', () => {
    const { track, low, high, target, placeThumb } = makeRange();
    placeThumb(low);
    // 3 px left of the minimum's centre
    dispatchPointer(low, 'pointerdown', { clientX: 17 });
    expect(target.range).toEqual(range(20, 80));
    expect(low.hasAttribute('data-dragging')).toBe(true);
    expect(high.hasAttribute('data-dragging')).toBe(false);
    dispatchPointer(track, 'pointermove', { clientX: 27 });
    expect(target.range).toEqual(range(30, 80));
    dispatchPointer(track, 'pointerup');
    expect(low.hasAttribute('data-dragging')).toBe(false);
  });

  it('a press on the span drags both, its width kept, and focuses it', () => {
    const { track, span, low, high, target, calls } = makeRange();
    dispatchPointer(span, 'pointerdown', { clientX: 50 });
    expect(low.hasAttribute('data-dragging')).toBe(true);
    expect(high.hasAttribute('data-dragging')).toBe(true);
    dispatchPointer(track, 'pointermove', { clientX: 60 });
    expect(target.range).toEqual(range(30, 90));
    dispatchPointer(track, 'pointermove', { clientX: 90 });
    dispatchPointer(track, 'pointerup');
    expect(target.range).toEqual(range(40, 100));
    expect(document.activeElement).toBe(span);
    expect(calls.at(-1)).toEqual({ value: range(40, 100), prev: range(20, 80), last: true });
  });

  it('two thumbs at one value: the first move’s side picks which moves', () => {
    const { track, low, high, target, placeThumb } = makeRange({}, { min: 100, max: 100 });
    placeThumb(high);
    // The maximum is on top, at the end: moving left takes the minimum
    dispatchPointer(high, 'pointerdown', { clientX: 100 });
    dispatchPointer(track, 'pointermove', { clientX: 70 });
    dispatchPointer(track, 'pointerup');
    expect(target.range).toEqual(range(70, 100));
    expect(document.activeElement).toBe(low);
    expect(high.hasAttribute('data-dragging')).toBe(false);
  });

  it('a click writes the press and commits it (D3)', () => {
    const { track, calls, drag } = makeRange();
    drag(track, 90);
    expect(calls).toEqual([
      { value: range(20, 90), prev: range(20, 80), last: false },
      { value: range(20, 90), prev: range(20, 80), last: true },
    ]);
  });
});

describe('the range slider’s histogram, states and disposal', () => {
  it('draws a bar per value, the range’s copy clipped to it', () => {
    const { root, track, low, press } = makeRange({ histogram: [2, 4, 0, 1] });
    expect(track.hasAttribute('data-histogram')).toBe(true);
    const [bars, active] = [...root.querySelectorAll<SVGElement>('.aekSlider__bars')];
    expect(bars.getAttribute('aria-hidden')).toBe('true');
    expect(bars.getAttribute('viewBox')).toBe('0 0 4 1');
    const heights = [...bars.querySelectorAll('rect')].map((bar) => bar.getAttribute('height'));
    expect(heights).toEqual(['0.5', '1', '0', '0.25']);
    expect(active.style.clipPath).toBe('inset(0 20% 0 20%)');
    press(low, 'Home');
    expect(active.style.clipPath).toBe('inset(0 20% 0 0%)');
  });

  it('disabled: every stop aria-disabled and out of the tab order, no keys, no press', () => {
    const { slider, root, track, low, target, press, drag } = makeRange();
    slider.setDisabled(true);
    expect(track.getAttribute('aria-disabled')).toBe('true');
    for (const stop of root.querySelectorAll('[role="slider"]')) {
      expect(stop.getAttribute('aria-disabled')).toBe('true');
      expect(stop.hasAttribute('tabindex')).toBe(false);
    }
    press(low, 'ArrowRight');
    drag(track, 5);
    expect(target.range).toEqual(range(20, 80));
    slider.setDisabled(false);
    expect(track.hasAttribute('aria-disabled')).toBe(false);
    expect(low.getAttribute('tabindex')).toBe('0');
  });

  it('a change from outside moves the thumbs and flashes the span, without onChange', () => {
    const scheduler = createBindingScheduler();
    const { target, high, span, calls } = makeRange({ scheduler });
    target.range.max = 90;
    scheduler.refresh();
    expect(high.style.left).toBe('90%');
    expect(span.hasAttribute('data-flash')).toBe(true);
    expect(calls).toEqual([]);
    scheduler.dispose();
  });

  it('leaves no listener, mid-drag too, and gives up the pointer', () => {
    const { slider, track, low, high, span, calls } = makeRange();
    dispatchPointer(track, 'pointerdown', { clientX: 10 });
    dispatchKey(high, 'keydown', 'ArrowUp');
    const before = calls.length;
    slider.cmp.remove();
    expect(calls).toHaveLength(before);
    expect(track.hasPointerCapture(1)).toBe(false);
    for (const elem of [track, low, high, span]) expect(countListeners(elem)).toBe(0);
  });
});

describe('the range slider’s spin buttons (showInputs)', () => {
  /** A range slider with its spin buttons, and a way to type into one */
  const makeInputs = (props: Partial<RangeSliderProps> = {}) => {
    const made = makeRange({ showInputs: true, unit: '€', id: 'price', ...props });
    const [minInput, maxInput] = [
      ...made.root.querySelectorAll<HTMLInputElement>('.aekNumberField__input'),
    ];
    const type = (input: HTMLInputElement, text: string) => {
      input.focus();
      input.value = text;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    return { ...made, minInput, maxInput, type };
  };

  it('two named spin buttons around an aria-hidden track are the group’s controls', () => {
    const { root, track, low, high, span, minInput, maxInput, label } = makeInputs({
      minGap: 10,
    });
    const group = root.querySelector('.aekSlider__row')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-labelledby')).toBe(label.id);
    expect([...group.children]).toEqual([minInput.parentElement, track, maxInput.parentElement]);
    expect(track.getAttribute('aria-hidden')).toBe('true');
    for (const part of [low, high, span]) {
      expect(part.hasAttribute('role')).toBe(false);
      expect(part.hasAttribute('tabindex')).toBe(false);
    }
    expect(minInput.id).toBe('price-min');
    expect(maxInput.id).toBe('price-max');
    expect(minInput.getAttribute('role')).toBe('spinbutton');
    expect(minInput.getAttribute('aria-label')).toBe('Minimum Price');
    expect(maxInput.getAttribute('aria-label')).toBe('Maximum Price');
    expect(minInput.value).toBe('20');
    expect(minInput.getAttribute('aria-valuetext')).toBe('20 €');
    // Each one's own ends: the track's and the other's value with the gap
    expect(minInput.getAttribute('aria-valuemin')).toBe('0');
    expect(minInput.getAttribute('aria-valuemax')).toBe('70');
    expect(maxInput.getAttribute('aria-valuemin')).toBe('30');
    expect(maxInput.getAttribute('aria-valuemax')).toBe('100');
  });

  it('a typed value is written on Enter, kept on its side of the other with the gap', () => {
    const { target, calls, minInput, maxInput, low, type } = makeInputs({ minGap: 10 });
    const bound = target.range;
    type(minInput, '30 + 5');
    expect(target.range).toEqual(range(20, 80));
    dispatchKey(minInput, 'keydown', 'Enter');
    expect(target.range).toBe(bound);
    expect(target.range).toEqual(range(35, 80));
    expect(low.style.left).toBe('35%');
    expect(calls).toEqual([{ value: range(35, 80), prev: range(20, 80), last: true }]);
    expect(maxInput.getAttribute('aria-valuemin')).toBe('45');
    // Past the other: as far as the gap lets it, and the text shows where it went
    type(minInput, '95');
    minInput.blur();
    expect(target.range).toEqual(range(70, 80));
    expect(minInput.value).toBe('70');
  });

  it('the number field’s keys step one end; End stops at the other less the gap', () => {
    const { target, calls, maxInput } = makeInputs({ minGap: 10 });
    dispatchKey(maxInput, 'keydown', 'ArrowUp');
    dispatchKey(maxInput, 'keyup', 'ArrowUp');
    expect(target.range).toEqual(range(20, 81));
    expect(calls.map((call) => call.last)).toEqual([false, true]);
    dispatchKey(maxInput, 'keydown', 'Home');
    expect(target.range).toEqual(range(20, 30));
    // A text input's horizontal arrows move its caret
    expect(dispatchKey(maxInput, 'keydown', 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('an invalid expression shows the error, described for both spin buttons', () => {
    const { root, target, minInput, maxInput, type } = makeInputs({ hint: 'In euros' });
    const message = root.querySelector('.aekField__message')!;
    for (const input of [minInput, maxInput]) {
      expect(input.getAttribute('aria-describedby')).toBe(message.id);
    }
    type(maxInput, '2 +');
    dispatchKey(maxInput, 'keydown', 'Enter');
    expect(target.range).toEqual(range(20, 80));
    expect(message.getAttribute('data-type')).toBe('error');
    expect(maxInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('a press on the track puts typed text back and leaves the focus where it was', () => {
    const { track, target, minInput, type, drag } = makeInputs();
    type(minInput, '5');
    drag(track, 10);
    expect(document.activeElement).toBe(minInput);
    expect(target.range).toEqual(range(10, 80));
    expect(minInput.value).toBe('10');
  });

  it('disabled: the spin buttons and the group; no listener left on removal', () => {
    const { slider, root, minInput, maxInput } = makeInputs();
    slider.setDisabled(true);
    expect(minInput.hasAttribute('disabled')).toBe(true);
    expect(maxInput.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector('.aekSlider__row')!.getAttribute('aria-disabled')).toBe('true');
    slider.setDisabled(false);
    dispatchKey(minInput, 'keydown', 'ArrowUp');
    slider.cmp.remove();
    expect(countListeners(minInput)).toBe(0);
    expect(countListeners(maxInput)).toBe(0);
  });
});
