// A colour field's value (p804 D8): the three forms a bound colour takes (a 24-bit number, a hex
// string, an `{ r, g, b, a? }` object of 0-1 floats), the two spaces an object's floats may be in
// (sRGB, or three's linear working space), and the text a user types (hex, `rgb()`, `hsl()`, a
// list of 0-1 numbers). The field works in sRGB floats (`Rgba`); a codec reads a bound value into
// them and writes them back in the value's own form. No three import: the sRGB curve is three's,
// with its constants, so a value goes through either the same way.

/**
 * A colour field's value, in one of three forms kept on write (p804 D8): a 24-bit number
 * (`0xrrggbb`, what a `THREE.Color`'s `getHex()` gives), a hex string (`'#rrggbb'`, or
 * `'#rrggbbaa'` with alpha), or an object of 0-1 floats (`{ r, g, b }`, `a` with alpha: a
 * `THREE.Color` itself, written in place).
 */
export type ColorFieldValue = number | string | { r: number; g: number; b: number; a?: number };

/**
 * A colour as the field works on it: sRGB, each channel 0-1 (an object's may be over 1: an HDR
 * value, kept until the user changes it).
 * @internal
 */
export type Rgba = { r: number; g: number; b: number; a: number };

/**
 * A bound value's form: what the field writes back.
 * @internal
 */
export type ColorForm = 'number' | 'hex' | 'float';

/** What a typed or pasted text is: a colour, or the error to show */
type ParseResult = { value: Rgba; error?: undefined } | { value?: undefined; error: string };

const HEX_STRING_REGEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const NUMBER_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const FUNCTION_REGEX = /^(rgba?|hsla?)\((.*)\)$/;
const HUE_UNITS: Readonly<Record<string, number>> = {
  deg: 1,
  rad: 180 / Math.PI,
  grad: 0.9,
  turn: 360,
};

/**
 * The error a text that isn't a colour shows.
 * @internal
 */
export const COLOR_TEXT_ERROR = 'Not a colour: type #rrggbb, rgb(), hsl() or three numbers 0-1';

/**
 * An sRGB channel in three's linear working space (three's `SRGBToLinear`, its constants).
 * @internal
 */
export const srgbToLinear = (c: number) =>
  c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);

/**
 * A linear channel in sRGB (three's `LinearToSRGB`, its constants).
 * @internal
 */
export const linearToSrgb = (c: number) =>
  c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;

/**
 * Whether a value is a hex colour string (`'#rgb'`, `'#rgba'`, `'#rrggbb'`, `'#rrggbbaa'`): what a
 * property grid item infers a colour field from.
 * @internal
 */
export const isColorString = (value: unknown): value is string =>
  typeof value === 'string' && HEX_STRING_REGEX.test(value);

/**
 * Whether a value is a colour object (`r`, `g` and `b` numbers, `a` a number or absent).
 * @internal
 */
export const isColorObject = (value: unknown): value is Rgba => {
  if (typeof value !== 'object' || value === null) return false;
  const { r, g, b, a } = value as Record<string, unknown>;
  return (
    typeof r === 'number' &&
    typeof g === 'number' &&
    typeof b === 'number' &&
    (a === undefined || typeof a === 'number')
  );
};

/**
 * A bound value's form, or null when it's no colour.
 * @internal
 */
export const getColorForm = (value: unknown): ColorForm | null => {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'hex';
  return isColorObject(value) ? 'float' : null;
};

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

const toByte = (value: number) => Math.round(clamp01(value) * 255);

const BYTE_HEX: string[] = [];

/** A byte as two hex digits: the table is made on first use (nothing at module load) */
const getByteHex = (byte: number) => {
  if (BYTE_HEX.length === 0) {
    for (let i = 0; i < 256; i++) BYTE_HEX.push(i.toString(16).padStart(2, '0'));
  }
  return BYTE_HEX[byte];
};

/**
 * A colour as `'#rrggbb'`, or `'#rrggbbaa'` with `withAlpha`: lower case, each channel clamped to
 * 0-1 and rounded to a byte.
 * @internal
 */
export const formatColorHex = (color: Rgba, withAlpha = false) =>
  `#${getByteHex(toByte(color.r))}${getByteHex(toByte(color.g))}${getByteHex(toByte(color.b))}${
    withAlpha ? getByteHex(toByte(color.a)) : ''
  }`;

/** Reads hex digits (3, 4, 6 or 8, no `#`) into `into`; false when they aren't */
const readHexDigits = (digits: string, into: Rgba) => {
  const { length } = digits;
  if (!/^[\da-f]+$/i.test(digits) || ![3, 4, 6, 8].includes(length)) return false;
  const short = length <= 4;
  const channel = (index: number) =>
    short
      ? parseInt(digits[index] + digits[index], 16) / 255
      : parseInt(digits.slice(index * 2, index * 2 + 2), 16) / 255;
  into.r = channel(0);
  into.g = channel(1);
  into.b = channel(2);
  into.a = length === 4 || length === 8 ? channel(3) : 1;
  return true;
};

