import { describe, expect, test } from 'vitest';
import { isAtLeast, parseBlenderVersion, pickWindowsBlender } from './findBlender';

describe('findBlender', () => {
  test('reads the version from --version output and from an install folder', () => {
    expect(parseBlenderVersion('Blender 5.3.0\n\tbuild date: 2026-11-03')).toEqual([5, 3]);
    expect(parseBlenderVersion('Blender 4.1')).toEqual([4, 1]);
    expect(parseBlenderVersion('blender.crt')).toBeNull();
  });

  test('compares major first, then minor', () => {
    expect(isAtLeast([5, 3], [5, 1])).toBe(true);
    expect(isAtLeast([5, 1], [5, 1])).toBe(true);
    expect(isAtLeast([6, 0], [5, 1])).toBe(true);
    expect(isAtLeast([4, 9], [5, 1])).toBe(false);
  });

  test('picks the newest Windows install at the minimum or above that has its executable', () => {
    const entries = ['Blender 4.1', 'Blender 5.10', 'Blender 5.3', 'Blender 5.12', 'notes.txt'];
    const exists = (file: string) => !file.includes('5.12');
    expect(pickWindowsBlender(entries, [5, 1], exists)).toMatchObject({
      version: [5, 10],
      source: 'windows',
    });
    expect(pickWindowsBlender(['Blender 4.1'], [5, 1], exists)).toBeNull();
  });
});
