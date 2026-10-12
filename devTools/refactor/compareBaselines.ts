/* eslint-disable no-console */
/**
 * The baselines after a move, against the ones before it mapped through the move map (p608 §4.7):
 *
 *   npx tsx devTools/refactor/compareBaselines.ts --plan p608 <base-sha>
 *
 * Reads `devTools/verify/baselines/` at `<base-sha>` (`git show`) and in the working tree (what
 * `yarn verify:baselines --update --allow-docs-drop` just wrote), maps the old ones through
 * `<base-sha>`'s `moveMap.json` for the plan, and exits 1 unless they differ only by paths:
 *
 * - `api.json`: the mapped `modules` equal the new ones (a split module's exports under their
 *   targets; a re-export whose name its target declares is dropped, as the split drops it; a
 *   deleted module's exports are gone with it), and `entries` are identical.
 * - `docs.json`: the totals equal, less what the deleted modules counted, and every undocumented
 *   name is undocumented in the same module at its new path (the per-folder counts follow).
 * - `bundle.json`: each chunk under its mapped name (a chunk named after a renamed module takes its
 *   new name; chunks of one name are paired by size, since their `#2` order follows the content
 *   hash) within the diff's tolerance (`bundleGrowth.ts`), no chunk new or gone, and the main
 *   chunk's totals within it too (its groups are per folder, so they're compared as a sum). A chunk
 *   outside the tolerance is named with the split parts the last build put in it
 *   (`dist-stats/`), the likely cause (p608 §7, risk 1).
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROOT } from '../assetPipeline/sources';
import { API_SUBTREES } from '../hub/api/model';
import type {
  ApiBaseline,
  BundleBaseline,
  DocsBaseline,
  DocsPart,
  FolderCoverage,
  Size,
} from '../verify/baselines';
import { isGrowthToFlag } from '../verify/bundleGrowth';
import { buildPathMap, type PathMap } from './moveApply';
import type { MovePlan } from './moveRules';

const posix = path.posix;

export type Baselines = { api: ApiBaseline; docs: DocsBaseline; bundle: BundleBaseline };

/** `attention` ones fail the comparison */
export type Finding = { line: string; attention: boolean };

const REFERENCE = 'Reference';

/** A module's export after the move: its own new path, or a split module's target for the name */
const targetOf = (map: PathMap, module: string, name: string) => {
  const split = map.splits.get(module);
  return split ? split[name.split('.')[0]] : map.newPathOf(module);
};

// api.json

/** The old `modules` at their paths after the move; `findings` say what didn't map */
export const mapApiModules = (map: PathMap, modules: ApiBaseline['modules']) => {
  const out: ApiBaseline['modules'] = {};
  const findings: Finding[] = [];
  // A module that exports nothing is listed too
  for (const module of Object.keys(modules)) {
    const to = map.splits.has(module) ? undefined : map.newPathOf(module);
    if (to) out[to] = {};
  }
  // Every export a module declares itself first: a split's re-export of the same name then drops
  const entries = Object.entries(modules).flatMap(([module, exports]) =>
    Object.entries(exports).map(([name, kind]) => ({ module, name, kind }))
  );
  entries.sort((a, b) => Number(a.kind === REFERENCE) - Number(b.kind === REFERENCE));
  for (const { module, name, kind } of entries) {
    const to = targetOf(map, module, name);
    if (to === null) {
      findings.push({ line: `api: ${name} goes with ${module} (deleted)`, attention: false });
      continue;
    }
    if (to === undefined) {
      const why = map.splits.has(module) ? 'its split has no target for it' : 'not in the map';
      findings.push({ line: `api: ${module}#${name}: ${why}`, attention: true });
      continue;
    }
    const target = (out[to] ??= {});
    const prior = target[name];
    if (prior === undefined) target[name] = kind;
    else if (kind !== REFERENCE) {
      findings.push({ line: `api: ${to} gets ${name} twice (${prior}, ${kind})`, attention: true });
    }
  }
  for (const [module, exports] of Object.entries(out)) out[module] = sortKeys(exports);
  return { modules: sortKeys(out), findings };
};