/** `hsl()`'s colour (h in degrees, s and l 0-1), into `into` */
const readHsl = (h: number, s: number, l: number, a: number, into: Rgba) => {
  const hue = (((h % 360) + 360) % 360) / 30;
  const chroma = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue) % 12;
    return l - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  into.r = channel(0);
  into.g = channel(8);
  into.b = channel(4);
  into.a = a;
  return into;
};

/** A CSS number or percentage: `percentOf` is what 100 % is; null when it's neither */
const readNumber = (text: string, percentOf: number) => {
  if (text.endsWith('%')) {
    const body = text.slice(0, -1);
    return NUMBER_REGEX.test(body) ? (Number(body) / 100) * percentOf : null;
  }
  return NUMBER_REGEX.test(text) ? Number(text) : null;
};

/** A hue: degrees, or a number with `deg`, `rad`, `grad` or `turn`; null when it isn't */
const readHue = (text: string) => {
  const match = /^(.*?)(deg|rad|grad|turn)?$/.exec(text);
  if (!match || !NUMBER_REGEX.test(match[1])) return null;
  return Number(match[1]) * (match[2] ? HUE_UNITS[match[2]] : 1);
};

/** `rgb()` / `hsl()`'s arguments: commas or spaces, an alpha after a `/` or as the fourth */
const splitArguments = (body: string) => {
  const [channels, alpha, ...rest] = body.split('/');
  if (rest.length > 0) return null;
  const parts = channels
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (alpha !== undefined) {
    if (parts.length !== 3 || !alpha.trim()) return null;
    parts.push(alpha.trim());
  }
  return parts.length === 3 || parts.length === 4 ? parts : null;
};

/** `rgb(…)` / `hsl(…)`, CSS's syntax (both its comma and space forms), clamped as CSS clamps */
const readFunction = (name: string, body: string): Rgba | null => {
  const parts = splitArguments(body);
  if (!parts) return null;
  const alpha = parts[3] === undefined ? 1 : readNumber(parts[3], 1);
  if (alpha === null) return null;
  if (name.startsWith('rgb')) {
    const channels = parts.slice(0, 3).map((part) => readNumber(part, 255));
    if (channels.some((value) => value === null)) return null;
    const [r, g, b] = channels as number[];
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a: clamp01(alpha) };
  }
  const h = readHue(parts[0]);
  // A saturation or lightness without its `%` is a percentage too (CSS Color 4)
  const s = readNumber(parts[1].endsWith('%') ? parts[1] : `${parts[1]}%`, 1);
  const l = readNumber(parts[2].endsWith('%') ? parts[2] : `${parts[2]}%`, 1);
  if (h === null || s === null || l === null) return null;
  return readHsl(h, clamp01(s), clamp01(l), clamp01(alpha), { r: 0, g: 0, b: 0, a: 1 });
};

/**
 * A typed or pasted colour (p804 D8): `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (or `0x` and the
 * digits, or 6 or 8 digits alone), `rgb()` / `rgba()` (0-255 or percentages), `hsl()` / `hsla()`
 * (a hue in degrees or with `deg`, `rad`, `grad`, `turn`), with CSS's commas or spaces and
 * `/ alpha`, or three or four numbers 0-1 (the float form: `0.2, 0.8, 0.9`). Case and the spaces
 * around it are ignored. No colour names.
 * @internal
 */
export const parseColorText = (text: string): ParseResult => {
  const source = text.trim().toLowerCase();
  const into: Rgba = { r: 0, g: 0, b: 0, a: 1 };
  const hex = source.startsWith('#')
    ? source.slice(1)
    : source.startsWith('0x')
      ? source.slice(2)
      : // Digits alone only at 6 or 8: `100` reads as numbers, not as `#110000`
        /^(?:[\da-f]{6}|[\da-f]{8})$/.test(source)
        ? source
        : null;
  if (hex !== null) return readHexDigits(hex, into) ? { value: into } : { error: COLOR_TEXT_ERROR };
  const call = FUNCTION_REGEX.exec(source);
  if (call) {
    const value = readFunction(call[1], call[2]);
    return value ? { value } : { error: COLOR_TEXT_ERROR };
  }
  const numbers = source.split(/[\s,]+/).filter(Boolean);
  if (
    (numbers.length !== 3 && numbers.length !== 4) ||
    !numbers.every((n) => NUMBER_REGEX.test(n))
  ) {
    return { error: COLOR_TEXT_ERROR };
  }
  const [r, g, b, a = 1] = numbers.map(Number);
  if ([r, g, b, a].some((value) => value < 0 || value > 1)) {
    return { error: 'A colour as numbers is three numbers 0-1 (or four, with alpha)' };
  }
  return { value: { r, g, b, a } };
};

