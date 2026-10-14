/**
 * Why a module is in the bundle (p611 D3): the shortest chain of imports from the entry to it,
 * over the visualizer's graph (`imported`, each edge `dynamic` for an `import()`). A module in the
 * initial chunks is reached by static imports alone; a lazy one by a chain with an `import()` in
 * it, printed as `⇢`.
 *
 * The graph is Rollup's before tree-shaking: a chain can pass a module none of whose code ships
 * (an entry's `index.ts` always does, it only re-exports). It's a true import chain, the shortest,
 * not the only one.
 */
import path from 'path';
import { ENTRY_FILES } from '../aliases';
import { type Manifest, type VisualizerData, getModuleGroup } from './bundleModel';

/** An import chain: module ids from the entry to the target; `dynamic[i]` is whether the edge
 * into `ids[i + 1]` is an `import()` */
export type ImportChain = { ids: string[]; dynamic: boolean[] };

/** Where a module's code is: rendered in an initial chunk, only in lazy ones, or nowhere
 * (tree-shaken, or a file with no code of its own such as an entry) */
export type ModuleLoad = 'initial' | 'lazy' | 'none';

/** The build graph indexed by module id */
export type ModuleGraph = {
  /** Module id → the ids it imports, with the edge's kind */
  imports: Map<string, { id: string; dynamic: boolean }[]>;
  /** Module id → where its code is */
  load: Map<string, ModuleLoad>;
};

/**
 * Indexes the visualizer's graph.
 * @param initialFiles the hashed names of the initial chunks (`BundleSplit.initialFiles`)
 */
export const indexModuleGraph = (data: VisualizerData, initialFiles: Set<string>): ModuleGraph => {
  const idOf = new Map(Object.entries(data.nodeMetas).map(([uid, meta]) => [uid, meta.id]));
  const imports: ModuleGraph['imports'] = new Map();
  const load: ModuleGraph['load'] = new Map();
  for (const meta of Object.values(data.nodeMetas)) {
    imports.set(
      meta.id,
      meta.imported.flatMap((ref) => {
        const id = idOf.get(ref.uid);
        return id ? [{ id, dynamic: !!ref.dynamic }] : [];
      })
    );
    const rendered = Object.entries(meta.moduleParts).filter(
      ([, part]) => data.nodeParts[part].renderedLength > 0
    );
    load.set(
      meta.id,
      rendered.some(([file]) => initialFiles.has(file))
        ? 'initial'
        : rendered.length
          ? 'lazy'
          : 'none'
    );
  }
  return { imports, load };
};

/** The module id of the manifest's entry (`/src/index.html`); `root` is Vite's, from the repo */
export const getEntryModuleId = (manifest: Manifest, root = 'src') => {
  const entry = Object.values(manifest).find((m) => m.isEntry);
  if (!entry?.src) throw new Error('The manifest names no entry chunk with a source');
  return `/${path.posix.normalize(`${root}/${entry.src}`)}`;
};

/**
 * The shortest import chain from `from` to a module `isTarget` accepts (breadth first, in each
 * module's import order).
 * @param opts.dynamic whether `import()` edges count; without them only static chains are found
 * @param opts.through which modules a chain may pass (the target and `from` aside); all by default
 * @returns the chain, or null when none reaches a target
 */
export const findImportChain = (
  graph: ModuleGraph,
  from: string,
  isTarget: (id: string) => boolean,
  opts: { dynamic: boolean; through?: (id: string) => boolean }
): ImportChain | null => {
  const previous = new Map<string, { id: string; dynamic: boolean } | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (isTarget(id)) {
      const ids: string[] = [];
      const dynamic: boolean[] = [];
      for (let at: string | undefined = id; at !== undefined; ) {
        ids.unshift(at);
        const prev = previous.get(at);
        if (prev) dynamic.unshift(prev.dynamic);
        at = prev?.id;
      }
      return { ids, dynamic };
    }
    if (i > 0 && opts.through && !opts.through(id)) continue;
    for (const next of graph.imports.get(id) ?? []) {
      if ((next.dynamic && !opts.dynamic) || previous.has(next.id)) continue;
      previous.set(next.id, { id, dynamic: next.dynamic });
      queue.push(next.id);
    }
  }
  return null;
};

const ENTRY_OF_FILE = new Map<string, string>(
  Object.entries(ENTRY_FILES).map(([entry, file]) => [`/${file}`, entry])
);

/** Whether a module's code ships, or it's an entry file (which only re-exports) */
const isShipping = (graph: ModuleGraph, id: string) =>
  graph.load.get(id) !== 'none' || ENTRY_OF_FILE.has(id);

/**
 * The chain that explains best: static imports alone before `import()`s, and through modules
 * whose code ships before through any (a tree-shaken module imports what it would have used too)
 * @param opts.dynamic whether to try chains with `import()`s when no static one is found
 */
