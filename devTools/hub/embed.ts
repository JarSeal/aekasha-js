import fs from 'node:fs';
import path from 'node:path';
import sbpProfiles from '../../sbp.config';
import { getEmbedProfiles } from '../gather/output';
import { getEmbedEntryFileName, getEmbedOutDir } from '../sbp/embedPaths';
import type { SbpProfile } from '../sbp/config';
import { hashContent } from './hash';
import { escapeHtml } from './html';
import { registerHubDirective, type HubMarkdownEnv } from './markdown';
import { APP_DATA_FILE, ROOT, toRepoPath } from './paths';
import { findScene, getSceneImageSources } from './scenes';

/**
 * `::: embed <profile> [height]` … `:::` (p611 D9): an embed profile (`sbp.config.ts`) running live
 * on a Hub page, the one place the public Hub runs the engine. The panel shows the profile's first
 * scene's Hub image as the poster; `hub.ts` loads `_embed.ts`, which imports the profile's entry
 * module when the panel nears the viewport and mounts it over the poster (`INLINE`, `input:
 * 'NONE'`, paused out of view), with a pause button. With reduced motion the poster stays, with a
 * play button; without WebGPU or WebGL2 it stays with a line saying why. The directive's content
 * is the caption.
 * - `public`: the entry is the profile's build, `dist-embed/<profile>/` copied into
 *   `_assets/embed/<profile>/` (`copyHubEmbeds`); `yarn hub:build` builds it first when it's
 *   missing, and `--no-embed` leaves it out (`HubEmbedState.isLive`: the poster and a note).
 * - `dev`: the entry's source from the dev server (the Hub is served by it), so an edit shows on
 *   the next load without a build.
 * - `height`: a CSS length (`24rem`, `60vh`); without one, the poster's aspect ratio.
 * - One per page: the engine mounts once per page load (`mountAekasha`).
 */

/** The build's embeds, shared by every page's render */
export type HubEmbedState = {
  /** `public`: false with `--no-embed` (posters only); always true in `dev` */
  isLive: boolean;
  /** The profiles the pages show, which `public` copies into `_assets/embed/` */
  used: Set<string>;
  /** The pages that have one already: a page mounts one engine */
  pages: Set<string>;
};

export const createHubEmbedState = (isLive: boolean): HubEmbedState => ({
  isLive,
  used: new Set(),
  pages: new Set(),
});

/** From the site root: `_assets/embed/<profile>/` */
export const EMBED_URL_DIR = '_assets/embed/';

/** The poster in the panel's width (the content column, 46rem) at 1x and 2x */
const POSTER_WIDTHS = [800, 1600];
const POSTER_SIZES = '(min-width: 46rem) 46rem, 100vw';

/** A CSS length: a number and a unit */
const HEIGHT_REGEX = /^\d+(\.\d+)?(px|rem|em|vh|svh|dvh|lvh)$/;

/** The vite build's files a site doesn't load (its manifest, the prune's list) */
const EMBED_BUILD_META_DIR = '.vite';

const getEmbedProfile = (id: string) =>
  getEmbedProfiles(sbpProfiles).find((profile) => profile.id === id) ?? null;

/** The entry's URL: the build's copy with its `?v=` (`public`), or its source (`dev`) */
const getEntryUrl = (profile: SbpProfile, env: HubMarkdownEnv, line: number) => {
  if (env.mode === 'dev')
    return `/${path.relative(path.join(ROOT, 'src'), path.join(ROOT, profile.entry)).split(path.sep).join('/')}`;
  const entryFile = path.join(getEmbedOutDir(profile.id), getEmbedEntryFileName(profile));
  if (!fs.existsSync(entryFile)) {
    env.diag.error(
      env.file,
      line,
      `::: embed ${profile.id}: no build of it (${toRepoPath(entryFile)}): run yarn sbp --profile ${profile.id}, or yarn hub:build --no-embed`
    );
    return null;
  }
  const hash = hashContent(fs.readFileSync(entryFile));
  return `${env.root}${EMBED_URL_DIR}${profile.id}/${getEmbedEntryFileName(profile)}?v=${hash}`;
};

