import { Color } from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
  type KitKeyInit,
} from '../../testing/KitDom';
import { createBindingScheduler } from '../binding/BindingScheduler';
import type { FieldChange } from '../Field';
import { createColorField, type ColorFieldProps } from './ColorField';
import { loadColorPickerAsync } from './ColorPicker';
import type { ColorFieldValue, Hsva } from './ColorValue';
import { getRecentColors, onRecentColorsChange, setRecentColors } from './RecentColors';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
  // Loaded, so every open shows it at once (its first open's lazy load: ColorPicker.test.ts)
  await loadColorPickerAsync();
});

type Change = { value: unknown; prev: unknown; last: boolean; source: string };

const removers: (() => void)[] = [];
beforeEach(() => setRecentColors([]));
afterEach(() => {
  while (removers.length) removers.pop()!();
  delete (globalThis as { EyeDropper?: unknown }).EyeDropper;
});

/** The browser's EyeDropper, its `open` resolved by the test (not `vi.stubGlobal`: unstubbing
 * would take KitDom's globals too) */
const stubEyeDropper = () => {
  const picks: ((result: { sRGBHex: string }) => void)[] = [];
  (globalThis as { EyeDropper?: unknown }).EyeDropper = class {
    open = () => new Promise<{ sRGBHex: string }>((done) => picks.push(done));
  };
  return (sRGBHex: string) => picks.shift()?.({ sRGBHex });
};

