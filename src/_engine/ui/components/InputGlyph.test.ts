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
});
