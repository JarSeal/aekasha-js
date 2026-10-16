import { describe, expect, test } from 'vitest';
import { hashStringFNV1a } from './Hash';

describe('hashStringFNV1a', () => {
  test("gives FNV-1a's published 32-bit values", () => {
    expect(hashStringFNV1a('')).toBe(0x811c9dc5);
    expect(hashStringFNV1a('a')).toBe(0xe40c292c);
    expect(hashStringFNV1a('foobar')).toBe(0xbf9cf968);
  });

  test('starts from the basis it is given', () => {
    expect(hashStringFNV1a('', 42)).toBe(42);
    expect(hashStringFNV1a('a', 0x811c9dc5)).toBe(hashStringFNV1a('a'));
  });
});
