/**
 * The move's edit table (p608 D5): what the rewrite can't follow on its own, as an explicit list
 * of file, text to find and replacement. A glob or a regex that stands for a folder, a path in a
 * string the rewrite leaves alone (D6: only specifiers and comments change in `src/`), a `hub:`
 * folder link whose modules scatter.
 *
 * - The table runs last, on the texts the rewrite made, and the rewrite leaves alone every match
 *   inside a `find` (`rewriteText`'s `protect`), so the entry decides the replacement.
 * - Each `find` must occur as often as the entry says (once by default): a `main` that changed the
 *   line fails the rerun instead of being merged past.
 * - An entry's `check` ties its replacement to the move map: a glob or regex matches the same files
 *   after the move as before it, mapped; paths in strings name the same files, mapped.
 */
import path from 'path';
import { describeSetDiff, mapFileSet, matchGlob, sameSet, type PathMap } from './moveApply';
import type { MovePlan } from './moveRules';

const posix = path.posix;
const ENGINE = 'src/_engine/';

/** ESLint's `files` and `ignores`, from the repo root */
export type GlobSet = { files: string[]; ignores?: string[] };

export type EditCheck =
  /** The glob set matches the same files after the move, mapped; `find` and `replace` hold its quoted patterns */
  | { kind: 'globs'; before: GlobSet; after: GlobSet }
  /** The regex matches the same repo paths after the move, mapped; `find` and `replace` hold it as a literal */
  | { kind: 'regex'; before: RegExp; after: RegExp }
  /**
   * Each quoted string of `find` is a file before the move and the one of `replace` at its index
   * is that file after it: from the repo root, `src/_engine/` or the file's own folder
   */
  | { kind: 'paths'; base: 'repo' | 'engine' | 'file' };

export type MoveEdit = {
  plan: MovePlan;
  /** The file, by its path before the move */
  file: string;
  find: string;
  replace: string;
  /** How often `find` occurs; each occurrence is replaced (1 by default) */
  count?: number;
  why: string;
  check?: EditCheck;
};

const SIMULATION_BEFORE = [
  'src/_engine/core/Physics/**/*.ts',
  'src/_engine/workers/physicsWorker.ts',
  'src/_engine/workers/physics/**/*.ts',
  'src/_engine/core/PhysicsAPI.ts',
  'src/_engine/core/PhysicsManager.ts',
  'src/_engine/core/PhysicsTiers.ts',
  'src/_engine/core/PhysicsTierPolicy.ts',
  'src/_engine/core/Character.ts',
  'src/_engine/core/Character/**/*.ts',
  'src/toolkit/ecs/MovingPlatform.ts',
  'src/toolkit/ecs/effects/MutualGravity.ts',
];
const SIMULATION_AFTER = [
  'src/_engine/features/physics/**/*.ts',
  'src/_engine/features/character/**/*.ts',
  'src/toolkit/ecs/MovingPlatform.ts',
  'src/toolkit/ecs/effects/MutualGravity.ts',
];
const SIMULATION_IGNORES = [
  'src/_engine/features/*/index.ts',
  'src/_engine/features/*/debug/**',
  'src/_engine/features/physics/PhysicsFeature.ts',
  'src/_engine/features/physics/import/**',
  'src/_engine/features/physics/worker/PhysicsWorker.test.ts',
];
const quotedList = (patterns: string[]) => patterns.map((p) => `  '${p}',\n`).join('');

const SIDE_EFFECT_WORKERS_BEFORE = /^src\/_engine\/workers\/(physicsWorker|assetsWorker)\.ts$/;
const SIDE_EFFECT_WORKERS_AFTER =
  /^src\/_engine\/(features\/physics\/worker\/PhysicsWorker|kernel\/assets\/worker\/AssetsWorker)\.ts$/;

