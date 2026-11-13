import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { sha256, writeFileAtomic, writeFileIfChanged, listSourceFiles } from '../files';
import { readZip } from './archives';

/**
 * The texture sets' source downloads (p303 D5, `yarn fetchTextureSources`): a set folder's
 * `source.json` (next to its `*.textureSet.json`) names a provider's asset; its maps are
 * downloaded (cached in `.cache/texture-downloads/`) and written to the set's gitignored
 * `source/raw/<map>.<ext>`, the fixed names its texture JSONs' pack recipes read (D3). The toolkit's
 * sets' credits (`src/toolkit/textures/CREDITS.md`) are generated from their `source.json`s.
 */

/**
 * The maps a `source.json` can name, by the file name each gets in `source/raw/`. `arm` is Poly
 * Haven's ready-made AO / roughness / metalness pack.
 */
export const TEXTURE_SOURCE_MAPS = [
  'color',
  'normal',
  'roughness',
  'ao',
  'height',
  'metalness',
  'arm',
] as const;

/** A map the download must have when the `source.json` names it; the others are optional */
const REQUIRED_MAPS = new Set<TextureSourceMap>(['color', 'normal', 'roughness']);

/** One of {@link TEXTURE_SOURCE_MAPS} */
export type TextureSourceMap = (typeof TEXTURE_SOURCE_MAPS)[number];

/** The image formats a map can be: what the pipeline's pack step decodes */
const IMAGE_EXTENSIONS: Record<string, string> = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png' };

const MAP_SHAPE = Object.fromEntries(
  TEXTURE_SOURCE_MAPS.map((map) => [map, z.string().min(1).optional()])
) as Record<TextureSourceMap, z.ZodOptional<z.ZodString>>;

/** A set folder's `source.json` (p303 D5) */
export const TextureSourceSchema = z
  .object({
    $schema: z.string().optional(),
    /** Where the maps come from */
    provider: z.enum(['ambientCG', 'polyHaven']),
    /** The provider's asset id (`Ground080`, `aerial_sand`) */
    assetId: z.string().regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, "_" and "-" only'),
    /** The resolution and format: ambientCG's download attribute, eg. `2K-JPG` (Poly Haven: `2k` `jpg`) */
    download: z.string().regex(/^\d+K-(JPG|PNG)$/, 'a resolution and a format, eg. "2K-JPG"'),
    /** The asset's licence, for the credits (`CC0-1.0`) */
    license: z.string().min(1),
    /** The asset's page, for the credits and to check it by eye */
    page: z.url(),
    /**
     * Each map to fetch: for ambientCG the file name's suffix in the zip (`_NormalGL`), for Poly
     * Haven the map's name in its files API (`nor_gl`). `color` is required.
     */
    maps: z
      .object(MAP_SHAPE)
      .strict()
      .refine((maps) => maps.color !== undefined, 'a "color" map is required'),
  })
  .strict();

/** A parsed {@link TextureSourceSchema} */
export type TextureSource = z.infer<typeof TextureSourceSchema>;

/** A texture set folder with a `source.json`, found by {@link findTextureSetSources} */
export type TextureSetSourceDir = {
  /** The set's id (its `*.textureSet.json`'s), or the folder's path from `src/` when unreadable */
  setId: string;
  /** The set folder, absolute */
  dir: string;
  /** The set folder from `src/`, '/'-separated */
  srcPath: string;
  /** The set's `*.textureSet.json`, absolute (undefined when the folder has none or two) */
  setFile?: string;
  /** The parsed `source.json`, or why it can't be used */
  source: TextureSource | { error: string };
};

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Every `source.json` in the toolkit and the app (`<srcDir>/toolkit/`, `<srcDir>/app/`), each with
 * its set: the `*.textureSet.json` beside it (a set folder holds one set). A `source.json` without
 * one, or with two, is returned with an error, as is an invalid one. Sorted by set id.
 */
