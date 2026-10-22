import type { EntryName } from '../../aliases';
import type { ApiEntryIndex, EntryProblem } from './entries';
import {
  API_SECTION_PATH,
  getOwnMembers,
  isDocumented,
  Kind,
  type ApiModule,
  type ApiSubtree,
  type ApiTarget,
  type Coverage,
  type DeclarationReflection,
} from './model';

/**
 * The API reference's pages (p619 D6): one per public entry at its import specifier
 * (`documentation/aekasha/physics/`), with a section per source module and each name the entry
 * exports as a symbol there. Internal exports have no page.
 *
 * An entry over `MAX_ENTRY_PAGE_NAMES` names (`aekasha`) gets a page per source folder below it
 * (`documentation/aekasha/scene/` for `kernel/scene/`), and its own page lists them. An entry
 * whose specifier's parent isn't an entry (`aekasha/toolkit/ecs`) gets a page listing it and its
 * siblings (`documentation/aekasha/toolkit/`). A name on two entries (the toolkit's deprecated
 * `createSeededRandom`) is documented on the first, and the second lists it as a re-export.
 */

/** Over this many names, an entry's page lists its folders, each a page of its own */
const MAX_ENTRY_PAGE_NAMES = 150;

/** A name an entry exports, where it's listed */
export type PublicSymbol = {
  /** Its name on the entry */
  name: string;
  entry: EntryName;
  reflection: DeclarationReflection;
  module: ApiModule;
  /** Its anchor on the page it's listed on */
  anchor: string;
  /** Where it's documented: here, or for a re-export the first entry's page */
  target: ApiTarget;
  /** A second entry's name for a declaration the first entry documents */
  isReexport: boolean;
};

/** A page's section: one source module and its public names on that page */
export type ApiPageSection = { module: ApiModule; symbols: PublicSymbol[] };

/**
 * `entry`: an entry's page; `folder`: a source folder of a large entry; `group`: the entries
 * under a specifier that isn't one (`aekasha/toolkit`)
 */
export type ApiPageKind = 'entry' | 'folder' | 'group';

/** One page of the API reference: an entry's, a large entry's source folder's, or a group's */
export type ApiPage = {
  kind: ApiPageKind;
  pagePath: string;
  /** `aekasha/physics`, `aekasha · scene/`, `aekasha/toolkit` */
  title: string;
  /** The menu's label: the title, a folder page's `scene/` */
  menu: string;
  /** The entry its names are imported from (`entry` and `folder` pages) */
  entry?: EntryName;
  /** From the repo root: the entry file, or a folder page's source folder */
  sourcePath: string;
  subtree: ApiSubtree;
  /** Its menu position among its siblings */
  order: number;
  /** Its modules in the entry file's order */
  sections: ApiPageSection[];
  /** Folder pages under an entry, entries under a group */
  children: ApiPage[];
  /** Its names and its children's, re-exports aside */
  coverage: Coverage;
};

/**
 * The API reference's layout (`buildPublicApi`): its pages, every name's target, and the problems
 */
export type PublicApi = {
  /** Every page, each before its children */
  pages: ApiPage[];
  /** The landing page's lists: the top pages of each subtree, in `ENTRY_FILES`' order */
  roots: Record<ApiSubtree, ApiPage[]>;
  /** Every public declaration and member by reflection id: its page and anchor */
  targets: Map<number, ApiTarget>;
  /** Every listed name, re-exports included, in page order */
  symbols: PublicSymbol[];
  coverage: Coverage;
  /** A page whose URL another page has (a folder named like an entry) */
  problems: EntryProblem[];
};

/** The kinds in a section's order: what a module is for first, then its types and constants */
const KIND_ORDER: number[] = [
  Kind.Function,
  Kind.Class,
  Kind.Interface,
  Kind.TypeAlias,
  Kind.Enum,
  Kind.Variable,
  Kind.Namespace,
  Kind.Module,
];

const kindRank = (kind: number) => {
  const rank = KIND_ORDER.indexOf(kind);
  return rank < 0 ? KIND_ORDER.length : rank;
};

/** `aekasha/physics` → `documentation/aekasha/physics/` */
const getEntryPagePath = (entry: string) => `${API_SECTION_PATH}${entry}/`;

/** A module's folder page under a large entry: a kernel area (`kernel/scene` → `scene`), else
 * its top folder (`utils`) */
const getFolderKey = (module: ApiModule) => {
  const parts = module.relPath.split('/');
  return parts[0] === 'kernel' && parts.length > 2 ? parts[1] : parts.length > 1 ? parts[0] : '';
};

const getFolderSourcePath = (module: ApiModule, key: string) => {
  const root = module.sourcePath.slice(0, module.sourcePath.length - module.relPath.length - 3);
  return `${root}${module.relPath.startsWith('kernel/') ? `kernel/${key}` : key}`;
};

const emptyCoverage = (): Coverage => ({ documented: 0, total: 0 });

const addCoverage = (to: Coverage, from: Coverage) => {
  to.documented += from.documented;
  to.total += from.total;
};

/**
 * A group page for entries whose specifier's parent isn't a page (`aekasha/toolkit`), listing
 * them: added to `byPath`, and each such entry to its children
 */
const addGroupPages = (entryPages: ApiPage[], byPath: Map<string, ApiPage>) => {
  for (const page of entryPages) {
    const parentPath = page.pagePath.replace(/[^/]+\/$/, '');
    if (parentPath === API_SECTION_PATH || byPath.has(parentPath)) continue;
    const title = parentPath.slice(API_SECTION_PATH.length, -1);
    byPath.set(parentPath, {
      kind: 'group',
      pagePath: parentPath,
      title,
      menu: title,
      sourcePath: page.sourcePath.replace(/\/[^/]+\/index\.ts$/, ''),
      subtree: page.subtree,
      order: page.order,
      sections: [],
      children: [],
      coverage: emptyCoverage(),
    });
  }
  for (const page of entryPages) {
    const parent = byPath.get(page.pagePath.replace(/[^/]+\/$/, ''));
    if (parent?.kind !== 'group') continue;
    parent.children.push(page);
    addCoverage(parent.coverage, page.coverage);
  }
};