const sortKeys = <T>(obj: Record<string, T>) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

export const compareApi = (map: PathMap, before: ApiBaseline, after: ApiBaseline): Finding[] => {
  const mapped = mapApiModules(map, before.modules);
  const findings = [...mapped.findings];
  for (const module of new Set([...Object.keys(mapped.modules), ...Object.keys(after.modules)])) {
    const expected = mapped.modules[module] ?? {};
    const found = after.modules[module] ?? {};
    // A module without exports on either side shows only by its path
    if (!(module in mapped.modules) || !(module in after.modules)) {
      if (!Object.keys(expected).length && !Object.keys(found).length) {
        const where = module in after.modules ? 'new' : 'gone';
        findings.push({
          line: `api: ${module}, which exports nothing, is ${where}`,
          attention: true,
        });
      }
    }
    for (const name of new Set([...Object.keys(expected), ...Object.keys(found)])) {
      const [e, f] = [expected[name], found[name]];
      if (e === f) continue;
      const line =
        e === undefined
          ? `api: ${module} exports ${name} (${f}), which the mapped baseline hasn't`
          : f === undefined
            ? `api: ${module} doesn't export ${name} (${e}) any more`
            : `api: ${name} in ${module}: ${e} → ${f}`;
      findings.push({ line, attention: true });
    }
  }
  const entries = new Set([
    ...Object.keys(before.entries ?? {}),
    ...Object.keys(after.entries ?? {}),
  ]);
  for (const entry of entries) {
    const [e, f] = [before.entries?.[entry] ?? [], after.entries?.[entry] ?? []];
    if (e.join() !== f.join()) {
      const added = f.filter((n) => !e.includes(n));
      const removed = e.filter((n) => !f.includes(n));
      findings.push({
        line: `api: the entry ${entry} changed (added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'})`,
        attention: true,
      });
    }
  }
  return findings;
};

// docs.json

/** `engine/core/Lod` + `LodFade` → `src/_engine/core/Lod/LodFade.ts` */
const moduleOf = (folder: string, fileName: string) => {
  const [subtree, ...dir] = folder.split('/');
  const sourceDir = API_SUBTREES.find((s) => s.id === subtree)?.sourceDir;
  return sourceDir ? posix.join(sourceDir, ...dir, `${fileName}.ts`) : undefined;
};

/** `src/_engine/kernel/render/LodFade.ts` → [`engine/kernel/render`, `LodFade`] */
const folderOf = (module: string) => {
  const subtree = API_SUBTREES.find((s) => module.startsWith(`${s.sourceDir}/`));
  if (!subtree) return undefined;
  const rel = module.slice(subtree.sourceDir.length + 1).replace(/\.ts$/, '');
  const dir = posix.dirname(rel);
  return [dir === '.' ? subtree.id : `${subtree.id}/${dir}`, posix.basename(rel)] as const;
};

const subtreeOf = (folder: string) => folder.split('/')[0];

const PARTS: DocsPart[] = ['exports', 'members'];

const subtract = (from: FolderCoverage, part: DocsPart, total: number, undocumented: number) => {
  from[part].total -= total;
  from[part].documented -= total - undocumented;
};

