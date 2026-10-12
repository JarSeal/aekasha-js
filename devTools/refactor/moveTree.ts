/**
 * The whole tree's rewrite for the move (p608 §4.3-§4.4), without the file system: every module's
 * specifiers and comments, the stylesheets and the documents (`moveApply.ts`, `moveText.ts`), then
 * the split files' parts (`moveSplit.ts`), then the edit table (`moveEdits.ts`), then the leftovers
 * on the result. `applyMoveMap.ts` writes what it returns; nothing may be written when it has
 * errors.
 */
import {
  rewriteStylesheet,
  rewriteTypeScript,
  type PathMap,
  type RewriteResult,
} from './moveApply';
import { applyEditTable, getProtectedTexts, type MoveEdit } from './moveEdits';
import { splitModules } from './moveSplit';
import {
  createTextContext,
  findLeftovers,
  getTextKind,
  rewriteText,
  type Leftover,
} from './moveText';

export type TreeRewrite = {
  /** The texts that change, by their path before the move (a moved file a split appends to too) */
  changed: Map<string, string>;
  /** The split targets that are no file's path after the move, by that path */
  created: Map<string, string>;
  /** The old paths still named, by the path after the move of the file naming them */
  leftovers: Leftover[];
  /** `file:line message`; on any, nothing may be written */
  errors: string[];
};

/**
 * Rewrites every text of a tree for the move: a module's specifiers then its comments (or its
 * whole text, `getTextKind`), a stylesheet's loads, a document's paths and links; then splits each
 * split file, its comments rewritten first; then applies the edit table's entries for the map's
 * plan, whose `find`s the text rewrite leaves alone. A deleted file isn't rewritten, history
 * neither (D6). Any error stops it before the next step.
 */
export const rewriteTree = (
  map: PathMap,
  texts: ReadonlyMap<string, string>,
  edits: readonly MoveEdit[]
): TreeRewrite => {
  const ctx = createTextContext(map);
  const protectedTexts = getProtectedTexts(edits, map.plan);
  const changed = new Map<string, string>();
  const errors: string[] = [];
  const splitTexts = new Map<string, string>();
  for (const [file, text] of texts) {
    if (getTextKind(file) === 'history') continue;
    if (map.splits.has(file)) {
      const comments = rewriteText(ctx, file, text);
      errors.push(...comments.errors);
      splitTexts.set(file, comments.text);
      continue;
    }
    if (!map.newPathOf(file)) continue;
    let next = text;
    const run = (result: RewriteResult) => {
      errors.push(...result.errors);
      next = result.text;
    };
    if (file.endsWith('.ts')) run(rewriteTypeScript(map, file, next));
    else if (/\.s[ac]ss$/.test(file)) run(rewriteStylesheet(map, file, next));
    run(rewriteText(ctx, file, next, protectedTexts.get(file)));
    if (next !== text) changed.set(file, next);
  }

  const created = new Map<string, string>();
  if (map.splits.size && !errors.length) {
    const split = splitModules(map, {
      texts,
      sourceText: (file) => splitTexts.get(file) ?? (texts.get(file) as string),
      current: (file) => changed.get(file) ?? (texts.get(file) as string),
    });
    errors.push(...split.errors);
    for (const [target, text] of split.targets) {
      const owner = map.oldPathOf(target) as string;
      if (map.newPathOf(owner) === target) changed.set(owner, text);
      else created.set(target, text);
    }
  }

  if (!errors.length) {
    const table = applyEditTable(map, edits, (file) => changed.get(file) ?? texts.get(file));
    errors.push(...table.errors);
    for (const [file, text] of table.changed) {
      if (text === texts.get(file)) changed.delete(file);
      else changed.set(file, text);
    }
  }

  const leftovers: Leftover[] = [];
  for (const [file, text] of texts) {
    const to = map.newPathOf(file);
    if (to) leftovers.push(...findLeftovers(ctx, to, changed.get(file) ?? text));
  }
  for (const [file, text] of created) leftovers.push(...findLeftovers(ctx, file, text));
  return { changed, created, leftovers, errors };
};
