import path from 'node:path';
import type { JSONOutput, ReflectionKind } from 'typedoc';
import { ROOT } from '../paths';

/**
 * The API model indexed (p553 §2.2): every module (a source file) of the two subtrees, the engine
 * (`src/_engine/`) and the toolkit (`src/toolkit/`), with its exports, and every export and member
 * by reflection id. The model stays per module (the docs ratchet counts every export); the pages
 * are the public entries' (`publicApi.ts`, p619 D6).
 */

export type DeclarationReflection = JSONOutput.DeclarationReflection;
export type SignatureReflection = JSONOutput.SignatureReflection;
export type SomeType = JSONOutput.SomeType;
export type Comment = JSONOutput.Comment;

/**
 * TypeDoc 0.28's reflection kinds (`ReflectionKind`), as numbers: importing the enum would load
 * TypeDoc wherever the Hub builds. `satisfies` checks them against it, so an upgrade that renumbers
 * a kind fails `tsc` (p550 §7.1).
 */
export const Kind = {
  Module: 2,
  Namespace: 4,
  Enum: 8,
  EnumMember: 16,
  Variable: 32,
  Function: 64,
  Class: 128,
  Interface: 256,
  Constructor: 512,
  Property: 1024,
  Method: 2048,
  CallSignature: 4096,
  IndexSignature: 8192,
  ConstructorSignature: 16384,
  Parameter: 32768,
  TypeLiteral: 65536,
  TypeParameter: 131072,
  Accessor: 262144,
  GetSignature: 524288,
  SetSignature: 1048576,
  TypeAlias: 2097152,
  Reference: 4194304,
} as const satisfies { [K in keyof typeof ReflectionKind]?: (typeof ReflectionKind)[K] };

export const API_SECTION_PATH = 'documentation/';

export type ApiSubtree = 'engine' | 'toolkit';

export const API_SUBTREES: { id: ApiSubtree; sourceDir: string; title: string }[] = [
  { id: 'engine', sourceDir: 'src/_engine', title: 'Engine' },
  { id: 'toolkit', sourceDir: 'src/toolkit', title: 'Toolkit' },
];

/** The entries' pages are under this one: `documentation/aekasha/physics/` (`publicApi.ts`) */
export const API_ENTRIES_PATH = `${API_SECTION_PATH}aekasha/`;

/**
 * Whether a site path (`documentation/aekasha/physics/`) is one of the pages the API model
 * renders: the landing page and the entries' pages, not the section's hand-written children
 */
export const isApiPagePath = (sitePath: string) =>
  sitePath === API_SECTION_PATH || sitePath.startsWith(API_ENTRIES_PATH);

/** Documented or not: a comment on it, or on one of its signatures */
export type Coverage = { documented: number; total: number };

export type ApiModule = {
  reflection: DeclarationReflection;
  subtree: ApiSubtree;
  /** From its subtree's folder, without `.ts`: `kernel/scene/SceneLoader` */
  relPath: string;
  /** From the repo root: `src/_engine/kernel/scene/SceneLoader.ts` */
  sourcePath: string;
  /** Absolute: its comments' diagnostics point here */
  file: string;
  /** Its exports, references (re-exports) included */
  symbols: DeclarationReflection[];
};

/** Where a reflection is shown: its page and its anchor there */
export type ApiTarget = { pagePath: string; anchor: string };

export type ApiIndex = {
  project: JSONOutput.ProjectReflection;
  /** Sorted by source path */
  modules: ApiModule[];
  /** Exports and their members (a class's methods) by reflection id */
  reflections: Map<number, DeclarationReflection>;
};

const hasComment = (comment: Comment | undefined) =>
  !!comment && (comment.summary.length > 0 || (comment.blockTags?.length ?? 0) > 0);

export const isDocumented = (reflection: DeclarationReflection) =>
  hasComment(reflection.comment) ||
  !!reflection.signatures?.some((signature) => hasComment(signature.comment)) ||
  hasComment(reflection.getSignature?.comment) ||
  hasComment(reflection.setSignature?.comment);

/** Members that get an anchor of their own: what a class or an interface declares itself */
export const getOwnMembers = (symbol: DeclarationReflection) =>
  (symbol.children ?? []).filter((child) => !child.inheritedFrom);

const getPagePath = (subtree: ApiSubtree, relPath: string) =>
  `${API_SECTION_PATH}${subtree}/${relPath ? `${relPath}/` : ''}`;

/** `src/_engine/kernel/scene/SceneLoader.ts` → its subtree and `kernel/scene/SceneLoader` */
const locateModule = (sourcePath: string) => {
  for (const { id, sourceDir } of API_SUBTREES) {
    if (sourcePath.startsWith(`${sourceDir}/`)) {
      return {
        subtree: id,
        relPath: sourcePath.slice(sourceDir.length + 1).replace(/(\.d)?\.ts$/, ''),
      };
    }
  }
  return null;
};

/**
 * The page a module (`src/_engine/kernel/scene/SceneLoader.ts` →
 * `documentation/engine/kernel/scene/SceneLoader/`) or a folder (`src/_engine/kernel/` →
 * `documentation/engine/kernel/`) had before the pages became the entries' (p619 D6); `null`
 * outside both subtrees. Only p608's dormant codemod reads it, which p619 D9 removes.
 */
export const getApiPagePath = (sourcePath: string): string | null => {
  const isFolder = sourcePath.endsWith('/');
  const location = locateModule(isFolder ? `${sourcePath}index.ts` : sourcePath);
  if (!location) return null;
  const relPath = isFolder ? location.relPath.replace(/\/?index$/, '') : location.relPath;
  return getPagePath(location.subtree, relPath);
};

export const indexApiModel = (project: JSONOutput.ProjectReflection): ApiIndex => {
  const modules: ApiModule[] = [];
  const reflections = new Map<number, DeclarationReflection>();
  for (const reflection of project.children ?? []) {
    const sourcePath = reflection.sources?.[0]?.fileName;
    const location = sourcePath ? locateModule(sourcePath) : null;
    if (!sourcePath || !location) continue;
    const symbols = reflection.children ?? [];
    modules.push({
      reflection,
      ...location,
      sourcePath,
      file: path.join(ROOT, sourcePath),
      symbols,
    });
    for (const symbol of symbols) {
      reflections.set(symbol.id, symbol);
      if (symbol.kind !== Kind.Class && symbol.kind !== Kind.Interface) continue;
      for (const member of getOwnMembers(symbol)) reflections.set(member.id, member);
    }
  }
  modules.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return { project, modules, reflections };
};
