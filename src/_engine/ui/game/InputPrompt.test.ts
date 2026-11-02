import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createInputPrompt, getPromptDevice, setPromptDevice } from './InputPrompt';
import type { InputPromptBinding } from './InputPrompt';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  setPromptDevice({ device: 'KEYBOARD_MOUSE' });
});

const INTERACT: InputPromptBinding[] = [
  { device: 'KEYBOARD', keys: ['e', 'Enter'] },
  { device: 'GAMEPAD', button: 'WEST' },
  { device: 'TOUCH', gesture: 'TAP' },
];

const labels = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekInputGlyph')].map((glyph) => glyph.getAttribute('aria-label'));

describe('input prompt (p808 D5)', () => {
  it('shows the binding for the prompt device, and its label', () => {
    const prompt = createInputPrompt({ bindings: INTERACT, label: 'Interact' });
    const elem = prompt.cmp.elem;
    expect(elem.className).toBe('aekInputPrompt');
    expect(elem.getAttribute('data-device')).toBe('keyboard_mouse');
    expect(labels(elem)).toEqual(['E']);
    expect(elem.querySelector('.aekInputPrompt__label')?.textContent).toBe('Interact');
    prompt.cmp.remove();
  });

  it('follows setPromptDevice, every prompt at once, with the family', () => {
    const a = createInputPrompt({ bindings: INTERACT });
    const b = createInputPrompt({ bindings: [{ device: 'GAMEPAD', button: 'SOUTH' }] });
    setPromptDevice({ device: 'GAMEPAD', family: 'PLAYSTATION' });
    expect(getPromptDevice()).toEqual({ device: 'GAMEPAD', family: 'PLAYSTATION' });
    expect(a.cmp.elem.getAttribute('data-device')).toBe('gamepad');
    expect(labels(a.cmp.elem)).toEqual(['Square button']);
    expect(labels(b.cmp.elem)).toEqual(['Cross button']);
    setPromptDevice({ device: 'GAMEPAD', family: 'XBOX' });
    expect(labels(a.cmp.elem)).toEqual(['X button']);
    // Touch shows the keyboard's (touch has no glyph)
    setPromptDevice({ device: 'TOUCH' });
    expect(labels(a.cmp.elem)).toEqual(['E']);
    a.cmp.remove();
    b.cmp.remove();
  });

  it('falls back to a binding it can draw when the device has none', () => {
    const prompt = createInputPrompt({ bindings: [{ device: 'MOUSE', button: 'LEFT' }] });
    setPromptDevice({ device: 'GAMEPAD' });
    expect(labels(prompt.cmp.elem)).toEqual(['Left mouse button']);
    prompt.cmp.remove();
  });

  it("draws a chord's modifiers and a keyboard axis' keys, and redraws on new bindings", () => {
    const prompt = createInputPrompt({
      bindings: [{ device: 'KEYBOARD', keys: [{ key: 's', ctrl: true, shift: true }] }],
      label: 'Save',
    });
    expect(labels(prompt.cmp.elem)).toEqual(['Control', 'Shift', 'S']);
    prompt.setBindings([{ device: 'KEYBOARD', up: 'w', down: 's', left: 'a', right: 'd' }]);
    expect(labels(prompt.cmp.elem)).toEqual(['W', 'A', 'S', 'D']);
    prompt.setBindings([{ device: 'KEYBOARD', negative: 'q', positive: 'e' }]);
    expect(labels(prompt.cmp.elem)).toEqual(['Q', 'E']);
    prompt.setLabel('');
    expect(prompt.cmp.elem.querySelector<HTMLElement>('.aekInputPrompt__label')?.hidden).toBe(true);
    prompt.cmp.remove();
  });

  it('stops following the device once removed', () => {
    const prompt = createInputPrompt({ bindings: INTERACT });
    const elem = prompt.cmp.elem;
    prompt.cmp.remove();
    setPromptDevice({ device: 'GAMEPAD', family: 'XBOX' });
    expect(elem.getAttribute('data-device')).toBe('keyboard_mouse');
  });
});
