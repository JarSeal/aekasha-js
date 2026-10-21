import type { JSONOutput } from 'typedoc';
import { getOwnMembers, Kind, type ApiIndex, type ApiTarget } from './model';
import type { PublicApi } from './publicApi';

/**
 * Links into the API pages (p553 §2.3), which hold the public entries' names only (p619 D6):
 * - by reflection id: a `{@link}` TypeDoc resolved, a type in a signature. A reflection without
 *   an anchor of its own (a type alias's property, a parameter, a signature) links to its nearest
 *   owner that has one; an internal export's has none;
 * - by name: `api:` links (`api:loadScene`, `api:SceneLoader.loadScene`,
 *   `api:ECSWorld.addSystem`), and a `{@link}` TypeDoc only resolved to a name in this package. An
 *   internal export's name fails, saying so.
 *
 * The index is built once per model (`getApiLinks`): it walks the whole model for the owners.
 */

export type ApiNameResult =
  | { isOk: true; target: ApiTarget }
  | { isOk: false; message: string; candidates: string[] };

/**
 * A `{@link}` with the reflection whose comment has it and the nearest source position. Its
 * target is a reflection id, a URL, another package's symbol (three's), a name in this package
 * TypeDoc found no reflection for (not exported), or none.
 */
export type CommentApiLink = {
  part: JSONOutput.InlineTagDisplayPart;
  ownerId: number;
  /** From the repo root */
  fileName?: string;
  line?: number;
};

export type ApiLinks = {
  /** A reflection's page and anchor: its own, else its nearest owner's */
  resolveId: (id: number) => ApiTarget | undefined;
  /** An `api:` link's name; ambiguous, unknown and internal names say why, with candidates */
  resolveName: (ref: string) => ApiNameResult;
  /** Every `{@link}` in the model */
  commentLinks: CommentApiLink[];
};

type NameEntry = {
  target: ApiTarget;
  /** The symbol's name, or the member's */
  name: string;
  /** Its names from the shortest (`loadScene`) to the longest (`engine/kernel/scene/SceneLoader.loadScene`) */
  keys: string[];
};

const MAX_SUGGESTIONS = 5;

const isReflection = (value: object): value is { id: number; variant: string } =>
  typeof (value as { id?: unknown }).id === 'number' &&
  typeof (value as { variant?: unknown }).variant === 'string';

type WalkState = { ownerId: number; source?: JSONOutput.SourceReference };

/**
 * Every reflection's owner (the reflection it's nested in: a member's class, a parameter's
 * signature, an object literal type's declaring property), and the `{@link}`s
 */
const walkModel = (project: JSONOutput.ProjectReflection) => {
  const owners = new Map<number, number>();
  const commentLinks: CommentApiLink[] = [];
  const walk = (value: unknown, state: WalkState) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, state);
      return;
    }
    let next = state;
    if (isReflection(value)) {
      if (value.id !== state.ownerId) owners.set(value.id, state.ownerId);
      const sources = (value as { sources?: JSONOutput.SourceReference[] }).sources;
      next = { ownerId: value.id, source: sources?.[0] ?? state.source };
    }
    const part = value as JSONOutput.InlineTagDisplayPart;
    if (part.kind === 'inline-tag') {
      if (part.tag.startsWith('@link')) {
        const { fileName, line } = next.source ?? {};
        commentLinks.push({ part, ownerId: next.ownerId, fileName, line });
      }
      return;
    }
    for (const key in value) walk((value as Record<string, unknown>)[key], next);
  };
  walk(project, { ownerId: project.id });
  return { owners, commentLinks };
};

/** `engine/kernel/scene/SceneLoader` → `SceneLoader`, `scene/SceneLoader`, `kernel/scene/SceneLoader`, `engine/kernel/scene/SceneLoader` */
const modulePathSuffixes = (subtree: string, relPath: string) => {
  const parts = [subtree, ...relPath.split('/')];
  return parts.map((_part, i) => parts.slice(parts.length - 1 - i).join('/'));
};

