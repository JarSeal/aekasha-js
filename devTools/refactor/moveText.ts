/**
 * The move's text rewrite (p608 §4.3, D6, D7), without the file system: paths in the documents,
 * the configs, the devTools and every TypeScript module's comments, and the leftovers report.
 *
 * - A moved file's path in its full (`src/_engine/core/Scene.ts`) and engine-relative
 *   (`core/Scene.ts`) forms, with or without `.ts`, between the boundaries `moveMap.ts`' report uses,
 *   so a path inside a relative import (`'../core/Scene'`) isn't matched. An engine-relative form
 *   without `.ts` needs a folder in it: a bare `InitApp` is a word, not a path.
 * - `hub:documentation/engine/<path>` links to the page of the module or folder they name, through
 *   the Hub's own URL rule (`getApiPagePath`), with their anchor. A folder whose modules don't land
 *   in one folder, and a split module's page without an anchor naming an export, are errors.
 * - TypeDoc's module-qualified links (`{@link _engine/InitApp!InitEngine}`).
 * - History isn't rewritten nor reported (D6): `CHANGELOG.md`, the plans, the migration guides, the
 *   codemod's own folder and the baselines (`compareBaselines.ts` maps those, §4.7).
 * - The leftovers: every mention of a moved, deleted or split file's path that's left after the
 *   rewrite, in every text file but the history (Phase 6's hand list).
 */
import path from 'path';
import ts from 'typescript';
import { API_SUBTREES, getApiPagePath } from '../hub/api/model';
import type { PathMap } from './moveApply';

const posix = path.posix;
const ENGINE = 'src/_engine/';

/**
 * - `history`: neither rewritten nor reported (D6)
 * - `text`: the whole text is rewritten (after a module's specifiers)
 * - `comments`: a module's specifiers, then its comments
 * - `scan`: only reported
 */
export type TextKind = 'history' | 'text' | 'comments' | 'scan';

const HISTORY = [
  /^CHANGELOG\.md$/,
  /^docs\/plans\//,
  /^hub\/pages\/documentation\/migration\//,
  /^devTools\/refactor\//,
  /^devTools\/verify\/baselines\//,
];
const TEXT = [
  /(^|\/)CLAUDE\.md$/,
  /^hub\/pages\/.*\.(md|html)$/,
  /^docs\/(issues|techniques)\/.*\.md$/,
  /^devTools\/.*\.ts$/,
  /^(readme\.md|vite\.config\.ts|vitest\.config\.ts|tsconfig\.json|eslint\.config\.js|package\.json)$/,
];

/** What the text rewrite does with a file (D6's lists) */
export const getTextKind = (file: string): TextKind => {
  if (HISTORY.some((re) => re.test(file))) return 'history';
  if (TEXT.some((re) => re.test(file))) return 'text';
  return file.endsWith('.ts') ? 'comments' : 'scan';
};

/** A module the API reference has a page for (`tsconfig.json`'s `typedocOptions`) */
const isApiModule = (file: string) =>
  API_SUBTREES.some(({ sourceDir }) => file.startsWith(`${sourceDir}/`)) &&
  file.endsWith('.ts') &&
  !file.endsWith('.test.ts') &&
  !posix.basename(file).startsWith('_dbg__') &&
  posix.basename(file) !== 'index.ts';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `moveMap.ts`' boundaries, but a sentence's full stop after a path ends it */
const pathPattern = (forms: Iterable<string>) => {
  const sorted = [...forms].sort((a, b) => b.length - a.length).map(escape);
  return sorted.length
    ? new RegExp(`(?<![\\w/.-])(${sorted.join('|')})(?![\\w/-]|\\.\\w)`, 'g')
    : null;
};

/** The ways a file's path is written: full and engine-relative, with or without `.ts` */
const pathForms = (file: string): string[] => {
  const forms = [file];
  const bare = file.endsWith('.ts') && !file.endsWith('.d.ts') ? file.slice(0, -3) : null;
  if (bare) forms.push(bare);
  if (file.startsWith(ENGINE)) {
    const rel = file.slice(ENGINE.length);
    forms.push(rel);
    if (bare && rel.includes('/')) forms.push(bare.slice(ENGINE.length));
  }
  return forms;
};

