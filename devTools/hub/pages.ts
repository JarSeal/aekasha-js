import fs from 'node:fs';
import path from 'node:path';
import { lineAt, type HubDiagnostics } from './diagnostics';
import type { HubGeneratedSection } from './generated/section';
import { decodeEntities, parseAttributes } from './html';
import { HUB_PAGES_DIR } from './paths';
import type { HubPage, HubSlot } from './types';

/**
 * Finds the Hub's pages: every folder under `hub/pages/` with an `index.html` is one, at the URL
 * path of its folder. Reads each one's head metadata and body slots, and builds the
 * page tree (children by `aek:order`, then title). A generated section's pages join the tree
 * here, and the slots its generator fills are marked. A page with `aek:dev` and every page under
 * it are dev only (p802 D1): `removeDevPages` takes them out of a `public` build's tree.
 */

const PAGE_FILE = 'index.html';

/** The `<meta name>`s a page can set; any other `aek:` name is a typo */
const META_NAMES = [
  'aek:menu',
  'aek:order',
  'aek:tags',
  'aek:description',
  'aek:icon',
  'aek:featured',
  'aek:image',
  'aek:group',
  'aek:covers',
  'aek:dev',
];

/** An empty element with an `id`: `<div id="setup"></div>` (whitespace inside is fine) */
const SLOT_REGEX = /<([a-zA-Z][\w-]*)(\s[^>]*?)?>\s*<\/\1\s*>/g;

/** The discovered pages (`discoverPages`): the homepage, every page, by path, and the files read */
export type HubPageTree = {
  /** The homepage */
  root: HubPage;
  /** Every page, parents before children and siblings in menu order */
  pages: HubPage[];
  byPath: Map<string, HubPage>;
  /** Every source file the pages read (their `index.html`s and `.md`s) */
  files: string[];
  /**
   * The dev pages `removeDevPages` took out (a `public` build's), by path: a link to one is told
   * apart from a dead one
   */
  removedDevPaths: Set<string>;
};

const toUrlPath = (dir: string) => {
  const relative = path.relative(HUB_PAGES_DIR, dir).split(path.sep).join('/');
  return relative ? `${relative}/` : '';
};

const findSlots = (html: string, body: string, bodyOffset: number, dir: string) => {
  const slots: HubSlot[] = [];
  for (const match of body.matchAll(SLOT_REGEX)) {
    const id = parseAttributes(match[2] ?? '').id;
    if (!id) continue;
    const mdFile = path.join(dir, `${id}.md`);
    const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
    slots.push({
      id,
      openTag,
      closeTag: `</${match[1]}>`,
      offset: match.index,
      length: match[0].length,
      line: lineAt(html, bodyOffset + match.index),
      mdFile: fs.existsSync(mdFile) ? mdFile : null,
      isGenerated: false,
    });
  }
  return slots;
};