/** A colour field bound to `target.color`, in the HUD root, with its onChange calls */
const makeColor = <T extends ColorFieldValue>(
  start: T,
  props: Partial<ColorFieldProps<T>> = {}
) => {
  const target = { color: start };
  const calls: Change[] = [];
  const field = createColorField<T>({
    label: 'Fog',
    target,
    key: 'color',
    onChange: (value: T, { prev, last, source }: FieldChange<T>) =>
      calls.push({ value, prev, last, source }),
    ...props,
  } as ColorFieldProps<T>);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const input = root.querySelector<HTMLInputElement>('.aekColorField__input')!;
  const swatch = root.querySelector<HTMLButtonElement>('.aekColorField__swatch')!;
  const message = root.querySelector<HTMLElement>('.aekField__message')!;
  const parts = root.querySelectorAll<HTMLInputElement>('.aekColorField__part input');
  const type = (text: string, into = input) => {
    into.value = text;
    into.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const enter = () => dispatchKey(input, 'keydown', 'Enter');
  const panel = () => document.querySelector<HTMLElement>('.aekColorPopover');
  return { field, target, calls, root, input, swatch, message, parts, type, enter, panel };
};

const user = (value: unknown, prev: unknown, last = true) => ({
  value,
  prev,
  last,
  source: 'user',
});

describe('the colour field (p804 D8)', () => {
  it('is a swatch button and a text input labelled by the label, the value as hex', () => {
    const { root, input, swatch } = makeColor(0x3fd8f2);
    expect(root.getAttribute('data-kind')).toBe('color');
    expect(root.querySelector('label')!.getAttribute('for')).toBe(input.id);
    expect(input.getAttribute('type')).toBe('text');
    expect(input.value).toBe('#3fd8f2');
    expect(swatch.getAttribute('type')).toBe('button');
    expect(swatch.getAttribute('aria-label')).toBe('Pick Fog');
    expect(swatch.getAttribute('aria-haspopup')).toBe('dialog');
    expect(swatch.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.aekColorField__chip')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('typed text is written in the bound form on Enter, once with last: true', () => {
    const number = makeColor(0x3fd8f2);
    number.type('rgb(255, 0, 0)');
    expect(number.target.color).toBe(0x3fd8f2);
    number.enter();
    expect(number.target.color).toBe(0xff0000);
    expect(number.input.value).toBe('#ff0000');
    expect(number.calls).toEqual([user(0xff0000, 0x3fd8f2)]);

    const hex = makeColor('#abc');
    hex.type('hsl(120 100% 25%)');
    hex.input.dispatchEvent(new window.Event('blur'));
    expect(hex.target.color).toBe('#008000');
    expect(hex.calls).toEqual([user('#008000', '#abc')]);
  });

  it('an invalid text shows its error and keeps the value; Escape puts the text back', () => {
    const { input, target, message, calls, type, enter } = makeColor('#3fd8f2');
    input.focus();
    type('#3fd8f');
    enter();
    expect(target.color).toBe('#3fd8f2');
    expect(input.value).toBe('#3fd8f');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(message.textContent).toMatch(/Not a colour/);
    const escape = dispatchKey(input, 'keydown', 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(input.value).toBe('#3fd8f2');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('writes an object in place: a THREE.Color stays the instance, in its linear space', () => {
    const color = new Color().setHex(0x3fd8f2);
    const { target, input, type, enter, calls } = makeColor(color, { colorSpace: 'linear' });
    expect(input.value).toBe('#3fd8f2');
    type('#ff8000');
    enter();
    expect(target.color).toBe(color);
    expect(color.getHex()).toBe(0xff8000);
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toEqual({ r: color.r, g: color.g, b: color.b });
    // An sRGB object's floats are the text's
    const plain = makeColor({ r: 1, g: 0, b: 0 });
    plain.type('0, 0.5, 1');
    plain.enter();
    expect(plain.target.color).toEqual({ r: 0, g: 0.5, b: 1 });
  });

  it('alpha: a spin button after the text, stepping the alpha with D3’s order', () => {
    const { parts, target, input, calls } = makeColor('#ff000080', {});
    expect(parts).toHaveLength(1);
    const alpha = parts[0];
    expect(alpha.getAttribute('role')).toBe('spinbutton');
    expect(alpha.getAttribute('aria-label')).toBe('Fog alpha');
    expect(alpha.value).toBe('0.50');
    expect(input.value).toBe('#ff000080');
    // 0x80 is 0.502: a step is 0.51 on the grid, 0x82
    dispatchKey(alpha, 'keydown', 'ArrowUp');
    expect(target.color).toBe('#ff000082');
    dispatchKey(alpha, 'keyup', 'ArrowUp');
    expect(calls).toEqual([
      user('#ff000082', '#ff000080', false),
      user('#ff000082', '#ff000080', true),
    ]);
    expect(input.value).toBe('#ff000082');
    // A number has none
    const number = makeColor(0xff0000, { alpha: true });
    expect(number.parts).toHaveLength(0);
  });

  it('alpha on an object writes `a` alone, the colour channels as they are', () => {
    const value = { r: 0.5, g: 0.25, b: 2, a: 1 };
    const { parts, target } = makeColor(value, { alpha: true, colorSpace: 'linear' });
    parts[0].value = '50%';
    parts[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    dispatchKey(parts[0], 'keydown', 'Enter');
    expect(target.color).toBe(value);
    expect(value).toEqual({ r: 0.5, g: 0.25, b: 2, a: 0.5 });
  });

  it('intensity: its own binding, read with the field and flashed on a refresh', () => {
    const light = { color: 0xffffff, intensity: 2 };
    const intensityCalls: Change[] = [];
    const scheduler = createBindingScheduler();
    const { field, parts, calls } = makeColor(0xffffff, {
      scheduler,
      intensity: {
        target: light,
        key: 'intensity',
        min: 0,
        step: 0.1,
        unit: 'lx',
        onChange: (value, { prev, last, source }) =>
          intensityCalls.push({ value, prev, last, source }),
      },
    });
    const intensity = parts[0];
    expect(intensity.getAttribute('aria-label')).toBe('Fog Intensity');
    expect(field.cmp.elem.querySelector('.aekColorField__partLabel')!.textContent).toBe(
      'Intensity'
    );
    expect(intensity.value).toBe('2.0');
    dispatchKey(intensity, 'keydown', 'ArrowUp');
    dispatchKey(intensity, 'keyup', 'ArrowUp');
    expect(light.intensity).toBe(2.1);
    expect(intensityCalls.map(({ last }) => last)).toEqual([false, true]);
    expect(calls).toEqual([]);
    light.intensity = 5;
    scheduler.refresh();
    expect(intensity.value).toBe('5.0');
    expect(intensity.closest('.aekField__box')!.hasAttribute('data-flash')).toBe(true);
    expect(intensityCalls).toHaveLength(2);
    scheduler.dispose();
  });

  it('copies its text with no selection; a pasted colour sets it', () => {
    const clipboardEvent = (type: string, text = '') => {
      const data = new Map([['text/plain', text]]);
      return Object.assign(new window.Event(type, { bubbles: true, cancelable: true }), {
        clipboardData: {
          getData: (format: string) => data.get(format) ?? '',
          setData: (format: string, value: string) => data.set(format, value),
        },
        data,
      });
    };
    const { input, target, calls } = makeColor(0x3fd8f2);
    input.setSelectionRange(2, 2);
    const copy = clipboardEvent('copy');
    input.dispatchEvent(copy);
    expect(copy.data.get('text/plain')).toBe('#3fd8f2');
    const paste = clipboardEvent('paste', ' 0x102030 ');
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(target.color).toBe(0x102030);
    expect(calls).toEqual([user(0x102030, 0x3fd8f2)]);
    const text = clipboardEvent('paste', 'ab');
    input.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('readonly: a monitor of the colour’s text', () => {
    const field = createColorField({ label: 'Tint', get: () => 0x00ff00, readonly: true });
    getHUDRootCMP().add(field.cmp);
    expect(field.cmp.elem.getAttribute('data-kind')).toBe('monitor');
    expect(field.cmp.elem.querySelector('.aekMonitor__value')!.textContent).toBe('#00ff00');
    field.cmp.remove();
  });

  it('disabled: the swatch and the inputs, and an open panel closes', () => {
    const { field, swatch, input, panel } = makeColor(0xff0000, { palette: ['#000'] });
    swatch.click();
    expect(panel()).not.toBe(null);
    field.setDisabled(true);
    expect(panel()).toBe(null);
    expect(swatch.hasAttribute('disabled')).toBe(true);
    expect(input.hasAttribute('disabled')).toBe(true);
    field.setDisabled(false);
    expect(swatch.hasAttribute('disabled')).toBe(false);
  });

  it('is removed with no listener, entry or panel left', () => {
    const { field, input, swatch, type } = makeColor(0xff0000);
    swatch.click();
    type('#00');
    field.cmp.remove();
    expect(countListeners(input)).toBe(0);
    expect(countListeners(swatch)).toBe(0);
    expect(document.querySelector('.aekColorPopover')).toBe(null);
    const escape = dispatchKey(getHUDRootCMP().elem, 'keydown', 'Escape');
    expect(escape.defaultPrevented).toBe(false);
  });
});

describe('the colour panel (p804 D8)', () => {
  it('a click on the swatch opens it: the palette, named swatches, the value’s marked', () => {
    const { swatch, panel } = makeColor('#3fd8f2', {
      palette: ['#3fd8f2', 'rgb(255 0 0)', 'not a colour'],
    });
    swatch.click();
    const popover = panel()!;
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(popover.getAttribute('aria-label')).toBe('Fog');
    expect(swatch.getAttribute('aria-expanded')).toBe('true');
    const group = popover.querySelector<HTMLElement>('.aekColorPanel__group')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Palette'
    );
    const swatches = [...popover.querySelectorAll<HTMLElement>('.aekColorPanel__swatch')];
    expect(swatches.map((elem) => elem.getAttribute('aria-label'))).toEqual(['#3fd8f2', '#ff0000']);
    expect(swatches[0].getAttribute('aria-current')).toBe('true');
    expect(swatches[1].hasAttribute('aria-current')).toBe(false);
    // The focus went to the picker's plane, at the panel's top
    const picker = popover.querySelector<HTMLElement>('.aekColorPanel__picker aek-color-picker')!;
    expect(popover.firstElementChild!.firstElementChild!.className).toBe('aekColorPanel__picker');
    expect(document.activeElement).toBe(picker);
    expect(picker.shadowRoot!.activeElement!.getAttribute('part')).toBe('saturation');
  });

  it('a swatch sets its colour once, stays open and moves the mark; it’s a recent colour', () => {
    const { swatch, panel, target, calls, input } = makeColor(0x3fd8f2, {
      palette: ['#3fd8f2', '#ff0000'],
    });
    swatch.click();
    const swatches = panel()!.querySelectorAll<HTMLElement>('.aekColorPanel__swatch');
    swatches[1].click();
    expect(target.color).toBe(0xff0000);
    expect(input.value).toBe('#ff0000');
    expect(calls).toEqual([user(0xff0000, 0x3fd8f2)]);
    expect(panel()).not.toBe(null);
    expect(swatches[0].hasAttribute('aria-current')).toBe(false);
    expect(swatches[1].getAttribute('aria-current')).toBe('true');
    expect(getRecentColors()).toEqual(['#ff0000']);
  });

  it('shows the page’s recent colours', () => {
    setRecentColors(['#102030', '#405060']);
    const { swatch, panel } = makeColor(0xffffff);
    swatch.click();
    const heading = panel()!.querySelector('.aekColorPanel__heading')!;
    expect(heading.textContent).toBe('Recent');
    expect(
      [...panel()!.querySelectorAll('.aekColorPanel__swatch')].map((elem) =>
        elem.getAttribute('aria-label')
      )
    ).toEqual(['#102030', '#405060']);
    swatch.click();
    // recent: false shows none and adds none
    const without = makeColor(0xffffff, { recent: false, palette: ['#000'] });
    without.swatch.click();
    expect(without.panel()!.querySelectorAll('.aekColorPanel__swatch')).toHaveLength(1);
    without.panel()!.querySelector<HTMLElement>('.aekColorPanel__swatch')!.click();
    expect(getRecentColors()).toEqual(['#102030', '#405060']);
  });

  it('the eyedropper, where the browser has one: its colour, the alpha kept', async () => {
    const pick = stubEyeDropper();
    const { swatch, panel, target, calls } = makeColor('#00000080');
    swatch.click();
    const button = panel()!.querySelector<HTMLElement>('.aekColorPanel__eyeDropper')!;
    expect(button.textContent).toBe('Pick from the screen');
    button.click();
    pick('#123456');
    await Promise.resolve();
    await Promise.resolve();
    expect(target.color).toBe('#12345680');
    expect(calls).toEqual([user('#12345680', '#00000080')]);
  });

  it('the eyedropper writes nothing to a field removed while it was open', async () => {
    const pick = stubEyeDropper();
    const { field, swatch, panel, target } = makeColor(0x000000);
    swatch.click();
    panel()!.querySelector<HTMLElement>('.aekColorPanel__eyeDropper')!.click();
    field.cmp.remove();
    pick('#123456');
    await Promise.resolve();
    await Promise.resolve();
    expect(target.color).toBe(0x000000);
  });

  it('without the API, or with eyeDropper: false, has no eyedropper', () => {
    const { swatch, panel } = makeColor(0x000000, { palette: ['#fff'] });
    swatch.click();
    expect(panel()!.querySelector('.aekColorPanel__eyeDropper')).toBe(null);
    swatch.click();
    stubEyeDropper();
    const off = makeColor(0x000000, { eyeDropper: false, palette: ['#fff'] });
    off.swatch.click();
    expect(off.panel()!.querySelector('.aekColorPanel__eyeDropper')).toBe(null);
  });
});

describe('the recent colours (p804 D8)', () => {
  it('keep the newest first, at most 8, as hex; an owner sets and hears them', () => {
    const heard: (readonly string[])[] = [];
    const removeListener = onRecentColorsChange((colors) => heard.push(colors));
    setRecentColors(['#FFF', 'rgb(255 0 0)', '#fff', 'nope', '#00000080']);
    expect(getRecentColors()).toEqual(['#ffffff', '#ff0000', '#00000080']);
    expect(heard).toEqual([]);
    const { type, enter } = makeColor(0x000000);
    for (const text of ['#000001', '#000002', '#ff0000']) {
      type(text);
      enter();
    }
    expect(getRecentColors()).toEqual(['#ff0000', '#000002', '#000001', '#ffffff', '#00000080']);
    expect(heard).toHaveLength(3);
    removeListener();
    setRecentColors(Array.from({ length: 12 }, (_, i) => `#0000${String(i).padStart(2, '0')}`));
    expect(getRecentColors()).toHaveLength(8);
    getRecentColors().push('#123456');
    expect(getRecentColors()).toHaveLength(8);
  });
});

describe('the picker in the panel (p804 D8)', () => {
  /** The open panel's picker and its three parts */
  const openPicker = (swatch: HTMLElement, panel: () => HTMLElement | null) => {
    swatch.click();
    const picker = panel()!.querySelector<HTMLElement & { color: Hsva }>('aek-color-picker')!;
    const part = (name: string) =>
      picker.shadowRoot!.querySelector<HTMLElement>(`[part="${name}"]`)!;
    /** The library's own event from a part: its move, merged into the colour it holds */
    const move = (name: string, detail: Partial<Hsva>) =>
      part(name).dispatchEvent(new window.CustomEvent('move', { bubbles: true, detail }));
    return { picker, part, move };
  };

  it('shows the value; the alpha slider only for a value with alpha', () => {
    const number = makeColor(0x0000ff);
    const { picker } = openPicker(number.swatch, number.panel);
    expect(picker.className).toBe('aekColorPicker');
    expect(picker.color).toMatchObject({ h: 240, s: 100, v: 100 });
    expect(picker.getAttribute('data-alpha')).toBe('off');
    number.swatch.click();
    const tint = makeColor('#ff000080');
    const withAlpha = openPicker(tint.swatch, tint.panel);
    expect(withAlpha.picker.hasAttribute('data-alpha')).toBe(false);
    expect(withAlpha.picker.color.a).toBeCloseTo(128 / 255);
    expect(withAlpha.part('alpha').getAttribute('role')).toBe('slider');
  });

  it('a drag: each move a step, the release anywhere the last: true', () => {
    const { swatch, panel, target, calls, input } = makeColor(0xff0000);
    const { part, move } = openPicker(swatch, panel);
    dispatchPointer(part('saturation'), 'pointerdown');
    // A press in its shadow root is a press in the panel: it stays open
    expect(panel()).not.toBe(null);
    move('hue', { h: 120 });
    expect(target.color).toBe(0x00ff00);
    expect(input.value).toBe('#00ff00');
    move('hue', { h: 240 });
    expect(target.color).toBe(0x0000ff);
    dispatchPointer(document.body, 'pointerup');
    expect(calls).toEqual([
      user(0x00ff00, 0xff0000, false),
      user(0x0000ff, 0x00ff00, false),
      user(0x0000ff, 0xff0000, true),
    ]);
    // A step isn't a recent colour; the gesture's end is
    expect(getRecentColors()).toEqual(['#0000ff']);
  });

  it('a key step writes last: false, its keyup last: true; the key goes no further', () => {
    const { swatch, panel, target, calls } = makeColor(0xff0000);
    const { part } = openPicker(swatch, panel);
    const outside: string[] = [];
    const onKey = (e: Event) => outside.push((e as KeyboardEvent).key);
    document.addEventListener('keydown', onKey);
    const hue = part('hue');
    // The library reads `keyCode`
    const down = dispatchKey(hue, 'keydown', 'ArrowRight', { keyCode: 39 } as KitKeyInit);
    expect(down.defaultPrevented).toBe(true);
    expect(target.color).not.toBe(0xff0000);
    dispatchKey(hue, 'keyup', 'ArrowRight', { keyCode: 39 } as KitKeyInit);
    document.removeEventListener('keydown', onKey);
    expect(outside).toEqual([]);
    expect(calls.map(({ last }) => last)).toEqual([false, true]);
  });

  it('its own writes don’t come back; a value from outside does, its hue kept at grey', () => {
    const { swatch, panel, field } = makeColor<number>(0x0000ff);
    const { picker, move } = openPicker(swatch, panel);
    // Black has no hue to give back: the picker keeps its own
    move('saturation', { v: 0 });
    expect(field.getValue()).toBe(0x000000);
    expect(picker.color).toMatchObject({ h: 240, v: 0 });
    field.setValue(0x808080);
    expect(picker.color).toMatchObject({ h: 240, s: 0 });
    field.setValue(0x00ff00);
    expect(picker.color).toMatchObject({ h: 120, s: 100, v: 100 });
  });

  it('a value without alpha keeps its own: a linear object’s floats from the picker', () => {
    const color = new Color(1, 0, 0);
    const { swatch, panel, target } = makeColor(color, { colorSpace: 'linear' });
    const { move } = openPicker(swatch, panel);
    move('hue', { h: 120 });
    expect(target.color).toBe(color);
    expect(color.getHex()).toBe(0x00ff00);
  });

  it('Escape mid-drag closes the panel with the value reached, last: true', () => {
    const { swatch, panel, calls } = makeColor(0xff0000);
    const { part, move } = openPicker(swatch, panel);
    dispatchPointer(part('saturation'), 'pointerdown');
    move('hue', { h: 120 });
    dispatchKey(part('saturation'), 'keydown', 'Escape', { keyCode: 27 } as KitKeyInit);
    expect(panel()).toBe(null);
    expect(document.activeElement).toBe(swatch);
    expect(calls).toEqual([user(0x00ff00, 0xff0000, false), user(0x00ff00, 0xff0000, true)]);
    // Its release, later, is no one's
    dispatchPointer(document.body, 'pointerup');
    expect(calls).toHaveLength(2);
  });

  it('a field removed mid-drag writes nothing more and leaves no listener on the page', () => {
    const before = countListeners(document, 'pointerup');
    const { field, swatch, panel, calls } = makeColor(0xff0000);
    const { part, move } = openPicker(swatch, panel);
    dispatchPointer(part('saturation'), 'pointerdown');
    expect(countListeners(document, 'pointerup')).toBe(before + 1);
    move('hue', { h: 120 });
    field.cmp.remove();
    expect(countListeners(document, 'pointerup')).toBe(before);
    dispatchPointer(document.body, 'pointerup');
    expect(calls.map(({ last }) => last)).toEqual([false]);
  });
});
