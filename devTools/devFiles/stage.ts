import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { isProcessAlive } from '../assetPipeline/runLock';
import { ROOT } from '../assetPipeline/sources';
import { DevFilesError } from './http';
import type { DevFilesStageBody } from '../../src/_engine/debug/DevFilesProtocol';

/**
 * Staged files (p342 §2.1): a binary body (a PNG) is sent raw with `PUT stage` and named by its
 * `stageId` in a commit. Each server keeps them in its own `.cache/dev-files/stage/<pid>-<id>/`
 * (a second server, `dev:https` or the self-check's, used to empty the shared folder under the
 * first one's staged commits, p619 §1.4 F5), removed when the server closes, or by the next
 * server once that pid is gone. They expire after 10 minutes. A commit that fails keeps them, so
 * it can be retried; one that lands removes them.
 */

export const DEV_FILES_CACHE_DIR = path.join(ROOT, '.cache', 'dev-files');
const STAGE_ROOT = path.join(DEV_FILES_CACHE_DIR, 'stage');
const STAGE_TTL_MS = 10 * 60 * 1000;

export type StagedFile = { file: string; bytes: number; sha256: string; expiresAt: number };

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Removes the stage folders of servers that are gone (and files of the old shared layout) */
const removeAbandonedStages = () => {
  for (const entry of fs.readdirSync(STAGE_ROOT, { withFileTypes: true })) {
    const pid = Number(/^(\d+)-/.exec(entry.name)?.[1]);
    if (entry.isDirectory() && isProcessAlive(pid)) continue;
    fs.rmSync(path.join(STAGE_ROOT, entry.name), { recursive: true, force: true });
  }
};

export const createStage = () => {
  const staged = new Map<string, StagedFile>();
  const STAGE_DIR = path.join(STAGE_ROOT, `${process.pid}-${randomBytes(4).toString('hex')}`);
  if (fs.existsSync(STAGE_ROOT)) removeAbandonedStages();

  const remove = (stageId: string) => {
    const entry = staged.get(stageId);
    if (!entry) return;
    staged.delete(stageId);
    fs.rmSync(entry.file, { force: true });
  };

  const sweep = () => {
    const now = Date.now();
    for (const [stageId, entry] of staged) {
      if (entry.expiresAt <= now) remove(stageId);
    }
  };
  const sweepTimer = setInterval(sweep, 60 * 1000);
  sweepTimer.unref();

  return {
    add: async (data: Buffer): Promise<DevFilesStageBody> => {
      sweep();
      await fs.promises.mkdir(STAGE_DIR, { recursive: true });
      const stageId = randomBytes(16).toString('hex');
      const file = path.join(STAGE_DIR, stageId);
      await fs.promises.writeFile(file, data);
      const entry = {
        file,
        bytes: data.length,
        sha256: sha256(data),
        expiresAt: Date.now() + STAGE_TTL_MS,
      };
      staged.set(stageId, entry);
      return { stageId, bytes: entry.bytes, sha256: entry.sha256 };
    },
    /** The staged file, or STAGE_EXPIRED */
    get: (stageId: string) => {
      sweep();
      const entry = staged.get(stageId);
      if (!entry) {
        throw new DevFilesError('STAGE_EXPIRED', `No staged file ${stageId} (expired or unknown)`, {
          stageId,
        });
      }
      return entry;
    },
    remove,
    dispose: () => {
      clearInterval(sweepTimer);
      fs.rmSync(STAGE_DIR, { recursive: true, force: true });
    },
  };
};

export type DevFilesStage = ReturnType<typeof createStage>;
