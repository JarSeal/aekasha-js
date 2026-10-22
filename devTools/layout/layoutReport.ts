/* eslint-disable no-console -- a CLI: its output is the console */
/**
 * The layout report, on demand (p619 D9):
 *
 *   npx tsx devTools/layout/layoutReport.ts
 *
 * Writes `.cache/layout/layoutReport.md` (not committed): what `layout.test.ts` checks, with what
 * it allows listed too: the kernel's and the schemas' type-only imports of other layers (each by
 * file and line), the assets worker's job modules, the feature → feature imports. Exits 1 when the
 * layout check fails, after writing the report.
 */
import fs from 'fs';
import path from 'path';
import { ROOT } from '../paths';
import { ENTRY_FILES } from '../aliases';
import type { ImportKind } from './importGraph';
import { checkLayout, getLayoutErrors, getLayoutZone, type LayoutEdge } from './layout';
import { readLayoutTree } from './layoutTree';

const REPORT_FILE = path.join(ROOT, '.cache/layout/layoutReport.md');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const tree = readLayoutTree();
const check = checkLayout({ ...tree, aliases: ENTRY_FILES });
const errors = getLayoutErrors(check);

const code = (s: string) => `\`${s}\``;
const short = (file: string) => file.replace(/^src\/_engine\//, '').replace(/^src\//, '');
const namesCell = (names: string[]) => {
  const shown = names.slice(0, 6).join(', ');
  return names.length > 6 ? `${shown}, … (${names.length})` : shown || '(side effect)';
};
const edgeRow = (e: LayoutEdge) =>
  `| ${code(`${short(e.from)}:${e.line}`)} | ${code(short(e.to))} | ${e.kind} | ${namesCell(e.names)} |`;
const EDGE_HEADER = '| Importer | Imports | Kind | Names |\n| --- | --- | --- | --- |';
const featureOf = (file: string) => getLayoutZone(file).area!;

const lines: string[] = [];
const out = (s = '') => lines.push(s);
out('# Layout report');
out();
out(
  `Written by ${code('npx tsx devTools/layout/layoutReport.ts')} from the working tree; ${code('devTools/layout/layout.test.ts')} checks the same in ${code('yarn test')}. Paths are relative to ${code('src/_engine/')} (or ${code('src/')}).`
);
out();
out('## Summary');
out();
out(
  `- **Files:** ${tree.files.length}; **imports checked:** ${check.importCount} in ${check.moduleCount} modules.`
);
out(`- **Layout errors:** ${errors.length ? errors.length : 'none'}.`);
for (const e of errors) out(`  - ${e}`);
out(
  '- **Boundary imports** (a type-only one is allowed but in the engine → app, toolkit and generated data categories):'
);
out();
out('| Category | Runtime | Type only | Dynamic | Files |');
out('| --- | --- | --- | --- | --- |');
const sorted = [...check.violations.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [category, edges] of sorted) {
  const n = (k: ImportKind) => edges.filter((e) => e.kind === k).length;
  const files = new Set(edges.map((e) => e.from)).size;
  out(`| ${category} | ${n('runtime')} | ${n('type')} | ${n('dynamic')} | ${files} |`);
}
out();
out(
  `- **Feature cycles** (runtime and dynamic imports, debug code left out): ${
    check.featureCycles.length ? check.featureCycles.map((c) => c.join(' ↔ ')).join('; ') : 'none'
  }.`
);
out();

out('## Assets worker job modules');
out();
out(
  `p607 D5: a worker can't be handed code, so the assets worker ${code('import()')}s the feature code a job needs, on the first job that needs it.`
);
out();
out(EDGE_HEADER);
for (const e of check.workerJobEdges) out(edgeRow(e));
out();

out('## Feature dependencies');
out();
const pairCounts = new Map<string, Record<ImportKind, number>>();
for (const e of check.featureEdges) {
  const key = `${featureOf(e.from)} → ${featureOf(e.to)}`;
  const c = pairCounts.get(key) ?? { runtime: 0, type: 0, dynamic: 0 };
  c[e.kind]++;
  pairCounts.set(key, c);
}
out('| Feature → feature | Runtime | Type only | Dynamic |');
out('| --- | --- | --- | --- |');
for (const [pair, c] of [...pairCounts.entries()].sort()) {
  out(`| ${pair} | ${c.runtime} | ${c.type} | ${c.dynamic} |`);
}
out();

for (const [category, edges] of sorted) {
  out(`## ${category}`);
  out();
  if (category === 'Kernel → feature') {
    const byFeature = new Map<string, LayoutEdge[]>();
    for (const e of edges)
      byFeature.set(featureOf(e.to), [...(byFeature.get(featureOf(e.to)) ?? []), e]);
    for (const [feature, list] of [...byFeature.entries()].sort()) {
      out(`### ${feature}`);
      out();
      out(EDGE_HEADER);
      for (const e of list) out(edgeRow(e));
      out();
    }
    continue;
  }
  out(EDGE_HEADER);
  for (const e of edges) out(edgeRow(e));
  out();
}

fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
for (const e of errors) console.log(`${RED}✖ ${e}${RESET}`);
const total = [...check.violations.values()].reduce((n, list) => n + list.length, 0);
console.log(
  `${errors.length ? RED : GREEN}${errors.length ? '✖' : '✔'} ${check.moduleCount} modules; ${errors.length} layout error(s); ${total} boundary import(s), the allowed type-only ones included; ${check.featureCycles.length} feature cycle(s)${RESET}`
);
console.log(`  ${path.relative(ROOT, REPORT_FILE)}`);
if (errors.length) process.exit(1);
