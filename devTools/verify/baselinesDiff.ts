/**
 * The API and docs baselines' diffs (`yarn verify:baselines`, `baselines.ts`; the bundle's is
 * `sbp/bundleDiff.ts`'): `api.json`'s exports and entries, and `docs.json`'s ratchet. Pure, so
 * `baselinesDiff.test.ts` covers them.
 */

/** `api.json`: the documented API's exports by module, and each entry's names */
export type ApiBaseline = {
  formatVersion: number;
  /** Source path → export name → kind (`Function`, `Class`, … several joined by `, `) */
  modules: Record<string, Record<string, string>>;
  /** Entry (`aekasha/physics`) → the names it exports; missing in a baseline from before p606 */
  entries?: Record<string, string[]>;
};
/** Documented of all */
export type Coverage = { documented: number; total: number };
/** A folder's or a subtree's coverage: its exports, and its classes' and interfaces' members */
export type FolderCoverage = { exports: Coverage; members: Coverage };
/** What a coverage counts */
export type DocsPart = 'exports' | 'members';
/** A folder's coverage with its undocumented names */
export type FolderDocs = FolderCoverage & {
  /**
   * By the module's file name in the folder: `SceneLoader#LoadSceneProps`, a class or interface
   * member after its owner (`ECS#ECSWorld.addSystem`). A name a module exports twice (a value and
   * a type) is listed twice.
   */
  undocumented: Record<DocsPart, string[]>;
};
/** `docs.json`: the coverage in all, per subtree (engine, toolkit) and per folder */
export type DocsBaseline = {
  formatVersion: number;
  total: FolderCoverage;
  subtrees: Record<string, FolderCoverage>;
  /** `engine/features/physics`, `toolkit` (the subtree's own folder): its own modules, not below */
  folders: Record<string, FolderDocs>;
};
/** `engine/kernel/scene/SceneLoader#LoadSceneProps` (folder, then the undocumented name) → `file:line` */
export type DocsLocations = Map<string, string>;

/** A finding: `attention` ones make the run exit 1 */
export type Finding = { line: string; attention: boolean };

/** `documented / total (n %)` */
export const formatShare = (c: Coverage) =>
  `${c.documented} / ${c.total}${c.total ? ` (${Math.round((c.documented / c.total) * 100)} %)` : ''}`;

/**
 * `api.json`'s diff: an export added, removed, moved (the same name and kind in another module)
 * or of another kind, and a name added to or removed from an entry, an entry new or gone; each
 * needs a look.
 */
export const diffApi = (before: ApiBaseline, after: ApiBaseline): Finding[] => {
  type Entry = { module: string; name: string; kind: string };
  const flatten = (api: ApiBaseline) =>
    Object.entries(api.modules).flatMap(([module, exports]) =>
      Object.entries(exports).map(([name, kind]): Entry => ({ module, name, kind }))
    );
  const key = (e: Entry) => `${e.module}#${e.name}`;
  const beforeMap = new Map(flatten(before).map((e) => [key(e), e]));
  const afterMap = new Map(flatten(after).map((e) => [key(e), e]));
  const removed = [...beforeMap.values()].filter((e) => !afterMap.has(key(e)));
  const added = [...afterMap.values()].filter((e) => !beforeMap.has(key(e)));

  const findings: Finding[] = [];
  // The same name and kind gone from one module and new in another is a move
  for (const gone of [...removed]) {
    const moved = added.find((e) => e.name === gone.name && e.kind === gone.kind);
    if (!moved) continue;
    removed.splice(removed.indexOf(gone), 1);
    added.splice(added.indexOf(moved), 1);
    findings.push({
      line: `moved ${gone.name} (${gone.kind}): ${gone.module} → ${moved.module}`,
      attention: true,
    });
  }
  for (const e of removed) {
    findings.push({ line: `removed ${e.name} (${e.kind}) from ${e.module}`, attention: true });
  }
  for (const e of added) {
    findings.push({ line: `added ${e.name} (${e.kind}) in ${e.module}`, attention: true });
  }
  for (const [k, e] of afterMap) {
    const old = beforeMap.get(k);
    if (old && old.kind !== e.kind) {
      findings.push({
        line: `${e.name} in ${e.module}: ${old.kind} → ${e.kind}`,
        attention: true,
      });
    }
  }
  // The public surface: what each entry exports
  const beforeEntries = before.entries ?? {};
  for (const [entry, names] of Object.entries(after.entries ?? {})) {
    const old = beforeEntries[entry];
    if (!old) {
      findings.push({ line: `new entry ${entry}: ${names.length} exports`, attention: true });
      continue;
    }
    const added = names.filter((n) => !old.includes(n));
    const removed = old.filter((n) => !names.includes(n));
    if (added.length) {
      findings.push({ line: `${entry} exports ${added.join(', ')}`, attention: true });
    }
    if (removed.length) {
      findings.push({ line: `${entry} no longer exports ${removed.join(', ')}`, attention: true });
    }
  }
  for (const entry of Object.keys(beforeEntries)) {
    if (!after.entries?.[entry]) findings.push({ line: `gone: entry ${entry}`, attention: true });
  }
  return findings;
};

const share = (c: Coverage) => (c.total ? c.documented / c.total : 1);

/** What `after` lists more often than `before` (both sorted lists, duplicates counted) */
const listAdded = (before: string[], after: string[]) => {
  const left = new Map<string, number>();
  for (const name of before) left.set(name, (left.get(name) ?? 0) + 1);
  return after.filter((name) => {
    const n = left.get(name) ?? 0;
    left.set(name, n - 1);
    return n <= 0;
  });
};

/**
 * `docs.json`'s diff, the ratchet (p605 S4): a folder whose undocumented exports or members grew in number is a finding to
 * look at, naming each new one with its file and line. A share change (deleted documented code,
 * better coverage) and a same-count swap are only reported.
 */
export const diffDocs =
  (locations: DocsLocations) =>
  (before: DocsBaseline, after: DocsBaseline): Finding[] => {
    const findings: Finding[] = [];
    for (const [folder, now] of Object.entries(after.folders)) {
      const old = before.folders[folder];
      for (const part of ['exports', 'members'] as const) {
        const oldNames = old?.undocumented[part] ?? [];
        const names = now.undocumented[part];
        const added = listAdded(oldNames, names).map(
          (name) => `      ${locations.get(`${folder}/${name}`) ?? '?'} ${name}`
        );
        if (names.length > oldNames.length) {
          findings.push({
            line: [
              `${folder}: ${oldNames.length} → ${names.length} undocumented ${part}${old ? '' : ' (a new folder starts at none)'}`,
              ...added,
            ].join('\n'),
            attention: true,
          });
          continue;
        }
        const a = old?.[part] ?? { documented: 0, total: 0 };
        const b = now[part];
        if (a.documented !== b.documented || a.total !== b.total) {
          findings.push({
            line: `${folder} ${part}: ${formatShare(a)} → ${formatShare(b)} documented${share(b) < share(a) - 1e-9 ? ' (a lower share, no more undocumented)' : ''}`,
            attention: false,
          });
        }
        if (added.length) {
          findings.push({
            line: [`${folder}: newly undocumented ${part}, as many fewer elsewhere`, ...added].join(
              '\n'
            ),
            attention: false,
          });
        }
      }
    }
    for (const folder of Object.keys(before.folders)) {
      if (!after.folders[folder]) findings.push({ line: `${folder}: gone`, attention: false });
    }
    return findings;
  };
