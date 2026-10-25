import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import { build as viteBuild, type Rollup } from 'vite';
import { getViteAliases } from '../aliases';
import type { ProjectMetadata } from '../projectMetadata';
import type { HubDiagnostics } from './diagnostics';
import { hashContent } from './hash';
import { hubKitKernelPlugin } from './kitKernel';
import {
  HUB_COMPONENTS_FILE,
  HUB_DEV_CLIENT_FILE,
  HUB_DIR,
  HUB_SCSS_ENTRY,
  HUB_STATIC_ASSET_DIRS,
  HUB_TS_DIR,
  isHubStaticAssetFile,
  ROOT,
} from './paths';
import type { HubBuildMode } from './types';

/**
 * The Hub's own assets: `hub.scss` through sass, the TS entries in `hub/_assets/ts/` through
 * Vite's `build()` (ES modules, fixed entry names, hashed shared chunks), and the static folders
 * copied as they are. Entries keep fixed names (`_assets/hub.css`) and get `?v=<hash>` where
 * they're referenced.
 */

export type HubAssetFile = {
  /** From the site root: `_assets/hub.js` */
  outPath: string;
  content: string | Buffer;
  hash: string;
};

/** The built and static assets' folder from the site root */
export const ASSETS_URL_DIR = '_assets/';

/**
 * A static asset's `?v=` hash, from its path in `_assets/`
 * (`fonts/ibm-plex-sans-latin-wght-normal.woff2`), or null when it isn't a file in one of the
 * static folders. `_headers` caches `_assets/*` as
 * immutable, so every reference to one carries its hash, like the built assets'.
 */
export type HubStaticAssetHasher = (assetPath: string) => string | null;

/**
 * The static assets' hashes across builds, by the file's size, mtime and ctime: the dev server's
 * rebuilds read a font or an image again only when it changed (p619 D16)
 */
const knownHashes = new Map<string, { stamp: string; hash: string }>();

/**
 * A build's static asset hasher: each path read once per build, its hash kept across builds while
 * its file stamp holds
 */
export const createStaticAssetHasher = (): HubStaticAssetHasher => {
  const hashes = new Map<string, string | null>();
  return (assetPath) => {
    if (hashes.has(assetPath)) return hashes.get(assetPath) ?? null;
    const [dir, ...rest] = assetPath.split('/');
    const sourceDir = Object.prototype.hasOwnProperty.call(HUB_STATIC_ASSET_DIRS, dir)
      ? HUB_STATIC_ASSET_DIRS[dir]
      : null;
    const file = sourceDir && path.join(sourceDir, ...rest);
    const stat =
      file && !rest.includes('..') && isHubStaticAssetFile(file)
        ? fs.statSync(file, { throwIfNoEntry: false })
        : undefined;
    let hash: string | null = null;
    if (file && stat?.isFile()) {
      const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const known = knownHashes.get(file);
      hash = known?.stamp === stamp ? known.hash : hashContent(fs.readFileSync(file));
      knownHashes.set(file, { stamp, hash });
    }
    hashes.set(assetPath, hash);
    return hash;
  };
};

