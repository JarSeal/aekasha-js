import fs from 'fs';
import path from 'path';
import { ROOT } from './sources';

/**
 * The asset pipeline's run lock (p619 §1.4 A3): one process at a time writes `assets.lock.json`
 * and removes stale outputs, so `yarn assets`' prune and a dev server's save (another process)
 * never interleave. Encoding isn't under it: the prune leaves alone what another run may be
 * writing (`removeStaleOutputs`' `since`).
 *
 * The lock is a file created with `O_EXCL` (`wx`) holding its owner's pid. A lock whose owner is
 * gone (killed mid-save) is taken over.
 */

export const RUN_LOCK_FILE = path.join(ROOT, '.cache', 'asset-pipeline', 'run.lock');

/** How long a run waits for another's prune and save, which take well under a second */
const WAIT_TIMEOUT_MS = 30_000;
const POLL_MS = 50;

/** Is a process with this pid running on this machine? `EPERM`: running, someone else's. */
export const isProcessAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const readOwnerPid = (lockFile: string) => {
  try {
    return Number((JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as { pid?: unknown }).pid);
  } catch {
    // Being written or removed right now, or not ours: treated as held, checked again
    return null;
  }
};

/** Creates the lock file, or returns false when another live process holds it */
const tryAcquire = (lockFile: string) => {
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, since: Date.now() }), {
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const owner = readOwnerPid(lockFile);
  if (owner !== null && !isProcessAlive(owner)) {
    // Its owner is gone: remove it, then race for it like everyone else
    fs.rmSync(lockFile, { force: true });
  }
  return false;
};

/**
 * Runs `fn` holding the run lock: waits for another process's run to finish its prune and save
 * (up to 30 s, then throws naming the lock file), and releases the lock when `fn` returns or
 * throws. Not re-entrant: `fn` must not call it again.
 * @param opts.lockFile Another location (tests)
 */
export const withRunLockAsync = async <T>(
  fn: () => T | Promise<T>,
  opts: { lockFile?: string; timeoutMs?: number } = {}
): Promise<T> => {
  const lockFile = opts.lockFile ?? RUN_LOCK_FILE;
  const timeoutMs = opts.timeoutMs ?? WAIT_TIMEOUT_MS;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const start = Date.now();
  while (!tryAcquire(lockFile)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `another asset pipeline run (pid ${readOwnerPid(lockFile) ?? '?'}) has held ${path.relative(ROOT, lockFile)} for over ${Math.round(timeoutMs / 1000)} s. Delete the file if no run is going.`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
};
