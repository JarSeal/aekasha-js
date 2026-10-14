/**
 * The bundle diff (p611 D1), shared by `yarn verify:baselines` and `yarn sbp`: a build's bundle
 * against the committed `devTools/verify/baselines/bundle.json`, with the tolerance of
 * `bundleGrowth.ts`. `verify:baselines` records the file; `yarn sbp` only reads it.
 */
import fs from 'fs';
import path from 'path';
import { ROOT } from '../assetPipeline/sources';
import { isGrowthToFlag } from '../verify/bundleGrowth';
import { BUNDLE_FORMAT_VERSION, type BundleBaseline } from './bundleModel';

export const BUNDLE_BASELINE_FILE = path.join(ROOT, 'devTools/verify/baselines/bundle.json');

/** A profile's committed bundle baseline: `bundle.json` for the app, `bundle.<id>.json` next to
 * it for an embed (p611 D7) */
export const getBundleBaselineFile = (profileId: string) =>
  profileId === 'app'
    ? BUNDLE_BASELINE_FILE
    : path.join(path.dirname(BUNDLE_BASELINE_FILE), `bundle.${profileId}.json`);

/** A diff line; `attention` ones need a look (`verify:baselines` exits 1 on them) */
export type BundleFinding = { line: string; attention: boolean };

export const formatKB = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;
export const formatSigned = (bytes: number) =>
  `${bytes >= 0 ? '+' : '−'}${formatKB(Math.abs(bytes))}`;

/** The committed bundle baseline; null when it's missing or of another format version */
export const readBundleBaseline = (file = BUNDLE_BASELINE_FILE): BundleBaseline | null => {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as BundleBaseline;
    return data.formatVersion === BUNDLE_FORMAT_VERSION ? data : null;
  } catch {
    return null;
  }
};

/**
 * A chunk that grew past the tolerance or is new needs a look; one that shrank past it or is gone
 * is reported, and so are the main chunk's groups that changed past it (they explain a change of
 * the main chunk, never a reason on their own).
 */
export const diffBundle = (before: BundleBaseline, after: BundleBaseline): BundleFinding[] => {
  const findings: BundleFinding[] = [];
  for (const [name, size] of Object.entries(after.chunks)) {
    const old = before.chunks[name];
    if (!old) {
      findings.push({ line: `new ${name}: ${formatKB(size.gzip)} gzip`, attention: true });
    } else if (isGrowthToFlag(old.gzip, size.gzip)) {
      findings.push({
        line: `${name}: ${formatKB(old.gzip)} → ${formatKB(size.gzip)} gzip (${formatSigned(size.gzip - old.gzip)})`,
        attention: true,
      });
    } else if (isGrowthToFlag(size.gzip, old.gzip)) {
      findings.push({
        line: `${name}: ${formatKB(old.gzip)} → ${formatKB(size.gzip)} gzip (${formatSigned(size.gzip - old.gzip)})`,
        attention: false,
      });
    }
  }
  for (const name of Object.keys(before.chunks)) {
    if (!after.chunks[name]) findings.push({ line: `gone: ${name}`, attention: false });
  }
  for (const [group, size] of Object.entries(after.mainGroups)) {
    const old = before.mainGroups[group];
    const oldGzip = old?.gzip ?? 0;
    if (isGrowthToFlag(oldGzip, size.gzip) || isGrowthToFlag(size.gzip, oldGzip)) {
      findings.push({
        line: `  main ${group}: ${formatKB(oldGzip)} → ${formatKB(size.gzip)} gzip (${formatSigned(size.gzip - oldGzip)}, ${old?.modules ?? 0} → ${size.modules} modules)`,
        attention: false,
      });
    }
  }
  for (const group of Object.keys(before.mainGroups)) {
    if (!after.mainGroups[group]) {
      findings.push({ line: `  main ${group}: gone from the main chunk`, attention: false });
    }
  }
  return findings;
};