/** `url(fonts/…)` in the CSS: relative to `_assets/hub.css`, so a static asset's path as is */
const CSS_URL_REGEX = /url\(\s*(['"]?)([^'")?#]+)\1\s*\)/g;

/** The stylesheet and the files sass read for it */
export type HubBuiltStyles = {
  file: HubAssetFile;
  /**
   * Every file sass loaded, the engine's `tokens.css` among them (p801 Phase 5): the dev plugin
   * watches the ones outside `hub/`, which `hub/`'s own watch doesn't see
   */
  sources: string[];
};

/**
 * Compiles `hub.scss` (compressed in `public`), giving each `url()` to a static asset its `?v=`;
 * null with an error at its line when sass fails
 */
export const buildStyles = (
  mode: HubBuildMode,
  diag: HubDiagnostics,
  hashStaticAsset: HubStaticAssetHasher
): HubBuiltStyles | null => {
  try {
    const compiled = sass.compile(HUB_SCSS_ENTRY, {
      style: mode === 'public' ? 'compressed' : 'expanded',
    });
    const css = compiled.css.replace(CSS_URL_REGEX, (match, quote: string, url: string) => {
      if (/^(data:|[a-z]+:|\/)/i.test(url)) return match;
      const hash = hashStaticAsset(url);
      if (hash) return `url(${quote}${url}?v=${hash}${quote})`;
      diag.error(HUB_SCSS_ENTRY, undefined, `${match}: no such file in hub/_assets/`);
      return match;
    });
    return {
      file: { outPath: `${ASSETS_URL_DIR}hub.css`, content: css, hash: hashContent(css) },
      sources: compiled.loadedUrls
        .filter((url) => url.protocol === 'file:')
        .map((url) => fileURLToPath(url)),
    };
  } catch (err) {
    if (err instanceof sass.Exception) {
      const url = err.span.url;
      const file = url?.protocol === 'file:' ? fileURLToPath(url) : HUB_SCSS_ENTRY;
      diag.error(file, err.span.start.line + 1, err.sassMessage);
    } else {
      diag.error(HUB_SCSS_ENTRY, undefined, (err as Error).message);
    }
    return null;
  }
};

/** The TS entries: every `.ts` directly in `hub/_assets/ts/`, except `_*.ts` and `.d.ts` */
const listScriptEntries = () =>
  fs.existsSync(HUB_TS_DIR)
    ? fs
        .readdirSync(HUB_TS_DIR)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.startsWith('_'))
        .map((name) => path.join(HUB_TS_DIR, name))
    : [];

type RollupErrorLike = Error & { loc?: { file?: string; line?: number }; id?: string };

/** The dev client's output: `dev` builds load it on every page */
export const HUB_DEV_CLIENT_OUT_PATH = `${ASSETS_URL_DIR}hub-dev.js`;

/**
 * The modules only a `dev` build may bundle: the dev client, and the component library
 * (`_components.ts`, p802 D9), which `hub.ts` imports behind `__HUB_DEV__`. A `public` build with
 * one of them is an error (`buildScripts`).
 */
const DEV_ONLY_SCRIPT_MODULES = [HUB_DEV_CLIENT_FILE, HUB_COMPONENTS_FILE];

/** The scripts, and the files outside `hub/` they were built from */
export type HubBuiltScripts = {
  files: HubAssetFile[];
  /**
   * Each bundled module's file outside `hub/` (the UI kit's, p802 Phase 4): the dev plugin
   * watches them, which `hub/`'s own watch doesn't see
   */
  sources: string[];
};

/** A bundled module's id as a file: without a query, null for a virtual module */
const toModuleFile = (id: string) => (id.startsWith('\0') ? null : id.replace(/\?.*$/, ''));

/**
 * Bundles the TS entries (and the dev client in `dev`) with Vite's `build()`, unwritten; null with
 * an error when it fails. The entries can import the `aekasha*` entries (the component library's
 * `aekasha/ui`): the aliases, the engine's `define`s (`__AEK_DEBUG__` false, as in a production
 * build), the kit's scss modules through Vite's CSS handling (a chunk's CSS next to it), and the
 * kit's kernel import resolved to the Hub's stand-in (`kitKernel.ts`). `__HUB_DEV__` is the Hub's
 * own: true in `dev`, so a `public` build drops what it guards.
 */
export const buildScripts = async (
  mode: HubBuildMode,
  diag: HubDiagnostics,
  meta: ProjectMetadata
): Promise<HubBuiltScripts | null> => {
  const input = Object.fromEntries(
    listScriptEntries().map((file) => [path.basename(file, '.ts'), file])
  );
  if (mode === 'dev') input[path.basename(HUB_DEV_CLIENT_OUT_PATH, '.js')] = HUB_DEV_CLIENT_FILE;
  if (!Object.keys(input).length) return { files: [], sources: [] };
  try {
    const result = await viteBuild({
      configFile: false,
      root: HUB_DIR,
      // Relative: a lazy chunk's CSS is loaded from `import.meta.url`, so the Hub works at any
      // path (the default `/` would load `/_assets/…` from the domain root)
      base: './',
      mode: 'production',
      logLevel: 'warn',
      publicDir: false,
      resolve: { alias: getViteAliases(ROOT) },
      define: {
        __AEK_DEBUG__: 'false',
        __PROJECT_METADATA__: JSON.stringify(meta),
        __HUB_DEV__: JSON.stringify(mode === 'dev'),
      },
      plugins: [hubKitKernelPlugin()],
      build: {
        write: false,
        minify: mode === 'public',
        target: 'es2021',
        modulePreload: false,
        reportCompressedSize: false,
        copyPublicDir: false,
        rollupOptions: {
          input,
          preserveEntrySignatures: 'strict',
          output: {
            format: 'es',
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            assetFileNames: 'chunks/[name]-[hash][extname]',
          },
        },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
    const items = outputs.flatMap(({ output }) => output);
    const moduleFiles = new Set(
      items.flatMap((item) => (item.type === 'chunk' ? item.moduleIds : [])).map(toModuleFile)
    );
    if (mode === 'public') {
      const devOnly = DEV_ONLY_SCRIPT_MODULES.filter((file) => moduleFiles.has(file));
      for (const file of devOnly) {
        diag.error(file, undefined, 'A dev-only script module is in the public build');
      }
      if (devOnly.length) return null;
    }
    return {
      files: items.map((item) => {
        const content = item.type === 'chunk' ? item.code : Buffer.from(item.source);
        return { outPath: ASSETS_URL_DIR + item.fileName, content, hash: hashContent(content) };
      }),
      sources: [...moduleFiles].filter(
        (file): file is string =>
          !!file && path.isAbsolute(file) && !file.startsWith(HUB_DIR + path.sep)
      ),
    };
  } catch (err) {
    const { loc, id, message } = err as RollupErrorLike;
    diag.error(loc?.file ?? id ?? HUB_TS_DIR, loc?.line, message);
    return null;
  }
};

/** Copies the static folders (`HUB_STATIC_ASSET_DIRS`) into `<outDir>/_assets/<name>/` */
export const copyStaticAssets = (outDir: string) => {
  for (const [name, source] of Object.entries(HUB_STATIC_ASSET_DIRS)) {
    if (!fs.existsSync(source)) continue;
    // Licence files go too: the icons' and fonts' licences ask to ship with them
    fs.cpSync(source, path.join(outDir, ASSETS_URL_DIR, name), {
      recursive: true,
      filter: isHubStaticAssetFile,
    });
  }
};
