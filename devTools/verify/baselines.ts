/**
 * The baselines (`yarn verify:baselines`, p601 Phase 3): what a refactor must not change by
 * accident, as three committed JSON files in `devTools/verify/baselines/`, none of them machine
 * dependent, diffed against the current state.
 *
 *   yarn verify:baselines [--update [--allow-docs-drop]] [--no-build] [--docs]
 *
 * - `bundle.json`: every file in `dist/assets/` (name without its content hash, bytes and gzip),
 *   and the main chunk's modules summed per group (three, Rapier, each engine folder, toolkit,
 *   app; the visualizer's rendered and gzip sizes, before minification, as p600 §2.4 counts).
 *   The measuring is `devTools/sbp/bundleModel.ts`', which `yarn sbp` shares (p611 D1).
 * - `api.json`: every export of the documented API (the Hub's TypeDoc model: `src/_engine` and
 *   `src/toolkit` minus `_dbg__*`, tests and the entries) by module, with its kind,
 *   and each public entry's (`aekasha`, `aekasha/*`, p606) export names, read from its file.
 * - `docs.json`: documented / total exports and class and interface members per folder (the
 *   Hub's coverage rule: re-exports don't count), as p600 §2.5 counts them, and each folder's
 *   undocumented ones by name (`SceneLoader#loadScene`, `ECS#ECSWorld.addSystem`).
 *
 * It exits 1 when something needs a look: a chunk whose gzip grew by more than 1 % or 2 kB (and at
 * least 100 B), a new chunk, an export added, removed, moved or of another kind, a name added to or
 * removed from an entry, or a folder with
 * more undocumented exports or members than recorded (the docs ratchet, p605 S4: it names each new
 * one with its file and line; a new folder starts at none). Shrinking and better coverage are
 * reported and pass, and so does deleting documented code. `--update` writes the current state as
 * the baselines (commit them with the change that explains them), but refuses a grown undocumented
 * count unless it's given `--allow-docs-drop` as well, so a drop is recorded only on purpose.
 *
 * The same build is checked for debug code (p607 D7, `debugInProduction.ts`): a `_dbg__` chunk or
 * module, or a `debug/*.ts` wrapper, fails the run and `--update` records nothing.
 *
 * It runs the production build's steps first (decoders, the production gather, `vite build`, then
 * the dev gather again, as `yarn build` does, without `tsc` and the Hub); `--no-build` reuses
 * `dist/` and `dist-stats/` from the last build. `--docs` checks (or records) `docs.json` alone,
 * without the build, `api.json` or the progress log (the Stop hook runs it, also while another
 * verify command writes the log). The TypeDoc model is the Hub's, converted only when its inputs
 * changed (`.cache/hub/typedoc.json`). `NO_COLOR` turns the colours off.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ROOT } from '../assetPipeline/sources';
import { ENTRY_FILES } from '../aliases';
import { loadApiModel } from '../hub/api/extract';
import { parseModuleSource } from '../refactor/importGraph';
import { getOwnMembers, indexApiModel, isDocumented, Kind } from '../hub/api/model';
import { out, PROGRESS_LOG_WATCH, setProgressLogEnabled } from './progressLog';
import { type BuildModule, findDebugCodeInBuild } from './debugInProduction';
import { isGrowthToFlag } from './bundleGrowth';
import { type BundleBaseline, collectBundle, sortKeys } from '../sbp/bundleModel';

/** Bump when that file's shape changes: an old one is then read as missing (`bundle.json`'s is
 * `bundleModel.ts`') */
const API_FORMAT_VERSION = 1;
const DOCS_FORMAT_VERSION = 2;
const BASELINES_DIR = path.join(ROOT, 'devTools/verify/baselines');

const color = (code: string) => (process.env.NO_COLOR ? '' : `\x1b[${code}m`);
const RED = color('31');
const GREEN = color('32');
const YELLOW = color('33');
const DIM = color('2');
const RESET = color('0');

