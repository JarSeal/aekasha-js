/**
 * `yarn verify:ui`'s screenshots (p803 D11): each state's in each setting against the last good
 * one, kept locally as the scene runner's are (the fonts render differently per machine):
 * `.cache/verify/ui/baseline/<piece>/<state>.<setting>.png`. Every run writes its shots to
 * `last-run/` (emptied when it starts), with a `*.diff.png` next to each one over the tolerance
 * (`ui.config.ts`); `--update` records the shots of the runs without problems as the baselines.
 */
import fs from 'fs';
import path from 'path';
import { ROOT } from '../paths';
import { writeFileAtomic } from '../files';
import { compareSnapshots } from './snapshotDiff';
import { UI_SNAPSHOT_TOLERANCE } from './ui.config';

const UI_CACHE_DIR = path.join(ROOT, '.cache/verify/ui');
const BASELINE_DIR = path.join(UI_CACHE_DIR, 'baseline');
/** The last run's shots and diffs */
export const UI_LAST_RUN_DIR = path.join(UI_CACHE_DIR, 'last-run');

/** Empties the last run's folder (every run starts it again) */
export const startSnapshotRun = () => fs.rmSync(UI_LAST_RUN_DIR, { recursive: true, force: true });

/** A shot's outcome: a problem fails its state, a note is printed with it */
export type SnapshotOutcome = { problem?: string; note?: string };

/**
 * Writes a shot to the last run's folder, then records it as the baseline (`isRecording`) or
 * compares it with the baseline
 * @param file the shot's path under the folders (`uiChecks.ts`' `getSnapshotFile`)
 */
export const checkSnapshotAsync = async (
  file: string,
  png: Buffer,
  isRecording: boolean
): Promise<SnapshotOutcome> => {
  const current = path.join(UI_LAST_RUN_DIR, file);
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(current, png);
  const baseline = path.join(BASELINE_DIR, file);
  if (isRecording) {
    fs.mkdirSync(path.dirname(baseline), { recursive: true });
    writeFileAtomic(baseline, png);
    return { note: 'screenshot recorded' };
  }
  if (!fs.existsSync(baseline)) return { note: 'new screenshot: --update records it' };
  const diffFile = current.replace(/\.png$/, '.diff.png');
  const diff = await compareSnapshots(png, baseline, UI_SNAPSHOT_TOLERANCE, diffFile);
  if ('sizeMismatch' in diff) return { problem: `screenshot size ${diff.sizeMismatch}` };
  if (
    diff.meanDelta <= UI_SNAPSHOT_TOLERANCE.maxMeanDelta &&
    diff.changedRatio <= UI_SNAPSHOT_TOLERANCE.maxChangedRatio
  ) {
    return {};
  }
  return {
    problem: `screenshot differs: mean delta ${diff.meanDelta.toFixed(2)}, ${(
      diff.changedRatio * 100
    ).toFixed(2)} % of the pixels (${path.relative(ROOT, diffFile)})`,
  };
};