/**
 * A colour as the picker holds it (vanilla-colorful's HSVA): hue 0-360, saturation and value
 * 0-100, alpha 0-1.
 * @internal
 */
export type Hsva = { h: number; s: number; v: number; a: number };

/**
 * An sRGB colour in HSVA, its channels clamped to 0-1. A grey has no hue and black no saturation
 * either: `previous`'s are kept then (the picker's), so its hue slider doesn't jump to red when
 * the plane reaches its edge.
 * @internal
 */
export const rgbaToHsva = (color: Rgba, previous?: Hsva): Hsva => {
  const r = clamp01(color.r);
  const g = clamp01(color.g);
  const b = clamp01(color.b);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = previous?.h ?? 0;
  if (delta > 0) {
    const sector =
      max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (sector * 60 + 360) % 360;
  }
  const s = max > 0 ? (delta / max) * 100 : previous?.s ?? 0;
  return { h, s, v: max * 100, a: clamp01(color.a) };
};

/**
 * An HSVA colour in sRGB.
 * @internal
 */
export const hsvaToRgba = (color: Hsva): Rgba => {
  const saturation = color.s / 100;
  const value = color.v / 100;
  const channel = (n: number) => {
    const k = (n + color.h / 60) % 6;
    return value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: channel(5), g: channel(3), b: channel(1), a: color.a };
};

/**
 * Reads and writes a field's bound colour in its own form.
 * @internal
 */
export type ColorCodec = {
  form: ColorForm;
  /** The keys an object's binding compares and writes (`r`, `g`, `b`, and `a` with alpha) */
  keys: readonly string[];
  /** Whether the value holds an alpha the field shows and edits */
  hasAlpha: boolean;
  /** The bound value in sRGB, into `into` (no allocation for a number, a hex string or an object) */
  read: (value: ColorFieldValue, into: Rgba) => Rgba;
  /** An sRGB colour as a new value in the bound form and space */
  write: (color: Rgba) => ColorFieldValue;
  /** The value with its alpha replaced, its colour channels as they are (no round trip through
   * sRGB, which isn't exact for a linear value) */
  withAlpha: (value: ColorFieldValue, alpha: number) => ColorFieldValue;
};

/**
 * Makes a field's codec: `form` read from the value at creation, `space` an object's
 * (`'linear'`: a `THREE.Color`'s working space), `alpha` whether the field edits it (a number has
 * none; a hex string written with alpha digits keeps them).
 * @internal
 */
export const createColorCodec = (
  form: ColorForm,
  options: { space?: 'srgb' | 'linear'; alpha?: boolean; first?: unknown } = {}
): ColorCodec => {
  const isLinear = form === 'float' && options.space === 'linear';
  const hadAlphaDigits =
    form === 'hex' && typeof options.first === 'string' && [5, 9].includes(options.first.length);
  const hasAlpha = form !== 'number' && (Boolean(options.alpha) || hadAlphaDigits);
  const keys = hasAlpha ? ['r', 'g', 'b', 'a'] : ['r', 'g', 'b'];
  const toSrgb = isLinear ? linearToSrgb : (c: number) => c;
  const fromSrgb = isLinear ? srgbToLinear : (c: number) => c;

  const read = (value: ColorFieldValue, into: Rgba) => {
    if (typeof value === 'number') {
      into.r = ((value >> 16) & 255) / 255;
      into.g = ((value >> 8) & 255) / 255;
      into.b = (value & 255) / 255;
      into.a = 1;
    } else if (typeof value === 'string') {
      const digits = value.startsWith('#') ? value.slice(1) : value;
      if (!readHexDigits(digits, into)) {
        // Any other colour text (an `rgb()` string): read, and written back as hex
        const parsed = parseColorText(value).value ?? { r: 0, g: 0, b: 0, a: 1 };
        Object.assign(into, parsed);
      }
    } else {
      into.r = toSrgb(value.r);
      into.g = toSrgb(value.g);
      into.b = toSrgb(value.b);
      into.a = value.a ?? 1;
    }
    return into;
  };

  const write = (color: Rgba): ColorFieldValue => {
    if (form === 'number')
      return (toByte(color.r) << 16) | (toByte(color.g) << 8) | toByte(color.b);
    if (form === 'hex') return formatColorHex(color, hasAlpha);
    const value = { r: fromSrgb(color.r), g: fromSrgb(color.g), b: fromSrgb(color.b) };
    return hasAlpha ? { ...value, a: color.a } : value;
  };

  const withAlpha = (value: ColorFieldValue, alpha: number): ColorFieldValue => {
    if (typeof value === 'number' || !hasAlpha) return value;
    if (typeof value === 'string') {
      return `${formatColorHex(read(value, { r: 0, g: 0, b: 0, a: 1 }))}${getByteHex(toByte(alpha))}`;
    }
    return { r: value.r, g: value.g, b: value.b, a: alpha };
  };

  return { form, keys, hasAlpha, read, write, withAlpha };
};
