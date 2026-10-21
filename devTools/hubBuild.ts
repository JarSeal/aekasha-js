/* eslint-disable no-console */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sbpProfiles from '../sbp.config';
import { getEmbedProfiles } from './gather/output';
import { buildHub, formatBytes, rebaseNotFoundPage } from './hub/build';
import { readSbpReport } from './hub/sbp';
import { getEmbedEntryFileName, getEmbedOutDir } from './sbp/embedPaths';
import { formatDiagnostic } from './hub/diagnostics';
import { getHubOutDirError } from './hub/outDir';
import { APP_DIST_DIR, HUB_DIST_DIR, ROOT, toRepoPath } from './hub/paths';

/**
 * `yarn hub:build [--out <dir>] [--no-api] [--no-embed]`: builds the Ækasha Hub's public site
 * (p551) into `dist-hub/`, and exits 1 on an error, leaving the last output as it was: it builds
 * into a staging folder next to it and replaces the folder only when nothing failed. `--out`
 * refuses a folder the build may not replace (`devTools/hub/outDir.ts`: the repo root or above,
 * a source folder, a non-empty folder that isn't a Hub output). `yarn build` runs it last.
 * - `--no-api`: no API docs (p553 §2.5), for fast content work: no TypeDoc conversion, the
 *   Documentation page says they aren't built, and `api:` links aren't checked (one warning).
 * - `--no-embed`: `::: embed` shows its poster only (p611 D9). Without it, an embed profile with
 *   no build (`dist-embed/<id>/`) or no `yarn sbp` report is built and measured first
 *   (`yarn sbp --profile <ids>`), and the pages' embeds are copied into `_assets/embed/`.
 * - `AEK_HUB=false`: does nothing (`yarn build` without the Hub).
 * - `AEK_HUB_IN_DIST=true`: also copies the site into the app's `dist/hub/`, so the app's own
 *   site serves it at `/hub/` (p550 §3.1). Off by default: the Hub isn't in production unless
 *   the developer asks for it.
 */

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const fail = (message: string) => {
  console.error(`${RED}✗ [Hub] ${message}${RESET}`);
  process.exit(1);
};

const parseArgs = (args: string[]) => {
  let outDir = HUB_DIST_DIR;
  let isApiSkipped = false;
  let isEmbedSkipped = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outDir = path.resolve(ROOT, args[++i]);
    else if (args[i] === '--no-api') isApiSkipped = true;
    else if (args[i] === '--no-embed') isEmbedSkipped = true;
    else {
      fail(
        `Unknown argument "${args[i]}" (usage: yarn hub:build [--out <dir>] [--no-api] [--no-embed])`
      );
    }
  }
  return { outDir, isApiSkipped, isEmbedSkipped };
};

/**
 * The embed profiles without a build or a report entry, built and measured by `yarn sbp` (which
 * `AEK_SBP=false` turns off: `::: embed` then fails on the missing build)
 */
const buildMissingEmbeds = () => {
  const report = readSbpReport();
  const missing = getEmbedProfiles(sbpProfiles)
    .filter(
      (profile) =>
        !report?.profiles[profile.id] ||
        !fs.existsSync(path.join(getEmbedOutDir(profile.id), getEmbedEntryFileName(profile)))
    )
    .map((profile) => profile.id);
  if (!missing.length) return;
  console.log(
    `[Hub] No build of ${missing.join(', ')} yet: yarn sbp --profile ${missing.join(',')}`
  );
  const run = spawnSync('yarn', ['-s', 'sbp', '--profile', missing.join(','), '--brief'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  // Exit 1 is a budget over: the build is there, and the Hub shows what it measured
  if (run.status !== 0 && run.status !== 1) fail(`yarn sbp exited with ${run.status}`);
};

/**
 * dist/hub/: everything but Netlify's `_headers`, which only works at a site's root, with the 404
 * page's links pointing at `/hub/`
 */
const copyIntoAppDist = (outDir: string) => {
  if (!fs.existsSync(path.join(APP_DIST_DIR, 'index.html'))) {
    fail('AEK_HUB_IN_DIST=true, but dist/ has no app build: run it after `vite build`');
  }
  const target = path.join(APP_DIST_DIR, 'hub');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(outDir, target, {
    recursive: true,
    filter: (file) => path.relative(outDir, file) !== '_headers',
  });
  const notFoundFile = path.join(target, '404.html');
  fs.writeFileSync(
    notFoundFile,
    rebaseNotFoundPage(fs.readFileSync(notFoundFile, 'utf-8'), '/hub/')
  );
  console.log(`${GREEN}✓ [Hub] Copied into ${toRepoPath(target)}/${RESET}`);
};

const main = async () => {
  if (process.env.AEK_HUB === 'false') {
    console.log('[Hub] AEK_HUB=false: not built');
    return;
  }
  const { outDir, isApiSkipped, isEmbedSkipped } = parseArgs(process.argv.slice(2));
  const outDirError = getHubOutDirError(outDir);
  if (outDirError) fail(outDirError);
  if (!isEmbedSkipped) buildMissingEmbeds();
  const result = await buildHub({
    mode: 'public',
    outDir,
    api: isApiSkipped ? 'none' : 'current',
    isEmbedLive: !isEmbedSkipped,
  });

  for (const warning of result.diag.warnings) {
    console.warn(`${YELLOW}⚠ [Hub] ${formatDiagnostic(warning)}${RESET}`);
  }
  for (const error of result.diag.errors) {
    console.error(`${RED}✗ [Hub] ${formatDiagnostic(error)}${RESET}`);
  }
  if (!result.isOk) {
    const count = result.diag.errors.length;
    fail(`${count} error${count === 1 ? '' : 's'}: ${toRepoPath(outDir)}/ left as it was`);
  }
  console.log(
    `${GREEN}✓ [Hub] ${result.pageCount} pages → ${toRepoPath(outDir)}/ (${Math.round(result.durationMs)} ms)${RESET}`
  );
  if (result.api) {
    const { isCached, extractMs, entryCount, symbolCount, coverage } = result.api;
    const share = coverage.total ? Math.round((coverage.documented / coverage.total) * 100) : 100;
    console.log(
      `  API: ${entryCount} entries, ${symbolCount} names, ${share}% documented; model ${isCached ? 'reused' : 'extracted'} (${(extractMs / 1000).toFixed(1)} s)`
    );
  } else if (isApiSkipped) {
    console.log('  API: not built (--no-api)');
  }
  if (result.search) {
    console.log(
      `  Search index: ${formatBytes(result.search.gzipBytes)} gzipped (${formatBytes(result.search.bytes)}), ${result.search.pageDocCount} page sections and ${result.search.docCount - result.search.pageDocCount} API docs`
    );
  }

  if (process.env.AEK_HUB_IN_DIST === 'true') copyIntoAppDist(outDir);
};

main().catch((err) => fail((err as Error).stack ?? String(err)));
