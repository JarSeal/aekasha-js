/* eslint-disable no-console */
/**
 * An embed profile's build (p611 D7): `vite build` with `AEK_EMBED_PROFILE=<id>` builds the
 * profile's entry module (`sbp.config.ts`) into `dist-embed/<id>/` instead of the app:
 *
 * - The entry at the folder's root, without a hash (`banner.embed.js`), so a site imports a stable
 *   URL and the entry's `import.meta.url` is the folder (its `assetBaseUrl`); every other file in
 *   `assets/`. `base: './'`: the files find each other relative to the entry, wherever it's served.
 * - ES chunks, workers and decoders as files, minified, as the app's build. Not Vite's library
 *   mode: it inlines every `new URL` file as base64 (the assets worker's GLTF job grows from 148 kB
 *   to 2.7 MB with the Draco and Basis decoders in it) and doesn't minify ES output (p611 Phase 4's
 *   comparison).
 * - No `src/public/` copy (433 MB): the plugin copies only the files the profile's data names
 *   (`__url`s), and the Basis transcoder or the Draco decoder when its data can load a KTX2
 *   texture or a model.
 * - The entry's CSS: Vite emits it but nothing loads it (a JS entry has no HTML to link it from),
 *   so the plugin prepends a `<link>` to the entry chunk.
 * - Pruned: Vite emits a worker, a `?url` or a `new URL` file when it loads the module naming it,
 *   before tree-shaking, so a profile without physics still gets the physics worker and Rapier.
 *   After the build, every file no kept file names (a crawl from the entry through the files'
 *   text) is removed, and listed in `.vite/aek-pruned.json`.
 */
import fs from 'fs';
import path from 'path';
import type { Plugin, UserConfig } from 'vite';
import sbpProfiles from '../../sbp.config';
import { ROOT } from '../assetPipeline/sources';
import { collectUrls } from '../assetOutputsBuildPlugin';
import { getEmbedProfiles } from '../gatherOutput';
import type { BuildLocation } from './bundleModel';
import type { SbpProfile } from './config';
import { getEmbedEntryFileName, getEmbedOutDir } from './embedPaths';

/** The profile `vite build` builds instead of the app */
export const EMBED_PROFILE_ENV = 'AEK_EMBED_PROFILE';
const PUBLIC_DIR = path.join(ROOT, 'src/public');
/** The files the prune removed, next to the manifest */
export const PRUNED_FILE_NAME = 'aek-pruned.json';

/** The visualizer's report of an embed build */
export const getEmbedStatsFile = (id: string) =>
  path.join(ROOT, 'dist-stats', `embed-${id}`, 'bundle-stats.html');
/** Where `collectBundle` measures an embed's build: every file of its folder */
export const getEmbedBuildLocation = (id: string): BuildLocation => ({
  outDir: getEmbedOutDir(id),
  statsFile: getEmbedStatsFile(id),
  isAssetsOnly: false,
});
/** The profile's generated data (`devTools/gatherOutput.ts`) */
export const getEmbedDataFile = (id: string) =>
  path.join(ROOT, 'src/generated/profiles', id, 'generatedAppData.json');

/** The embed profile `AEK_EMBED_PROFILE` names; null without it */
export const getEmbedProfileFromEnv = (): SbpProfile | null => {
  const id = process.env[EMBED_PROFILE_ENV];
  if (!id) return null;
  const profile = getEmbedProfiles(sbpProfiles).find((p) => p.id === id);
  if (!profile) {
    throw new Error(
      `${EMBED_PROFILE_ENV}=${id}: no embed profile ${id} in sbp.config.ts (${getEmbedProfiles(
        sbpProfiles
      )
        .map((p) => p.id)
        .join(', ')})`
    );
  }
  return profile;
};

/** The app config's overrides for an embed profile's build */
export const getEmbedBuildConfig = (profile: SbpProfile): UserConfig => ({
  base: './',
  publicDir: false,
  build: {
    outDir: getEmbedOutDir(profile.id),
    emptyOutDir: true,
    rollupOptions: {
      input: { [path.basename(profile.entry, '.ts')]: path.join(ROOT, profile.entry) },
      // The entry's exports are its API (`mount`)
      preserveEntrySignatures: 'exports-only',
      output: { entryFileNames: '[name].js' },
    },
  },
});

/** Every file under a folder, as paths relative to it with `/`, `.vite/` left out */
const listFiles = (dir: string, prefix = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      return rel === '.vite' ? [] : listFiles(path.join(dir, rel), `${rel}/`);
    return [rel];
  });

const TEXT_FILE = /\.(js|mjs|css)$/;