export const findBestImportChain = (
  graph: ModuleGraph,
  from: string,
  isTarget: (id: string) => boolean,
  opts: { dynamic: boolean } = { dynamic: true }
) => {
  const through = (id: string) => isShipping(graph, id);
  const tries = [
    { dynamic: false, through },
    ...(opts.dynamic ? [{ dynamic: true, through }] : []),
    { dynamic: false },
    ...(opts.dynamic ? [{ dynamic: true }] : []),
  ];
  for (const attempt of tries) {
    const chain = findImportChain(graph, from, isTarget, attempt);
    if (chain) return chain;
  }
  return null;
};

/** A module's label: an entry by its alias, an engine module from `_engine/` (its own files
 * with it), else from the repo */
const labelOf = (id: string) => {
  const entry = ENTRY_OF_FILE.get(id);
  const engine = id.match(/^\/src\/_engine\/(.*)$/)?.[1];
  const short = engine
    ? engine.includes('/')
      ? engine
      : `_engine/${engine}`
    : id.replace(/^[/\0]/, '');
  return entry ? `${entry} (${short})` : short;
};

/**
 * A chain on one line: `src/index.ts → aekasha/physics (features/physics/index.ts) →
 * PhysicsFeature.ts`. An HTML entry is left out, a module in the previous one's folder is named by
 * its file, an `import()` edge is `⇢`.
 */
export const formatImportChain = (chain: ImportChain) => {
  let line = '';
  chain.ids.forEach((id, i) => {
    if (i === 0 && id.endsWith('.html') && chain.ids.length > 1) return;
    const prev = line ? chain.ids[i - 1] : undefined;
    const isSameFolder =
      prev && !ENTRY_OF_FILE.has(id) && path.posix.dirname(prev) === path.posix.dirname(id);
    const label = isSameFolder ? path.posix.basename(id) : labelOf(id);
    line += line ? ` ${chain.dynamic[i - 1] ? '⇢' : '→'} ${label}` : label;
  });
  return line;
};

/** A `--why` answer: the module or group asked about, where its code is, and how it's reached */
export type WhyResult = {
  target: string;
  /** Module ids, for a group or a path several modules match */
  modules: string[];
  load: ModuleLoad;
  chain: ImportChain | null;
};

/** At most this many modules a path matches get a chain each */
export const WHY_MAX_MODULES = 8;

/** The group a `--why` query names: `_engine/features/physics`, `features/physics`, `physics`,
 * `three`; undefined when it names none */
export const findGroup = (groups: Iterable<string>, query: string) => {
  const names = new Set(groups);
  return [query, `_engine/${query}`, `_engine/features/${query}`, `_engine/kernel/${query}`].find(
    (name) => names.has(name)
  );
};

const LOAD_ORDER: ModuleLoad[] = ['initial', 'lazy', 'none'];

/**
 * Answers `yarn sbp --why <group | module path>`: a group gets one chain, to its nearest module
 * whose code is in the initial chunks (else in the lazy ones, else any); a path (the end of a
 * module id, `features/physics/PhysicsTiers.ts`, or any part of one) gets a chain per module it
 * matches, up to {@link WHY_MAX_MODULES}.
 * @returns the answers; empty when the query matches nothing, and the matches without chains
 *   past the limit
 */
export const answerWhy = (
  graph: ModuleGraph,
  from: string,
  query: string
): { results: WhyResult[]; tooMany: string[] } => {
  const ids = [...graph.load.keys()];
  const group = findGroup(
    ids.map((id) => getModuleGroup(id)),
    query
  );
  if (group) {
    const modules = ids.filter((id) => getModuleGroup(id) === group);
    for (const load of LOAD_ORDER) {
      const at = new Set(modules.filter((id) => graph.load.get(id) === load));
      if (!at.size) continue;
      const chain = findBestImportChain(graph, from, (id) => at.has(id));
      if (chain) return { results: [{ target: group, modules, load, chain }], tooMany: [] };
    }
    return { results: [{ target: group, modules, load: 'none', chain: null }], tooMany: [] };
  }
  const needle = query.replace(/^\.?\//, '');
  const exact = ids.filter((id) => id.endsWith(`/${needle}`));
  const matches = (exact.length ? exact : ids.filter((id) => id.includes(needle))).sort(
    (a, b) =>
      LOAD_ORDER.indexOf(graph.load.get(a)!) - LOAD_ORDER.indexOf(graph.load.get(b)!) ||
      a.localeCompare(b)
  );
  return {
    results: matches.slice(0, WHY_MAX_MODULES).map((id) => ({
      target: id,
      modules: [id],
      load: graph.load.get(id)!,
      chain: findBestImportChain(graph, from, (at) => at === id),
    })),
    tooMany: matches.slice(WHY_MAX_MODULES),
  };
};