const renderControls = (env: HubMarkdownEnv, line: number) =>
  `<button type="button" class="hubButton hubEmbedPlay" data-hub-embed-play hidden>${env.icons.render('play', env.file, line)}Play the live scene</button>` +
  `<button type="button" class="hubEmbedPause" data-hub-embed-pause aria-label="Pause the scene" hidden><span class="hubEmbedPauseIcon">${env.icons.render('pause', env.file, line)}</span><span class="hubEmbedPlayIcon">${env.icons.render('play', env.file, line)}</span></button>`;

registerHubDirective('embed', {
  open: (args, { env, line }) => {
    const [id = '', height, ...rest] = args.trim().split(/\s+/);
    const fail = (message: string) => {
      env.diag.error(env.file, line, message);
      return '<figure class="hubEmbed">\n<figcaption class="hubEmbedBody">\n';
    };
    const profile = getEmbedProfile(id);
    if (!profile) {
      const ids = getEmbedProfiles(sbpProfiles).map((embed) => embed.id);
      return fail(
        `::: embed needs an embed profile of sbp.config.ts ("::: embed ${ids[0] ?? 'banner'}"), not "${id}" (it has ${ids.join(', ') || 'none'})`
      );
    }
    if (rest.length) return fail(`::: embed ${id}: unknown arguments "${rest.join(' ')}"`);
    if (height !== undefined && !HEIGHT_REGEX.test(height)) {
      return fail(`::: embed ${id}: the height is a CSS length ("24rem", "60vh"), not "${height}"`);
    }
    if (env.embeds.pages.has(env.page.path)) {
      return fail(`::: embed ${id}: a page has one embed (the engine mounts once per page load)`);
    }
    env.embeds.pages.add(env.page.path);

    env.includes.push(APP_DATA_FILE);
    const scene = findScene(profile.scenes?.[0] ?? '', env, env.diag, env.file, line);
    const poster = scene ? getSceneImageSources(scene, env, env.file, line, POSTER_WIDTHS) : null;
    const stageSize = height
      ? `height: ${height}`
      : poster
        ? `aspect-ratio: ${poster.width} / ${poster.height}`
        : 'aspect-ratio: 16 / 10';
    const posterHtml = poster
      ? `<img class="hubEmbedPoster" src="${poster.src}" srcset="${poster.srcset}" sizes="${POSTER_SIZES}" width="${poster.width}" height="${poster.height}" alt="${escapeHtml(scene?.name ?? id)}, rendered by the engine" decoding="async" data-hub-embed-poster />`
      : '';

    let attrs = '';
    let note = '';
    if (env.embeds.isLive) {
      const url = getEntryUrl(profile, env, line);
      if (url) {
        env.embeds.used.add(profile.id);
        attrs = ` data-hub-embed="${escapeHtml(url)}"${env.mode === 'dev' ? ' data-hub-embed-dev' : ''}`;
      }
    } else {
      note = `<p class="hubEmbedStatus">A still of the scene: this build of the Hub leaves the live embed out.</p>\n`;
    }
    return `<figure class="hubEmbed"${attrs}>\n<div class="hubEmbedStage" style="${stageSize}">${posterHtml}<div class="hubEmbedTarget" data-hub-embed-target></div>${attrs ? renderControls(env, line) : ''}</div>\n<figcaption class="hubEmbedBody">\n${note}<p class="hubEmbedStatus" data-hub-embed-status hidden></p>\n`;
  },
  close: () => '</figcaption>\n</figure>\n',
});

/**
 * `public`: copies each embed the pages show (its `dist-embed/<profile>/`, without the build's
 * `.vite/`) into `<outDir>/_assets/embed/<profile>/`
 */
export const copyHubEmbeds = (state: HubEmbedState, outDir: string) => {
  for (const id of state.used) {
    const source = getEmbedOutDir(id);
    fs.cpSync(source, path.join(outDir, EMBED_URL_DIR, id), {
      recursive: true,
      filter: (file) => path.relative(source, file).split(path.sep)[0] !== EMBED_BUILD_META_DIR,
    });
  }
};
