import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createInputGlyph } from './InputGlyph';

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('input glyph (p803 D10)', () => {
  it('draws a key as a key cap named by the key', () => {
    const { cmp } = createInputGlyph({ input: { device: 'KEYBOARD', key: 'e' } });
    expect(cmp.elem.className).toBe('aekInputGlyph');
    expect(cmp.elem.getAttribute('role')).toBe('img');
    expect(cmp.elem.getAttribute('data-device')).toBe('keyboard');
    expect(cmp.elem.getAttribute('aria-label')).toBe('E');
    expect(cmp.elem.textContent).toBe('E');
    cmp.remove();
  });

  it('shows a modifier by platform and says its word', () => {
    const { cmp } = createInputGlyph({
      input: { device: 'KEYBOARD', key: 'Meta' },
      platform: 'mac',
    });
    expect(cmp.elem.textContent).toBe('⌘');
    expect(cmp.elem.getAttribute('aria-label')).toBe('Command');
    cmp.remove();
  });

  it('draws a mouse button, the wheel and the movement, each with its part and name', () => {
    const glyph = createInputGlyph({
      input: { device: 'MOUSE', button: 'LEFT' },
      attr: { title: 'x' },
    });
    const elem = glyph.cmp.elem;
    expect(elem.getAttribute('title')).toBe('x');
    expect(elem.getAttribute('data-device')).toBe('mouse');
    expect(elem.getAttribute('aria-label')).toBe('Left mouse button');
    expect(elem.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(elem.querySelectorAll('.aekInputGlyph__active')).toHaveLength(1);
    glyph.setInput({ device: 'MOUSE', delta: 'WHEEL' });
    expect(glyph.cmp.elem).toBe(elem);
    expect(elem.getAttribute('aria-label')).toBe('Mouse wheel');
    glyph.setInput({ device: 'MOUSE', delta: 'MOVE' });
    expect(elem.getAttribute('aria-label')).toBe('Mouse movement');
    expect(elem.querySelector('.aekInputGlyph__active')).toBeNull();
    glyph.setInput({ device: 'KEYBOARD', key: ' ' });
    expect(elem.getAttribute('data-device')).toBe('keyboard');
    expect(elem.textContent).toBe('Space');
    expect(elem.querySelector('svg')).toBeNull();
    glyph.cmp.remove();
  });

  it("labels a gamepad's face button by its family, and says its name (p808 D5)", () => {
    const glyph = createInputGlyph({
      input: { device: 'GAMEPAD', button: 'SOUTH' },
      family: 'XBOX',
    });
    const elem = glyph.cmp.elem;
    expect(elem.getAttribute('data-device')).toBe('gamepad');
    expect(elem.getAttribute('data-family')).toBe('xbox');
    expect(elem.getAttribute('data-button')).toBe('SOUTH');
    expect(elem.getAttribute('data-shape')).toBe('circle');
    expect(elem.textContent).toBe('A');
    expect(elem.getAttribute('aria-label')).toBe('A button');
    glyph.setFamily('NINTENDO');
    expect(elem.textContent).toBe('B');
    glyph.setFamily('PLAYSTATION');
    expect(elem.textContent).toBe('');
    expect(elem.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(elem.getAttribute('aria-label')).toBe('Cross button');
    glyph.setFamily('GENERIC');
    expect(elem.getAttribute('data-shape')).toBe('plain');
    expect(elem.querySelectorAll('.aekInputGlyph__active')).toHaveLength(1);
    expect(elem.getAttribute('aria-label')).toBe('Bottom face button');
    glyph.cmp.remove();
  });

  it('draws the shoulders, triggers, sticks, axes and the d-pad', () => {
    const glyph = createInputGlyph({
      input: { device: 'GAMEPAD', button: 'RIGHT_TRIGGER' },
      family: 'PLAYSTATION',
    });
    const elem = glyph.cmp.elem;
    expect(elem.getAttribute('data-shape')).toBe('trigger');
    expect(elem.textContent).toBe('R2');
    glyph.setInput({ device: 'GAMEPAD', button: 'LEFT_SHOULDER' });
    expect(elem.getAttribute('data-shape')).toBe('pill');
    expect(elem.getAttribute('aria-label')).toBe('L1 button');
    glyph.setInput({ device: 'GAMEPAD', stick: 'LEFT' });
    expect(elem.getAttribute('aria-label')).toBe('Left stick');
    expect(elem.getAttribute('data-button')).toBe('STICK_LEFT');
    glyph.setInput({ device: 'GAMEPAD', axis: 'RIGHT_Y' });
    expect(elem.getAttribute('aria-label')).toBe('Right stick, up and down');
    glyph.setInput({ device: 'GAMEPAD', button: 'DPAD_LEFT' });
    expect(elem.getAttribute('aria-label')).toBe('D-pad left');
    expect(elem.querySelectorAll('.aekInputGlyph__active')).toHaveLength(1);
    // Back to a key: the gamepad's attributes go
    glyph.setInput({ device: 'KEYBOARD', key: 'e' });
    expect(elem.hasAttribute('data-shape')).toBe(false);
    expect(elem.hasAttribute('data-family')).toBe(false);
    // A family change doesn't redraw a key
    glyph.setFamily('XBOX');
    expect(elem.textContent).toBe('E');
    glyph.cmp.remove();
  });
});