export type ApiBaseline = {
  formatVersion: number;
  /** Source path → export name → kind (`Function`, `Class`, … several joined by `, `) */
  modules: Record<string, Record<string, string>>;
  /** Entry (`aekasha/physics`) → the names it exports; missing in a baseline from before p606 */
  entries?: Record<string, string[]>;
};
export type Coverage = { documented: number; total: number };
export type FolderCoverage = { exports: Coverage; members: Coverage };
export type DocsPart = 'exports' | 'members';
export type FolderDocs = FolderCoverage & {
  /**
   * By the module's file name in the folder: `SceneLoader#LoadSceneProps`, a class or interface
   * member after its owner (`ECS#ECSWorld.addSystem`). A name a module exports twice (a value and
   * a type) is listed twice.
   */
  undocumented: Record<DocsPart, string[]>;
};
export type DocsBaseline = {
  formatVersion: number;
  total: FolderCoverage;
  subtrees: Record<string, FolderCoverage>;
  /** `engine/features/physics`, `toolkit` (the subtree's own folder): its own modules, not below */
  folders: Record<string, FolderDocs>;
};
/** `engine/kernel/scene/SceneLoader#LoadSceneProps` (folder, then the undocumented name) → `file:line` */
type DocsLocations = Map<string, string>;

/** A finding: `attention` ones make the run exit 1 */
type Finding = { line: string; attention: boolean };

const fail = (msg: string): never => {
  out(`${RED}${msg}${RESET}`, true);
  process.exit(2);
};

const USAGE = 'yarn verify:baselines [--update [--allow-docs-drop]] [--no-build] [--docs]';

const parseArgs = (argv: string[]) => {
  const args = { update: false, build: true, docsOnly: false, allowDocsDrop: false };
  for (const arg of argv) {
    if (arg === '--update') args.update = true;
    else if (arg === '--no-build') args.build = false;
    else if (arg === '--docs') args.docsOnly = true;
    else if (arg === '--allow-docs-drop') args.allowDocsDrop = true;
    else fail(`Unknown argument: ${arg} (usage: ${USAGE})`);
  }
  if (args.allowDocsDrop && !args.update) fail(`--allow-docs-drop goes with --update (${USAGE})`);
  return args;
};

const readJSON = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const formatKB = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;
const formatSigned = (bytes: number) => `${bytes >= 0 ? '+' : '−'}${formatKB(Math.abs(bytes))}`;
const formatShare = (c: Coverage) =>
  `${c.documented} / ${c.total}${c.total ? ` (${Math.round((c.documented / c.total) * 100)} %)` : ''}`;

// --- Build ---

/** Runs `yarn <args>`, its output into the progress log */
const runYarn = (args: string[], env: Record<string, string> = {}) =>
  new Promise<void>((resolve, reject) => {
    out(
      `${DIM}$ ${Object.entries(env)
        .map(([k, v]) => `${k}=${v} `)
        .join('')}yarn ${args.join(' ')}${RESET}`
    );
    const child = spawn('yarn', ['-s', ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    const pipe = (stream: NodeJS.ReadableStream, isError: boolean) => {
      let pending = '';
      stream.on('data', (data: Buffer) => {
        const lines = (pending + data.toString()).split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) out(`  ${line}`, isError);
      });
      stream.on('end', () => pending && out(`  ${pending}`, isError));
    };
    pipe(child.stdout, false);
    pipe(child.stderr, true);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`yarn ${args.join(' ')} exited with ${code}`))
    );
  });

/** `yarn build`'s bundle steps; the dev data is gathered again whatever happens */
const buildBundle = async () => {
  try {
    await runYarn(['copyDecoders']);
    await runYarn(['gatherAppData'], { NODE_ENV: 'production' });
    // Set, not inherited: a shell's `development` would build the debug code in (`__AEK_DEBUG__`)
    await runYarn(['vite', 'build'], { VITE_APP_ENV: 'production' });
  } finally {
    await runYarn(['gatherAppData']);
  }
};

// --- bundle.json ---

/** Prints the debug check's findings (p607 D7); returns their count */
const reportDebugCode = (bundle: BundleBaseline, modules: BuildModule[]) => {
  const findings = findDebugCodeInBuild(Object.keys(bundle.chunks), modules);
  out(`\nproduction build: debug code`);
  if (!findings.length) out(`  ${GREEN}none${RESET}`);
  for (const line of findings) out(`  ${RED}✗ ${line}${RESET}`);
  return findings.length;
};

