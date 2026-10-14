import { describe, expect, it } from 'vitest';
import { checkBox, diffComputedStyles } from './embedChecks';

describe('diffComputedStyles', () => {
  it('lists each changed, added and removed property, and a selector gone', () => {
    expect(
      diffComputedStyles(
        { body: { color: 'red', margin: '8px' }, p: { color: 'black' }, h1: {} },
        { body: { color: 'blue', margin: '8px', cursor: 'auto' }, p: {} }
      )
    ).toEqual([
      'body color: red → blue',
      'body cursor: (none) → auto',
      'p color: black → (none)',
      'h1: gone',
    ]);
  });

  it('is empty for the same styles', () => {
    expect(diffComputedStyles({ body: { color: 'red' } }, { body: { color: 'red' } })).toEqual([]);
  });
});

describe('checkBox', () => {
  it('passes within a pixel and names the sizes otherwise', () => {
    expect(checkBox('canvas', { width: 320.5, height: 288 }, { width: 320, height: 288 })).toBe(
      null
    );
    expect(checkBox('canvas', { width: 300, height: 288 }, { width: 320, height: 288 })).toBe(
      'canvas: 300 × 288, expected 320 × 288'
    );
    expect(checkBox('canvas', null, { width: 1, height: 1 })).toBe('canvas: missing');
  });
});
