import { describe, expect, it } from 'vitest';
import { stableStringify } from './StableStringify';

describe('stableStringify', () => {
  it('sorts object keys at every depth, by code unit', () => {
    expect(stableStringify({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}'
    );
    expect(stableStringify({ b: 1, B: 2, '10': 3, '9': 4 })).toBe('{"10":3,"9":4,"B":2,"b":1}');
  });

  it('writes undefined as null, or leaves it out of an object', () => {
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify([1, undefined])).toBe('[1,null]');
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('is JSON.stringify for plain data without integer-like keys', () => {
    const value = { name: 'x', list: [1, 'two', true, null, { k: 0.5 }], nested: { e: [] } };
    expect(JSON.parse(stableStringify(value))).toEqual(value);
    expect(stableStringify(value)).toBe(
      '{"list":[1,"two",true,null,{"k":0.5}],"name":"x","nested":{"e":[]}}'
    );
  });

  it('writes what `replace` returns', () => {
    const color = { isColor: true, hex: 0xff0000 };
    const replace = (v: unknown) => (v && typeof v === 'object' && 'isColor' in v ? color.hex : v);
    expect(stableStringify({ c: color, list: [color] }, replace)).toBe(
      '{"c":16711680,"list":[16711680]}'
    );
  });
});
