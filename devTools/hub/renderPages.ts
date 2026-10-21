import type MarkdownIt from 'markdown-it';
import { ASSETS_URL_DIR, type HubStaticAssetHasher } from './assets';
import { isApiPagePath } from './api/model';
import { lineAt, type HubDiagnostics } from './diagnostics';
import type { HubGeneratedSection, HubSlotGenerator } from './generated/section';
import type { HubIcons } from './icons';
import {
  createMarkdownEnv,
  isApiLink,
  renderMarkdown,
  resolveApiLink,
  resolveHubLink,
  type HubMarkdownEnv,
  type HubRenderContext,
} from './markdown';
import { relativeRoot, type HubPageTree } from './pages';
import { resolvePageImage, resolveSceneImageTag, SCENE_IMG_TAG_REGEX } from './scenes';
import { fillSbpPlaceholder } from './sbp';
import type { SbpReportFile } from '../sbp/report';
import { pageHref, PLACEHOLDER_REGEX, type HubMarkupHelpers } from './shell';
import type { HubBuildMode, HubPage } from './types';

/**
 * A build's page bodies (`buildHub`'s render step): each page's markup with its `hub:` and `api:`
 * links resolved and its placeholders filled, its slots filled by their Markdown or by their
 * generated section's generator, then every `hub:` link checked against the pages and their ids.
 */

/** A page's rendered body, with the Markdown env it rendered in (its headings, links, images) */
export type RenderedPage = { page: HubPage; body: string; env: HubMarkdownEnv };