export const findTextureSetSources = (srcDir: string): TextureSetSourceDir[] => {
  const files = listSourceFiles(srcDir).map((file) => file.split(path.sep).join('/'));
  const dirs = new Map<string, { hasSource: boolean; setFiles: string[] }>();
  for (const file of files) {
    if (!file.startsWith('toolkit/') && !file.startsWith('app/')) continue;
    const name = path.posix.basename(file);
    const isSource = name === 'source.json';
    if (!isSource && !name.endsWith('.textureSet.json')) continue;
    const dir = path.posix.dirname(file);
    const entry = dirs.get(dir) ?? { hasSource: false, setFiles: [] };
    if (isSource) entry.hasSource = true;
    else entry.setFiles.push(file);
    dirs.set(dir, entry);
  }

  const result: TextureSetSourceDir[] = [];
  for (const [srcPath, { hasSource, setFiles }] of dirs) {
    if (!hasSource) continue; // A hand-made set: nothing to fetch
    const dir = path.join(srcDir, srcPath);
    let setId = srcPath;
    let setFile: string | undefined;
    let source: TextureSetSourceDir['source'];
    if (setFiles.length !== 1) {
      source = {
        error: setFiles.length
          ? `one texture set per folder: ${setFiles.map((f) => path.posix.basename(f)).join(', ')}`
          : 'source.json without a *.textureSet.json beside it',
      };
    } else {
      setFile = path.join(srcDir, setFiles[0]);
      try {
        const id = (readJson(setFile) as { id?: unknown }).id;
        if (typeof id === 'string') setId = id;
        const parsed = TextureSourceSchema.safeParse(readJson(path.join(dir, 'source.json')));
        source = parsed.success
          ? parsed.data
          : {
              error: `invalid source.json: ${parsed.error.issues
                .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
                .join('; ')}`,
            };
      } catch (error) {
        source = { error: (error as Error).message };
      }
    }
    result.push({ setId, dir, srcPath, ...(setFile ? { setFile } : {}), source });
  }
  return result.sort((a, b) => a.setId.localeCompare(b.setId));
};

/** Downloads a URL's bytes; throws with the URL in the message */
export type Downloader = (url: string) => Promise<Buffer>;

/** {@link fetchTextureSetSourceAsync}'s options */
export type FetchTextureSetOpts = {
  /** The download cache (`.cache/texture-downloads/`) */
  cacheDir: string;
  download: Downloader;
  /** Download again, the cache and the up-to-date check ignored */
  force?: boolean;
  log: (line: string) => void;
};

/** What a set's fetch did */
export type FetchTextureSetResult = {
  status: 'fetched' | 'upToDate';
  /** The optional maps the `source.json` names and the download hasn't */
  missingOptional: TextureSourceMap[];
};

/** A downloaded map: its bytes and the extension it's written with */
type MapFile = { data: Buffer; ext: string };

/** What `source/raw/.fetched.json` records: the source it came from and each file's hash */
type FetchedManifest = {
  source: Pick<TextureSource, 'provider' | 'assetId' | 'download' | 'maps'>;
  files: Record<string, string>;
};

const MANIFEST_FILE = '.fetched.json';

const toManifestSource = ({ provider, assetId, download, maps }: TextureSource) => ({
  provider,
  assetId,
  download,
  maps,
});

/** The bytes of a cached download, or downloads it into the cache */
const readCachedAsync = async (
  file: string,
  url: string,
  opts: FetchTextureSetOpts,
  isValid: (data: Buffer) => boolean = () => true
) => {
  if (!opts.force && fs.existsSync(file)) {
    const cached = fs.readFileSync(file);
    if (isValid(cached)) return { data: cached, isCached: true };
  }
  const started = Date.now();
  const data = await opts.download(url);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  opts.log(`  downloaded ${url} (${(data.length / 1e6).toFixed(1)} MB, ${seconds} s)`);
  writeFileAtomic(file, data);
  return { data, isCached: false };
};

