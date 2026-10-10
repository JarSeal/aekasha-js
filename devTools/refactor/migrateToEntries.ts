/* eslint-disable no-console */
/**
 * Rewrites deep imports of the engine and the toolkit to entry imports (p606 Phase 7), for this
 * repo and for apps made from the template when they move to the engine's next major:
 *
 *   npx tsx devTools/refactor/migrateToEntries.ts [--check] <folder | file>...
 *
 *   eg. npx tsx devTools/refactor/migrateToEntries.ts src/app src/toolkit src/index.ts
 *
 * Each imported name goes to the entry that exports it (`aekasha`, `aekasha/physics`,
 * `aekasha/toolkit/ecs`, …, from `devTools/aliases.ts`): the rules are `entryImports.ts`'s. The
 * rewritten modules are formatted with Prettier. On any error (a name no entry exports, a
 * namespace import of an engine module, …) it lists them all and writes nothing. `--check` writes
 * nothing and exits 1 when a module would change.
 */
import fs from 'fs';
import path from 'path';
import prettier from 'prettier';
import { ROOT } from '../assetPipeline/sources';
import { ENTRY_FILES } from '../aliases';
import { migrateToEntryImports } from './entryImports';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error(
    'Usage: npx tsx devTools/refactor/migrateToEntries.ts [--check] <folder | file>...'
  );
  process.exit(1);
}

const toRepoPath = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

const walk = (dir: string, out: string[]) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else out.push(toRepoPath(abs));
  }
  return out;
};

// Every file under src/ (what the imports can reach), and the modules to rewrite
const allFiles = walk(path.join(ROOT, 'src'), []);
const existing = new Set(allFiles);
const isModule = (f: string) => f.endsWith('.ts') && !f.endsWith('.d.ts');
const sources = new Map<string, string>();
for (const f of allFiles) {
  if (isModule(f)) sources.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

const files = new Set<string>();
for (const target of targets) {
  const abs = path.resolve(process.cwd(), target);
  if (!fs.existsSync(abs)) {
    console.error(`${RED}✖ ${target} doesn't exist${RESET}`);
    process.exit(1);
  }
  const rel = toRepoPath(abs);
  if (!rel.startsWith('src/')) {
    console.error(`${RED}✖ ${target} isn't under src/${RESET}`);
    process.exit(1);
  }
  const found = fs.statSync(abs).isDirectory() ? walk(abs, []) : [rel];
  for (const f of found) if (isModule(f)) files.add(f);
}

const { changed, errors } = migrateToEntryImports({
  sources,
  files: [...files].sort(),
  entries: ENTRY_FILES,
  exists: (f) => existing.has(f),
});

if (errors.length) {
  console.error(
    `${RED}✖ ${errors.length} import(s) can't go through an entry; nothing written:${RESET}`
  );
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const formatted = new Map<string, string>();
for (const [file, text] of changed) {
  const abs = path.join(ROOT, file);
  const config = (await prettier.resolveConfig(abs)) ?? {};
  formatted.set(file, await prettier.format(text, { ...config, filepath: abs }));
}

const rewritten = [...formatted].filter(([file, text]) => sources.get(file) !== text);
if (isCheck) {
  if (rewritten.length) {
    console.error(
      `${RED}✖ ${rewritten.length} module(s) import the engine or toolkit by path:${RESET}`
    );
    for (const [file] of rewritten) console.error(`  ${file}`);
    process.exit(1);
  }
  console.log(`${GREEN}✔ ${files.size} module(s) import only through entries${RESET}`);
} else {
  for (const [file, text] of rewritten) fs.writeFileSync(path.join(ROOT, file), text);
  console.log(`${GREEN}✔ ${rewritten.length} of ${files.size} module(s) rewritten${RESET}`);
  for (const [file] of rewritten) console.log(`  ${file}`);
}
