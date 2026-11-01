import { describe, expect, it } from 'vitest';
import {
  checkBox,
  checkInside,
  checkPosition,
  diffComputedStyles,
  readRegisteredProperties,
} from './embedChecks';

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

  it('skips the ignored properties only', () => {
    expect(
      diffComputedStyles(
        { body: { color: 'red' } },
        { body: { color: 'red', '--aek-base': '14px', '--aek-accent': '#0ff' } },
        ['--aek-base']
      )
    ).toEqual(['body --aek-accent: (none) → #0ff']);
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

describe('checkInside', () => {
  const container = { x: 25, y: 100, width: 640, height: 360 };

  it('passes inside and on the edges, within a pixel', () => {
    expect(checkInside('window', { x: 41, y: 116, width: 220, height: 150 }, container)).toBe(null);
    expect(checkInside('backdrop', container, container)).toBe(null);
    expect(checkInside('toast', { x: 24.5, y: 100, width: 641, height: 10 }, container)).toBe(null);
  });

  it('names both boxes past any edge', () => {
    expect(checkInside('list', { x: 200, y: 400, width: 100, height: 80 }, container)).toBe(
      "list: 100 × 80 at 200, 400, outside the container's 640 × 360 at 25, 100"
    );
    expect(checkInside('window', { x: 0, y: 0, width: 220, height: 150 }, container)).not.toBe(
      null
    );
    expect(checkInside('window', null, container)).toBe('window: missing');
  });
});

describe('checkPosition', () => {
  it('passes within a pixel and names the positions otherwise', () => {
    expect(
      checkPosition('window', { x: 41.4, y: 116, width: 1, height: 1 }, { x: 41, y: 116 })
    ).toBe(null);
    expect(checkPosition('window', { x: 25, y: 100, width: 1, height: 1 }, { x: 41, y: 116 })).toBe(
      'window: at 25, 100, expected 41, 116'
    );
    expect(checkPosition('window', null, { x: 0, y: 0 })).toBe('window: missing');
  });
});

describe('readRegisteredProperties', () => {
  it("reads each @property's name", () => {
    const css = `@layer a, b;\n@property --aek-base {\n  syntax: '<length>';\n}\n@property --x-y{}\n.aekUi { --aek-x: 1px; }`;
    expect(readRegisteredProperties(css)).toEqual(['--aek-base', '--x-y']);
  });
});