const diffBundle = (before: BundleBaseline, after: BundleBaseline): Finding[] => {
  const findings: Finding[] = [];
  for (const [name, size] of Object.entries(after.chunks)) {
    const old = before.chunks[name];
    if (!old) {
      findings.push({ line: `new ${name}: ${formatKB(size.gzip)} gzip`, attention: true });
    } else if (isGrowthToFlag(old.gzip, size.gzip)) {
      findings.push({
        line: `${name}: ${formatKB(old.gzip)} → ${formatKB(size.gzip)} gzip (${formatSigned(size.gzip - old.gzip)})`,
        attention: true,
      });
    } else if (isGrowthToFlag(size.gzip, old.gzip)) {
      findings.push({
        line: `${name}: ${formatKB(old.gzip)} → ${formatKB(size.gzip)} gzip (${formatSigned(size.gzip - old.gzip)})`,
        attention: false,
      });
    }
  }
  for (const name of Object.keys(before.chunks)) {
    if (!after.chunks[name]) findings.push({ line: `gone: ${name}`, attention: false });
  }
  // The main chunk's groups explain a change of it (details, never a reason on their own)
  for (const [group, size] of Object.entries(after.mainGroups)) {
    const old = before.mainGroups[group];
    const oldGzip = old?.gzip ?? 0;
    if (isGrowthToFlag(oldGzip, size.gzip) || isGrowthToFlag(size.gzip, oldGzip)) {
      findings.push({
        line: `  main ${group}: ${formatKB(oldGzip)} → ${formatKB(size.gzip)} gzip (${formatSigned(size.gzip - oldGzip)}, ${old?.modules ?? 0} → ${size.modules} modules)`,
        attention: false,
      });
    }
  }
  for (const group of Object.keys(before.mainGroups)) {
    if (!after.mainGroups[group]) {
      findings.push({ line: `  main ${group}: gone from the main chunk`, attention: false });
    }
  }
  return findings;
};

// --- api.json and docs.json ---

const KIND_NAMES = new Map<number, string>(Object.entries(Kind).map(([name, n]) => [n, name]));

const addTo = (into: Coverage, documented: boolean) => {
  into.total++;
  if (documented) into.documented++;
};
const emptyFolderCoverage = (): FolderCoverage => ({
  exports: { documented: 0, total: 0 },
  members: { documented: 0, total: 0 },
});
const emptyFolderDocs = (): FolderDocs => ({
  ...emptyFolderCoverage(),
  undocumented: { exports: [], members: [] },
});

const getSourceLocation = (reflection: { sources?: { fileName: string; line: number }[] }) => {
  const source = reflection.sources?.[0];
  return source ? `${source.fileName}:${source.line}` : '?';
};

/** Each entry's export names, from its file's AST (an entry re-exports by name) */
const collectEntries = (): Record<string, string[]> =>
  sortKeys(
    Object.fromEntries(
      Object.entries(ENTRY_FILES).map(([entry, file]) => {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
        const { exports } = parseModuleSource(file, text);
        if (exports.star.length) fail(`${file}: an entry re-exports by name, not \`export *\``);
        return [entry, [...exports.local, ...Object.keys(exports.named)].sort()];
      })
    )
  );

