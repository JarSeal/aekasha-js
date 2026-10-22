import fs from 'fs';
import path from 'path';
import { listExternalGLTFUris, readGLTFJson } from './gltfJson';
import { isProcessAlive } from './runLock';
import type { AssetSource, PackSource } from './sources';
import { sha256 } from '../files';
import { PUBLIC_DIR, ROOT, SRC_DIR } from '../paths';

/**
 * The pipeline's outputs (p300 DD3): `src/public/aek-assets/<logical path>.<content hash>.<ext>`,
 * served at `/aek-assets/…`. Committed, so a clone runs without the encoder. A name never
 * changes its content, so it can be cached forever and is only written once.
 */

export const AEK_ASSETS_DIR = path.join(PUBLIC_DIR, 'aek-assets');

const toPosix = (filePath: string) => filePath.split(path.sep).join('/');

/** The first 8 hex digits of the SHA-256: unique enough within one logical path */
export const getContentHash = (bytes: Uint8Array) => sha256(bytes).slice(0, 8);

/**
 * Where a source's outputs go inside `aek-assets/`, without the hash and extension: its path
 * under `src/` (under `src/public/` for a public one), eg. 'app/textures/source/rock'.
 */
export const getLogicalPath = (source: Extract<AssetSource, { file: string }>) => {
  const base = source.kind === 'public' ? PUBLIC_DIR : SRC_DIR;
  const relative = toPosix(path.relative(base, source.file));
  return relative.slice(0, relative.length - path.extname(relative).length);
};

/** An output named after its asset JSON: the JSON's path under `src/` without `.<type>.json` */
const getJsonLogicalPath = (jsonFile: string, suffix: string) =>
  `${toPosix(path.relative(SRC_DIR, jsonFile)).replace(/(\.[^./]+)?\.json$/, '')}${suffix}`;

/** A packed texture's logical path: its JSON's, eg. 'app/textures/rock.pack' for rock.texture.json */
export const getPackLogicalPath = (source: PackSource) =>
  getJsonLogicalPath(source.jsonFile, '.pack');

/**
 * A texture array's logical path (p299 D2): its JSON's, eg. 'app/textures/rocks.array' for
 * rocks.textureArray.json
 * @param jsonFile Absolute
 */
export const getArrayLogicalPath = (jsonFile: string) => getJsonLogicalPath(jsonFile, '.array');

/**
 * A texture atlas slot's logical path (p299 D3): its JSON's, eg. 'app/textures/decals.atlas.albedo'
 * for the slot "albedo" of decals.textureAtlas.json
 * @param jsonFile Absolute
 */
export const getAtlasLogicalPath = (jsonFile: string, slot: string) =>
  getJsonLogicalPath(jsonFile, `.atlas.${slot}`);

/** An output written into `aek-assets/` (or a public source used where it is) */
export type PipelineOutput = {
  /** Absolute path on disk */
  file: string;
  /** Root-absolute URL, what the runtime loads */
  url: string;
  bytes: number;
};

/**
 * Writes an output unless it exists (same name, same content): one of another size (a truncated
 * copy, an interrupted checkout) is written again (p619 §1.4 A5). Atomic: temp file + rename.
 */
export const writeOutput = (
  logicalPath: string,
  ext: string,
  bytes: Uint8Array
): PipelineOutput => {
  const fileName = `${logicalPath}.${getContentHash(bytes)}${ext}`;
  const file = path.join(AEK_ASSETS_DIR, fileName);
  if (fs.statSync(file, { throwIfNoEntry: false })?.size !== bytes.byteLength) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, bytes);
    fs.renameSync(tempFile, file);
  }
  return { file, url: `/${toPosix(path.relative(PUBLIC_DIR, file))}`, bytes: bytes.byteLength };
};

/** An output's (or a public source's) file on disk, from its root-absolute URL */
export const getOutputFile = (url: string, publicDir = PUBLIC_DIR) =>
  path.join(publicDir, ...url.split('/'));

/** A temp file `writeOutput` or the cache writes (`<file>.<pid>.tmp`): the pid that writes it */
const getTempFileOwner = (fileName: string) => {
  const match = /\.(\d+)\.tmp$/.exec(fileName);
  return match ? Number(match[1]) : null;
};

/**
 * Deletes every file in `aek-assets/` that no URL in `usedUrls` points to, and the folders that
 * leaves empty (§7). Only for the end of a full, successful run: an asset that wasn't processed in
 * it would lose its output. Returns the deleted files, relative to the repo root.
 *
 * Leaves alone what another process may be writing (p619 §1.4 A3): a temp file whose writer is
 * still running (a leftover one is deleted), and with `opts.since`, a file changed since then (an
 * output another run encoded under a key this one never saw).
 * @param publicDir Default: `src/public`. The build's `dist/` for its copy (Phase 3 step 4).
 * @param opts.since When this run started (ms since the epoch)
 */
export const removeStaleOutputs = (
  usedUrls: Iterable<string>,
  publicDir = PUBLIC_DIR,
  opts: { since?: number } = {}
) => {
  const aekAssetsDir = path.join(publicDir, 'aek-assets');
  const used = new Set([...usedUrls].map((url) => getOutputFile(url, publicDir)));
  const removed: string[] = [];
  const isInUse = (file: string, name: string) => {
    if (used.has(file)) return true;
    const writer = getTempFileOwner(name);
    if (writer !== null) return isProcessAlive(writer);
    return opts.since !== undefined && fs.statSync(file).mtimeMs >= opts.since;
  };
  const sweep = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        sweep(file);
        if (!fs.readdirSync(file).length) fs.rmdirSync(file);
      } else if (!isInUse(file, entry.name)) {
        fs.rmSync(file);
        removed.push(toPosix(path.relative(ROOT, file)));
      }
    }
  };
  if (fs.existsSync(aekAssetsDir)) sweep(aekAssetsDir);
  return removed;
};

/**
 * Passes a source through as it is (DD8): a relative one is copied, content-hashed, into
 * `aek-assets/` (the production build doesn't ship `src/`); a public one is already served, so
 * its own URL is the output. Throws for a missing relative source and for a relative .gltf with
 * external files.
 */
export const passThroughSource = (
  source: Extract<AssetSource, { file: string }>
): PipelineOutput & { isCopy: boolean } => {
  if (source.kind === 'public') {
    const bytes = fs.existsSync(source.file) ? fs.statSync(source.file).size : 0;
    const url = `/${toPosix(path.relative(PUBLIC_DIR, source.file))}`;
    return { file: source.file, url, bytes, isCopy: false };
  }
  const ext = path.extname(source.file);
  if (ext.toLowerCase() === '.gltf') {
    const uris = listExternalGLTFUris(readGLTFJson(source.file));
    if (uris.length) {
      throw new Error(
        `${source.repoPath} refers to external files (${uris.join(', ')}), which a copy would lose: export it as a .glb, or optimize it`
      );
    }
  }
  return {
    ...writeOutput(getLogicalPath(source), ext, fs.readFileSync(source.file)),
    isCopy: true,
  };
};