/** The table, in the order it applies */
export const MOVE_EDITS: MoveEdit[] = [
  {
    plan: 'p608',
    file: 'eslint.config.js',
    find: `const SIMULATION_FILES = [\n${quotedList(SIMULATION_BEFORE)}];\n`,
    replace:
      `const SIMULATION_FILES = [\n${quotedList(SIMULATION_AFTER)}];\n` +
      '// What the two feature folders hold besides the simulation: the installs and entries, the\n' +
      '// physics import extension and worker test, the debug modules\n' +
      `const SIMULATION_IGNORES = [\n${quotedList(SIMULATION_IGNORES)}];\n`,
    why: "the same files (D5): the physics and character folders also hold what the lint doesn't cover; widening it is p614's and p610's call",
    check: {
      kind: 'globs',
      before: { files: SIMULATION_BEFORE },
      after: { files: SIMULATION_AFTER, ignores: SIMULATION_IGNORES },
    },
  },
  {
    plan: 'p608',
    file: 'eslint.config.js',
    find: '    files: SIMULATION_FILES,\n',
    replace: '    files: SIMULATION_FILES,\n    ignores: SIMULATION_IGNORES,\n',
    why: "SIMULATION_IGNORES applies where SIMULATION_FILES does (the glob entry's check counts it)",
  },
  {
    plan: 'p608',
    file: 'eslint.config.js',
    find: "steps and draws randomness from a seeded RNG. p608's codemod rewrites these paths when it moves\n// the files.\n",
    replace:
      'steps and draws randomness from a seeded RNG. Two feature folders, without what else they hold\n' +
      '// (p608 D5: the set the lint covered before the move).\n',
    why: 'the comment named the move; it now says what the set is',
  },
  {
    plan: 'p608',
    file: 'devTools/verify/moduleSideEffects.test.ts',
    find: `  /${SIDE_EFFECT_WORKERS_BEFORE.source}/,\n`,
    replace: `  /${SIDE_EFFECT_WORKERS_AFTER.source}/,\n`,
    why: 'the worker entries are exempt by their paths (p608 D4), in two folders after the move',
    check: { kind: 'regex', before: SIDE_EFFECT_WORKERS_BEFORE, after: SIDE_EFFECT_WORKERS_AFTER },
  },
  {
    plan: 'p608',
    file: 'src/_engine/workers/physicsWorker.test.ts',
    find: "const FORBIDDEN_MODULES = ['core/MainLoop.ts', 'core/Config.ts', 'core/PhysicsAPI.ts'];",
    replace:
      'const FORBIDDEN_MODULES = [\n' +
      "  'kernel/loop/MainLoop.ts',\n" +
      "  'kernel/config/Config.ts',\n" +
      "  'features/physics/PhysicsAPI.ts',\n" +
      '];',
    why: "engine-relative paths in a string, matched against esbuild's inputs: left as they are, the boundary test would pass for nothing",
    check: { kind: 'paths', base: 'engine' },
  },
  {
    plan: 'p608',
    file: 'src/_engine/workers/physicsWorker.test.ts',
    find: "const WORKER = path.resolve(__dirname, 'physicsWorker.ts');",
    replace: "const WORKER = path.resolve(__dirname, 'PhysicsWorker.ts');",
    why: 'a path in a string, renamed: a case-sensitive file system (Linux, WSL2) has no physicsWorker.ts',
    check: { kind: 'paths', base: 'file' },
  },
  {
    plan: 'p608',
    file: 'devTools/verify/baselines.ts',
    find:
      "/** The main chunk's module groups: a package, an engine folder (core's subfolders apart), the\n" +
      " * toolkit, or the app (`src/app/` and `src/`'s own files) */",
    replace:
      "/** The main chunk's module groups: a package, an engine folder (kernel's and features'\n" +
      " * subfolders apart), the toolkit, or the app (`src/app/` and `src/`'s own files) */",
    why: "the bundle baseline's groups split kernel/ and features/ as they split core/",
  },
  {
    plan: 'p608',
    file: 'devTools/verify/baselines.ts',
    find: "    if (parts[1] === 'core' && parts.length > 3) return `_engine/core/${parts[2]}`;\n",
    replace:
      "    if ((parts[1] === 'kernel' || parts[1] === 'features') && parts.length > 3) {\n" +
      '      return `_engine/${parts[1]}/${parts[2]}`;\n' +
      '    }\n',
    why: "the bundle baseline's groups split kernel/ and features/ as they split core/",
  },
  {
    plan: 'p608',
    file: 'hub/pages/features/debug-suite/guide.md',
    find: '[debug](hub:documentation/engine/debug)',
    replace: '[debug](hub:documentation/engine/debug)',
    why: "the folder's page stays: 15 of its modules stay, 3DSymbols.ts goes to debug/symbols/ below it",
  },
  {
    plan: 'p608',
    file: 'hub/pages/features/lod/guide.md',
    find: '[Lod](hub:documentation/engine/core/Lod)',
    replace: '[Lod](hub:documentation/engine/features/lod)',
    why: 'the LOD folder lands in features/lod/, but LodFade.ts in kernel/render/',
  },
];

/** The table's `find`s per file, for one plan: what the rewrite leaves to the table */
export const getProtectedTexts = (edits: readonly MoveEdit[], plan: MovePlan) => {
  const out = new Map<string, string[]>();
  for (const edit of edits) {
    if (edit.plan === plan) out.set(edit.file, [...(out.get(edit.file) ?? []), edit.find]);
  }
  return out;
};

