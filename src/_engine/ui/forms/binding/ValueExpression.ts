// A number part's typed expressions (p804 D6): a parser of the kit's own, so nothing in the text
// runs (no `eval` or `Function`: CSP-safe).

/** A typed expression's result: its value, or why it has none. */
export type ValueExpressionResult =
  | { value: number; error?: undefined }
  | { value?: undefined; error: string };

/** Longer text is refused before it's parsed: nobody types more */
const MAX_LENGTH = 256;
/** Nested parentheses and unary signs: deep enough for any typed value, short of the stack */
const MAX_DEPTH = 32;

const NUMBER_REGEX = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WORD_REGEX = /[A-Za-z]+/y;
const SPACE_REGEX = /\s/;
/** A unit made of one sign (`%`, `°`) rather than letters */
const isSymbolChar = (char: string) => !/[\w\s.()+\-*/]/.test(char);

/** An expression's own error, which the caller gets as text */
class ExpressionError extends Error {}

/**
 * Evaluates a number typed into a field (p804 D6): numbers (`1.5`, `.5`, `2e-3`), `+ - * / **`,
 * parentheses, a unary `-` or `+`, `pi` (or `π`), and the units the field declares, each a factor
 * written after a number or a closing parenthesis (`90deg`, `(1 + 2)deg`, `50%`). `**` binds
 * tighter than a unary sign and from the right (`-2 ** 2` is -4, `2 ** 3 ** 2` 512); names are
 * case-insensitive. A result that isn't a finite number (`1 / 0`) is an error.
 * @internal
 * @param text what was typed
 * @param units the field's units by name, each the factor it multiplies by (a field shown in
 * degrees: `{ deg: 1, rad: 180 / Math.PI }`; a 0-1 field: `{ '%': 0.01 }`)
 * @returns the value, or the error to show (the field keeps its value)
 */
export const evaluateValueExpression = (
  text: string,
  units?: Readonly<Record<string, number>>
): ValueExpressionResult => {
  if (text.length > MAX_LENGTH) return { error: 'Too long' };
  let pos = 0;
  let depth = 0;

  const skipSpace = () => {
    while (pos < text.length && SPACE_REGEX.test(text[pos])) pos++;
  };
  const peek = () => {
    skipSpace();
    return text[pos] ?? '';
  };
  const fail = (message: string): never => {
    throw new ExpressionError(message);
  };
  const unexpected = () =>
    fail(pos < text.length ? `Unexpected “${text[pos]}”` : 'Incomplete expression');
  const enter = () => {
    if (++depth > MAX_DEPTH) fail('Too deeply nested');
  };

  /** A word (`pi`, `deg`) or a one-sign unit (`%`) at `pos`, consumed; '' when there's none */
  const readName = () => {
    skipSpace();
    WORD_REGEX.lastIndex = pos;
    const word = WORD_REGEX.exec(text);
    if (word) {
      pos += word[0].length;
      return word[0];
    }
    const char = text[pos];
    if (char !== undefined && isSymbolChar(char)) {
      pos++;
      return char;
    }
    return '';
  };

  const findUnit = (name: string) => {
    if (!units) return undefined;
    // Own keys only: `toString` isn't a unit
    const lower = name.toLowerCase();
    const keys = Object.keys(units);
    for (let i = 0; i < keys.length; i++)
      if (keys[i].toLowerCase() === lower) return units[keys[i]];
    return undefined;
  };

  // The grammar, loosest first: sum, product, unary, power, unit, primary
  const parseSum = (): number => {
    let value = parseProduct();
    for (let char = peek(); char === '+' || char === '-'; char = peek()) {
      pos++;
      const right = parseProduct();
      value = char === '+' ? value + right : value - right;
    }
    return value;
  };

  const parseProduct = (): number => {
    let value = parseUnary();
    for (let char = peek(); char === '*' || char === '/'; char = peek()) {
      // `**` is a power, the operand's own
      if (char === '*' && text[pos + 1] === '*') break;
      pos++;
      const right = parseUnary();
      value = char === '*' ? value * right : value / right;
    }
    return value;
  };

  const parseUnary = (): number => {
    const char = peek();
    if (char !== '-' && char !== '+') return parsePower();
    pos++;
    enter();
    const value = parseUnary();
    depth--;
    return char === '-' ? -value : value;
  };

  const parsePower = (): number => {
    const base = parseUnit();
    if (peek() !== '*' || text[pos + 1] !== '*') return base;
    pos += 2;
    // Its right side may have a sign (`2 ** -1`) and is a power itself (right to left)
    return base ** parseUnary();
  };

  const parseUnit = (): number => {
    const value = parsePrimary();
    const start = pos;
    const name = readName();
    if (!name) return value;
    const factor = findUnit(name);
    if (factor === undefined) {
      pos = start;
      skipSpace();
      return fail(
        units && /^[A-Za-z]/.test(name) ? `Unknown unit “${name}”` : `Unexpected “${name}”`
      );
    }
    return value * factor;
  };

  const parsePrimary = (): number => {
    const char = peek();
    if (char === '(') {
      pos++;
      enter();
      const value = parseSum();
      depth--;
      if (peek() !== ')') return fail('Missing “)”');
      pos++;
      return value;
    }
    NUMBER_REGEX.lastIndex = pos;
    const number = NUMBER_REGEX.exec(text);
    if (number) {
      pos += number[0].length;
      return Number(number[0]);
    }
    const start = pos;
    const name = readName();
    if (name === 'π' || name.toLowerCase() === 'pi') return Math.PI;
    pos = start;
    return unexpected();
  };

  try {
    if (!peek()) return { error: 'Enter a number' };
    const value = parseSum();
    if (peek()) unexpected();
    if (!Number.isFinite(value)) return { error: 'Not a finite number' };
    return { value };
  } catch (e) {
    if (e instanceof ExpressionError) return { error: e.message };
    throw e;
  }
};
