import fs from 'fs';
import {
  getFontCharsetPresetCodePoints,
  isControlCodePoint,
} from '../../../src/_engine/features/text/FontCharsets';
import type { FontCharsetPreset } from '../../../src/_engine/schemas';
import { sha256 } from '../../files';
import { toRepoPath } from '../sources';
import type { FontSource } from './fontSource';

/**
 * A font's requested characters (p391 D2): its presets, its `chars`, its `charsFromFiles` files'
 * characters, space and the fallback glyph, before the font's own cmap drops what it lacks
 * (`encodeFont.ts`). No fontkit here: the cache key hashes the result.
 */

/** The characters a font asks for, and where each came from (the missing ones' warnings) */
export type RequestedCharset = {
  /** Every code point asked for, ascending, each once, no control characters */
  codePoints: number[];
  /** The ones named one by one (space, the fallback glyph, `chars`, a file's): a missing one is
   * warned about by name */
  named: Set<number>;
  /** Each preset's code points (a missing one is counted per preset) */
  presets: Map<FontCharsetPreset, number[]>;
};

const addCharacters = (text: string, into: Set<number>) => {
  for (const character of text) {
    const codePoint = character.codePointAt(0) as number;
    if (!isControlCodePoint(codePoint)) into.add(codePoint);
  }
};

/** Every string of a JSON value: its objects' keys and its string values, however deep */
const collectJsonStrings = (value: unknown, into: string[]) => {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectJsonStrings(item, into);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      collectJsonStrings(item, into);
    }
  }
};

/**
 * A `charsFromFiles` file's characters: a `.json` file's strings (keys and values), any other
 * file's whole text. Throws naming the file for a JSON that doesn't parse.
 */
export const readCharsFile = (file: string, into: Set<number>) => {
  const text = fs.readFileSync(file, 'utf-8');
  if (!file.toLowerCase().endsWith('.json')) {
    addCharacters(text, into);
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`charsFromFiles: ${toRepoPath(file)} isn't JSON: ${(error as Error).message}`);
  }
  const strings: string[] = [];
  collectJsonStrings(json, strings);
  for (const string of strings) addCharacters(string, into);
};

/**
 * The characters a font asks for. Throws like {@link readCharsFile}.
 * @param opts.collected The characters the scenes' texts write with the font
 * (`collectFromScenes`, the gather's)
 */
export const resolveRequestedCharset = (
  source: Pick<FontSource, 'font' | 'charsFiles'>,
  opts: { collected?: Iterable<number> } = {}
): RequestedCharset => {
  const { charset, fallbackGlyph } = source.font;
  const named = new Set<number>();
  addCharacters(` ${fallbackGlyph}${charset.chars}`, named);
  for (const file of source.charsFiles) readCharsFile(file, named);
  for (const codePoint of opts.collected ?? []) {
    if (!isControlCodePoint(codePoint)) named.add(codePoint);
  }
  const presets = new Map(
    charset.presets.map((preset) => [preset, getFontCharsetPresetCodePoints(preset)] as const)
  );
  const all = new Set(named);
  for (const codePoints of presets.values()) for (const codePoint of codePoints) all.add(codePoint);
  return { codePoints: [...all].sort((a, b) => a - b), named, presets };
};

/** The requested characters' hash, for the cache key (D3) */
export const getRequestedCharsetHash = (requested: RequestedCharset) =>
  sha256(requested.codePoints.join(','));