/** ambientCG: one zip per download, its maps matched by their file name's suffix */
const fetchAmbientCgAsync = async (source: TextureSource, opts: FetchTextureSetOpts) => {
  const name = `${source.assetId}_${source.download}`;
  const url = `https://ambientcg.com/get?file=${name}.zip`;
  const file = path.join(opts.cacheDir, 'ambientCG', `${name}.zip`);
  const readEntries = (data: Buffer) => {
    try {
      return readZip(data);
    } catch (error) {
      throw new Error(`${url}: ${(error as Error).message}`);
    }
  };
  const cached = await readCachedAsync(file, url, opts);
  let entries;
  try {
    entries = readEntries(cached.data);
  } catch (error) {
    if (!cached.isCached) throw error;
    // A cached download that doesn't read (eg. cut short): fetched once more
    opts.log(`  the cached ${path.basename(file)} doesn't read (${(error as Error).message})`);
    entries = readEntries((await readCachedAsync(file, url, { ...opts, force: true })).data);
  }

  const maps = new Map<TextureSourceMap, MapFile>();
  for (const map of TEXTURE_SOURCE_MAPS) {
    const suffix = source.maps[map];
    if (!suffix) continue;
    const matches = entries.filter((entry) => {
      const ext = path.posix.extname(entry.path).toLowerCase();
      return IMAGE_EXTENSIONS[ext] && path.posix.basename(entry.path, ext).endsWith(suffix);
    });
    if (matches.length > 1) {
      throw new Error(
        `the "${map}" suffix "${suffix}" matches ${matches.length} files: ${matches.map((m) => m.path).join(', ')}`
      );
    }
    if (matches.length) {
      const ext = IMAGE_EXTENSIONS[path.posix.extname(matches[0].path).toLowerCase()];
      maps.set(map, { data: matches[0].data, ext });
    }
  }
  return maps;
};

type PolyHavenFile = { url: string; md5: string; size: number };
type PolyHavenFiles = Record<string, Record<string, Record<string, PolyHavenFile>> | undefined>;

const md5 = (data: Buffer) => createHash('md5').update(data).digest('hex');

/** Poly Haven: its files API lists each map's URL and MD5 by resolution and format */
const fetchPolyHavenAsync = async (source: TextureSource, opts: FetchTextureSetOpts) => {
  const [resolution, format] = source.download.toLowerCase().split('-');
  const assetDir = path.join(opts.cacheDir, 'polyHaven', source.assetId);
  const apiUrl = `https://api.polyhaven.com/files/${source.assetId}`;
  const { data: listing } = await readCachedAsync(path.join(assetDir, 'files.json'), apiUrl, opts);
  const files = JSON.parse(listing.toString('utf8')) as PolyHavenFiles;

  const maps = new Map<TextureSourceMap, MapFile>();
  for (const map of TEXTURE_SOURCE_MAPS) {
    const name = source.maps[map];
    if (!name) continue;
    const file = files[name]?.[resolution]?.[format];
    if (!file) continue;
    const cacheFile = path.join(assetDir, path.posix.basename(new URL(file.url).pathname));
    const isValid = (data: Buffer) => md5(data) === file.md5;
    const { data } = await readCachedAsync(cacheFile, file.url, opts, isValid);
    if (!isValid(data)) throw new Error(`${file.url}: its MD5 isn't the files API's`);
    maps.set(map, { data, ext: format });
  }
  return maps;
};

/** Whether `source/raw/` already holds this source's maps, as its manifest records them */
const isUpToDate = (rawDir: string, source: TextureSource) => {
  const manifestFile = path.join(rawDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestFile)) return false;
  try {
    const manifest = readJson(manifestFile) as FetchedManifest;
    if (JSON.stringify(manifest.source) !== JSON.stringify(toManifestSource(source))) return false;
    return Object.entries(manifest.files).every(([file, hash]) => {
      const full = path.join(rawDir, file);
      return fs.existsSync(full) && sha256(fs.readFileSync(full)) === hash;
    });
  } catch {
    return false;
  }
};