const collectApiAndDocs = async () => {
  out(`${DIM}The TypeDoc model (converted only when its inputs changed)…${RESET}`);
  const result = await loadApiModel();
  if (!result.model) {
    for (const m of result.messages) out(`  ${m.message}`, true);
    return fail('The TypeDoc conversion failed');
  }
  out(
    `${DIM}  ${result.isCached ? 'cached' : 'converted'} in ${(result.durationMs / 1000).toFixed(1)} s${RESET}`
  );
  const index = indexApiModel(result.model.project);

  const modules: ApiBaseline['modules'] = {};
  const docs: DocsBaseline = {
    formatVersion: DOCS_FORMAT_VERSION,
    total: emptyFolderCoverage(),
    subtrees: {},
    folders: {},
  };
  const locations: DocsLocations = new Map();
  for (const module of index.modules) {
    const exports: Record<string, string[]> = {};
    for (const symbol of module.symbols) {
      (exports[symbol.name] ??= []).push(KIND_NAMES.get(symbol.kind) ?? String(symbol.kind));
    }
    modules[module.sourcePath] = sortKeys(
      Object.fromEntries(
        Object.entries(exports).map(([name, kinds]) => [name, kinds.sort().join(', ')])
      )
    );

    const slash = module.relPath.lastIndexOf('/');
    const dir = slash >= 0 ? module.relPath.slice(0, slash) : '';
    const fileName = module.relPath.slice(slash + 1);
    const folderKey = dir ? `${module.subtree}/${dir}` : module.subtree;
    const folder = (docs.folders[folderKey] ??= emptyFolderDocs());
    const subtree = (docs.subtrees[module.subtree] ??= emptyFolderCoverage());
    const addUndocumented = (part: DocsPart, name: string, location: string) => {
      folder.undocumented[part].push(`${fileName}#${name}`);
      locations.set(`${folderKey}/${fileName}#${name}`, location);
    };
    for (const symbol of module.symbols) {
      if (symbol.kind === Kind.Reference) continue;
      const documented = isDocumented(symbol);
      for (const into of [folder, subtree, docs.total]) addTo(into.exports, documented);
      if (!documented) addUndocumented('exports', symbol.name, getSourceLocation(symbol));
      if (symbol.kind !== Kind.Class && symbol.kind !== Kind.Interface) continue;
      for (const member of getOwnMembers(symbol)) {
        const memberDocumented = isDocumented(member);
        for (const into of [folder, subtree, docs.total]) addTo(into.members, memberDocumented);
        if (!memberDocumented) {
          addUndocumented('members', `${symbol.name}.${member.name}`, getSourceLocation(member));
        }
      }
    }
  }
  for (const folder of Object.values(docs.folders)) {
    for (const names of Object.values(folder.undocumented)) names.sort();
  }
  docs.subtrees = sortKeys(docs.subtrees);
  docs.folders = sortKeys(docs.folders);
  return {
    api: {
      formatVersion: API_FORMAT_VERSION,
      modules: sortKeys(modules),
      entries: collectEntries(),
    } as ApiBaseline,
    docs,
    locations,
  };
};

