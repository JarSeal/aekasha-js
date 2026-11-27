import type { FontCharsetPreset } from './FontSchema';

// The characters of a font's charset presets (p391 D2). Import-free: the asset pipeline's font
// encoder resolves a font's charset with it, and the text debug tab shows what of each a font has.

/** A run of code points, both ends included */
type CodePointRange = readonly [first: number, last: number];

/** A preset's code points as ranges, in code point order */
const PRESET_RANGES: Record<FontCharsetPreset, readonly CodePointRange[]> = {
  // 0-9, space, + - . , : %
  DIGITS: [
    [0x20, 0x20],
    [0x25, 0x25],
    [0x2b, 0x2e],
    [0x30, 0x3a],
  ],
  // Printable ASCII
  ASCII: [[0x20, 0x7e]],
  // Latin-1 Supplement's printable half (no-break space to ÿ)
  LATIN_1: [[0xa0, 0xff]],
  // Latin Extended-A, whole (Central European, Baltic, Turkish, …)
  LATIN_EXT_A: [[0x100, 0x17f]],
  // Modern Greek: tonos, accented capitals, the alphabet and its accented small letters (the
  // block's unassigned code points left out)
  GREEK: [
    [0x384, 0x38a],
    [0x38c, 0x38c],
    [0x38e, 0x3a1],
    [0x3a3, 0x3ce],
  ],
  // Cyrillic's basic block (Russian, Ukrainian, Belarusian, Serbian, Macedonian, Bulgarian) and
  // Ukrainian Ґ ґ
  CYRILLIC: [
    [0x400, 0x45f],
    [0x490, 0x491],
  ],
  // General Punctuation's common ones: hyphen, en and em dash, the quotes, daggers, bullet,
  // ellipsis, per mille, primes and single guillemets
  PUNCTUATION: [
    [0x2010, 0x2010],
    [0x2013, 0x2014],
    [0x2018, 0x201a],
    [0x201c, 0x201e],
    [0x2020, 0x2022],
    [0x2026, 0x2026],
    [0x2030, 0x2030],
    [0x2032, 0x2033],
    [0x2039, 0x203a],
  ],
};

/**
 * A charset preset's code points, ascending.
 * @internal
 */
export const getFontCharsetPresetCodePoints = (preset: FontCharsetPreset): number[] => {
  const codePoints: number[] = [];
  for (const [first, last] of PRESET_RANGES[preset]) {
    for (let codePoint = first; codePoint <= last; codePoint++) codePoints.push(codePoint);
  }
  return codePoints;
};

/**
 * Whether a code point is a control character (C0, DEL, C1): never a glyph, so a charset leaves
 * it out (a text file's line breaks and tabs).
 * @internal
 */
export const isControlCodePoint = (codePoint: number) =>
  codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