/** The strings in quotes of a text (paths and patterns: the table's texts quote nothing else) */
const quoted = (text: string) => [...text.matchAll(/(['"])([^'"\n]*)\1/g)].map((m) => m[2]);

const sameStrings = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((s, i) => s === [...b].sort()[i]);

const expandGlobs = ({ files, ignores = [] }: GlobSet, tree: Iterable<string>) =>
  matchGlob(
    [
      ...files.map((pattern) => ({ isNegated: false, pattern })),
      ...ignores.map((pattern) => ({ isNegated: true, pattern })),
    ],
    '',
    tree
  );

/** What's wrong with one entry's replacement against the move map (D5) */
export const checkEdit = (map: PathMap, edit: MoveEdit): string[] => {
  const { check } = edit;
  if (!check) return [];
  const at = `${edit.file}: '${edit.find.split('\n')[0]}'`;
  if (check.kind === 'globs') {
    const errors: string[] = [];
    const listed = (set: GlobSet) => [...set.files, ...(set.ignores ?? [])];
    if (!sameStrings(quoted(edit.find), listed(check.before))) {
      errors.push(`${at}: its find doesn't quote exactly the patterns before the move`);
    }
    if (!sameStrings(quoted(edit.replace), listed(check.after))) {
      errors.push(`${at}: its replacement doesn't quote exactly the patterns after the move`);
    }
    const matched = expandGlobs(check.before, map.oldFiles);
    if (!matched.size) errors.push(`${at}: its globs match nothing before the move`);
    const expected = mapFileSet(map, matched);
    const found = expandGlobs(check.after, map.newFiles);
    if (!sameSet(expected, found)) {
      errors.push(`${at}: its globs after the move ${describeSetDiff(expected, found)}`);
    }
    return errors;
  }
  if (check.kind === 'regex') {
    const errors: string[] = [];
    if (!edit.find.includes(`/${check.before.source}/`)) {
      errors.push(`${at}: its find doesn't hold the regex before the move`);
    }
    if (!edit.replace.includes(`/${check.after.source}/`)) {
      errors.push(`${at}: its replacement doesn't hold the regex after the move`);
    }
    const matched = [...map.oldFiles].filter((f) => check.before.test(f));
    if (!matched.length) errors.push(`${at}: its regex matches nothing before the move`);
    const expected = mapFileSet(map, matched);
    const found = new Set([...map.newFiles].filter((f) => check.after.test(f)));
    if (!sameSet(expected, found)) {
      errors.push(`${at}: its regex after the move ${describeSetDiff(expected, found)}`);
    }
    return errors;
  }
  // Paths in strings, in order
  const before = quoted(edit.find);
  const after = quoted(edit.replace);
  if (before.length !== after.length || !before.length) {
    return [`${at}: ${before.length} paths before the move, ${after.length} after it`];
  }
  const newFile = map.newPathOf(edit.file) ?? edit.file;
  const resolve = (p: string, file: string) =>
    check.base === 'repo'
      ? p
      : check.base === 'engine'
        ? `${ENGINE}${p}`
        : posix.join(posix.dirname(file), p);
  return before.flatMap((p, i) => {
    const old = resolve(p, edit.file);
    const to = map.oldFiles.has(old) ? map.newPathOf(old) : undefined;
    if (!to) return [`${at}: '${p}' names no file before the move`];
    const written = resolve(after[i], newFile);
    return written === to ? [] : [`${at}: '${after[i]}' names ${written}, not ${to}`];
  });
};

const countOf = (text: string, find: string) => text.split(find).length - 1;

/**
 * Applies one plan's entries to the texts after the rewrite (`textOf`, by the path before the
 * move), checking each; returns the texts it changed, by that path. On an error, nothing changes.
 */
export const applyEditTable = (
  map: PathMap,
  edits: readonly MoveEdit[],
  textOf: (file: string) => string | undefined
): { changed: Map<string, string>; errors: string[] } => {
  const changed = new Map<string, string>();
  const errors: string[] = [];
  for (const edit of edits) {
    if (edit.plan !== map.plan) continue;
    errors.push(...checkEdit(map, edit));
    const text =
      changed.get(edit.file) ?? (map.newPathOf(edit.file) ? textOf(edit.file) : undefined);
    if (text === undefined) {
      errors.push(`${edit.file}: not in the tree after the move (edit table)`);
      continue;
    }
    const expected = edit.count ?? 1;
    const found = countOf(text, edit.find);
    if (found !== expected) {
      errors.push(
        `${edit.file}: '${edit.find.split('\n')[0]}' occurs ${found} times, the edit table says ${expected}`
      );
      continue;
    }
    changed.set(edit.file, text.split(edit.find).join(edit.replace));
  }
  return errors.length ? { changed: new Map(), errors } : { changed, errors };
};