const diffApi = (before: ApiBaseline, after: ApiBaseline): Finding[] => {
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
 * The ratchet (S4): a folder whose undocumented exports or members grew in number is a finding to
 * look at, naming each new one with its file and line. A share change (deleted documented code,
 * better coverage) and a same-count swap are only reported.
 */
const diffDocs =
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

// --- Main ---

const writeBaseline = (name: string, data: unknown) => {
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASELINES_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
};

const readBaseline = <T extends { formatVersion: number }>(name: string, formatVersion: number) => {
  const data = readJSON<T>(path.join(BASELINES_DIR, name));
  return data?.formatVersion === formatVersion ? data : null;
};

const report = <T extends { formatVersion: number }>(
  name: string,
  summary: string,
  current: T,
  diff: (before: T, after: T) => Finding[],
  isUpdate: boolean
) => {
  const before = readBaseline<T>(name, current.formatVersion);
  out(`\n${name}: ${summary}`);
  if (!before) {
    out(`  ${YELLOW}no baseline${isUpdate ? '' : ' (record one with --update)'}${RESET}`);
    return { name, attention: 0, changes: 1 };
  }
  const findings = diff(before, current);
  if (!findings.length) out(`  ${GREEN}unchanged${RESET}`);
  for (const f of findings) out(`  ${f.attention ? `${RED}✗` : `${DIM}·`} ${f.line}${RESET}`);
  return { name, attention: findings.filter((f) => f.attention).length, changes: findings.length };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  // The Stop hook runs --docs, also while a verify command started from a terminal writes the log
  if (args.docsOnly) setProgressLogEnabled(false);
  out(
    `Baselines (${path.relative(ROOT, BASELINES_DIR)}/${args.docsOnly ? 'docs.json' : ''})${args.update ? ', recording them' : ''}${args.build && !args.docsOnly ? '' : ', without a build'}`
  );
  if (!args.docsOnly) out(`${DIM}Watch it: ${PROGRESS_LOG_WATCH}${RESET}\n`);
  const started = Date.now();

  if (args.build && !args.docsOnly) await buildBundle();
  const { bundle = null, modules = [] } = args.docsOnly ? {} : collectBundle();
  const { api, docs, locations } = await collectApiAndDocs();

  const exportCount = Object.values(api.modules).reduce((n, m) => n + Object.keys(m).length, 0);
  const entryExportCount = Object.values(api.entries ?? {}).reduce((n, e) => n + e.length, 0);
  const results = [
    ...(bundle
      ? [
          report(
            'bundle.json',
            `${Object.keys(bundle.chunks).length} files; main ${bundle.main.chunk} ${bundle.main.modules} modules, ${formatKB(bundle.main.rendered)} rendered, ${formatKB(bundle.main.gzip)} gzip`,
            bundle,
            diffBundle,
            args.update
          ),
          report(
            'api.json',
            `${exportCount} exports in ${Object.keys(api.modules).length} modules; ${entryExportCount} in ${Object.keys(api.entries ?? {}).length} entries`,
            api,
            diffApi,
            args.update
          ),
        ]
      : []),
    report(
      'docs.json',
      `exports ${formatShare(docs.total.exports)}, members ${formatShare(docs.total.members)} documented`,
      docs,
      diffDocs(locations),
      args.update
    ),
  ];

  const debugFindings = bundle ? reportDebugCode(bundle, modules) : 0;
  const attention = results.reduce((n, r) => n + r.attention, debugFindings);
  const changes = results.reduce((n, r) => n + r.changes, 0);
  const docsDrops = results.find((r) => r.name === 'docs.json')?.attention ?? 0;
  const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
  const docsHint = `Document each one above (a JSDoc summary), or record the drop on purpose: yarn verify:baselines${args.docsOnly ? ' --docs' : ''} --update --allow-docs-drop, with the reason in the commit.`;
  const debugHint = `Debug code in a production build: it must fold out (\`__AEK_DEBUG__\`, the debug loader), never be recorded.${args.build ? '' : ' A `dist/` from `yarn build:test` holds it by design: run without --no-build.'}`;
  if (args.update) {
    if (debugFindings) {
      out(`\n${RED}Nothing recorded${RESET}: ${debugFindings} finding(s). ${debugHint}`);
      process.exit(1);
    }
    if (docsDrops && !args.allowDocsDrop) {
      out(
        `\n${RED}Nothing recorded${RESET}: ${docsDrops} folder count(s) of undocumented exports or members grew. ${docsHint}`
      );
      process.exit(1);
    }
    if (bundle) {
      writeBaseline('bundle.json', bundle);
      writeBaseline('api.json', api);
    }
    writeBaseline('docs.json', docs);
    out(
      `\n${GREEN}Recorded ${bundle ? 'the baselines' : 'docs.json'}${RESET} in ${took}${docsDrops ? `, with ${docsDrops} grown undocumented count(s) (--allow-docs-drop)` : ''}: commit ${bundle ? 'them' : 'it'} with the change.`
    );
    return;
  }
  if (attention) {
    out(`\n${RED}${attention} change(s) to look at${RESET} in ${took}.`);
    if (docsDrops) out(`Undocumented exports or members added: ${docsHint}`);
    if (debugFindings) out(debugHint);
    if (attention > docsDrops + debugFindings) {
      out(
        "Bundle or API changes: if they're intended, record them with --update and commit the baselines with the change."
      );
    }
    process.exit(1);
  }
  out(
    changes
      ? `\n${GREEN}Nothing to look at${RESET} in ${took}; ${changes} smaller change(s): --update records them.`
      : `\n${GREEN}All ${bundle ? 'baselines' : 'of docs.json'} unchanged${RESET} in ${took}.`
  );
};

main().catch((err: Error) => fail(`The baselines stopped: ${err.message}`));
