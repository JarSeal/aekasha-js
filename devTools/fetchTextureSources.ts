import path from 'path';
import { fileURLToPath } from 'url';
import {
  fetchTextureSetSourceAsync,
  findTextureSetSources,
  writeTextureCredits,
  type TextureSetSourceDir,
  type TextureSource,
} from './assetPipeline/textureSources';
import { readGit } from './git';
import { out, setProgressLogFile } from './progressLog';
import { ROOT, SRC_DIR } from './paths';

/**
 * Fetches the texture sets' source maps (p303 D5): every set folder with a `source.json` (the
 * toolkit's `src/toolkit/textures/<setId>/`, and an app set's folder) gets its provider's maps in
 * its gitignored `source/raw/` (`color`, `normal`, `roughness`, `ao`, `height`, …), the fixed names
 * its pack recipes read. Downloads are cached in `.cache/texture-downloads/`; a set whose
 * `source/raw/` already holds its `source.json`'s maps is skipped. Then writes the toolkit's
 * `src/toolkit/textures/CREDITS.md` when it changed. The output also goes to
 * `.cache/texture-downloads/progress.log`.
 *
 * Usage: `yarn fetchTextureSources [--only <setId>[,<setId>…]] [--force]` (`--force` downloads
 * again, the cache and the up-to-date check ignored). Exits 1 when a set failed.
 */

const CACHE_DIR = path.join(ROOT, '.cache', 'texture-downloads');
/** A large download (a 2K-PNG zip is ≈ 60 MB) on a slow line, but never a hung run */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const downloadAsync = async (url: string) => {
  try {
    // A generic client name: the providers ask for a User-Agent, not who runs it
    const response = await fetch(url, {
      headers: { 'User-Agent': 'texture-source-fetcher/1.0' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    // fetch's own message is only "fetch failed": the network error is its cause
    const { name, message, cause } = error as Error & { cause?: unknown };
    const reason =
      name === 'TimeoutError'
        ? `timed out after ${DOWNLOAD_TIMEOUT_MS / 1000} s`
        : cause instanceof Error
          ? cause.message
          : message;
    throw new Error(`can't download ${url}: ${reason}`);
  }
};

const parseArgs = (args: string[]) => {
  let only: string[] | undefined;
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') force = true;
    else if (args[i] === '--only' && args[i + 1]) only = args[++i].split(',').filter(Boolean);
    else throw new Error(`unknown argument "${args[i]}" (--only <setId>[,<setId>…], --force)`);
  }
  return { only, force };
};

/** Whether git ignores the set's `source/raw/` (a set outside the ignored patterns would commit
 * its maps); true without git */
const isRawIgnored = (set: TextureSetSourceDir) => {
  if (!readGit(['rev-parse', '--git-dir'])) return true;
  const rawFile = path.relative(ROOT, path.join(set.dir, 'source', 'raw', 'color.jpg'));
  return readGit(['check-ignore', rawFile]) !== '';
};

const mainAsync = async () => {
  const watch = setProgressLogFile(path.join(CACHE_DIR, 'progress.log'));
  const { only, force } = parseArgs(process.argv.slice(2));
  const sets = findTextureSetSources(SRC_DIR);
  out(`[textures] ${sets.length} set(s) with a source.json (watch: ${watch})`);

  let selected = sets;
  if (only) {
    const unknown = only.filter((id) => !sets.some((set) => set.setId === id));
    if (unknown.length) {
      out(
        `✗ No set with a source.json has the id ${unknown.map((id) => `"${id}"`).join(', ')} (sets: ${sets.map((set) => set.setId).join(', ') || 'none'})`,
        true
      );
      process.exitCode = 1;
      return;
    }
    selected = sets.filter((set) => only.includes(set.setId));
  }

  let failed = 0;
  for (const set of selected) {
    const where = `${set.setId} (src/${set.srcPath})`;
    if ('error' in set.source) {
      out(`✗ ${where}: ${set.source.error}`, true);
      failed++;
      continue;
    }
    if (!isRawIgnored(set)) {
      out(
        `✗ ${where}: git doesn't ignore its source/raw/: add the folder to .gitignore (the sets' pattern is there)`,
        true
      );
      failed++;
      continue;
    }
    try {
      const result = await fetchTextureSetSourceAsync(
        set as TextureSetSourceDir & { source: TextureSource },
        { cacheDir: CACHE_DIR, download: downloadAsync, force, log: (line) => out(line) }
      );
      const optional = result.missingOptional.length
        ? `; no ${result.missingOptional.join(', ')} map (optional)`
        : '';
      out(`✓ ${where}: ${result.status === 'upToDate' ? 'up to date' : 'fetched'}${optional}`);
    } catch (error) {
      out(`✗ ${where}: ${(error as Error).message}`, true);
      failed++;
    }
  }

  const credits = writeTextureCredits(SRC_DIR, sets);
  const creditsPath = path.relative(ROOT, credits.file);
  if ('skipped' in credits) out(`  ${creditsPath} not written: ${credits.skipped}`);
  else if (credits.isWritten) out(`✓ ${creditsPath} written`);

  if (failed) {
    out(`✗ ${failed} set(s) failed`, true);
    process.exitCode = 1;
  }
};

// Only as a script (`yarn fetchTextureSources`): an import fetches nothing
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainAsync().catch((error: Error) => {
    out(`✗ ${error.message}`, true);
    process.exitCode = 1;
  });
}
