/**
 * The layout check (p619 D9, from p602's move map): the repo's files against `layoutRules.ts`
 * and its import graph against the layers of the root `CLAUDE.md`'s Three-folder split. No file
 * system: the caller hands it the files and the sources (`layout.test.ts` the working tree's,
 * `layoutReport.ts` the same for the report).
 *
 * - Every file of `src/_engine/`, `src/toolkit/` and `src/app/` under a rule, the engine's and
 *   the toolkit's modules named in PascalCase, no two paths that differ only in case.
 * - The imports between the layers: the engine imports no toolkit, app or generated file; the
 *   kernel imports a feature's types only (the assets worker's job `import()`s apart: a worker
 *   can't be handed code, p607 D5); no static `_dbg__` import outside debug code; `utils/` imports
 *   only `utils/`, `schemas/` only `schemas/` and `utils/`, the UI kit only itself, `utils/`,
 *   `types/` and the kernel's hooks (`UI_KERNEL_HOOKS`); the toolkit no app or generated file.
 * - No cycle between features (runtime and dynamic imports from code outside a debug folder).
 *
 * The lint (`eslint.config.js`) keeps most of the import rules per file; this sees them through
 * the entries (an `aekasha/physics` import resolves to the module behind it) and adds the cycles.
 * Type-only edges of the boundaries are listed, not failed: they emit nothing.
 */
import path from 'path';
import { buildImportGraph, type ImportKind } from './importGraph';
import { findLayoutRule, getLayoutRules, isPascalModuleName, isPascalScope } from './layoutRules';

export type LayoutLayer =
  | 'kernel'
  | 'feature'
  | 'ui'
  | 'debug'
  | 'utils'
  | 'schemas'
  | 'types'
  | 'engine'
  | 'generated'
  | 'toolkit'
  | 'app'
  | 'devTools';

/** Where a file sits: its layer, its kernel area, feature or toolkit category, and whether it's
 * in a debug folder */
export type LayoutZone = { layer: LayoutLayer; area?: string; isDebug: boolean };

/** An import between two modules, both repo-relative */
export type LayoutEdge = {
  from: string;
  to: string;
  kind: ImportKind;
  names: string[];
  line: number;
};

export type LayoutCheck = {
  /** Engine, toolkit and app files no rule covers */
  unruled: string[];
  /** Engine and toolkit modules whose name isn't PascalCase */
  misnamed: string[];
  /** Paths that differ only in case, each group sorted */
  caseClashes: string[][];
  /** Each boundary's imports, by category (`Kernel → feature`) */
  violations: Map<string, LayoutEdge[]>;
  /** The assets worker's `import()`s of feature code: allowed (p607 D5) */
  workerJobEdges: LayoutEdge[];
  /** Imports from a feature's code (no debug folder) into another feature */
  featureEdges: LayoutEdge[];
  /** Strongly connected sets of features, each sorted */
  featureCycles: string[][];
  /** Packages imported by `utils/` (no test): it's pure, so none but its own storage */
  utilsPackages: { from: string; specifier: string; line: number }[];
  /** Relative imports that resolve to no file, `file:line 'specifier'` */
  unresolved: string[];
  importCount: number;
  moduleCount: number;
};

/** Which file of a layer the UI kit may import from the kernel (p617 D7): the env flags, and the
 * registries through which the windows follow a scene load and the boot while the kernel names no
 * window (p613 D5). They import nothing heavy, so the kit runs without the engine (p803 D4: the
 * windows follow a resize through `ui/core/Window.ts`' `onBoundsResize`, not the main loop) */
export const UI_KERNEL_HOOKS = new Set([
  'src/_engine/kernel/config/Config.ts',
  'src/_engine/kernel/scene/SceneHooks.ts',
  'src/_engine/kernel/init/BootHooks.ts',
]);

const WORKER_ZONE = 'src/_engine/kernel/assets/worker/';
const ENGINE_LAYERS: readonly LayoutLayer[] = [
  'kernel',
  'feature',
  'ui',
  'debug',
  'utils',
  'schemas',
  'types',
  'engine',
];
/** The categories whose type-only imports fail too (the lint refuses `import type` there) */
const TYPE_FAILING_CATEGORIES = new Set([
  'Engine → app',
  'Engine → generated data',
  'Engine → toolkit',
]);
const DEBUG_IMPORT_CATEGORY = 'Static `_dbg__` imports outside debug code';