const buildNameTable = (api: PublicApi) => {
  const byKey = new Map<string, NameEntry[]>();
  const entries: NameEntry[] = [];
  const add = (target: ApiTarget, name: string, keys: string[]) => {
    const entry: NameEntry = { target, name, keys };
    entries.push(entry);
    for (const key of keys) byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  };
  for (const { reflection, module, target, isReexport } of api.symbols) {
    // A second entry's re-export is the first's: its own name would only make that ambiguous
    if (isReexport) continue;
    const suffixes = modulePathSuffixes(module.subtree, module.relPath);
    add(target, reflection.name, [
      reflection.name,
      ...suffixes.map((suffix) => `${suffix}.${reflection.name}`),
    ]);
    if (reflection.kind !== Kind.Class && reflection.kind !== Kind.Interface) continue;
    // A member needs its owner's name: `addSystem` alone would match every class's
    for (const member of getOwnMembers(reflection)) {
      const memberTarget = api.targets.get(member.id);
      if (!memberTarget) continue;
      const own = `${reflection.name}.${member.name}`;
      add(memberTarget, member.name, [own, ...suffixes.map((suffix) => `${suffix}.${own}`)]);
    }
  }
  return { byKey, entries };
};

/** The internal exports by name, with their modules: an `api:` link to one says why it fails */
const buildInternalNames = (index: ApiIndex, api: PublicApi) => {
  const names = new Map<string, string[]>();
  for (const module of index.modules) {
    for (const symbol of module.symbols) {
      if (symbol.kind === Kind.Reference || api.targets.has(symbol.id)) continue;
      names.set(symbol.name, [...(names.get(symbol.name) ?? []), module.sourcePath]);
    }
  }
  return names;
};

/** The entry's shortest name that names only it */
const shortestKey = (entry: NameEntry, byKey: Map<string, NameEntry[]>) =>
  entry.keys.find((key) => byKey.get(key)?.length === 1) ?? entry.keys[entry.keys.length - 1];

/** Edit distance, capped: anything over `max` is `max + 1` */
const distance = (a: string, b: string, max: number) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
};

const createLinks = (index: ApiIndex, api: PublicApi): ApiLinks => {
  const { owners, commentLinks } = walkModel(index.project);
  const { byKey, entries } = buildNameTable(api);
  const internalNames = buildInternalNames(index, api);

  const resolveId = (id: number) => {
    for (let at: number | undefined = id; at !== undefined; at = owners.get(at)) {
      const target = api.targets.get(at);
      if (target) return target;
    }
    return undefined;
  };

  /** The closest names for an unknown one: same letters in another case, a typo, or a part */
  const suggest = (ref: string) => {
    const name = ref.slice(ref.lastIndexOf('.') + 1).toLowerCase();
    const max = Math.max(1, Math.floor(name.length / 4));
    return entries
      .map((entry) => {
        const candidate = entry.name.toLowerCase();
        const d = distance(name, candidate, max);
        const score = d <= max ? d : candidate.includes(name) ? max + 1 : Infinity;
        return { entry, score };
      })
      .filter(({ score }) => score < Infinity)
      .sort((a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length)
      .slice(0, MAX_SUGGESTIONS)
      .map(({ entry }) => `api:${shortestKey(entry, byKey)}`);
  };

  const resolveName = (ref: string): ApiNameResult => {
    const found = byKey.get(ref) ?? [];
    if (found.length === 1) return { isOk: true, target: found[0].target };
    if (!found.length) {
      const internal = internalNames.get(ref);
      if (internal) {
        return {
          isOk: false,
          message: `api:${ref} is internal (${internal.join(', ')}): it's on no entry, so it has no page`,
          candidates: [],
        };
      }
      const candidates = suggest(ref);
      return {
        isOk: false,
        message: `Unknown api:${ref}${candidates.length ? ` (did you mean ${candidates.join(', ')}?)` : ': no symbol of that name'}`,
        candidates,
      };
    }
    // A value and a type of the same name in one module (`ComponentType`): the one whose anchor
    // is the bare name
    const [first] = found;
    if (found.every((entry) => entry.target.pagePath === first.target.pagePath)) {
      return { isOk: true, target: first.target };
    }
    const candidates = found.map((entry) => `api:${shortestKey(entry, byKey)}`);
    return {
      isOk: false,
      message: `Ambiguous api:${ref}: ${candidates.join(', ')}`,
      candidates,
    };
  };

  return { resolveId, resolveName, commentLinks };
};

const cache = new WeakMap<PublicApi, ApiLinks>();

/** The links of the public API, built on its first use */
export const getApiLinks = (index: ApiIndex, api: PublicApi) => {
  let links = cache.get(api);
  if (!links) cache.set(api, (links = createLinks(index, api)));
  return links;
};