const parsePage = (dir: string, diag: HubDiagnostics): HubPage | null => {
  const file = path.join(dir, PAGE_FILE);
  const html = fs.readFileSync(file, 'utf-8');

  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (!bodyMatch) {
    diag.error(file, undefined, 'No <body>…</body>: the page has nothing to show');
    return null;
  }
  const head = headMatch?.[1] ?? '';
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = decodeEntities(titleMatch?.[1] ?? '').trim();
  if (!title)
    diag.error(file, 1, 'No <title>: every page needs one (the menu label defaults to it)');

  const meta: Record<string, string> = {};
  for (const match of head.matchAll(/<meta\s([^>]*)>/gi)) {
    const { name, content } = parseAttributes(match[1]);
    if (!name?.startsWith('aek:')) continue;
    const line = lineAt(html, (headMatch?.index ?? 0) + match.index);
    if (!META_NAMES.includes(name)) {
      diag.warn(file, line, `Unknown <meta name="${name}"> (known: ${META_NAMES.join(', ')})`);
      continue;
    }
    meta[name] = (content ?? '').trim();
  }

  const dev = meta['aek:dev'];
  if (dev !== undefined && dev !== 'true') {
    diag.warn(file, undefined, `aek:dev is "true" or left out, not "${dev}": the page is public`);
  }

  const order = meta['aek:order'] ? Number(meta['aek:order']) : 0;
  if (!Number.isFinite(order)) {
    diag.error(file, undefined, `aek:order must be a number, not "${meta['aek:order']}"`);
  }

  const bodyOffset = bodyMatch.index + bodyMatch[0].indexOf('>') + 1;
  const body = bodyMatch[1];
  const slots = findSlots(html, body, bodyOffset, dir);

  return {
    path: toUrlPath(dir),
    dir,
    file,
    title: title || path.basename(dir),
    menu: meta['aek:menu'] || title || path.basename(dir),
    order: Number.isFinite(order) ? order : 0,
    tags: (meta['aek:tags'] ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    description: meta['aek:description'] ?? '',
    icon: meta['aek:icon'] ?? '',
    isFeatured: meta['aek:featured'] === 'true',
    image: meta['aek:image'] ?? '',
    imageFile: null,
    group: meta['aek:group'] ?? '',
    covers: (meta['aek:covers'] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    isDev: dev === 'true',
    isGenerated: false,
    isInMenu: true,
    isSearchable: true,
    body,
    bodyLine: lineAt(html, bodyOffset),
    slots,
    parent: null,
    children: [],
  };
};

/**
 * Every `.md` in the page's folder needs a slot that isn't generated, and every slot should have
 * an `.md` or a generator
 */
const checkSlots = (page: HubPage, diag: HubDiagnostics) => {
  if (page.isGenerated) return; // Its folder is its source's, and its generator fills its slots
  const slots = new Map(page.slots.map((slot) => [slot.id, slot]));
  for (const name of fs.readdirSync(page.dir)) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -'.md'.length);
    const slot = slots.get(id);
    if (!slot) {
      diag.error(
        path.join(page.dir, name),
        1,
        `No slot for it: add an empty element with id="${id}" to ${PAGE_FILE}'s <body>`
      );
    } else if (slot.isGenerated) {
      diag.error(
        path.join(page.dir, name),
        1,
        `Slot "${id}" is filled by its section's generator: rename the slot or the file`
      );
    }
  }
  for (const slot of page.slots) {
    if (!slot.mdFile && !slot.isGenerated) {
      diag.warn(page.file, slot.line, `Slot "${slot.id}" has no ${slot.id}.md: it stays empty`);
    }
  }
};

/** The folders under `dir`, depth first, `_`- and `.`-prefixed ones left out */
const listDirs = (dir: string): string[] => {
  const dirs = [dir];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || /^[_.]/.test(entry.name)) continue;
    dirs.push(...listDirs(path.join(dir, entry.name)));
  }
  return dirs;
};

/** Marks the slots a generated section fills on its page, and adds its pages to `byPath` */
const attachSection = (
  section: HubGeneratedSection,
  byPath: Map<string, HubPage>,
  diag: HubDiagnostics
) => {
  const page = byPath.get(section.path);
  if (!page) {
    diag.error(
      path.join(HUB_PAGES_DIR, section.path, PAGE_FILE),
      undefined,
      `The generated section /${section.path} needs its page here`
    );
    return;
  }
  for (const id of Object.keys(section.slots)) {
    const slot = page.slots.find((s) => s.id === id);
    if (slot) slot.isGenerated = true;
    else {
      diag.error(
        page.file,
        undefined,
        `No slot for the generated "${id}": add an empty element with id="${id}" to its <body>`
      );
    }
  }
  for (const generated of section.pages) {
    if (byPath.has(generated.path)) {
      diag.error(
        generated.file,
        undefined,
        `Its page's URL /${generated.path} is taken by hub/pages/${generated.path}${PAGE_FILE}`
      );
      continue;
    }
    const dir = path.dirname(generated.file);
    const slots = findSlots(generated.body, generated.body, 0, dir).map((slot) => ({
      ...slot,
      mdFile: null,
      isGenerated: slot.id in generated.slots,
    }));
    byPath.set(generated.path, {
      path: generated.path,
      dir,
      file: generated.file,
      title: generated.title,
      menu: generated.menu,
      order: generated.order ?? 0,
      tags: generated.tags,
      description: generated.description,
      icon: '',
      isFeatured: false,
      image: '',
      imageFile: null,
      group: '',
      covers: [],
      isDev: false,
      isGenerated: true,
      isInMenu: generated.isInMenu,
      isSearchable: generated.isSearchable ?? true,
      body: generated.body,
      bodyLine: 1,
      slots,
      parent: null,
      children: [],
    });
  }
};