/** A file's zone, from its path */
export const getLayoutZone = (file: string): LayoutZone => {
  let m = /^src\/_engine\/kernel\/([^/]+)\/(debug\/)?/.exec(file);
  if (m) return { layer: 'kernel', area: m[1], isDebug: !!m[2] };
  m = /^src\/_engine\/features\/([^/]+)\/(debug\/)?/.exec(file);
  if (m) return { layer: 'feature', area: m[1], isDebug: !!m[2] };
  const top = /^src\/_engine\/([^/]+)\//.exec(file)?.[1];
  if (top === 'ui' || top === 'utils' || top === 'schemas' || top === 'types') {
    return { layer: top, isDebug: false };
  }
  if (top === 'debug') return { layer: 'debug', isDebug: true };
  if (file.startsWith('src/_engine/')) return { layer: 'engine', isDebug: false };
  if (file.startsWith('src/generated/')) return { layer: 'generated', isDebug: false };
  m = /^src\/toolkit\/([^/]+)\//.exec(file);
  if (m) return { layer: 'toolkit', area: m[1], isDebug: false };
  if (file.startsWith('devTools/')) return { layer: 'devTools', isDebug: false };
  return { layer: 'app', isDebug: false };
};

const isDbgModule = (file: string) => path.posix.basename(file).startsWith('_dbg__');

/** The boundary an import crosses, or null when it's allowed */
const getEdgeCategory = (
  fz: LayoutZone,
  tz: LayoutZone,
  edge: LayoutEdge,
  entryFiles: ReadonlySet<string>
): string | null => {
  if (fz.layer === 'toolkit') {
    return tz.layer === 'app' || tz.layer === 'generated' ? 'Toolkit → app' : null;
  }
  if (!ENGINE_LAYERS.includes(fz.layer)) return null;
  if (tz.layer === 'app') return 'Engine → app';
  if (tz.layer === 'generated') return 'Engine → generated data';
  if (tz.layer === 'toolkit') return 'Engine → toolkit';
  if (edge.kind !== 'dynamic' && isDbgModule(edge.to) && !fz.isDebug) return DEBUG_IMPORT_CATEGORY;
  if (fz.isDebug) return null;
  // An entry re-exports its names from wherever their code is (`aekasha/schemas` the features'
  // schemas, p607 D10): its layer's rule is for the code under it
  if (entryFiles.has(edge.from)) return null;
  switch (fz.layer) {
    case 'utils':
      return tz.layer === 'utils' ? null : `utils → ${tz.layer}`;
    case 'schemas':
      return tz.layer === 'schemas' || tz.layer === 'utils' ? null : `schemas → ${tz.layer}`;
    case 'ui':
      if (tz.layer === 'kernel' && UI_KERNEL_HOOKS.has(edge.to)) return null;
      return ['ui', 'utils', 'types'].includes(tz.layer) ? null : `ui → ${tz.layer}`;
    case 'kernel':
      return tz.layer === 'feature' ? 'Kernel → feature' : null;
    default:
      return null;
  }
};

/** Whether an edge of a category fails the check (a type-only one only where the lint refuses
 * `import type` too) */
export const isFailingEdge = (category: string, edge: LayoutEdge) =>
  edge.kind !== 'type' || TYPE_FAILING_CATEGORIES.has(category);

/** Tarjan's strongly connected components with more than one member */
const findCycles = (graph: Map<string, Set<string>>): string[][] => {
  let index = 0;
  const stack: string[] = [];
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) !== idx.get(v)) return;
    const scc: string[] = [];
    let w: string;
    do {
      w = stack.pop()!;
      onStack.delete(w);
      scc.push(w);
    } while (w !== v);
    if (scc.length > 1) cycles.push(scc.sort());
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  return cycles;
};

