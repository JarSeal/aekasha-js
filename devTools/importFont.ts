/* eslint-disable no-console -- a command's own output */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Font } from 'fontkit';
import { getFontCharsetPresetCodePoints } from '../src/_engine/features/text/FontCharsets';
import {
  FONT_CHARSET_PRESETS,
  FONT_DEFAULTS,
  FONT_TYPES,
  FontAssetSchema,
  type FontAsset,
  type FontCharsetPreset,
  type FontType,
} from '../src/_engine/schemas';
import { openFont } from './assetPipeline/fonts/fontFile';
import { formatDevFileJson } from './devFiles/format';
import { listSourceFiles } from './files';
import { ROOT, SRC_DIR } from './paths';

/**
 * Starts a font asset (p391 D4): copies a font file into its folder, writes its `*.font.json`
 * with every default filled in, writes a licence note beside it from the font's name table when
 * the font embeds a licence, prints what the font covers of each charset preset, then encodes it
 * (`yarn assets --only <id>`).
 *
 * Usage: `yarn importFont <file> [--id <id>] [--charset ASCII,LATIN_1] [--chars "…"]
 * [--into app|toolkit|<folder>] [--type MTSDF|MSDF|SDF] [--size 48] [--force] [--no-encode]`
 * - `<file>`: a static TTF, OTF or WOFF (a WOFF2, a collection or a variable font is refused
 *   before anything is written).
 * - `--id`: the font's id and file names. Default: the font file's name in camelCase
 *   (`IBMPlexSans-Medium.woff` → `ibmPlexSansMedium`).
 * - `--into`: `app` (the default, `src/app/fonts/<id>/`), `toolkit` (`src/toolkit/fonts/<id>/`)
 *   or a folder under `src/` (a scene's, for a font only it uses).
 * - `--force` overwrites the JSON, the font and the note; without it any of them existing fails.
 * - `--no-encode` writes the files only (`yarn assets --only <id>` later).
 * Relative paths are from where the command was run (yarn's `INIT_CWD`).
 */

const USAGE =
  'Usage: yarn importFont <file> [--id <id>] [--charset ASCII,LATIN_1] [--chars "…"] [--into app|toolkit|<folder>] [--type MTSDF|MSDF|SDF] [--size 48] [--force] [--no-encode]';

/** An id is a file name too: letters, digits, `_` and `-`, starting with a letter */
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** The licence note's file, beside the font */
export const FONT_LICENSE_NOTE = 'LICENSE.txt';

/** What `yarn importFont` was asked to do */
export type FontImportOptions = {
  /** The font file, absolute */
  file: string;
  id?: string;
  presets?: FontCharsetPreset[];
  chars?: string;
  /** `app`, `toolkit`, or a folder, absolute */
  into?: string;
  type?: FontType;
  size?: number;
  force?: boolean;
};

/** A font's coverage of a preset: how many of its characters the font has */
export type FontPresetCoverage = {
  preset: FontCharsetPreset;
  covered: number;
  total: number;
  requested: boolean;
};

/** An import ready to write: every file's content, and what to tell */
export type FontImportPlan = {
  id: string;
  /** The font's folder, absolute */
  folder: string;
  jsonFile: string;
  json: FontAsset;
  /** The font's copy, absolute (the source itself when it's already there) */
  fontFile: string;
  /** The licence note, or null when the font embeds no licence */
  licenseNote: string | null;
  coverage: FontPresetCoverage[];
  warnings: string[];
};

/**
 * A font file's name as an id: its words in camelCase, a leading run of capitals lowered as one
 * word (`IBMPlexSans-Medium` → `ibmPlexSansMedium`, `Roboto_Mono-Bold` → `robotoMonoBold`)
 */
export const toFontId = (fileName: string) => {
  const stem = path.basename(fileName).replace(/\.[^.]+$/, '');
  const words = stem.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words
    .map((word, i) => {
      if (i) return word.charAt(0).toUpperCase() + word.slice(1);
      // The leading capitals, but the last when a lower-case letter follows (`IBMPlex`: `ibm`)
      const leading = /^[A-Z]+(?=[A-Z][a-z])|^[A-Z]+(?![a-z])|^[A-Z]/.exec(word)?.[0] ?? '';
      return leading.toLowerCase() + word.slice(leading.length);
    })
    .join('');
};

