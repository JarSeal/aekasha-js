import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
} from '../../testing/KitDom';
import { createBindingScheduler } from '../binding/BindingScheduler';
import { loadColorPickerAsync } from '../color/ColorPicker';
import type { FieldChange } from '../Field';
import type { GradientValue } from './Gradient';
import { createGradientEditor, type GradientEditorProps } from './GradientEditor';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
  // The colour panel's picker, loaded first: an open doesn't start a load mid-test
  await loadColorPickerAsync();
});

type Change = { value: string; prev: string; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** The stops as text: `#000000@0, #ffffff@1` */
const describe_ = (value: GradientValue) =>
  value.stops.map((stop) => `${stop.color}@${stop.t}`).join(', ');

const BAR_LEFT = 12;
const BAR_WIDTH = 200;

/** An editor bound to `target.ramp` (black to white), its bar 200 px wide from x 12 (linkedom lays
 * nothing out), with its onChange calls as text */
const makeEditor = (
  props: Partial<GradientEditorProps> = {},
  start: GradientValue = {
    stops: [
      { t: 0, color: '#000000' },
      { t: 1, color: '#ffffff' },
    ],
  }
) => {
  const target = { ramp: start };
  const calls: Change[] = [];
  const field = createGradientEditor({
    label: 'Ramp',
    target,
    key: 'ramp',
    onChange: (value: GradientValue, { prev, last, source }: FieldChange<GradientValue>) =>
      calls.push({ value: describe_(value), prev: describe_(prev), last, source }),
    ...props,
  } as GradientEditorProps);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const track = root.querySelector<HTMLElement>('.aekGradientEditor__track');
  const bar = root.querySelector<HTMLElement>('.aekGradientEditor__bar');
  if (bar) {
    bar.getBoundingClientRect = () =>
      ({ left: BAR_LEFT, width: BAR_WIDTH, top: 0, height: 24, right: 212, bottom: 24 }) as DOMRect;
  }
  /** The handles as they are now, each with its box where it's drawn */
  const getHandles = () =>
    [...root.querySelectorAll<HTMLElement>('.aekGradientEditor__stop')].map((handle) => {
      const left = BAR_LEFT + (parseFloat(handle.style.left) / 100) * BAR_WIDTH - 12;
      handle.getBoundingClientRect = () =>
        ({ left, width: 24, top: 24, height: 24, right: left + 24, bottom: 48 }) as DOMRect;
      return handle;
    });
  const position = root.querySelector<HTMLInputElement>('input[aria-label="Stop position"]');
  const colorInput = root.querySelector<HTMLInputElement>('input[aria-label="Stop colour"]');
  const addButton = root.querySelector<HTMLButtonElement>('.aekGradientEditor__add');
  const removeButton = root.querySelector<HTMLButtonElement>('.aekGradientEditor__remove');
  return {
    field,
    target,
    calls,
    root,
    track: track!,
    bar: bar!,
    getHandles,
    position: position!,
    colorInput: colorInput!,
    addButton: addButton!,
    removeButton: removeButton!,
  };
};

const typeInto = (input: HTMLInputElement, text: string) => {
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  dispatchKey(input, 'keydown', 'Enter');
};

describe('the gradient editor (p804 D8)', () => {
  it('a group with the bar, a slider per stop and the selected stop’s row', () => {
    const { root, bar, getHandles, position, colorInput, removeButton } = makeEditor();
    expect(root.getAttribute('data-kind')).toBe('gradient');
    const group = root.querySelector('.aekGradientEditor')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.style.getPropertyValue('--aek-gradient-editor-value')).toBe(
      'linear-gradient(to right, #000000 0%, #ffffff 100%)'
    );
    const handles = getHandles();
    expect(handles.map((handle) => handle.getAttribute('role'))).toEqual(['slider', 'slider']);
    expect(handles.map((handle) => handle.getAttribute('aria-label'))).toEqual([
      'Stop 1',
      'Stop 2',
    ]);
    expect(handles[1].getAttribute('aria-valuenow')).toBe('100');
    expect(handles[1].getAttribute('aria-valuetext')).toBe('100 %, #ffffff');
    expect(handles[0].hasAttribute('data-selected')).toBe(true);
    expect(handles[0].getAttribute('tabindex')).toBe('0');
    expect(position.getAttribute('role')).toBe('spinbutton');
    expect(position.value).toBe('0');
    expect(colorInput.value).toBe('#000000');
    expect(root.querySelector('.aekColorField__swatch')!.getAttribute('aria-label')).toBe(
      'Pick the stop’s colour'
    );
    // At the fewest stops: nothing to remove
    expect(removeButton.hasAttribute('disabled')).toBe(true);
  });

  it('a handle’s keys move its stop in place, in D3’s order; focusing it selects it', () => {
    const { target, calls, getHandles, position, colorInput } = makeEditor();
    const ramp = target.ramp;
    const stops = ramp.stops;
    const handle = getHandles()[1];
    handle.focus();
    expect(handle.hasAttribute('data-selected')).toBe(true);
    expect(colorInput.value).toBe('#ffffff');
    dispatchKey(handle, 'keydown', 'ArrowLeft', { shiftKey: true });
    expect(position.value).toBe('90');
    dispatchKey(handle, 'keyup', 'ArrowLeft');
    dispatchKey(handle, 'keydown', 'Home');
    dispatchKey(handle, 'keyup', 'Home');
    expect(target.ramp).toBe(ramp);
    expect(target.ramp.stops).toBe(stops);
    expect(calls).toEqual([
      {
        value: '#000000@0, #ffffff@0.9',
        prev: '#000000@0, #ffffff@1',
        last: false,
        source: 'user',
      },
      { value: '#000000@0, #ffffff@0.9', prev: '#000000@0, #ffffff@1', last: true, source: 'user' },
      {
        value: '#000000@0, #ffffff@0',
        prev: '#000000@0, #ffffff@0.9',
        last: false,
        source: 'user',
      },
      {
        value: '#000000@0, #ffffff@0',
        prev: '#000000@0, #ffffff@0.9',
        last: true,
        source: 'user',
      },
    ]);
  });

  it('Insert adds a stop after one, its colour the gradient’s there; Delete removes it', () => {
    const { target, getHandles, colorInput, removeButton } = makeEditor();
    const first = getHandles()[0];
    first.focus();
    dispatchKey(first, 'keydown', 'Insert');
    expect(describe_(target.ramp)).toBe('#000000@0, #808080@0.5, #ffffff@1');
    // The new stop is selected and focused
    const added = getHandles()[1];
    expect(document.activeElement).toBe(added);
    expect(colorInput.value).toBe('#808080');
    expect(removeButton.hasAttribute('disabled')).toBe(false);
    dispatchKey(added, 'keydown', '+');
    expect(describe_(target.ramp)).toBe('#000000@0, #808080@0.5, #c0c0c0@0.75, #ffffff@1');
    dispatchKey(getHandles()[2], 'keydown', 'Delete');
    expect(describe_(target.ramp)).toBe('#000000@0, #808080@0.5, #ffffff@1');
    expect(document.activeElement).toBe(getHandles()[2]);
    dispatchKey(getHandles()[2], 'keydown', 'Backspace');
    // Not below minStops
    dispatchKey(getHandles()[1], 'keydown', 'Delete');
    expect(describe_(target.ramp)).toBe('#000000@0, #808080@0.5');
  });

  it('a drag moves a handle from where it was grabbed, past another, keeping its index', () => {
    const { target, calls, track, getHandles } = makeEditor();
    const handle = getHandles()[0];
    // Grabbed 4 px right of its centre (x 12)
    dispatchPointer(handle, 'pointerdown', { clientX: 16 });
    expect(track.hasAttribute('data-dragging')).toBe(true);
    expect(document.activeElement).toBe(handle);
    dispatchPointer(track, 'pointermove', { clientX: 116 });
    expect(describe_(target.ramp)).toBe('#000000@0.5, #ffffff@1');
    // Past the other stop: still the first in the array
    dispatchPointer(track, 'pointermove', { clientX: 300 });
    dispatchPointer(track, 'pointerup', { clientX: 300 });
    expect(describe_(target.ramp)).toBe('#000000@1, #ffffff@1');
    expect(getHandles()[0].hasAttribute('data-selected')).toBe(true);
    expect(calls.map((call) => call.last)).toEqual([false, false, true]);
  });

  it('a press on the bar adds a stop there and drags it; none past maxStops', () => {
    const { target, calls, track, bar, getHandles, colorInput } = makeEditor({ maxStops: 3 });
    dispatchPointer(bar, 'pointerdown', { clientX: 62 });
    expect(describe_(target.ramp)).toBe('#000000@0, #ffffff@1, #404040@0.25');
    expect(document.activeElement).toBe(getHandles()[2]);
    expect(colorInput.value).toBe('#404040');
    dispatchPointer(track, 'pointermove', { clientX: 82, altKey: true });
    expect(describe_(target.ramp)).toBe('#000000@0, #ffffff@1, #404040@0.35');
    dispatchPointer(track, 'pointerup', { clientX: 82 });
    expect(calls.map((call) => call.last)).toEqual([false, false, true]);
    dispatchPointer(bar, 'pointerdown', { clientX: 150 });
    dispatchPointer(track, 'pointerup', { clientX: 150 });
    expect(target.ramp.stops).toHaveLength(3);
    expect(calls).toHaveLength(3);
  });

  it('the row writes the selected stop: a typed position and colour, the buttons', () => {
    const { target, getHandles, position, colorInput, addButton, removeButton } = makeEditor();
    getHandles()[1].focus();
    typeInto(position, '75');
    expect(describe_(target.ramp)).toBe('#000000@0, #ffffff@0.75');
    typeInto(colorInput, '#3fd8f2');
    expect(describe_(target.ramp)).toBe('#000000@0, #3fd8f2@0.75');
    addButton.click();
    expect(describe_(target.ramp)).toBe('#000000@0, #3fd8f2@0.75, #3fd8f2@0.88');
    removeButton.click();
    expect(describe_(target.ramp)).toBe('#000000@0, #3fd8f2@0.75');
  });

  it('Enter on a handle opens the colour panel', () => {
    const { getHandles } = makeEditor();
    const handle = getHandles()[1];
    handle.focus();
    dispatchKey(handle, 'keydown', 'Enter');
    const popover = document.querySelector('.aekColorPopover');
    expect(popover).not.toBe(null);
    expect(popover!.querySelector('.aekColorPanel')).not.toBe(null);
  });

  it('alpha: stops with alpha digits keep them, and the row has the alpha part', () => {
    const { root, colorInput } = makeEditor(
      {},
      {
        stops: [
          { t: 0, color: '#ff000000' },
          { t: 1, color: '#ff0000ff' },
        ],
      }
    );
    expect(colorInput.value).toBe('#ff000000');
    expect(root.querySelector('input[aria-label="Ramp stop alpha"]')).not.toBe(null);
  });

  it('a change from outside redraws the handles and flashes the bar', () => {
    const scheduler = createBindingScheduler();
    removers.push(() => scheduler.dispose());
    const { target, bar, getHandles } = makeEditor({ scheduler });
    target.ramp.stops.push({ t: 0.5, color: '#ff0000' });
    scheduler.refresh();
    expect(getHandles()).toHaveLength(3);
    expect(bar.hasAttribute('data-flash')).toBe(true);
  });

  it('disabled: the handles are out of the tab order, nothing writes', () => {
    const { field, target, getHandles, bar, addButton } = makeEditor();
    field.setDisabled(true);
    const handles = getHandles();
    expect(handles[0].getAttribute('aria-disabled')).toBe('true');
    expect(handles[0].hasAttribute('tabindex')).toBe(false);
    expect(addButton.hasAttribute('disabled')).toBe(true);
    dispatchKey(handles[0], 'keydown', 'ArrowRight');
    dispatchKey(handles[0], 'keydown', 'Insert');
    dispatchPointer(bar, 'pointerdown', { clientX: 100 });
    expect(describe_(target.ramp)).toBe('#000000@0, #ffffff@1');
    field.setDisabled(false);
    expect(getHandles()[0].getAttribute('tabindex')).toBe('0');
    expect(addButton.hasAttribute('disabled')).toBe(false);
  });

  it('readonly is a monitor of the stops', () => {
    const { root } = makeEditor({ readonly: true });
    expect(root.getAttribute('data-kind')).toBe('monitor');
    expect(root.textContent).toContain('#000000 0 %, #ffffff 100 %');
  });

  it('removed mid-drag, it leaves no listener and writes nothing more', () => {
    const { field, track, getHandles, position, colorInput, calls } = makeEditor();
    const handles = getHandles();
    dispatchPointer(handles[0], 'pointerdown', { clientX: 12 });
    dispatchPointer(track, 'pointermove', { clientX: 60 });
    field.cmp.remove();
    expect(countListeners(track)).toBe(0);
    for (const handle of handles) expect(countListeners(handle)).toBe(0);
    expect(countListeners(position)).toBe(0);
    expect(countListeners(colorInput)).toBe(0);
    expect(calls.map((call) => call.last)).toEqual([false]);
  });
});