/** `href="hub:…"` and `src="hub:…"` in a page's own markup, and `href="api:…"` */
const HTML_HUB_LINK_REGEX = /\b(href|src)=(["'])((?:hub|api):[^"']*)\2/g;

/** The markup helpers a page's own markup can use (`{{link:…}}` is the shell's: pages use `hub:`) */
const PAGE_HELPERS = ['icon', 'asset', 'sbp'] as const;

/** The markup helpers of a build: `{{icon:…}}`, `{{asset:…}}`, `{{link:…}}`, `{{sbp:…}}` */
export const createMarkupHelpers = (opts: {
  mode: HubBuildMode;
  diag: HubDiagnostics;
  icons: HubIcons;
  tree: HubPageTree | null;
  hashStaticAsset: HubStaticAssetHasher;
  getSbpReport: () => SbpReportFile | null;
}): HubMarkupHelpers => {
  const { mode, diag, icons, tree, hashStaticAsset, getSbpReport } = opts;
  return {
    icon: (name, _root, file, line) => icons.render(name, file, line),
    asset: (assetPath, root, file, line) => {
      const hash = hashStaticAsset(assetPath);
      if (hash) return `${root}${ASSETS_URL_DIR}${assetPath}?v=${hash}`;
      diag.error(file, line, `{{asset:${assetPath}}}: no such file in hub/_assets/`);
      return '';
    },
    link: (sitePath, root, file, line) => {
      const target = tree?.byPath.get(`${sitePath.replace(/^\/+|\/+$/g, '')}/`);
      if (target) return pageHref(root, target);
      diag.error(file, line, `Dead link {{link:${sitePath}}}: no page at hub/pages/${sitePath}/`);
      return '';
    },
    sbp: (ref, _root, file, line) =>
      fillSbpPlaceholder(ref, { mode, report: getSbpReport(), diag, file, line }),
  };
};

/** The page's markup with its `hub:` links resolved, `{{root}}` and its markup helpers filled */
const resolvePageMarkup = (
  markup: string,
  offset: number,
  env: HubMarkdownEnv,
  helpers: HubMarkupHelpers
) => {
  const lineOf = (at: number) => env.page.bodyLine + lineAt(env.page.body, offset + at) - 1;
  /** Links and placeholders in `text`, which starts at `start` in `markup` */
  const resolveText = (text: string, start: number) =>
    text
      .replace(
        HTML_HUB_LINK_REGEX,
        (_match, attr: string, quote: string, href: string, at: number) =>
          `${attr}=${quote}${(isApiLink(href) ? resolveApiLink : resolveHubLink)(href, env, env.page.file, lineOf(start + at))}${quote}`
      )
      .replace(PLACEHOLDER_REGEX, (match, key: string, arg: string | undefined, at: number) => {
        if (arg === undefined) return key === 'root' ? env.root : match;
        if ((PAGE_HELPERS as readonly string[]).includes(key)) {
          return helpers[key as (typeof PAGE_HELPERS)[number]](
            arg,
            env.root,
            env.page.file,
            lineOf(start + at)
          );
        }
        env.diag.error(
          env.page.file,
          lineOf(start + at),
          `Unknown placeholder ${match} (a page has {{root}}, ${PAGE_HELPERS.map((name) => `{{${name}:…}}`).join(', ')})`
        );
        return '';
      });
  // A scene's image (`<img data-aek-scene="…">`) after its own placeholders (its fallback `src`)
  let resolved = '';
  let cursor = 0;
  for (const match of markup.matchAll(SCENE_IMG_TAG_REGEX)) {
    resolved += resolveText(markup.slice(cursor, match.index), cursor);
    const tag = resolveText(match[0], match.index);
    resolved += resolveSceneImageTag(tag, match[1], env, env.page.file, lineOf(match.index));
    cursor = match.index + match[0].length;
  }
  return resolved + resolveText(markup.slice(cursor), cursor);
};

/** A generated slot's key: `issues/#generated-issues` */
const slotKey = (pagePath: string, slotId: string) => `${pagePath}#${slotId}`;

/** Every generated slot's generator, by `slotKey`: the sections' pages' and their child pages' */
const collectSlotGenerators = (sections: HubGeneratedSection[]) => {
  const generators = new Map<string, HubSlotGenerator>();
  for (const section of sections) {
    for (const [id, generate] of Object.entries(section.slots)) {
      generators.set(slotKey(section.path, id), generate);
    }
    for (const page of section.pages) {
      for (const [id, generate] of Object.entries(page.slots)) {
        generators.set(slotKey(page.path, id), generate);
      }
    }
  }
  return generators;
};

/** The page's body with its slots filled by their Markdown, or by their section's generator */
const renderPageBody = (
  page: HubPage,
  env: HubMarkdownEnv,
  md: MarkdownIt,
  helpers: HubMarkupHelpers,
  generators: Map<string, HubSlotGenerator>
) => {
  let body = '';
  let cursor = 0;
  for (const slot of page.slots) {
    body += resolvePageMarkup(page.body.slice(cursor, slot.offset), cursor, env, helpers);
    const generate = slot.isGenerated ? generators.get(slotKey(page.path, slot.id)) : undefined;
    const content = generate
      ? generate(md, env)
      : slot.mdFile
        ? renderMarkdown(md, slot.mdFile, env)
        : '';
    body += `${slot.openTag}\n${content}${slot.closeTag}`;
    cursor = slot.offset + slot.length;
  }
  return body + resolvePageMarkup(page.body.slice(cursor), cursor, env, helpers);
};

/**
 * Renders every page of the tree: each page's `aek:image` first (a `::: cards` shows other pages'
 * images), then the bodies. Returns the pages and the files the images were resolved from.
 */
export const renderHubPages = (opts: {
  tree: HubPageTree;
  sections: HubGeneratedSection[];
  md: MarkdownIt;
  helpers: HubMarkupHelpers;
  context: HubRenderContext;
  diag: HubDiagnostics;
}) => {
  const { tree, md, helpers, context, diag } = opts;
  const generators = collectSlotGenerators(opts.sections);
  const pageImageFiles: string[] = [];
  for (const page of tree.pages) {
    const image = resolvePageImage(page, context, diag);
    page.imageFile = image.file;
    pageImageFiles.push(...image.dependencies);
  }
  const rendered: RenderedPage[] = tree.pages.map((page) => {
    const env = createMarkdownEnv(page, relativeRoot(page.path), diag, context);
    return { page, env, body: renderPageBody(page, env, md, helpers, generators) };
  });
  return { rendered, pageImageFiles };
};

/**
 * A `hub:` link must reach a page, and its `#hash` an id on that page. Without an API model
 * (`areApiPagesUnchecked`), a link to an API page isn't checked: it's there in a full build.
 */
export const checkLinks = (
  rendered: RenderedPage[],
  tree: HubPageTree,
  areApiPagesUnchecked: boolean,
  diag: HubDiagnostics
) => {
  const envs = new Map(rendered.map(({ page, env }) => [page.path, env]));
  for (const { env } of rendered) {
    for (const link of env.links) {
      const target = tree.byPath.get(link.targetPath);
      if (!target && areApiPagesUnchecked && isApiPagePath(link.targetPath)) continue;
      if (!target) {
        diag.error(
          link.file,
          link.line,
          `Dead link ${link.raw}: no page at hub/pages/${link.targetPath}index.html`
        );
      } else if (link.hash && !envs.get(target.path)?.ids.has(link.hash)) {
        diag.error(
          link.file,
          link.line,
          `Dead link ${link.raw}: "${target.title}" has no #${link.hash}`
        );
      }
    }
  }
};