/** The font's name for people: its typographic family and style, else its full name */
const getFontName = (font: Font) => {
  const family = font.getName('preferredFamily', 'en');
  const style = font.getName('preferredSubfamily', 'en');
  if (family) return style && style !== 'Regular' ? `${family} ${style}` : family;
  return font.fullName || font.familyName || undefined;
};

const hasGlyph = (font: Font, codePoint: number) =>
  font.hasGlyphForCodePoint(codePoint) && font.glyphForCodePoint(codePoint).id !== 0;

/**
 * The licence note's text, from the font's name table, or null when it names no licence (neither
 * a licence description nor its URL)
 * @param fileName The font file's name, as the note names it
 */
export const createFontLicenseNote = (font: Font, fileName: string): string | null => {
  const get = (key: string) => font.getName(key, 'en')?.trim() || null;
  const license = get('license');
  const licenseURL = get('licenseURL');
  if (!license && !licenseURL) return null;
  const lines = [`${getFontName(font) ?? fileName} (${fileName})`, ''];
  const fields: [string, string | null][] = [
    ['Copyright', get('copyright')],
    ['Trademark', get('trademark')],
    ['Designer', [get('designer'), get('designerURL')].filter(Boolean).join(', ') || null],
    ['Manufacturer', [get('manufacturer'), get('vendorURL')].filter(Boolean).join(', ') || null],
    ['Version', get('version')],
  ];
  for (const [label, value] of fields) if (value) lines.push(`${label}: ${value}`);
  if (license) lines.push('', 'License:', license);
  if (licenseURL) lines.push('', `License URL: ${licenseURL}`);
  lines.push(
    '',
    "Read from the font's name table by `yarn importFont`. When the licence asks for its full text",
    'to travel with the font (the SIL Open Font License does), add that text beside it.',
    ''
  );
  return lines.join('\n');
};

/** What the font covers of each preset, the requested ones marked */
export const getFontPresetCoverage = (
  font: Font,
  requested: readonly FontCharsetPreset[]
): FontPresetCoverage[] =>
  FONT_CHARSET_PRESETS.map((preset) => {
    const codePoints = getFontCharsetPresetCodePoints(preset);
    return {
      preset,
      covered: codePoints.filter((codePoint) => hasGlyph(font, codePoint)).length,
      total: codePoints.length,
      requested: requested.includes(preset),
    };
  });

/** A warning per asked preset the font lacks part of (the encode leaves those characters out) */
export const getCoverageWarnings = (coverage: readonly FontPresetCoverage[]) =>
  coverage
    .filter(({ requested, covered, total }) => requested && covered < total)
    .map(
      ({ preset, covered, total }) => `the font has ${covered} of ${preset}'s ${total} characters`
    );

/** The folder `--into` names: `app`, `toolkit` or a folder under `srcDir` (not the outputs') */
const resolveFolder = (into: string | undefined, id: string, srcDir: string) => {
  if (!into || into === 'app') return path.join(srcDir, 'app', 'fonts', id);
  if (into === 'toolkit') return path.join(srcDir, 'toolkit', 'fonts', id);
  const relative = path.relative(srcDir, into);
  const parts = relative.split(path.sep);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) {
    throw new Error(`--into ${into} isn't a folder under src/, which the gather reads`);
  }
  if (parts[0] === 'generated' || parts[0] === 'public') {
    throw new Error(`--into ${into} is in src/${parts[0]}/, which the gather doesn't read`);
  }
  return into;
};

/** The font JSONs' ids under `srcDir` (the JSON's own, else its file name), by JSON file */
const listFontIds = (srcDir: string) => {
  const ids = new Map<string, string>();
  for (const file of listSourceFiles(srcDir)) {
    if (!file.endsWith('.font.json')) continue;
    const fullPath = path.join(srcDir, file);
    let id: unknown;
    try {
      id = (JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as { id?: unknown }).id;
    } catch {
      // An unreadable JSON: the gather reports it
    }
    ids.set(fullPath, typeof id === 'string' && id ? id : path.basename(file, '.font.json'));
  }
  return ids;
};