const sameCoverage = (a: FolderCoverage | undefined, b: FolderCoverage | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const describeCoverage = (c: FolderCoverage | undefined) =>
  c ? PARTS.map((p) => `${p} ${c[p].documented} / ${c[p].total}`).join(', ') : 'none';

/**
 * The undocumented names at their new folders, and the totals less the deleted modules' share
 * (their exports from `api.json`: a deleted class's members can't be counted, an error)
 */
export const mapDocs = (map: PathMap, docs: DocsBaseline, api: ApiBaseline) => {
  const findings: Finding[] = [];
  const undocumented = new Map<string, Record<DocsPart, string[]>>();
  const total: FolderCoverage = structuredClone(docs.total);
  const subtrees: Record<string, FolderCoverage> = structuredClone(docs.subtrees);
  const deletedUndocumented = new Map<string, Record<DocsPart, number>>();
  for (const [folder, data] of Object.entries(docs.folders)) {
    for (const part of PARTS) {
      for (const entry of data.undocumented[part]) {
        const [fileName, name] = entry.split('#');
        const module = moduleOf(folder, fileName);
        const to = module ? targetOf(map, module, name) : undefined;
        if (to === null) {
          const counts = deletedUndocumented.get(module as string) ?? { exports: 0, members: 0 };
          counts[part]++;
          deletedUndocumented.set(module as string, counts);
          continue;
        }
        const at = to ? folderOf(to) : undefined;
        if (!at) {
          findings.push({ line: `docs: ${folder}/${entry} maps to no module`, attention: true });
          continue;
        }
        const lists = undocumented.get(at[0]) ?? { exports: [], members: [] };
        lists[part].push(`${at[1]}#${name}`);
        undocumented.set(at[0], lists);
      }
    }
  }
  for (const module of map.deletes) {
    const exports = api.modules[module];
    if (!exports) continue;
    const kinds = Object.values(exports)
      .flatMap((k) => k.split(', '))
      .filter((k) => k !== REFERENCE);
    if (kinds.some((k) => k === 'Class' || k === 'Interface')) {
      findings.push({
        line: `docs: ${module} is deleted with a class or interface: its members can't be counted`,
        attention: true,
      });
    }
    const counts = deletedUndocumented.get(module) ?? { exports: 0, members: 0 };
    const at = folderOf(module);
    for (const into of [total, at && subtrees[subtreeOf(at[0])]]) {
      if (!into) continue;
      subtract(into, 'exports', kinds.length, counts.exports);
      subtract(into, 'members', counts.members, counts.members);
    }
    findings.push({
      line: `docs: ${module} (deleted) counted ${kinds.length} exports, ${counts.exports} undocumented`,
      attention: false,
    });
  }
  for (const lists of undocumented.values()) for (const part of PARTS) lists[part].sort();
  return { undocumented, total, subtrees, findings };
};

/** What `b` lists more often than `a` (duplicates counted) */
const listExtra = (a: string[], b: string[]) => {
  const left = new Map<string, number>();
  for (const name of a) left.set(name, (left.get(name) ?? 0) + 1);
  return b.filter((name) => {
    const n = left.get(name) ?? 0;
    left.set(name, n - 1);
    return n <= 0;
  });
};

export const compareDocs = (
  map: PathMap,
  before: DocsBaseline,
  after: DocsBaseline,
  api: ApiBaseline
): Finding[] => {
  const mapped = mapDocs(map, before, api);
  const findings = [...mapped.findings];
  if (!sameCoverage(mapped.total, after.total)) {
    findings.push({
      line: `docs: the total is ${describeCoverage(after.total)}, the mapped baseline's ${describeCoverage(mapped.total)}`,
      attention: true,
    });
  }
  for (const subtree of new Set([
    ...Object.keys(mapped.subtrees),
    ...Object.keys(after.subtrees),
  ])) {
    if (!sameCoverage(mapped.subtrees[subtree], after.subtrees[subtree])) {
      findings.push({
        line: `docs: ${subtree} is ${describeCoverage(after.subtrees[subtree])}, the mapped baseline's ${describeCoverage(mapped.subtrees[subtree])}`,
        attention: true,
      });
    }
  }
  const folders = new Set([...mapped.undocumented.keys(), ...Object.keys(after.folders)]);
  for (const folder of [...folders].sort()) {
    for (const part of PARTS) {
      const expected = mapped.undocumented.get(folder)?.[part] ?? [];
      const found = after.folders[folder]?.undocumented[part] ?? [];
      for (const name of listExtra(found, expected)) {
        findings.push({
          line: `docs: ${folder}/${name} isn't undocumented there any more (${part})`,
          attention: true,
        });
      }
      for (const name of listExtra(expected, found)) {
        findings.push({
          line: `docs: ${folder}/${name} is newly undocumented (${part})`,
          attention: true,
        });
      }
    }
  }
  return findings;
};

// bundle.json

const chunkParts = (name: string) => {
  const [file, n] = name.split('#');
  const ext = posix.extname(file);
  return { dir: posix.dirname(file), base: posix.basename(file, ext), ext, n };
};

const withoutExt = (file: string) => posix.basename(file, posix.extname(file));

/**
 * A chunk's name after the move: one named after a module that's renamed (not only moved) takes
 * its new name, `#n` dropped (chunks of one name are paired by size); `findings` for a name two
 * renames claim
 */
export const createChunkNameMap = (map: PathMap) => {
  const renamed = new Map<string, Set<string>>();
  for (const [from, to] of map.renames) {
    const [a, b] = [withoutExt(from), withoutExt(to)];
    if (a !== b) renamed.set(a, (renamed.get(a) ?? new Set()).add(b));
  }
  return (name: string): { name: string; error?: string } => {
    const { dir, base, ext } = chunkParts(name);
    const targets = renamed.get(base);
    if (!targets) return { name: `${dir}/${base}${ext}` };
    if (targets.size > 1) {
      return {
        name,
        error: `${name} is named after modules renamed to ${[...targets].join(', ')}`,
      };
    }
    return { name: `${dir}/${[...targets][0]}${ext}` };
  };
};

const groupChunks = (chunks: Record<string, Size>, nameOf: (name: string) => string) => {
  const groups = new Map<string, Size[]>();
  for (const [name, size] of Object.entries(chunks)) {
    const key = nameOf(name);
    groups.set(key, [...(groups.get(key) ?? []), size]);
  }
  for (const sizes of groups.values()) sizes.sort((a, b) => a.gzip - b.gzip);
  return groups;
};

const isWithin = (before: number, after: number) =>
  !isGrowthToFlag(before, after) && !isGrowthToFlag(after, before);

const kB = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`;

/** Module ids of the last build per chunk (hash and `#n` stripped), for the hints */
export type ChunkModules = Map<string, string[]>;

export const compareBundle = (
  map: PathMap,
  before: BundleBaseline,
  after: BundleBaseline,
  chunkModules: ChunkModules = new Map()
): Finding[] => {
  const findings: Finding[] = [];
  const nameMap = createChunkNameMap(map);
  const splitTargets = new Set([...map.splits.values()].flatMap((s) => Object.values(s)));
  const hint = (chunk: string) => {
    const parts = (chunkModules.get(chunk) ?? []).filter((id) =>
      splitTargets.has(id.replace(/^\//, ''))
    );
    return parts.length ? ` (split parts in it: ${parts.join(', ')})` : '';
  };
  const renames = new Set<string>();
  const expected = groupChunks(before.chunks, (name) => {
    const mapped = nameMap(name);
    if (mapped.error) findings.push({ line: `bundle: ${mapped.error}`, attention: true });
    const plain = name.split('#')[0];
    if (mapped.name !== plain) renames.add(`${plain} → ${mapped.name}`);
    return mapped.name;
  });
  const found = groupChunks(after.chunks, (name) => name.split('#')[0]);
  for (const r of [...renames].sort())
    findings.push({ line: `bundle: renamed ${r}`, attention: false });
  for (const name of [...new Set([...expected.keys(), ...found.keys()])].sort()) {
    const [e, f] = [expected.get(name) ?? [], found.get(name) ?? []];
    if (e.length !== f.length) {
      findings.push({
        line: `bundle: ${e.length} chunk(s) named ${name} before the move, ${f.length} after it${hint(name)}`,
        attention: true,
      });
      continue;
    }
    e.forEach((size, i) => {
      if (isWithin(size.gzip, f[i].gzip)) return;
      findings.push({
        line: `bundle: ${name}${e.length > 1 ? ` (${i + 1} of ${e.length})` : ''}: ${kB(size.gzip)} → ${kB(f[i].gzip)} gzip${hint(name)}`,
        attention: true,
      });
    });
  }
  const [m, n] = [before.main, after.main];
  const mainName = nameMap(m.chunk).name;
  if (mainName !== n.chunk) {
    findings.push({
      line: `bundle: the main chunk is ${n.chunk}, not ${mainName}`,
      attention: true,
    });
  }
  for (const key of ['gzip', 'rendered'] as const) {
    if (!isWithin(m[key], n[key])) {
      findings.push({
        line: `bundle: the main chunk's ${key} ${kB(m[key])} → ${kB(n[key])}${hint(n.chunk)}`,
        attention: true,
      });
    }
  }
  if (m.modules !== n.modules) {
    findings.push({
      line: `bundle: the main chunk's modules ${m.modules} → ${n.modules} (the splits' parts count apart)`,
      attention: false,
    });
  }
  return findings;
};

export const compareBaselines = (
  map: PathMap,
  before: Baselines,
  after: Baselines,
  chunkModules?: ChunkModules
): Finding[] => [
  ...compareApi(map, before.api, after.api),
  ...compareDocs(map, before.docs, after.docs, before.api),
  ...compareBundle(map, before.bundle, after.bundle, chunkModules),
];

// The command

const BASELINES = 'devTools/verify/baselines';
const VISUALIZER_FILE = path.join(ROOT, 'dist-stats/bundle-stats.html');

/** The last build's modules per chunk, from the visualizer's data; empty without it */
const readChunkModules = (): ChunkModules => {
  const out: ChunkModules = new Map();
  if (!fs.existsSync(VISUALIZER_FILE)) return out;
  const match = fs.readFileSync(VISUALIZER_FILE, 'utf-8').match(/const data = (\{.*?\});\n/s);
  if (!match) return out;
  const data = JSON.parse(match[1]) as {
    nodeMetas: Record<string, { id: string; moduleParts: Record<string, string> }>;
  };
  for (const meta of Object.values(data.nodeMetas)) {
    for (const file of Object.keys(meta.moduleParts)) {
      const chunk = file.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1');
      out.set(chunk, [...(out.get(chunk) ?? []), meta.id]);
    }
  }
  return out;
};

const main = () => {
  const RED = '\x1b[31m';
  const GREEN = '\x1b[32m';
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';
  const args = process.argv.slice(2);
  const planAt = args.indexOf('--plan');
  const plan = planAt >= 0 ? (args[planAt + 1] as MovePlan) : undefined;
  const ref = args.filter((a, i) => !a.startsWith('--') && i !== planAt + 1)[0];
  if (!plan || !['p608', 'p609'].includes(plan) || !ref) {
    console.error('Usage: npx tsx devTools/refactor/compareBaselines.ts --plan <plan> <base-sha>');
    process.exit(2);
  }
  const git = (gitArgs: string[]) =>
    execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const base = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const files = git(['ls-tree', '-r', '-z', '--name-only', base]).split('\0').filter(Boolean);
  const moveMap = JSON.parse(git(['show', `${base}:devTools/refactor/moveMap.json`])).files;
  const map = buildPathMap({ files, moveMap, plan });
  if (map.errors.length) {
    console.error(`${RED}✖ ${base.slice(0, 7)}'s map doesn't fit its tree:${RESET}`);
    for (const e of map.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  const readAt = (name: string) => JSON.parse(git(['show', `${base}:${BASELINES}/${name}`]));
  const readNow = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, BASELINES, name), 'utf-8'));
  const load = (read: (name: string) => unknown) =>
    ({ api: read('api.json'), docs: read('docs.json'), bundle: read('bundle.json') }) as Baselines;

  const findings = compareBaselines(map, load(readAt), load(readNow), readChunkModules());
  console.log(`The baselines against ${base.slice(0, 7)}'s, mapped through its ${plan} move map:`);
  for (const f of findings)
    console.log(`  ${f.attention ? `${RED}✗` : `${DIM}·`} ${f.line}${RESET}`);
  const attention = findings.filter((f) => f.attention).length;
  if (attention) {
    console.log(`${RED}✖ ${attention} difference(s) beyond the paths${RESET}`);
    process.exit(1);
  }
  console.log(
    `${GREEN}✔ The baselines differ from ${base.slice(0, 7)}'s only by the move's paths${RESET}`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
