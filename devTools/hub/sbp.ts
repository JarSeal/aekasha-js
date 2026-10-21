import fs from 'node:fs';
import sbpProfiles from '../../sbp.config';
import {
  REPORT_FORMAT_VERSION,
  SBP_REPORT_FILE,
  type ProfileReport,
  type SbpReportFile,
} from '../sbp/report';
import type { HubDiagnostics } from './diagnostics';
import { toRepoPath } from './paths';
import type { HubBuildMode } from './types';

/**
 * `{{sbp:<profile>.<measure>}}` (p611 D9): a size from the last `yarn sbp` report
 * (`.cache/sbp/report.json`), in a page's Markdown or markup, so a page can't state a number its
 * build doesn't have. `yarn build` runs `yarn sbp` right before `yarn hub:build`, so the public
 * Hub's numbers are that build's. Gzip sizes in KiB (1,024 bytes, one decimal), as `yarn sbp`
 * measures them:
 * - `initial`, `lazy`: what loads before the first frame, and the rest of the build's files;
 * - `lazyFiles`: how many lazy files (a count, no unit);
 * - `chunk:<key>`: a file (`assets/index.js`, an embed's `banner.embed.js`);
 * - `group:<group>`: a group's code in the initial chunks, minified (`three`,
 *   `_engine/features/physics`);
 * - `budget:<key>`: the profile's budget (`initial`, a chunk's key, a group).
 *
 * An unknown profile (not in `sbp.config.ts`) or measure fails the build. A report without the
 * profile fails `public` and warns in `dev`, where the text says to run `yarn sbp`.
 */

export const SBP_PLACEHOLDER_REGEX = /\{\{sbp:([^}]*)\}\}/g;

/** Gzip bytes as the page shows them: `300.6 KiB` (a no-break space) */
export const formatHubKiB = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`;

/** A `{{sbp:…}}` value: its text, an error, or a report that lacks it */
export type SbpValue = { value: string } | { error: string } | { missing: string };

type Measure = (report: ProfileReport, arg: string) => SbpValue;

const sizeOf = (sizes: Record<string, { gzip: number }>, key: string, what: string): SbpValue => {
  const size = sizes[key];
  if (size) return { value: formatHubKiB(size.gzip) };
  return { error: `no ${what} "${key}" (it has ${Object.keys(sizes).sort().join(', ')})` };
};

const MEASURES: Record<string, { hasArg: boolean; read: Measure }> = {
  initial: {
    hasArg: false,
    read: (report) => ({ value: formatHubKiB(report.initial.total.gzip) }),
  },
  lazy: { hasArg: false, read: (report) => ({ value: formatHubKiB(report.lazy.total.gzip) }) },
  lazyFiles: {
    hasArg: false,
    read: (report) => ({ value: String(Object.keys(report.lazy.files).length) }),
  },
  chunk: {
    hasArg: true,
    read: (report, key) => sizeOf({ ...report.initial.files, ...report.lazy.files }, key, 'chunk'),
  },
  group: {
    hasArg: true,
    read: (report, key) =>
      sizeOf(
        Object.fromEntries(
          Object.entries(report.groups).map(([group, size]) => [group, size.initial])
        ),
        key,
        'group'
      ),
  },
  budget: {
    hasArg: true,
    read: (report, key) => {
      const check = report.budgets?.find((budget) => budget.key === key);
      if (check) return { value: formatHubKiB(check.budget) };
      return { error: `no budget "${key}" in the profile's report` };
    },
  },
};

/**
 * Resolves a placeholder's reference (`banner.initial`, `app.group:three`) against a report.
 * @param report null when there's none (or it's of another format)
 */
export const resolveSbpValue = (ref: string, report: SbpReportFile | null): SbpValue => {
  const match = /^([\w-]+)\.(\w+)(?::(.+))?$/.exec(ref.trim());
  const known = Object.keys(MEASURES).join(', ');
  if (!match) return { error: `{{sbp:${ref}}}: write {{sbp:<profile>.<measure>}} (${known})` };
  const [, id, name, arg] = match;
  if (!sbpProfiles.some((profile) => profile.id === id)) {
    const ids = sbpProfiles.map((profile) => profile.id).join(', ');
    return { error: `{{sbp:${ref}}}: no profile "${id}" in sbp.config.ts (it has ${ids})` };
  }
  const measure = MEASURES[name];
  if (!measure) return { error: `{{sbp:${ref}}}: unknown measure "${name}" (known: ${known})` };
  if (measure.hasArg !== (arg !== undefined)) {
    return {
      error: `{{sbp:${ref}}}: "${name}" ${measure.hasArg ? `needs a key (${name}:<key>)` : 'takes no key'}`,
    };
  }
  const profile = report?.profiles[id];
  if (!profile) {
    const why = report ? `has no profile "${id}"` : `isn't there (or is of another format)`;
    return { missing: `${toRepoPath(SBP_REPORT_FILE)} ${why}: run yarn sbp --profile ${id}` };
  }
  const result = measure.read(profile, arg ?? '');
  return 'error' in result ? { error: `{{sbp:${ref}}}: ${result.error}` } : result;
};

/** Reads the report; null when there's none or it's of another format */
export const readSbpReport = (): SbpReportFile | null => {
  try {
    const report = JSON.parse(fs.readFileSync(SBP_REPORT_FILE, 'utf-8')) as SbpReportFile;
    return report.formatVersion === REPORT_FORMAT_VERSION ? report : null;
  } catch {
    return null;
  }
};

/**
 * Fills a placeholder. A report without the profile is an error in `public`, and a warning and a
 * note in the text in `dev`.
 */
export const fillSbpPlaceholder = (
  ref: string,
  ctx: {
    mode: HubBuildMode;
    report: SbpReportFile | null;
    diag: HubDiagnostics;
    file: string;
    line: number;
  }
) => {
  const result = resolveSbpValue(ref, ctx.report);
  if ('value' in result) return result.value;
  if ('error' in result) {
    ctx.diag.error(ctx.file, ctx.line, result.error);
    return '';
  }
  const message = `{{sbp:${ref}}}: ${result.missing}`;
  if (ctx.mode === 'public') {
    ctx.diag.error(ctx.file, ctx.line, message);
    return '';
  }
  ctx.diag.warn(ctx.file, ctx.line, message);
  return '[run yarn sbp]';
};