/**
 * Reads the font and plans its import: nothing written. Throws naming the problem: a font the
 * encoder refuses (WOFF2, a collection, a variable font), a bad option, a fallback glyph the font
 * lacks, an id another font JSON has, or a file that exists without `force`.
 * @param opts.srcDir The folder the gather walks (`src/`; a test's own)
 * @param opts.rootDir The repo root (`.schemas/` is in it)
 */
export const planFontImport = (
  options: FontImportOptions,
  opts: { srcDir?: string; rootDir?: string } = {}
): FontImportPlan => {
  const srcDir = opts.srcDir ?? SRC_DIR;
  const rootDir = opts.rootDir ?? ROOT;
  if (!fs.existsSync(options.file)) throw new Error(`${options.file} doesn't exist`);
  const fileName = path.basename(options.file);
  let font: Font;
  try {
    font = openFont(new Uint8Array(fs.readFileSync(options.file)));
  } catch (error) {
    throw new Error(`${fileName}: ${(error as Error).message}`);
  }
  const fallback = FONT_DEFAULTS.fallbackGlyph;
  if (!hasGlyph(font, fallback.codePointAt(0) as number)) {
    throw new Error(`${fileName} has no glyph for the fallback glyph "${fallback}"`);
  }

  const id = options.id ?? toFontId(fileName);
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `"${id}" isn't a usable id (letters, digits, _ and -, starting with a letter): give one with --id`
    );
  }
  const folder = resolveFolder(options.into, id, srcDir);
  const jsonFile = path.join(folder, `${id}.font.json`);
  for (const [other, otherId] of listFontIds(srcDir)) {
    if (otherId === id && other !== jsonFile) {
      throw new Error(
        `${path.relative(rootDir, other)} has the id "${id}": give another with --id`
      );
    }
  }

  const fontFile = path.join(folder, fileName);
  const licenseNote = createFontLicenseNote(font, fileName);
  const existing = [jsonFile, licenseNote ? path.join(folder, FONT_LICENSE_NOTE) : null]
    .concat(path.resolve(options.file) === fontFile ? [] : [fontFile])
    .filter((file): file is string => !!file && fs.existsSync(file));
  if (existing.length && !options.force) {
    const named = existing.map((file) => path.relative(rootDir, file)).join(', ');
    throw new Error(`${named} already exist(s): --force overwrites`);
  }

  const presets = options.presets ?? [...FONT_DEFAULTS.charset.presets];
  const json: FontAsset = {
    $schema: path
      .relative(folder, path.join(rootDir, '.schemas', 'font.schema.json'))
      .split(path.sep)
      .join('/'),
    id,
    name: getFontName(font),
    fileName: `./${fileName}`,
    type: options.type ?? FONT_DEFAULTS.type,
    size: options.size ?? FONT_DEFAULTS.size,
    pxRange: FONT_DEFAULTS.pxRange,
    charset: {
      presets,
      chars: options.chars ?? FONT_DEFAULTS.charset.chars,
      charsFromFiles: [],
      collectFromScenes: FONT_DEFAULTS.charset.collectFromScenes,
    },
    fallbackGlyph: fallback,
    kerning: FONT_DEFAULTS.kerning,
    atlas: { ...FONT_DEFAULTS.atlas },
  };
  if (!json.name) delete json.name;
  const validation = FontAssetSchema.safeParse(json);
  if (!validation.success) {
    const [issue] = validation.error.issues;
    throw new Error(`the font JSON would be invalid: ${issue.message} (${issue.path.join('.')})`);
  }

  const coverage = getFontPresetCoverage(font, presets);
  const warnings = getCoverageWarnings(coverage);
  const lacking = [...new Set(options.chars ?? '')].filter(
    (character) => !hasGlyph(font, character.codePointAt(0) as number)
  );
  if (lacking.length) warnings.push(`the font lacks --chars' "${lacking.join('')}"`);
  if (!licenseNote) {
    warnings.push(
      'the font names no licence in its name table: check its terms before you ship it, and put them beside it'
    );
  }
  return { id, folder, jsonFile, json, fontFile, licenseNote, coverage, warnings };
};

