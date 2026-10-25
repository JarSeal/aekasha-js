import path from 'node:path';
import { ROOT, SRC_DIR } from '../paths';

/** The repo root (`devTools/paths.ts`') */
export { ROOT };

/** The Hub's sources */
export const HUB_DIR = path.join(ROOT, 'hub');
/** The site settings (a Vite config dependency: a change restarts the dev server) */
export const HUB_CONFIG_FILE = path.join(HUB_DIR, 'hub.config.ts');
/** The pages: one folder per URL */
export const HUB_PAGES_DIR = path.join(HUB_DIR, 'pages');
const HUB_LAYOUT_DIR = path.join(HUB_DIR, '_layout');
/** The frame every page goes into */
export const HUB_SHELL_FILE = path.join(HUB_LAYOUT_DIR, 'shell.html');
/** The 404 page's body, put into the shell like a page's */
export const HUB_NOT_FOUND_FILE = path.join(HUB_LAYOUT_DIR, '404.html');
/** The SCSS, the TS, and the static folders */
export const HUB_ASSETS_DIR = path.join(HUB_DIR, '_assets');
/** The stylesheet's entry: `_assets/hub.css` */
export const HUB_SCSS_ENTRY = path.join(HUB_ASSETS_DIR, 'scss', 'hub.scss');
/** Every `.ts` file directly in it (not `_*.ts`) is an entry, built to `_assets/<name>.js` */
export const HUB_TS_DIR = path.join(HUB_ASSETS_DIR, 'ts');
/** Dev builds only: the dev plugin's client, built to `_assets/hub-dev.js` */
export const HUB_DEV_CLIENT_FILE = path.join(HUB_TS_DIR, '_devClient.ts');
/**
 * Dev builds only: the component library (p802 D9), a chunk `hub.ts` imports behind `__HUB_DEV__`
 * on a page with `[data-hub-components]`
 */
export const HUB_COMPONENTS_FILE = path.join(HUB_TS_DIR, '_components.ts');
/** The icons, also inlined into the pages (`devTools/hub/icons.ts`) */
export const HUB_ICONS_DIR = path.join(HUB_ASSETS_DIR, 'icons');
/**
 * The UI kit's fonts (p801 D8): the Hub's `_assets/fonts/` are the engine's files, which
 * `_base.scss`' `@font-face` rules name (`fonts.test.ts` checks they match `fonts.css`')
 */
export const ENGINE_FONTS_DIR = path.join(SRC_DIR, '_engine', 'ui', 'fonts');
/**
 * Copied as they are into `_assets/<name>/`, each from its folder: `hub/_assets/<name>/`, the
 * fonts from the engine (`isHubStaticAssetFile` leaves its stylesheet and entry out)
 */
export const HUB_STATIC_ASSET_DIRS: Record<string, string> = {
  icons: HUB_ICONS_DIR,
  fonts: ENGINE_FONTS_DIR,
  images: path.join(HUB_ASSETS_DIR, 'images'),
};
/** A static folder's file the Hub copies and serves: not the engine fonts folder's CSS and TS */
export const isHubStaticAssetFile = (file: string) => !/\.(css|ts)$/.test(file);
/** The static folder a file is in, by its name, or null */
export const getHubStaticAssetDir = (file: string) =>
  Object.entries(HUB_STATIC_ASSET_DIRS).find(([, dir]) => file.startsWith(dir + path.sep))?.[0] ??
  null;

/** The outputs */
export const HUB_DEV_OUT_DIR = path.join(ROOT, '.cache', 'hub', 'dev');
/** Where the dev plugin serves `HUB_DEV_OUT_DIR` */
export const HUB_DEV_URL_BASE = '/hub/';
/** `yarn hub:build`'s default output */
export const HUB_DIST_DIR = path.join(ROOT, 'dist-hub');
/** The app's build: `AEK_HUB_IN_DIST=true` copies the Hub into its `hub/` */
export const APP_DIST_DIR = path.join(ROOT, 'dist');

/** The versions and packages (`getProjectMetadata`) */
export const PACKAGE_JSON_FILE = path.join(ROOT, 'package.json');

/** The TypeScript config: its `typedocOptions` are the API docs' entry points */
export const TSCONFIG_FILE = path.join(ROOT, 'tsconfig.json');
/** The API model's cache: TypeDoc's JSON and the hash of its inputs */
export const HUB_API_CACHE_FILE = path.join(ROOT, '.cache', 'hub', 'typedoc.json');

/** The generated sections' sources */
export const ISSUES_DIR = path.join(ROOT, 'docs', 'issues');
/** The Version section's changelog */
export const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');

/** The Hub's own favicons (the app's glyph in the Hub's accent), copied to the Hub's root */
export const FAVICON_FILES = ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png'].map((name) =>
  path.join(HUB_ASSETS_DIR, 'favicons', name)
);

/** The output folder for a page's Markdown images: `_assets/images/pages/<page path>` */
export const PAGE_IMAGES_URL_DIR = '_assets/images/pages/';

/** The app's scenes: the generated data lists them, a scene file's path is from `src/app/` */
export const APP_DATA_FILE = path.join(ROOT, 'src', 'generated', 'generatedAppData.json');
/** The app's sources: a scene's `sceneFile` is relative to it */
export const APP_SRC_DIR = path.join(ROOT, 'src', 'app');
/** The output folder for the scenes' Hub images: `_assets/images/scenes/<sceneId>-<width>.webp` */
export const SCENE_IMAGES_URL_DIR = '_assets/images/scenes/';

/** A path from the repo root with forward slashes, for messages */
export const toRepoPath = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