/**
 * Lays out the pages from the entries: a page per entry (a page per source folder over
 * `maxEntryPageNames`), a group page where a specifier's parent is none, and every public name's
 * and member's anchor
 */
export const buildPublicApi = (
  entries: ApiEntryIndex,
  maxEntryPageNames = MAX_ENTRY_PAGE_NAMES
): PublicApi => {
  const targets = new Map<number, ApiTarget>();
  const symbols: PublicSymbol[] = [];
  const problems: EntryProblem[] = [];
  const byPath = new Map<string, ApiPage>();
  const addPage = (page: ApiPage, file: string) => {
    if (byPath.has(page.pagePath)) {
      problems.push({ file, message: `Two API pages at /${page.pagePath}: ${page.title}` });
      return false;
    }
    byPath.set(page.pagePath, page);
    return true;
  };

  /** A page's sections: its names by module (entry file order), each by kind, then name */
  const fillSections = (page: ApiPage, names: Omit<PublicSymbol, 'anchor' | 'target'>[]) => {
    const anchors = new Set<string>();
    const unique = (base: string) => {
      let anchor = base;
      for (let n = 2; anchors.has(anchor); n++) anchor = `${base}-${n}`;
      anchors.add(anchor);
      return anchor;
    };
    const sections = new Map<ApiModule, Omit<PublicSymbol, 'anchor' | 'target'>[]>();
    for (const name of names)
      sections.set(name.module, [...(sections.get(name.module) ?? []), name]);
    for (const [module, list] of sections) {
      list.sort(
        (a, b) =>
          kindRank(a.reflection.kind) - kindRank(b.reflection.kind) || a.name.localeCompare(b.name)
      );
      const section: ApiPageSection = { module, symbols: [] };
      for (const name of list) {
        const anchor = unique(name.name);
        const own = { pagePath: page.pagePath, anchor };
        // The first entry is built first, so a re-export's home is known
        const target = name.isReexport ? targets.get(name.reflection.id) ?? own : own;
        const symbol: PublicSymbol = { ...name, anchor, target };
        if (!name.isReexport) {
          targets.set(name.reflection.id, own);
          const { reflection } = name;
          if (reflection.kind === Kind.Class || reflection.kind === Kind.Interface) {
            for (const member of getOwnMembers(reflection)) {
              targets.set(member.id, {
                pagePath: page.pagePath,
                anchor: unique(`${anchor}.${member.name}`),
              });
            }
          }
          page.coverage.total++;
          if (isDocumented(reflection)) page.coverage.documented++;
        }
        section.symbols.push(symbol);
        symbols.push(symbol);
      }
      page.sections.push(section);
    }
  };

  const roots: Record<ApiSubtree, ApiPage[]> = { engine: [], toolkit: [] };
  const entryPages: ApiPage[] = [];
  entries.entries.forEach(({ entry, file, symbols: entrySymbols }, order) => {
    const subtree: ApiSubtree = file.startsWith('src/toolkit/') ? 'toolkit' : 'engine';
    const page: ApiPage = {
      kind: 'entry',
      pagePath: getEntryPagePath(entry),
      title: entry,
      menu: entry,
      entry,
      sourcePath: file,
      subtree,
      order: order + 1,
      sections: [],
      children: [],
      coverage: emptyCoverage(),
    };
    if (!addPage(page, file)) return;
    entryPages.push(page);
    roots[subtree].push(page);
    const names = entrySymbols.map((symbol) => ({
      ...symbol,
      isReexport: entries.byId.get(symbol.reflection.id)![0].entry !== entry,
    }));
    // Modules in the entry file's order
    const firstSeen = new Map<ApiModule, number>();
    entrySymbols.forEach((symbol, i) => {
      if (!firstSeen.has(symbol.module)) firstSeen.set(symbol.module, i);
    });
    names.sort((a, b) => firstSeen.get(a.module)! - firstSeen.get(b.module)!);
    const nameCount = new Set(names.map((name) => name.name)).size;
    if (nameCount <= maxEntryPageNames) {
      fillSections(page, names);
      return;
    }
    const folders = new Map<string, typeof names>();
    for (const name of names) {
      const key = getFolderKey(name.module);
      folders.set(key, [...(folders.get(key) ?? []), name]);
    }
    for (const [key, folderNames] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
      const folder: ApiPage = {
        kind: 'folder',
        pagePath: `${page.pagePath}${key || 'top-level'}/`,
        title: `${entry} · ${key ? `${key}/` : 'top level'}`,
        menu: key ? `${key}/` : 'Top level',
        entry,
        sourcePath: getFolderSourcePath(folderNames[0].module, key),
        subtree,
        // Before the entries listed under the same page (`aekasha/physics` under `aekasha`): its
        // folders hold the page's own names
        order: 0,
        sections: [],
        children: [],
        coverage: emptyCoverage(),
      };
      if (!addPage(folder, file)) continue;
      fillSections(folder, folderNames);
      page.children.push(folder);
      addCoverage(page.coverage, folder.coverage);
    }
  });

  addGroupPages(entryPages, byPath);

  const pages = [...byPath.values()].sort((a, b) => a.pagePath.localeCompare(b.pagePath));
  const coverage = emptyCoverage();
  for (const page of entryPages) addCoverage(coverage, page.coverage);
  return { pages, roots, targets, symbols, coverage, problems };
};
