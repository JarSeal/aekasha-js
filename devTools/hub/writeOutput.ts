import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { copyStaticAssets, type HubAssetFile } from './assets';
import type { HubBuiltPage } from './build';
import type { HubDiagnostics } from './diagnostics';
import { copyHubEmbeds, type HubEmbedState } from './embed';
import type { HubImageJob } from './markdown';
import { commitHubStagingDir, createHubStagingDir } from './outDir';
import { FAVICON_FILES } from './paths';
import type { HubBuildMode } from './types';

/**
 * A build's writes (`buildHub`'s last step): the pages, the built assets, the static assets, the
 * embeds, the images and the favicons. `public` writes into a staging folder and swaps it in only
 * when nothing failed (p619 §1.4 H1), so a failed build leaves the last output as it was; `dev`
 * writes its own folder in place.
 */

/** Netlify's headers: every `_assets/` reference carries `?v=<hash>`, so they're immutable */
const NETLIFY_HEADERS = `/_assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

const writeFile = (file: string, content: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** `dev` writes into the same folder every run: an image newer than its source is kept */
const isUpToDate = (source: string, out: string) =>
  (fs.statSync(out, { throwIfNoEntry: false })?.mtimeMs ?? -1) >= fs.statSync(source).mtimeMs;

const writeImagesAsync = async (
  jobs: HubImageJob[],
  outDir: string,
  mode: HubBuildMode,
  diag: HubDiagnostics
) => {
  // Pages that show the same image (a scene's) share its outputs
  const byOutPath = new Map(jobs.map((job) => [job.outPath, job]));
  await Promise.all(
    [...byOutPath.values()].map(async ({ source, outPath, isConverted, width }) => {
      const out = path.join(outDir, outPath);
      if (mode === 'dev' && isUpToDate(source, out)) return;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      try {
        if (isConverted) {
          const image = sharp(source);
          if (width) image.resize({ width, withoutEnlargement: true });
          await image.webp({ quality: 85 }).toFile(out);
        } else fs.copyFileSync(source, out);
      } catch (err) {
        diag.error(source, undefined, `The image could not be written: ${(err as Error).message}`);
      }
    })
  );
};

/**
 * Writes the build into `outDir`. Returns whether it was written: `public` with an error in a
 * write step (an image) leaves the last output, and a throw does too (the staging folder is
 * removed either way).
 */
export const writeHubOutputAsync = async (opts: {
  mode: HubBuildMode;
  outDir: string;
  pages: HubBuiltPage[];
  files: (HubAssetFile | null)[];
  images: HubImageJob[];
  embeds: HubEmbedState;
  diag: HubDiagnostics;
}) => {
  const { mode, outDir, diag } = opts;
  const writeDir = mode === 'public' ? createHubStagingDir(outDir) : outDir;
  try {
    for (const { outPath, html } of opts.pages) writeFile(path.join(writeDir, outPath), html);
    for (const file of opts.files) {
      if (file) writeFile(path.join(writeDir, file.outPath), file.content);
    }
    copyStaticAssets(writeDir);
    if (mode === 'public') copyHubEmbeds(opts.embeds, writeDir);
    await writeImagesAsync(opts.images, writeDir, mode, diag);
    for (const file of FAVICON_FILES) {
      fs.copyFileSync(file, path.join(writeDir, path.basename(file)));
    }
    if (mode === 'dev') return true;
    writeFile(path.join(writeDir, '_headers'), NETLIFY_HEADERS);
    if (diag.errors.length) return false;
    commitHubStagingDir(writeDir, outDir);
    return true;
  } finally {
    if (writeDir !== outDir) fs.rmSync(writeDir, { recursive: true, force: true });
  }
};
