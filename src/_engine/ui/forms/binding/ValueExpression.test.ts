import { describe, expect, it } from 'vitest';
import { evaluateValueExpression } from './ValueExpression';

const DEGREES = { deg: 1, rad: 180 / Math.PI };
const value = (text: string, units?: Record<string, number>) =>
  evaluateValueExpression(text, units).value;
const error = (text: string, units?: Record<string, number>) =>
  evaluateValueExpression(text, units).error;

describe('value expressions (p804 D6)', () => {
  it('reads numbers', () => {
    expect(value('1.5')).toBe(1.5);
    expect(value('.5')).toBe(0.5);
    expect(value('2.')).toBe(2);
    expect(value('2e-3')).toBe(0.002);
    expect(value('1E3')).toBe(1000);
    expect(value('  42  ')).toBe(42);
  });

  it('evaluates the operators with their precedence', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('1/2')).toBe(0.5);
    expect(value('10 - 4 - 3')).toBe(3);
    expect(value('8 / 4 / 2')).toBe(1);
    expect(value('2 ** 3')).toBe(8);
    // Right to left, and tighter than a unary sign
    expect(value('2 ** 3 ** 2')).toBe(512);
    expect(value('-2 ** 2')).toBe(-4);
    expect(value('2 ** -1')).toBe(0.5);
    expect(value('2 * -3')).toBe(-6);
    expect(value('--3')).toBe(3);
    expect(value('+3')).toBe(3);
  });

  it('knows pi', () => {
    expect(value('pi')).toBe(Math.PI);
    expect(value('PI / 2')).toBe(Math.PI / 2);
    expect(value('2 * π')).toBe(2 * Math.PI);
  });

  it('applies the units the field declares, after a number or a parenthesis', () => {
    expect(value('90deg', DEGREES)).toBe(90);
    expect(value('pi rad', DEGREES)).toBeCloseTo(180);
    expect(value('(1 + 2)deg', DEGREES)).toBe(3);
    expect(value('1RAD', DEGREES)).toBeCloseTo(57.29577951308232);
    expect(value('50%', { '%': 0.01 })).toBe(0.5);
    expect(value('-50 %', { '%': 0.01 })).toBe(-0.5);
  });

  it('refuses what it doesn’t know, and keeps no value', () => {
    expect(error('')).toBe('Enter a number');
    expect(error('abc')).toBe('Unexpected “a”');
    expect(error('1 +')).toBe('Incomplete expression');
    expect(error('(1 + 2')).toBe('Missing “)”');
    expect(error('1 2')).toBe('Unexpected “2”');
    // Tweakpane's modulo, bit operators and `~` are gone; `%` is a unit only where declared
    expect(error('5 % 2')).toBe('Unexpected “%”');
    expect(error('1 | 2')).toBe('Unexpected “|”');
    expect(error('~1')).toBe('Unexpected “~”');
    expect(error('2pi')).toBe('Unexpected “pi”');
    expect(error('90 grad', DEGREES)).toBe('Unknown unit “grad”');
    expect(error('1 / 0')).toBe('Not a finite number');
    expect(error('1e999')).toBe('Not a finite number');
    expect(evaluateValueExpression('1 / 0').value).toBeUndefined();
  });

  it('runs nothing in the text', () => {
    expect(error('alert(1)')).toBe('Unexpected “a”');
    expect(error('constructor')).toBe('Unexpected “c”');
    expect(error('1; 2')).toBe('Unexpected “;”');
    // A unit lookup reads the field's own units only
    expect(error('1 constructor', DEGREES)).toBe('Unknown unit “constructor”');
    expect(error('1 toString', {})).toBe('Unknown unit “toString”');
  });

  it('refuses text too long or nested too deep', () => {
    expect(error('1'.repeat(300))).toBe('Too long');
    expect(error(`${'('.repeat(40)}1${')'.repeat(40)}`)).toBe('Too deeply nested');
    expect(error('-'.repeat(40) + '1')).toBe('Too deeply nested');
    expect(value(`${'('.repeat(20)}1${')'.repeat(20)}`)).toBe(1);
  });
});
