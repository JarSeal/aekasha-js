import type { JSONOutput } from 'typedoc';
import type { EntryName } from '../../aliases';
import type { ApiEntry } from './extract';
import { Kind, type ApiIndex, type ApiModule, type DeclarationReflection } from './model';

/**
 * The public API in the model (p619 D6): each entry's names (`ApiModel.entries`, read from the
 * entry files with the model) mapped to the reflections of the modules they come from, a
 * re-export followed to its declaration. The model stays per source module; this says which of
 * its exports are public, and where.
 *
 * And R2's check, `findLeakedTypes`: a type a public export names (in a signature, a property, a
 * base type) that no entry exports. An app can't name it, and its page would be a dead link.
 */

/** A name on an entry and the declaration it is */
export type EntrySymbol = {
  entry: EntryName;
  /** Its name on the entry */
  name: string;
  reflection: DeclarationReflection;
  module: ApiModule;
};

export type EntryProblem = { file: string; message: string };

export type ApiEntryIndex = {
  /** In `ENTRY_FILES`' order, each with its names in its file's order */
  entries: { entry: EntryName; file: string; symbols: EntrySymbol[] }[];
  /** A declaration's names on the entries, by its reflection id; a name on no entry isn't here */
  byId: Map<number, EntrySymbol[]>;
  /** A name the model doesn't have (its module left out of the docs, or no such export) */
  problems: EntryProblem[];
};

/**
 * The entries' names as declarations. A name can stand for two (a value and a type of one name:
 * `ComponentType`), and a module's re-export is followed to its declaration.
 */
export const indexEntries = (index: ApiIndex, entries: ApiEntry[]): ApiEntryIndex => {
  const modules = new Map(index.modules.map((module) => [module.sourcePath, module]));
  const moduleOf = new Map<number, ApiModule>();
  for (const module of index.modules) {
    for (const symbol of module.symbols) moduleOf.set(symbol.id, module);
  }
  const byId = new Map<number, EntrySymbol[]>();
  const problems: EntryProblem[] = [];

  /** A re-export's declaration, through every module that re-exports it */
  const declarationOf = (symbol: DeclarationReflection) => {
    const seen = new Set<number>();
    let at: DeclarationReflection | undefined = symbol;
    while (at?.kind === Kind.Reference && !seen.has(at.id)) {
      seen.add(at.id);
      at = index.reflections.get((at as unknown as JSONOutput.ReferenceReflection).target);
    }
    return at?.kind === Kind.Reference ? undefined : at;
  };

  const result = entries.map(({ entry, file, exports }) => {
    const symbols: EntrySymbol[] = [];
    for (const { name, imported, sourcePath } of exports) {
      const module = modules.get(sourcePath);
      const found = module?.symbols.filter((symbol) => symbol.name === imported) ?? [];
      const declarations = found.map(declarationOf);
      if (!found.length || declarations.some((d) => !d)) {
        problems.push({
          file,
          message: `${entry}: \`${name}\` (${sourcePath}) isn’t in the API model`,
        });
        continue;
      }
      for (const reflection of declarations as DeclarationReflection[]) {
        const symbol: EntrySymbol = {
          entry,
          name,
          reflection,
          module: moduleOf.get(reflection.id)!,
        };
        symbols.push(symbol);
        byId.set(reflection.id, [...(byId.get(reflection.id) ?? []), symbol]);
      }
    }
    return { entry, file, symbols };
  });
  return { entries: result, byId, problems };
};

// --- R2: the types the public API names but no entry exports ---

/**
 * What names a leaked type: a public export (with its entry), or another leaked type (no entry),
 * and the nearest source position of the reference (a member's, a property's, else the namer's)
 */
export type LeakNamer = {
  name: string;
  entry?: EntryName;
  id: number;
  fileName?: string;
  line?: number;
};

export type LeakedType = {
  /** Its reflection id, or `<file>#<name>` for a type the model has no reflection for */
  key: string;
  name: string;
  /** From the repo root; for a reflection, its declaration's */
  sourcePath?: string;
  line?: number;
  /** Public exports first (in entry order), then the leaked types that name it */
  namedBy: LeakNamer[];
};

