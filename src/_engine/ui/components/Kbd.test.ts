import { beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createKbd } from './Kbd';
import { getKeyName, getKeyPlatform, splitKeyChord } from './KeyNames';

beforeAll(async () => {
  await stubKitDomAsync();
});

const getKeys = (elem: HTMLElement) =>
  [...elem.querySelectorAll('.aekKbd__key')].map((key) => key.textContent);

describe('key names (p803 D10)', () => {
  it('splits a chord, the plus key included', () => {
    expect(splitKeyChord('Ctrl+Shift+P')).toEqual(['Ctrl', 'Shift', 'P']);
    expect(splitKeyChord('Ctrl++')).toEqual(['Ctrl', '+']);
    expect(splitKeyChord('+')).toEqual(['+']);
    expect(splitKeyChord(' F6 ')).toEqual(['F6']);
  });

  it('names the modifiers by platform, the arrows and letters alike', () => {
    expect(getKeyName('Meta', 'mac')).toEqual({ shown: '⌘', spoken: 'Command' });
    expect(getKeyName('meta', 'other')).toEqual({ shown: 'Meta', spoken: 'Meta' });
    expect(getKeyName('Alt', 'mac')).toEqual({ shown: '⌥', spoken: 'Option' });
    expect(getKeyName('Ctrl', 'other')).toEqual({ shown: 'Ctrl', spoken: 'Control' });
    expect(getKeyName('ArrowUp', 'other')).toEqual({ shown: '↑', spoken: 'Up arrow' });
    expect(getKeyName(' ', 'mac')).toEqual({ shown: 'Space', spoken: 'Space' });
    expect(getKeyName('e', 'mac')).toEqual({ shown: 'E', spoken: 'E' });
    expect(getKeyName('F6', 'mac')).toEqual({ shown: 'F6', spoken: 'F6' });
  });

  it('reads the platform from navigator when asked, not at load', () => {
    const original = globalThis.navigator;
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: '' });
    expect(getKeyPlatform()).toBe('mac');
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(getKeyPlatform()).toBe('other');
    vi.stubGlobal('navigator', { platform: 'iPhone' });
    expect(getKeyPlatform()).toBe('mac');
    vi.stubGlobal('navigator', original);
  });
});

describe('kbd (p803 D10)', () => {
  it('draws a kbd per key with a plus between them; words need no hidden copy', () => {
    const { cmp } = createKbd({ keys: 'Shift+F6', platform: 'other' });
    expect(cmp.elem.tagName).toBe('KBD');
    expect(cmp.elem.className).toBe('aekKbd');
    expect(getKeys(cmp.elem)).toEqual(['Shift', 'F6']);
    expect(cmp.elem.querySelectorAll('.aekKbd__join')).toHaveLength(1);
    expect(cmp.elem.querySelector('.aekKbd__keys')?.hasAttribute('aria-hidden')).toBe(false);
    expect(cmp.elem.querySelector('.aekVisuallyHidden')).toBeNull();
    cmp.remove();
  });

  it('says an abbreviation in full (Ctrl as Control)', () => {
    const { cmp } = createKbd({ keys: 'Ctrl+Shift+P', platform: 'other' });
    expect(getKeys(cmp.elem)).toEqual(['Ctrl', 'Shift', 'P']);
    expect(cmp.elem.querySelector('.aekVisuallyHidden')?.textContent).toBe('Control+Shift+P');
    cmp.remove();
  });

  it('on macOS shows symbols, hides them from assistive tech and says the words', () => {
    const { cmp } = createKbd({ keys: 'Meta+Shift+P', platform: 'mac' });
    expect(getKeys(cmp.elem)).toEqual(['⌘', '⇧', 'P']);
    expect(cmp.elem.querySelector('.aekKbd__keys')?.getAttribute('aria-hidden')).toBe('true');
    expect(cmp.elem.querySelector('.aekVisuallyHidden')?.textContent).toBe('Command+Shift+P');
    expect(cmp.elem.hasAttribute('aria-label')).toBe(false);
    cmp.remove();
  });

  it('joins alternatives with "or", and setKeys redraws in place', () => {
    const kbd = createKbd({ keys: 'F7 / Shift+ArrowUp', platform: 'other', class: 'hint' });
    expect(kbd.cmp.elem.className).toBe('aekKbd hint');
    expect(getKeys(kbd.cmp.elem)).toEqual(['F7', 'Shift', '↑']);
    expect(kbd.cmp.elem.querySelector('.aekKbd__or')?.textContent).toBe('or');
    expect(kbd.cmp.elem.querySelector('.aekVisuallyHidden')?.textContent).toBe(
      'F7 or Shift+Up arrow'
    );
    const elem = kbd.cmp.elem;
    kbd.setKeys('Escape');
    expect(kbd.cmp.elem).toBe(elem);
    expect(getKeys(elem)).toEqual(['Esc']);
    expect(elem.querySelector('.aekVisuallyHidden')?.textContent).toBe('Escape');
    kbd.cmp.remove();
  });

  it('writes its id only when given one', () => {
    const withId = createKbd({ keys: 'A', id: 'saveHint', platform: 'other' });
    expect(withId.cmp.elem.id).toBe('saveHint');
    const without = createKbd({ keys: 'A', platform: 'other' });
    expect(without.cmp.elem.hasAttribute('id')).toBe(false);
    withId.cmp.remove();
    without.cmp.remove();
  });
});