/**
 * The files reachable from the roots: a text file (JS, CSS) reaches every file whose name it
 * contains. A name is only in code that ships (a tree-shaken importer leaves none), so what isn't
 * reached is never loaded.
 * @param files every file of the build (relative paths)
 * @param read a text file's content
 */
export const findReachableFiles = (
  roots: string[],
  files: string[],
  read: (file: string) => string
) => {
  const byName = new Map(files.map((file) => [path.posix.basename(file), file]));
  const reached = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    if (!TEXT_FILE.test(file)) continue;
    const text = read(file);
    for (const [name, other] of byName) {
      if (!reached.has(other) && text.includes(name)) queue.push(other);
    }
  }
  return reached;
};

/** Copies a file or folder from `src/public/` into the build, when it's there */
const copyFromPublic = (rel: string, outDir: string) => {
  const from = path.join(PUBLIC_DIR, rel);
  if (!fs.existsSync(from)) return false;
  fs.cpSync(from, path.join(outDir, rel), { recursive: true });
  return true;
};

/** The entry's CSS link, prepended to the entry chunk: the `<link>`s it loads before it runs */
const formatCssLinks = (hrefs: string[]) =>
  `for(const h of ${JSON.stringify(hrefs)}){const l=document.createElement("link");l.rel="stylesheet";l.href=new URL(h,import.meta.url).href;document.head.appendChild(l)}\n`;

/** The embed build's plugin: the entry's CSS, the data's files, the prune (see the file's header) */
export const embedOutputsPlugin = (profile: SbpProfile): Plugin => {
  const outDir = getEmbedOutDir(profile.id);
  const entryFile = getEmbedEntryFileName(profile);
  return {
    name: 'vite-plugin-aek-embed-outputs',
    apply: 'build',
    generateBundle(_, bundle) {
      const entry = bundle[entryFile];
      if (!entry || entry.type !== 'chunk') {
        this.error(`The embed's entry ${entryFile} isn't in the bundle`);
        return;
      }
      // The CSS of the entry and of the chunks it imports statically (loaded with it)
      const css = new Set<string>();
      const seen = new Set<string>();
      const queue = [entryFile];
      while (queue.length) {
        const name = queue.pop()!;
        const chunk = bundle[name];
        if (seen.has(name) || !chunk || chunk.type !== 'chunk') continue;
        seen.add(name);
        for (const file of chunk.viteMetadata?.importedCss ?? []) css.add(file);
        queue.push(...chunk.imports);
      }
      if (css.size) entry.code = formatCssLinks([...css].map((file) => `./${file}`)) + entry.code;
    },
    closeBundle() {
      // The data's files, and the decoders it can need
      const data: unknown = JSON.parse(fs.readFileSync(getEmbedDataFile(profile.id), 'utf-8'));
      const urls = new Set<string>();
      collectUrls(data, urls);
      const missing = [...urls].filter((url) => !copyFromPublic(url.replace(/^\/+/, ''), outDir));
      if (missing.length) {
        throw new Error(
          `The profile's data names files src/public/ doesn't have: ${missing.join(', ')}`
        );
      }
      const decoders = [
        ...([...urls].some((url) => url.endsWith('.ktx2')) ? ['basis'] : []),
        ...(JSON.stringify(data).includes('"importedAssets"') ? ['draco'] : []),
      ];
      for (const dir of decoders) {
        if (!copyFromPublic(dir, outDir))
          throw new Error(`No src/public/${dir}/: yarn copyDecoders`);
      }

      // The prune: the entry, its static imports' CSS (linked above) and the copied files are
      // the roots
      const files = listFiles(outDir);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(outDir, '.vite/manifest.json'), 'utf-8')
      ) as Record<string, { file: string; isEntry?: boolean; css?: string[] }>;
      const roots = Object.values(manifest)
        .filter((chunk) => chunk.isEntry)
        .flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]);
      for (const file of files) {
        if (!file.startsWith('assets/')) roots.push(file);
      }
      const reached = findReachableFiles(roots, files, (file) =>
        fs.readFileSync(path.join(outDir, file), 'utf-8')
      );
      const pruned = files.filter((file) => !reached.has(file)).sort();
      for (const file of pruned) fs.rmSync(path.join(outDir, file));
      fs.writeFileSync(
        path.join(outDir, '.vite', PRUNED_FILE_NAME),
        `${JSON.stringify(pruned, null, 2)}\n`
      );
      console.log(
        `\x1b[32m✓ [Embed] ${path.relative(ROOT, outDir)}/: ${reached.size} file(s)${urls.size ? `, ${urls.size} from the data` : ''}${decoders.length ? `, ${decoders.join(' and ')}` : ''}; pruned ${pruned.length} no shipped code names\x1b[0m`
      );
    },
  };
};