/** A form of an old path written for its new path */
const writeForm = (form: string, oldFile: string, newFile: string) => {
  const isFull = form.startsWith(ENGINE) || !oldFile.startsWith(ENGINE);
  const hasExtension = form.endsWith(posix.extname(oldFile));
  const full = hasExtension ? newFile : newFile.replace(/\.ts$/, '');
  return isFull || !newFile.startsWith(ENGINE) ? full : full.slice(ENGINE.length);
};

export type TextContext = {
  map: PathMap;
  /** Each form of a moved file's path → its form after the move */
  rewrites: Map<string, string>;
  rewritePattern: RegExp | null;
  /** The forms of every moved, deleted or split file, but those a file after the move also has */
  leftoverPattern: RegExp | null;
};

/** The patterns of one path map, built once for every file */
export const createTextContext = (map: PathMap): TextContext => {
  const rewrites = new Map<string, string>();
  for (const [from, to] of map.renames) {
    for (const form of pathForms(from)) rewrites.set(form, writeForm(form, from, to));
  }
  const taken = new Set([...map.newFiles].flatMap(pathForms));
  const gone = [...map.renames.map(([from]) => from), ...map.deletes, ...map.splits.keys()];
  const leftovers = gone.flatMap(pathForms).filter((form) => !taken.has(form));
  return {
    map,
    rewrites,
    rewritePattern: pathPattern(rewrites.keys()),
    leftoverPattern: pathPattern(leftovers),
  };
};

type Edit = { start: number; end: number; text: string };
type Problem = { at: number; message: string };

/** A split module's target for an exported name (`Owner.member` takes the owner's) */
const splitTarget = (split: Readonly<Record<string, string>>, name: string | undefined) =>
  name ? split[name.split('.')[0]] : undefined;