/** Writes a planned import: the font's copy, its JSON (Prettier-formatted) and its licence note */
export const writeFontImportAsync = async (plan: FontImportPlan, sourceFile: string) => {
  fs.mkdirSync(plan.folder, { recursive: true });
  if (path.resolve(sourceFile) !== plan.fontFile) fs.copyFileSync(sourceFile, plan.fontFile);
  fs.writeFileSync(plan.jsonFile, await formatDevFileJson(plan.json, plan.jsonFile));
  if (plan.licenseNote) {
    fs.writeFileSync(path.join(plan.folder, FONT_LICENSE_NOTE), plan.licenseNote);
  }
};

const parseList = <T extends string>(value: string, allowed: readonly T[], flag: string): T[] => {
  const items = value.split(',').filter(Boolean);
  const unknown = items.filter((item) => !allowed.includes(item as T));
  if (unknown.length || !items.length) {
    throw new Error(`${flag} takes ${allowed.join(', ')}; not "${unknown.join(',') || value}"`);
  }
  return items as T[];
};

/** The command's arguments; relative paths from `cwd` */
export const parseImportFontArgs = (args: string[], cwd: string) => {
  const options: Partial<FontImportOptions> = {};
  let encode = true;
  const takeValue = (i: number) => {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${args[i]} needs a value. ${USAGE}`);
    }
    return value;
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--no-encode') encode = false;
    else if (arg === '--id') options.id = takeValue(i++);
    else if (arg === '--chars') options.chars = takeValue(i++);
    else if (arg === '--charset') {
      options.presets = parseList(takeValue(i++), FONT_CHARSET_PRESETS, '--charset');
    } else if (arg === '--type') {
      [options.type] = parseList(takeValue(i++), FONT_TYPES, '--type');
    } else if (arg === '--size') {
      const size = Number(takeValue(i++));
      if (!Number.isInteger(size)) throw new Error(`--size takes a whole number of pixels`);
      options.size = size;
    } else if (arg === '--into') {
      const into = takeValue(i++);
      options.into = into === 'app' || into === 'toolkit' ? into : path.resolve(cwd, into);
    } else if (!arg.startsWith('--') && !options.file) options.file = path.resolve(cwd, arg);
    else throw new Error(`Unknown or extra argument "${arg}". ${USAGE}`);
  }
  if (!options.file) throw new Error(`No font file given. ${USAGE}`);
  return { options: options as FontImportOptions, encode };
};

const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  // yarn runs a script from the package root: the user's paths are from where they ran it
  const { options, encode } = parseImportFontArgs(args, process.env.INIT_CWD ?? process.cwd());
  const plan = planFontImport(options);
  await writeFontImportAsync(plan, options.file);

  const rel = (file: string) => path.relative(ROOT, file);
  console.log(`${GREEN}✓ [importFont] ${plan.id}${RESET} ${DIM}(${rel(plan.folder)}/)${RESET}`);
  console.log(`  ${rel(plan.jsonFile)}`);
  console.log(`  ${rel(plan.fontFile)}`);
  if (plan.licenseNote) console.log(`  ${rel(path.join(plan.folder, FONT_LICENSE_NOTE))}`);
  console.log('  Covers (* asked for):');
  for (const { preset, covered, total, requested } of plan.coverage) {
    const mark = requested ? '*' : ' ';
    const line = `${mark} ${preset.padEnd(12)} ${String(covered).padStart(4)} / ${total}`;
    console.log(`  ${covered ? line : `${DIM}${line}${RESET}`}`);
  }
  for (const warning of plan.warnings) console.warn(`${YELLOW}⚠ [importFont] ${warning}${RESET}`);

  if (!encode) {
    console.log(`Encode it with: yarn assets --only ${plan.id}`);
    return;
  }
  const result = spawnSync('yarn', ['assets', '--only', plan.id], { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw new Error(`can't run yarn assets: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`${RED}✗ [importFont] ${(error as Error).message}${RESET}`);
    process.exitCode = 1;
  }
}
