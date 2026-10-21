import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHub } from './build';
import { ROOT } from './paths';

// docs/plans/p619_review-schemas-pipeline-devtools-hub.md Phase 0 (§1.4 H1): a public build empties
// its `outDir` with `fs.rmSync`, whatever it is (`yarn hub:build --out .` deletes the repo). The
// spy throws instead of deleting a protected folder, so this test never deletes anything. An
// `it.fails` is a bug not fixed yet: Phase 1 turns it into an `it`.

const SENTINEL = 'p619: rmSync of a protected folder';
const PROTECTED = [ROOT, path.dirname(ROOT), path.join(ROOT, 'src')];

const rmSync = fs.rmSync.bind(fs);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('H1: a public build refuses to empty a folder that isn’t a Hub output', () => {
  it.fails(
    'refuses the repo root before it builds',
    async () => {
      const removed: string[] = [];
      vi.spyOn(fs, 'rmSync').mockImplementation((target, opts) => {
        const file = path.resolve(String(target));
        if (PROTECTED.includes(file)) {
          removed.push(file);
          throw new Error(SENTINEL);
        }
        rmSync(target, opts);
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const build = buildHub({ mode: 'public', outDir: ROOT, api: 'none', isEmbedLive: false });
      await expect(build).rejects.toThrow(/refuse|not a Hub output/i);
      expect(removed).toEqual([]);
    },
    60_000
  );
});