/** The files' own checks: the rules, the names, the case clashes */
const checkFiles = (files: readonly string[]) => {
  const rules = getLayoutRules([...files]);
  const unruled: string[] = [];
  const misnamed: string[] = [];
  const byLowerCase = new Map<string, string[]>();
  for (const file of files) {
    if (!file.startsWith('src/')) continue;
    const lower = file.toLowerCase();
    byLowerCase.set(lower, [...(byLowerCase.get(lower) ?? []), file]);
    if (!/^src\/(_engine|toolkit|app)\//.test(file)) continue;
    if (!findLayoutRule(rules, file)) unruled.push(file);
    if (isPascalScope(file) && !isPascalModuleName(path.posix.basename(file))) misnamed.push(file);
  }
  const caseClashes = [...byLowerCase.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort());
  return { unruled, misnamed, caseClashes };
};

/**
 * Checks the files and their imports against the layout.
 * @param opts.files every file of the tree (repo-relative, `/`), what the imports can resolve to
 * @param opts.sources the modules whose imports are checked (path → source): `src/`'s `.ts`
 * @param opts.aliases the entries' aliases (`ENTRY_FILES`): an entry import resolves to its file
 */
export const checkLayout = (opts: {
  files: readonly string[];
  sources: Map<string, string>;
  aliases: Readonly<Record<string, string>>;
}): LayoutCheck => {
  const fileSet = new Set(opts.files);
  const entryFiles = new Set(Object.values(opts.aliases));
  const graph = buildImportGraph(opts.sources, {
    exists: (f) => fileSet.has(f),
    aliases: opts.aliases,
  });
  const violations = new Map<string, LayoutEdge[]>();
  const workerJobEdges: LayoutEdge[] = [];
  const featureEdges: LayoutEdge[] = [];
  const utilsPackages: LayoutCheck['utilsPackages'] = [];
  const unresolved: string[] = [];

  for (const imp of graph.imports) {
    const fz = getLayoutZone(imp.from);
    if (imp.resolved === undefined) {
      unresolved.push(`${imp.from}:${imp.line} '${imp.specifier}'`);
      continue;
    }
    if (imp.resolved === null) {
      if (fz.layer === 'utils' && !imp.from.endsWith('.test.ts')) {
        utilsPackages.push({ from: imp.from, specifier: imp.specifier, line: imp.line });
      }
      continue;
    }
    // An import of names that are all types emits nothing, with or without `type`
    const to = imp.resolved;
    const kind: ImportKind =
      imp.kind === 'runtime' &&
      imp.names.length > 0 &&
      imp.names.every((n) => n !== '*' && graph.isTypeExport(to, n))
        ? 'type'
        : imp.kind;
    const edge: LayoutEdge = { from: imp.from, to, kind, names: imp.names, line: imp.line };
    const tz = getLayoutZone(to);
    if (kind === 'dynamic' && imp.from.startsWith(WORKER_ZONE) && tz.layer === 'feature') {
      workerJobEdges.push(edge);
      continue;
    }
    const category = getEdgeCategory(fz, tz, edge, entryFiles);
    if (category) violations.set(category, [...(violations.get(category) ?? []), edge]);
    if (fz.layer === 'feature' && tz.layer === 'feature' && fz.area !== tz.area && !fz.isDebug) {
      featureEdges.push(edge);
    }
  }

  const featureGraph = new Map<string, Set<string>>();
  for (const e of featureEdges) {
    if (e.kind === 'type') continue;
    const a = getLayoutZone(e.from).area!;
    const b = getLayoutZone(e.to).area!;
    if (!featureGraph.has(a)) featureGraph.set(a, new Set());
    featureGraph.get(a)!.add(b);
  }

  return {
    ...checkFiles(opts.files),
    violations,
    workerJobEdges,
    featureEdges,
    featureCycles: findCycles(featureGraph),
    utilsPackages,
    unresolved,
    importCount: graph.imports.length,
    moduleCount: opts.sources.size,
  };
};

/** What fails the layout, one line each: the files outside the rules, the names, the case
 * clashes, the failing edges, the cycles, the packages in `utils/` and the unresolved imports */
export const getLayoutErrors = (check: LayoutCheck): string[] => [
  ...check.unruled.map((f) => `${f}: no rule in devTools/layout/layoutRules.ts covers it`),
  ...check.misnamed.map((f) => `${f}: a module's name is PascalCase (p602 D7)`),
  ...check.caseClashes.map((group) => `${group.join(' and ')} differ only in case`),
  ...[...check.violations].flatMap(([category, edges]) =>
    edges
      .filter((edge) => isFailingEdge(category, edge))
      .map((e) => `${category}: ${e.from}:${e.line} imports ${e.to} (${e.kind})`)
  ),
  ...check.featureCycles.map((cycle) => `a feature cycle: ${cycle.join(' ↔ ')}`),
  ...check.utilsPackages.map((u) => `utils is pure: ${u.from}:${u.line} imports '${u.specifier}'`),
  ...check.unresolved.map((u) => `an unresolved import: ${u}`),
];
