/**
 * The move's rewrite rules (p608 §4.1, §4.3), without the file system: `applyMoveMap.ts` reads the
 * tree and writes the result, the tests run on trees in memory.
 *
 * - The path map: every file of the tree before the move to its path after it, from
 *   `moveMap.json`'s entries for one plan (the other plan's files stay where they are), each split
 *   file's target per export, and the inverse for the leftovers report.
 * - TypeScript (`rewriteTypeScript`): every string literal that names a file, resolved from its
 *   importer's old path to the old target, both mapped, and written as the relative path between
 *   the new ones in the style it had. An import of a split file is divided per target.
 *
 * Every rewrite resolves against the tree before the move and writes against the one after it.
 */
import path from 'path';
import ts from 'typescript';
import { resolveSpecifier } from './importGraph';
import type { MoveEntry, MovePlan } from './moveRules';

export type PathMap = {
  plan: MovePlan;
  /**
   * A file's path after the move: itself when it stays (a keep, the other plan's entry, a file the
   * map doesn't list), `null` when it's deleted or split, `undefined` when the tree hasn't got it
   */
  newPathOf: (file: string) => string | null | undefined;
  /** Each split file's target module per export */
  splits: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** The file a path held before the move; a split target no file moves to: its split file */
  oldPathOf: (file: string) => string | undefined;
  /** The tree before the move */
  oldFiles: ReadonlySet<string>;
  /** The tree after the move, the split targets included */
  newFiles: ReadonlySet<string>;
  /** Every move of the plan, case-only renames included: `git mv`'s list */
  renames: [from: string, to: string][];
  deletes: string[];
  /** Entries the tree contradicts: nothing may be written */
  errors: string[];
};

export type PathMapInput = {
  /** Every tracked file before the move (repo-relative) */
  files: Iterable<string>;
  /** `moveMap.json`'s `files` */
  moveMap: Readonly<Record<string, MoveEntry>>;
  plan: MovePlan;
};

/** The path map of one plan's entries, checked against the tree it runs on (§4.2) */
export const buildPathMap = ({ files, moveMap, plan }: PathMapInput): PathMap => {
  const tree = new Set(files);
  const errors: string[] = [];
  const moved = new Map<string, string | null>();
  const splits = new Map<string, Readonly<Record<string, string>>>();
  const renames: [string, string][] = [];
  const deletes: string[] = [];

  for (const [from, entry] of Object.entries(moveMap)) {
    if (entry.plan !== plan) continue;
    if (!tree.has(from)) {
      errors.push(`${from} is in the map but not in the tree: regenerate the map (moveMap.ts)`);
      continue;
    }
    switch (entry.action) {
      case 'keep':
        break;
      case 'move':
        if (entry.to && entry.to !== from) {
          moved.set(from, entry.to);
          renames.push([from, entry.to]);
        }
        break;
      case 'delete':
        moved.set(from, null);
        deletes.push(from);
        break;
      case 'split':
        if (!entry.split || !Object.keys(entry.split).length) {
          errors.push(`${from} is split without targets`);
          break;
        }
        moved.set(from, null);
        splits.set(from, entry.split);
        break;
      default:
        errors.push(`${from}: the codemod has no rule for '${entry.action}'`);
    }
  }

  const newPathOf = (file: string) => {
    if (!tree.has(file)) return undefined;
    const to = moved.get(file);
    return to === undefined ? file : to;
  };

  // The tree after the move, and its owners by path; on a case-insensitive file system (macOS)
  // two paths that differ only by case are one
  const owners = new Map<string, string>();
  const byCase = new Map<string, string>();
  const claim = (to: string, owner: string, isSplitTarget: boolean) => {
    const prior = owners.get(to);
    if (prior !== undefined && prior !== owner && !isSplitTarget) {
      errors.push(`${owner} and ${prior} both land on ${to}`);
    }
    if (prior === undefined || !isSplitTarget) owners.set(to, owner);
    const sameCase = byCase.get(to.toLowerCase());
    if (sameCase !== undefined && sameCase !== to) {
      errors.push(`${to} (from ${owner}) and ${sameCase} differ only by case`);
    }
    byCase.set(to.toLowerCase(), to);
  };
  for (const file of tree) {
    const to = newPathOf(file);
    if (!to) continue;
    // A move onto a file that stays, whichever of the two comes first
    const prior = owners.get(to);
    if (prior !== undefined) {
      const [mover, stayer] = to === file ? [prior, file] : to === prior ? [file, prior] : [];
      if (mover && stayer) {
        errors.push(`${mover} moves onto ${to}, which stays`);
        continue;
      }
    }
    claim(to, file, false);
  }
  // A split target may be a moved file's path, another split's target or the split file's own
  // path in another case: its parts are appended there (§4.4)
  for (const [file, targets] of splits) {
    for (const to of new Set(Object.values(targets))) claim(to, file, true);
  }

  return {
    plan,
    newPathOf,
    splits,
    oldPathOf: (file) => owners.get(file),
    oldFiles: tree,
    newFiles: new Set(owners.keys()),
    renames,
    deletes,
    errors,
  };
};

