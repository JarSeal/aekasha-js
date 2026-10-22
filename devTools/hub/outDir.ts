import fs from 'node:fs';
import path from 'node:path';
import { ROOT, toRepoPath } from './paths';

/**
 * A public build's output folder (p619 §1.4 H1): `yarn hub:build --out <dir>` takes any path, and
 * the build replaces the folder, so it must be one the Hub may replace. The build writes into a
 * staging folder next to it and swaps it in only when nothing failed, so a failed build leaves
 * the last output as it was.
 */

/** The repo's source folders: never a Hub output, even empty */
const SOURCE_DIRS = ['src', 'hub', 'devTools', 'docs', 'node_modules', '.git'].map((dir) =>
  path.join(ROOT, dir)
);

/** What every public build writes at its root: a folder with all three is a Hub output */
const HUB_OUTPUT_SIGNATURE = ['_headers', '404.html', '_assets'];

/** Is `relative` (a `path.relative` result) outside the folder it was taken from? */
const isOutside = (relative: string) =>
  relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

const isSameOrAncestor = (dir: string, of: string) => !isOutside(path.relative(dir, of));

const formatDir = (dir: string) => {
  const relative = path.relative(ROOT, dir);
  return isOutside(relative) ? dir : `${toRepoPath(dir) || '.'}/`;
};

/**
 * Why `outDir` can't take a public build, or null when it can: it may be missing, empty or an
 * earlier Hub output. Refused: the repo root and every folder above it, the repo's source folders
 * (`src/`, `hub/`, `devTools/`, `docs/`, `node_modules/`, `.git/`), a file, and a non-empty folder
 * that isn't a Hub output.
 * @param outDir Absolute
 */
export const getHubOutDirError = (outDir: string): string | null => {
  const dir = path.resolve(outDir);
  const refuse = (why: string) => `--out ${formatDir(dir)} refused: ${why}`;
  if (isSameOrAncestor(dir, ROOT)) return refuse('the build replaces it, and it holds the repo');
  if (SOURCE_DIRS.includes(dir)) return refuse('it is one of the repo’s source folders');
  const stat = fs.statSync(dir, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isDirectory()) return refuse('it is a file');
  const entries = fs.readdirSync(dir);
  if (!entries.length) return null;
  if (HUB_OUTPUT_SIGNATURE.every((name) => entries.includes(name))) return null;
  return refuse(
    `the folder isn’t empty and is not a Hub output (no ${HUB_OUTPUT_SIGNATURE.join(', ')}), and the build replaces it`
  );
};

/** The staging folder a public build writes into, next to `outDir` (a rename can't cross disks) */
export const getHubStagingDir = (outDir: string) => `${path.resolve(outDir)}.tmp-${process.pid}`;

/**
 * Creates the staging folder for `outDir`, emptied first (a crashed build's), after checking
 * `outDir` (throws with {@link getHubOutDirError}'s message)
 */
export const createHubStagingDir = (outDir: string) => {
  const error = getHubOutDirError(outDir);
  if (error) throw new Error(error);
  const staging = getHubStagingDir(outDir);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  return staging;
};

/**
 * Puts a finished staging folder in `outDir`'s place: the old output is moved aside, the staging
 * folder renamed, then the old one deleted. `outDir` is checked again first, since the build took
 * a while.
 */
export const commitHubStagingDir = (staging: string, outDir: string) => {
  const error = getHubOutDirError(outDir);
  if (error) throw new Error(error);
  const dir = path.resolve(outDir);
  const old = `${dir}.old-${process.pid}`;
  fs.rmSync(old, { recursive: true, force: true });
  const hasOld = fs.existsSync(dir);
  if (hasOld) fs.renameSync(dir, old);
  try {
    fs.renameSync(staging, dir);
  } catch (err) {
    if (hasOld) fs.renameSync(old, dir);
    throw err;
  }
  if (hasOld) fs.rmSync(old, { recursive: true, force: true });
};