const sortPages = (pages: HubPage[]) =>
  pages.sort((a, b) => a.order - b.order || a.menu.localeCompare(b.menu));

/**
 * Finds the pages under `hub/pages/` and the generated sections' pages; null, with an error,
 * without a homepage
 */
export const discoverPages = (
  diag: HubDiagnostics,
  sections: HubGeneratedSection[] = []
): HubPageTree | null => {
  if (!fs.existsSync(path.join(HUB_PAGES_DIR, PAGE_FILE))) {
    diag.error(path.join(HUB_PAGES_DIR, PAGE_FILE), undefined, 'The homepage is missing');
    return null;
  }

  const byPath = new Map<string, HubPage>();
  const files: string[] = [];
  for (const dir of listDirs(HUB_PAGES_DIR)) {
    const names = fs.readdirSync(dir);
    if (!names.includes(PAGE_FILE)) {
      for (const name of names.filter((n) => n.endsWith('.md'))) {
        diag.error(path.join(dir, name), 1, `Its folder has no ${PAGE_FILE}, so it's no page's`);
      }
      continue;
    }
    const page = parsePage(dir, diag);
    if (!page) continue;
    byPath.set(page.path, page);
    files.push(page.file, ...names.filter((n) => n.endsWith('.md')).map((n) => path.join(dir, n)));
  }

  const root = byPath.get('');
  if (!root) return null;
  for (const section of sections) attachSection(section, byPath, diag);
  for (const page of byPath.values()) {
    if (page === root) continue;
    const parentPath = page.path.replace(/[^/]+\/$/, '');
    const parent = byPath.get(parentPath);
    if (!parent) {
      diag.error(
        page.file,
        undefined,
        `No parent page: hub/pages/${parentPath}${PAGE_FILE} is missing, so the menu can't reach it`
      );
      continue;
    }
    page.parent = parent;
    parent.children.push(page);
  }

  const pages: HubPage[] = [];
  const walk = (page: HubPage) => {
    // A dev page's children are dev too: in `public`, a public one would have lost its parent
    if (page.parent?.isDev) page.isDev = true;
    if (page.isGenerated && page.isDev) {
      diag.error(
        page.file,
        undefined,
        `The generated page /${page.path} is under a dev-only page (aek:dev): a generated section's pages are public`
      );
    }
    pages.push(page);
    checkSlots(page, diag);
    sortPages(page.children).forEach(walk);
  };
  if (root.isDev) diag.error(root.file, undefined, 'The homepage can’t be dev only (aek:dev)');
  root.isDev = false;
  walk(root);

  return { root, pages, byPath, files, removedDevPaths: new Set() };
};

/**
 * Takes the dev pages (`aek:dev` and every page under one) out of the tree, its page list and
 * their parents' children, for a `public` build (p802 D1): run after the CLAUDE.md coverage check,
 * which counts them (D4). Records their paths in `removedDevPaths`.
 */
export const removeDevPages = (tree: HubPageTree) => {
  for (const page of tree.pages) {
    if (!page.isDev) continue;
    tree.byPath.delete(page.path);
    tree.removedDevPaths.add(page.path);
  }
  tree.pages = tree.pages.filter((page) => !page.isDev);
  for (const page of tree.pages) page.children = page.children.filter((child) => !child.isDev);
};

/** The page and its ancestors, from the homepage down */
export const getPageTrail = (page: HubPage) => {
  const trail: HubPage[] = [];
  for (let p: HubPage | null = page; p; p = p.parent) trail.unshift(p);
  return trail;
};

/** A link from one page (or the root, '') to another site path: `../../features/`, `./` */
export const relativeRoot = (fromPath: string) =>
  fromPath ? '../'.repeat(fromPath.split('/').length - 1) : './';

/** The page's top-level section's path ('' for the homepage): its search group and its styles */
export const getPageSection = (page: HubPage) => {
  let top = page;
  while (top.parent?.parent) top = top.parent;
  return top.parent ? top.path : '';
};