// Specifiers

type Edit = { start: number; end: number; text: string };

/** A rewritten module or stylesheet; `text` is the input when nothing changed */
export type RewriteResult = { text: string; errors: string[] };

const posix = path.posix;

const applyEdits = (text: string, edits: Edit[]) => {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
};

/** Every folder a tree's files are in (`''` for the root) */
const foldersCache = new WeakMap<ReadonlySet<string>, Set<string>>();
const foldersOf = (files: ReadonlySet<string>) => {
  let folders = foldersCache.get(files);
  if (!folders) {
    folders = new Set(['']);
    for (const file of files) {
      for (let i = file.indexOf('/'); i > 0; i = file.indexOf('/', i + 1)) {
        folders.add(file.slice(0, i));
      }
    }
    foldersCache.set(files, folders);
  }
  return folders;
};

/** A relative path written as a specifier: `./` for a sibling, `.` for the folder itself */
const toSpecifier = (fromDir: string, to: string) => {
  const rel = posix.relative(fromDir, to);
  if (!rel) return '.';
  return rel === '..' || rel.startsWith('../') ? rel : `./${rel}`;
};

const isRelative = (spec: string) =>
  spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';

/** The file a relative specifier names before the move (its query dropped); `undefined` when none */
const resolveOld = (map: PathMap, importer: string, spec: string) =>
  resolveSpecifier(importer, spec, { exists: (f) => map.oldFiles.has(f) }) ?? undefined;

const describeGone = (map: PathMap, file: string) =>
  map.splits.has(file) ? `${file}, which is split` : `${file}, which is deleted`;

/**
 * A relative specifier after the move, written as it was (with or without `.ts`, `/index` or not,
 * its query); `{}` when it stays as written. `target` stands for the file it names after the move
 * (a split file's part). A specifier naming a folder (`new URL('.', import.meta.url)`) keeps naming
 * it, and one naming nothing is left alone unless its importer moves.
 */
const moveSpecifier = (
  map: PathMap,
  importer: string,
  spec: string,
  target?: string
): { spec?: string; error?: string } => {
  if (!isRelative(spec)) return {};
  const newImporter = map.newPathOf(importer) as string;
  const query = /\?.*$/.exec(spec)?.[0] ?? '';
  const bare = spec.slice(0, spec.length - query.length);
  const base = posix.normalize(posix.join(posix.dirname(importer), bare)).replace(/\/$/, '');
  const newDir = posix.dirname(newImporter);
  const oldTarget = resolveOld(map, importer, bare);

  if (oldTarget === undefined) {
    if (foldersOf(map.oldFiles).has(base === '.' ? '' : base)) {
      if (!foldersOf(map.newFiles).has(base === '.' ? '' : base)) {
        return { error: `'${spec}' names the folder ${base}, which is empty after the move` };
      }
      if (newImporter === importer) return {};
      const trailing = bare.endsWith('/') && base !== '.' ? '/' : '';
      return { spec: toSpecifier(newDir, base === '.' ? '' : base) + trailing + query };
    }
    if (newImporter === importer) return {};
    return { error: `'${spec}' names no file: it can't follow its importer` };
  }

  const newTarget = target ?? map.newPathOf(oldTarget);
  if (!newTarget) return { error: `'${spec}' names ${describeGone(map, oldTarget)}` };
  if (newImporter === importer && newTarget === oldTarget) return {};

  // What resolving added to the written path decides how the new one is written
  const added = oldTarget.startsWith(base) ? oldTarget.slice(base.length) : '.js';
  let written: string;
  if (added === '') written = toSpecifier(newDir, newTarget);
  else if (added === '/index.ts') {
    if (posix.basename(newTarget) !== 'index.ts') {
      return { error: `'${spec}' names a folder's index, but ${newTarget} isn't one` };
    }
    written = toSpecifier(newDir, posix.dirname(newTarget));
  } else if (added === '.js') written = toSpecifier(newDir, newTarget.replace(/\.ts$/, '.js'));
  else written = toSpecifier(newDir, newTarget.slice(0, -added.length));

  const resolved = resolveSpecifier(newImporter, written, { exists: (f) => map.newFiles.has(f) });
  if (resolved !== newTarget) {
    return {
      error: `'${written}' from ${newImporter} would name ${resolved ?? 'nothing'}, not ${newTarget}`,
    };
  }
  return written + query === spec ? {} : { spec: written + query };
};