const HUB_LINK = /hub:documentation\/((?:engine|toolkit)(?:\/[\w.$-]+)*)(\/?)(#[\w.$-]*)?/g;

/** A `hub:documentation/…` link's page after the move (D7) */
const moveHubLink = (
  { map }: TextContext,
  page: string,
  anchor: string | undefined
): { page?: string; error?: string } => {
  const [subtreeId, ...rest] = page.split('/');
  const subtree = API_SUBTREES.find((s) => s.id === subtreeId);
  if (!subtree || !rest.length) return {};
  const source = `${subtree.sourceDir}/${rest.join('/')}`;

  // A module, which wins over a folder with its name (`core/ECS.ts` has `core/ECS/`'s URL)
  const module = [`${source}.ts`, `${source}.d.ts`].find((f) => map.oldFiles.has(f));
  if (module) {
    const split = map.splits.get(module);
    const to = split ? splitTarget(split, anchor?.slice(1)) : map.newPathOf(module);
    if (!to) {
      return {
        error: split
          ? `the page of ${module}, which is split: link an export's anchor`
          : `the page of ${module}, which is deleted`,
      };
    }
    return {
      page: getApiPagePath(to)
        ?.replace(/^documentation\//, '')
        .replace(/\/$/, ''),
    };
  }

  // A folder: where its modules land, at their depth below it
  const modules = [...map.oldFiles].filter((f) => f.startsWith(`${source}/`) && isApiModule(f));
  if (!modules.length) return {};
  const landing = new Map<string, number>();
  for (const file of modules) {
    const depth = file.slice(source.length + 1).split('/').length;
    const to = map.newPathOf(file);
    const targets = to ? [to] : Object.values(map.splits.get(file) ?? {});
    for (const target of targets) {
      const folder = target.split('/').slice(0, -depth).join('/');
      landing.set(folder, (landing.get(folder) ?? 0) + 1);
    }
  }
  if (landing.size !== 1) {
    const where = [...landing]
      .sort((a, b) => b[1] - a[1])
      .map(([folder, n]) => `${folder}/ ${n}`)
      .join(', ');
    return { error: `the page of ${source}/, whose modules land in ${where}` };
  }
  const folder = [...landing.keys()][0];
  return {
    page: getApiPagePath(`${folder}/`)
      ?.replace(/^documentation\//, '')
      .replace(/\/$/, ''),
  };
};

const TYPEDOC_LINK = /(\{@link(?:code|plain)?\s+)((?:_engine|toolkit)\/[\w./-]+)!([\w$.]+)/g;

/** The edits and problems of one stretch of text (`[start, end)` of `text`) */
const findEdits = (ctx: TextContext, text: string, start: number, end: number) => {
  const part = text.slice(start, end);
  const edits: Edit[] = [];
  const problems: Problem[] = [];

  if (ctx.rewritePattern) {
    for (const m of part.matchAll(ctx.rewritePattern)) {
      const at = start + (m.index as number);
      edits.push({ start: at, end: at + m[1].length, text: ctx.rewrites.get(m[1]) as string });
    }
  }
  for (const m of part.matchAll(HUB_LINK)) {
    const at = start + (m.index as number);
    const moved = moveHubLink(ctx, m[1], m[3]);
    if (moved.error) problems.push({ at, message: `hub: link: ${moved.error}` });
    else if (moved.page && moved.page !== m[1]) {
      const pageStart = at + 'hub:documentation/'.length;
      edits.push({ start: pageStart, end: pageStart + m[1].length, text: moved.page });
    }
  }
  for (const m of part.matchAll(TYPEDOC_LINK)) {
    const at = start + (m.index as number) + m[1].length;
    const module = [`src/${m[2]}.ts`, `src/${m[2]}.d.ts`].find((f) => ctx.map.oldFiles.has(f));
    if (!module) continue;
    const split = ctx.map.splits.get(module);
    const to = split ? splitTarget(split, m[3]) : ctx.map.newPathOf(module);
    if (!to) {
      problems.push({ at, message: `{@link}: ${module} is deleted` });
      continue;
    }
    const written = to.replace(/^src\//, '').replace(/(\.d)?\.ts$/, '');
    if (written !== m[2]) edits.push({ start: at, end: at + m[2].length, text: written });
  }
  return { edits, problems };
};

/** Every comment of a module, JSDoc included */
const commentRanges = (file: string, text: string): [number, number][] => {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const seen = new Map<number, number>();
  const visit = (node: ts.Node) => {
    // A comment after code on its line is the code's trailing comment, not the next one's
    for (const r of [
      ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
    ]) {
      seen.set(r.pos, r.end);
    }
    // A JSDoc node's children start inside its comment
    for (const child of node.getChildren(sf)) if (!ts.isJSDoc(child)) visit(child);
  };
  visit(sf);
  return [...seen].sort((a, b) => a[0] - b[0]);
};

const lineAt = (text: string, at: number) => text.slice(0, at).split('\n').length;

/**
 * Rewrites one file's text for the move: the whole text, or a module's comments only
 * (`getTextKind`). Run it after the file's specifiers are rewritten. On an error (a `hub:` link
 * that can't follow its page, a link to a deleted module) the text stays as it was.
 */
export const rewriteText = (
  ctx: TextContext,
  file: string,
  text: string
): { text: string; errors: string[] } => {
  const kind = getTextKind(file);
  if (kind === 'history' || kind === 'scan') return { text, errors: [] };
  const ranges: [number, number][] =
    kind === 'comments' ? commentRanges(file, text) : [[0, text.length]];
  const edits: Edit[] = [];
  const errors: string[] = [];
  for (const [start, end] of ranges) {
    const found = findEdits(ctx, text, start, end);
    edits.push(...found.edits);
    for (const p of found.problems) errors.push(`${file}:${lineAt(text, p.at)} ${p.message}`);
  }
  if (errors.length) return { text, errors };
  let out = text;
  let last = Infinity;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > last) {
      errors.push(`${file}:${lineAt(text, edit.start)} two rewrites overlap`);
      continue;
    }
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    last = edit.start;
  }
  return errors.length ? { text, errors } : { text: out, errors };
};

export type Leftover = { file: string; line: number; path: string };

/**
 * The paths of moved, deleted and split files a text still names (`file` is where the text is);
 * history isn't reported. A form that a file after the move also has isn't one.
 */
export const findLeftovers = (ctx: TextContext, file: string, text: string): Leftover[] => {
  if (!ctx.leftoverPattern || getTextKind(file) === 'history') return [];
  return [...text.matchAll(ctx.leftoverPattern)].map((m) => ({
    file,
    line: lineAt(text, m.index as number),
    path: m[1],
  }));
};