/**
 * Fetches one set's maps into its `source/raw/` (`<map>.<ext>`), the folder's other files
 * removed (it holds only fetched maps). Skipped when the folder already holds this `source.json`'s
 * maps, unchanged (`.fetched.json`), unless `force`. Throws when the download fails or lacks a
 * required map (`color`, `normal`, `roughness`); a missing optional map is returned. Nothing is
 * written until every map is in hand.
 */
export const fetchTextureSetSourceAsync = async (
  set: TextureSetSourceDir & { source: TextureSource },
  opts: FetchTextureSetOpts
): Promise<FetchTextureSetResult> => {
  const { source } = set;
  const rawDir = path.join(set.dir, 'source', 'raw');
  if (!opts.force && isUpToDate(rawDir, source)) return { status: 'upToDate', missingOptional: [] };

  const maps =
    source.provider === 'ambientCG'
      ? await fetchAmbientCgAsync(source, opts)
      : await fetchPolyHavenAsync(source, opts);

  const named = TEXTURE_SOURCE_MAPS.filter((map) => source.maps[map]);
  const missing = named.filter((map) => !maps.has(map));
  const missingRequired = missing.filter((map) => REQUIRED_MAPS.has(map));
  if (missingRequired.length) {
    throw new Error(
      `the ${source.provider} download ${source.assetId} ${source.download} has no ${missingRequired
        .map((map) => `"${map}" (${source.maps[map]})`)
        .join(', ')}`
    );
  }

  const manifest: FetchedManifest = { source: toManifestSource(source), files: {} };
  for (const [map, { data, ext }] of maps) {
    const file = `${map}.${ext}`;
    writeFileAtomic(path.join(rawDir, file), data);
    manifest.files[file] = sha256(data);
  }
  for (const file of fs.readdirSync(rawDir)) {
    if (file !== MANIFEST_FILE && !manifest.files[file]) fs.rmSync(path.join(rawDir, file));
  }
  writeFileAtomic(path.join(rawDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return { status: 'fetched', missingOptional: missing };
};

const PROVIDER_NAMES: Record<TextureSource['provider'], string> = {
  ambientCG: 'ambientCG',
  polyHaven: 'Poly Haven',
};

/** The toolkit's sets' credits, `src/toolkit/textures/CREDITS.md`'s content */
export const renderTextureCredits = (sets: { setId: string; source: TextureSource }[]) =>
  [
    '# Texture set credits',
    '',
    "Generated by `yarn fetchTextureSources` from each set's `source.json` (p303 D5); don't edit it by hand. A CC0 asset needs no attribution: this records where each set comes from.",
    '',
    '| Set | Asset | Provider | Licence | Page |',
    '| --- | --- | --- | --- | --- |',
    ...[...sets]
      .sort((a, b) => a.setId.localeCompare(b.setId))
      .map(
        ({ setId, source }) =>
          `| \`${setId}\` | ${source.assetId} (${source.download}) | ${PROVIDER_NAMES[source.provider]} | ${source.license} | <${source.page}> |`
      ),
    '',
  ].join('\n');

/**
 * Writes `<srcDir>/toolkit/textures/CREDITS.md` from the toolkit's sets when it changed. Not
 * written while a toolkit `source.json` is invalid (its set would drop out) or no toolkit set has
 * one.
 * @returns the file and whether it was written, or why it wasn't
 */
export const writeTextureCredits = (srcDir: string, sets: TextureSetSourceDir[]) => {
  const toolkitSets = sets.filter((set) => set.srcPath.startsWith('toolkit/textures/'));
  const file = path.join(srcDir, 'toolkit', 'textures', 'CREDITS.md');
  const invalid = toolkitSets.filter((set) => 'error' in set.source);
  if (invalid.length) {
    return { file, skipped: `invalid: ${invalid.map((set) => set.srcPath).join(', ')}` };
  }
  if (!toolkitSets.length) return { file, skipped: 'no toolkit set has a source.json' };
  const valid = toolkitSets as (TextureSetSourceDir & { source: TextureSource })[];
  return { file, isWritten: writeFileIfChanged(file, renderTextureCredits(valid)) };
};
