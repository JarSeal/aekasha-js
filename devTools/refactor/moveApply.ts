/**
 * The move's rewrite rules (p608 §4.1, §4.3), without the file system: `applyMoveMap.ts` reads the
 * tree and writes the result, the tests run on trees in memory.
 *
 * - The path map: every file of the tree before the move to its path after it, from
 *   `moveMap.json`'s entries for one plan (the other plan's files stay where they are), each split
 *   file's target per export, and the inverse for the leftovers report.
 *
 * Every rewrite resolves against the tree before the move and writes against the one after it.
 */
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
    newFiles: new Set(owners.keys()),
    renames,
    deletes,
    errors,
  };
};