// Globs (`import.meta.glob`): `**`, `*` and `?`, which is all the tree uses

const GLOB_CHARS = /[*?]/;
const UNSUPPORTED_GLOB = /[[\]{}()]|[!+@]\(/;

const globToRegExp = (pattern: string) => {
  const segments = pattern.split('/');
  let re = '';
  segments.forEach((segment, i) => {
    const isLast = i === segments.length - 1;
    if (segment === '**') re += isLast ? '.*' : '(?:[^/]+/)*';
    else {
      re += segment
        .replace(/[.+^$|\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      if (!isLast) re += '/';
    }
  });
  return new RegExp(`^${re}$`);
};

type GlobPattern = { isNegated: boolean; pattern: string };

const parseGlob = (written: string): GlobPattern => {
  const isNegated = written.startsWith('!');
  return { isNegated, pattern: isNegated ? written.slice(1) : written };
};

/** The files a glob's patterns match, from its importer's folder */
const matchGlob = (patterns: GlobPattern[], dir: string, files: Iterable<string>) => {
  const tests = patterns.map(({ isNegated, pattern }) => ({
    isNegated,
    re: globToRegExp(posix.normalize(posix.join(dir, pattern))),
  }));
  const out = new Set<string>();
  for (const file of files) {
    if (
      tests.some((t) => !t.isNegated && t.re.test(file)) &&
      !tests.some((t) => t.isNegated && t.re.test(file))
    ) {
      out.add(file);
    }
  }
  return out;
};

/** Files before the move, as the files after it: a split file is its targets */
const mapFileSet = (map: PathMap, files: Iterable<string>) => {
  const out = new Set<string>();
  for (const file of files) {
    const to = map.newPathOf(file);
    if (to) out.add(to);
    else for (const target of Object.values(map.splits.get(file) ?? {})) out.add(target);
  }
  return out;
};

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((f) => b.has(f));

const describeSetDiff = (expected: Set<string>, actual: Set<string>) => {
  const missing = [...expected].filter((f) => !actual.has(f));
  const extra = [...actual].filter((f) => !expected.has(f));
  const list = (files: string[]) =>
    files.slice(0, 3).join(', ') + (files.length > 3 ? `, … (${files.length})` : '');
  return [
    missing.length ? `misses ${list(missing)}` : '',
    extra.length ? `adds ${list(extra)}` : '',
  ]
    .filter(Boolean)
    .join('; ');
};

/**
 * One glob pattern after the move: a file path is a specifier; a pattern's folder (the part before
 * its first wildcard) follows its files, when they all land in one folder at the same depth below it
 */
const moveGlobPattern = (
  map: PathMap,
  importer: string,
  { isNegated, pattern }: GlobPattern
): { pattern?: string; error?: string } => {
  const written = isNegated ? `!${pattern}` : pattern;
  if (!isRelative(pattern.split('/')[0]) || UNSUPPORTED_GLOB.test(pattern)) {
    return {
      error: `glob pattern '${written}': only relative paths with **, * and ? are supported`,
    };
  }
  const segments = pattern.split('/');
  const firstGlob = segments.findIndex((s) => GLOB_CHARS.test(s));
  if (firstGlob === -1) {
    const moved = moveSpecifier(map, importer, pattern);
    if (moved.error) return { error: `glob pattern ${moved.error}` };
    return moved.spec ? { pattern: (isNegated ? '!' : '') + moved.spec } : {};
  }

  const oldDir = posix.dirname(importer);
  const newDir = posix.dirname(map.newPathOf(importer) as string);
  const folder = posix.normalize(posix.join(oldDir, segments.slice(0, firstGlob).join('/') || '.'));
  const prefix = folder === '.' ? '' : folder;
  const rest = segments.slice(firstGlob).join('/');
  const matched = matchGlob([{ isNegated: false, pattern }], oldDir, map.oldFiles);
  const expected = mapFileSet(map, matched);

  const candidates = new Set([prefix]);
  const byDepth = new Set<string>();
  for (const file of matched) {
    const depth = (prefix ? file.slice(prefix.length + 1) : file).split('/').length;
    const to = map.newPathOf(file);
    if (to) byDepth.add(to.split('/').slice(0, -depth).join('/'));
  }
  if (byDepth.size === 1) candidates.add([...byDepth][0]);

  for (const candidate of candidates) {
    const next = `${toSpecifier(newDir, candidate)}/${rest}`;
    const found = matchGlob([{ isNegated: false, pattern: next }], newDir, map.newFiles);
    if (!matched.size || sameSet(found, expected)) {
      const nextWritten = (isNegated ? '!' : '') + next;
      return nextWritten === written ? {} : { pattern: nextWritten };
    }
  }
  return {
    error: `glob pattern '${written}': its files don't land in one folder (edit table)`,
  };
};

// TypeScript

const VI_PATH_CALLS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
]);

const isImportMeta = (node: ts.Node, name: string) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === name;

/** The specifier in a node that names a file, with how a split file may be named there */
type Site = {
  literal: ts.StringLiteralLike;
  /** The names it takes, for a split file: an `import()` type's qualifier */
  names?: string[];
  what: string;
};

/**
 * Rewrites one TypeScript module's paths for the move (§4.3): import and `export … from`
 * declarations (an import of a split file divided per target, in its place and kind), `import()`
 * and `import('…')` types, `vi.mock` and its siblings, `new URL('…', import.meta.url)` and
 * `import.meta.glob`'s patterns (their file sets checked). Only the string literals change, so the
 * quotes, the order and the formatting stay. A deleted or split module isn't rewritten.
 */
export const rewriteTypeScript = (map: PathMap, file: string, text: string): RewriteResult => {
  if (!map.newPathOf(file)) return { text, errors: [] };
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Edit[] = [];
  const errors: string[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const fail = (node: ts.Node, message: string) =>
    errors.push(`${file}:${lineOf(node)} ${message}`);
  const replaceLiteral = (literal: ts.StringLiteralLike, value: string) =>
    edits.push({ start: literal.getStart(sf) + 1, end: literal.getEnd() - 1, text: value });

  const moveSite = ({ literal, names, what }: Site) => {
    const spec = literal.text;
    const oldTarget = isRelative(spec)
      ? resolveOld(map, file, spec.replace(/\?.*$/, ''))
      : undefined;
    const split = oldTarget ? map.splits.get(oldTarget) : undefined;
    let target: string | undefined;
    if (split) {
      target = names?.length === 1 ? split[names[0]] : undefined;
      if (!target) {
        fail(literal, `${what} of ${oldTarget}, which is split: name its exports`);
        return;
      }
    }
    const moved = moveSpecifier(map, file, spec, target);
    if (moved.error) fail(literal, moved.error);
    else if (moved.spec) replaceLiteral(literal, moved.spec);
  };

  /** An import or re-export of a split file: one declaration per target, in its place */
  const divideDeclaration = (
    st: ts.ImportDeclaration | ts.ExportDeclaration,
    literal: ts.StringLiteral,
    oldTarget: string,
    split: Readonly<Record<string, string>>
  ) => {
    let elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[];
    let isTypeOnly: boolean;
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause;
      if (
        !clause ||
        clause.name ||
        !clause.namedBindings ||
        !ts.isNamedImports(clause.namedBindings)
      ) {
        const kind = !clause
          ? 'a side-effect import'
          : clause.name
            ? 'a default import'
            : 'a namespace import';
        fail(st, `${kind} of ${oldTarget}, which is split: import its names`);
        return;
      }
      elements = clause.namedBindings.elements;
      isTypeOnly = clause.isTypeOnly;
    } else {
      if (!st.exportClause || !ts.isNamedExports(st.exportClause)) {
        fail(st, `\`export *\` from ${oldTarget}, which is split: re-export its names`);
        return;
      }
      elements = st.exportClause.elements;
      isTypeOnly = st.isTypeOnly;
    }
    const groups = new Map<string, string[]>();
    for (const el of elements) {
      const name = (el.propertyName ?? el.name).text;
      const target = split[name];
      if (!target) {
        fail(el, `${oldTarget}'s split has no target for ${name}`);
        continue;
      }
      groups.set(target, [...(groups.get(target) ?? []), el.getText(sf)]);
    }
    const specs = new Map<string, string>();
    for (const target of groups.keys()) {
      const moved = moveSpecifier(map, file, literal.text, target);
      if (moved.error) fail(literal, moved.error);
      specs.set(target, moved.spec ?? literal.text);
    }
    if (errors.length) return;
    if (groups.size === 1) {
      const spec = specs.get([...groups.keys()][0]) as string;
      if (spec !== literal.text) replaceLiteral(literal, spec);
      return;
    }
    const start = st.getStart(sf);
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const indent = /^\s*$/.test(text.slice(lineStart, start)) ? text.slice(lineStart, start) : '';
    const quote = text[literal.getStart(sf)];
    const keyword = `${ts.isImportDeclaration(st) ? 'import' : 'export'}${isTypeOnly ? ' type' : ''}`;
    const semi = st.getText(sf).endsWith(';') ? ';' : '';
    const lines = [...groups].map(
      ([target, els]) =>
        `${keyword} { ${els.join(', ')} } from ${quote}${specs.get(target)}${quote}${semi}`
    );
    edits.push({ start, end: st.getEnd(), text: lines.join(`\n${indent}`) });
  };

  const moveGlob = (call: ts.CallExpression) => {
    const arg = call.arguments[0];
    const literals =
      arg && ts.isStringLiteralLike(arg)
        ? [arg]
        : arg && ts.isArrayLiteralExpression(arg)
          ? arg.elements
          : [];
    if (!literals.length || !literals.every(ts.isStringLiteralLike)) {
      fail(call, 'import.meta.glob without literal patterns');
      return;
    }
    const patterns = (literals as ts.StringLiteralLike[]).map((l) => parseGlob(l.text));
    const next: GlobPattern[] = [];
    let failed = false;
    (literals as ts.StringLiteralLike[]).forEach((literal, i) => {
      const moved = moveGlobPattern(map, file, patterns[i]);
      if (moved.error) {
        fail(literal, moved.error);
        failed = true;
      } else if (moved.pattern) replaceLiteral(literal, moved.pattern);
      next.push(moved.pattern ? parseGlob(moved.pattern) : patterns[i]);
    });
    if (failed) return;
    const expected = mapFileSet(map, matchGlob(patterns, posix.dirname(file), map.oldFiles));
    const newDir = posix.dirname(map.newPathOf(file) as string);
    const found = matchGlob(next, newDir, map.newFiles);
    if (!sameSet(found, expected)) {
      fail(call, `import.meta.glob after the move ${describeSetDiff(expected, found)}`);
    }
  };

  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const literal = node.moduleSpecifier;
      if (ts.isStringLiteral(literal)) {
        const oldTarget = isRelative(literal.text)
          ? resolveOld(map, file, literal.text.replace(/\?.*$/, ''))
          : undefined;
        const split = oldTarget ? map.splits.get(oldTarget) : undefined;
        if (oldTarget && split) divideDeclaration(node, literal, oldTarget, split);
        else moveSite({ literal, what: 'an import' });
      }
    } else if (ts.isImportTypeNode(node)) {
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        let qualifier = node.qualifier;
        while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
        moveSite({
          literal: arg.literal,
          names: qualifier ? [qualifier.text] : undefined,
          what: 'an `import()` type',
        });
      }
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (first && ts.isStringLiteralLike(first))
          moveSite({ literal: first, what: 'an `import()`' });
      } else if (isImportMeta(callee, 'glob')) {
        moveGlob(node);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'vi' &&
        VI_PATH_CALLS.has(callee.name.text) &&
        first &&
        ts.isStringLiteralLike(first)
      ) {
        moveSite({ literal: first, what: `vi.${callee.name.text}` });
      }
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.length === 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      isImportMeta(node.arguments[1], 'url')
    ) {
      moveSite({ literal: node.arguments[0], what: 'a `new URL`' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { text: errors.length ? text : applyEdits(text, edits), errors };
};