/** Keys that point back from a declaration (its subclasses, its base's member) or aren't types */
const SKIPPED_KEYS = new Set([
  'comment',
  'sources',
  'groups',
  'categories',
  'implementedBy',
  'extendedBy',
  'inheritedFrom',
  'overwrites',
  'implementationOf',
]);

const isReflection = (value: object): value is DeclarationReflection =>
  typeof (value as { id?: unknown }).id === 'number' &&
  typeof (value as { variant?: unknown }).variant === 'string';

/**
 * The types the public exports name that no entry exports, sorted by source, and the types those
 * name in turn (each would be public once its namer is on an entry). A private member, an
 * inherited one (its base is named instead) and a `{@link}` don't count; a type parameter, three's
 * and the lib's types neither.
 */
export const findLeakedTypes = (index: ApiIndex, entries: ApiEntryIndex): LeakedType[] => {
  // Every reflection nested in a module's export → that export (a member's type names its owner)
  const exportOf = new Map<number, DeclarationReflection>();
  for (const module of index.modules) {
    for (const symbol of module.symbols) {
      const add = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) return value.forEach(add);
        if (isReflection(value)) exportOf.set(value.id, symbol);
        for (const key in value) {
          if (!SKIPPED_KEYS.has(key)) add((value as Record<string, unknown>)[key]);
        }
      };
      add(symbol);
    }
  }

  const leaks = new Map<string, LeakedType>();
  /** The leaked declarations still to walk */
  const queue: { reflection: DeclarationReflection; leak: LeakedType }[] = [];
  const record = (key: string, leak: Omit<LeakedType, 'namedBy'>, namer: LeakNamer) => {
    let entry = leaks.get(key);
    if (!entry) leaks.set(key, (entry = { ...leak, namedBy: [] }));
    if (!entry.namedBy.some((n) => n.id === namer.id)) entry.namedBy.push(namer);
    return entry;
  };

  type State = { namer: Omit<LeakNamer, 'fileName' | 'line'>; source?: JSONOutput.SourceReference };
  const walk = (value: unknown, state: State) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, state);
      return;
    }
    let next = state;
    if (isReflection(value)) {
      if (value.flags?.isPrivate || value.inheritedFrom) return;
      next = { namer: state.namer, source: value.sources?.[0] ?? state.source };
    }
    const type = value as JSONOutput.ReferenceType;
    if (type.type === 'reference' && !type.refersToTypeParameter) {
      const namer = { ...state.namer, fileName: next.source?.fileName, line: next.source?.line };
      if (typeof type.target === 'number') {
        const owner = exportOf.get(type.target);
        if (owner && !entries.byId.has(owner.id) && owner.id !== state.namer.id) {
          const key = String(owner.id);
          const isNew = !leaks.has(key);
          const source = owner.sources?.[0];
          const leak = record(
            key,
            { key, name: owner.name, sourcePath: source?.fileName, line: source?.line },
            namer
          );
          if (isNew) queue.push({ reflection: owner, leak });
        }
      } else if (
        typeof type.target === 'object' &&
        type.target.packageName === index.project.packageName
      ) {
        const key = `${type.target.packagePath}#${type.target.qualifiedName}`;
        record(
          key,
          { key, name: type.target.qualifiedName, sourcePath: type.target.packagePath },
          namer
        );
      }
    }
    for (const key in value) {
      if (!SKIPPED_KEYS.has(key)) walk((value as Record<string, unknown>)[key], next);
    }
  };

  const walked = new Set<number>();
  for (const { symbols } of entries.entries) {
    for (const { entry, name, reflection } of symbols) {
      if (walked.has(reflection.id)) continue;
      walked.add(reflection.id);
      walk(reflection, { namer: { name, entry, id: reflection.id } });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const { reflection, leak } = queue[i];
    walk(reflection, { namer: { name: leak.name, id: reflection.id } });
  }
  return [...leaks.values()].sort(
    (a, b) =>
      (a.sourcePath ?? '').localeCompare(b.sourcePath ?? '') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.name.localeCompare(b.name)
  );
};
