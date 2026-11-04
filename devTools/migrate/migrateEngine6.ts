/* eslint-disable no-console -- a CLI: its output is the console */
/**
 * The engine 6.0.0 codemod (p622 D10): migrates an app made from the template, run after the app
 * took the new engine, toolkit and tools (the migration page's order, `documentation/migration/`):
 *
 *   npx tsx devTools/migrate/migrateEngine6.ts [--check] [--report] <folder | file>...
 *
 *   eg. npx tsx devTools/migrate/migrateEngine6.ts src hub/_assets/ts
 *
 * The rules are `engine6Rules.ts`'s and the logic `engine6.ts`'s, on a program from the repo's
 * `tsconfig.json`; the rewritten modules are formatted with Prettier. A module with an error is
 * left as it was, and every error is listed. The reports (what needs a person) always print, on
 * stderr. `--check` writes nothing and exits 1 when a module would change; `--report` writes
 * nothing and prints only the reports. Exits 2 on an error.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prettier from 'prettier';
import ts from 'typescript';
import { ROOT } from '../paths';
import { createMigrationProgram, migrateEngine6, type MigrationFinding } from './engine6';
import { ENGINE6_RULES } from './engine6Rules';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const USAGE =
  'Usage: npx tsx devTools/migrate/migrateEngine6.ts [--check] [--report] <folder | file>...';
// Not migrated: the gather's output, written again from the data
const SKIPPED_FOLDERS = ['src/generated'];

const toRepoPath = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');
const isModule = (file: string) => file.endsWith('.ts') && !file.endsWith('.d.ts');

const walk = (dir: string, out: string[]) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    if (SKIPPED_FOLDERS.includes(toRepoPath(abs))) continue;
    if (ent.isDirectory()) walk(abs, out);
    else if (isModule(ent.name)) out.push(abs);
  }
  return out;
};

const formatFinding = (f: MigrationFinding) =>
  `${toRepoPath(f.file)}:${f.line} ${f.message}${f.anchor ? ` (documentation/migration/#${f.anchor})` : ''}`;

const mainAsync = async () => {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isReport = args.includes('--report');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (
    !targets.length ||
    args.some((a) => a.startsWith('--') && a !== '--check' && a !== '--report')
  ) {
    console.error(USAGE);
    return 2;
  }

  const files = new Set<string>();
  for (const target of targets) {
    const abs = path.resolve(process.cwd(), target);
    if (!fs.existsSync(abs)) {
      console.error(`${RED}✖ ${target} doesn't exist${RESET}`);
      return 2;
    }
    if (toRepoPath(abs).startsWith('..')) {
      console.error(`${RED}✖ ${target} isn't in this repo${RESET}`);
      return 2;
    }
    for (const f of fs.statSync(abs).isDirectory() ? walk(abs, []) : [abs]) {
      if (isModule(f)) files.add(f);
    }
  }

  const configPath = path.join(ROOT, 'tsconfig.json');
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT, undefined, configPath);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };
  // The config's ambient declarations (`vite-env.d.ts`, the engine's globals) and the modules
  const ambient = parsed.fileNames.filter((f) => f.endsWith('.d.ts'));
  const sorted = [...files].sort();
  const program = createMigrationProgram({
    rootNames: [...sorted, ...ambient],
    options,
    baseHost: ts.createCompilerHost(options),
  });
  const { changed, errors, reports } = migrateEngine6({
    program,
    files: sorted,
    rules: ENGINE6_RULES,
  });

  if (reports.length) {
    console.error(`${YELLOW}⚠ ${reports.length} use(s) need a person:${RESET}`);
    for (const r of reports) console.error(`  ${formatFinding(r)}`);
  }
  if (isReport) {
    if (!reports.length)
      console.log(`${GREEN}✔ nothing in ${files.size} module(s) needs a person${RESET}`);
    return 0;
  }

  const rewritten: [string, string][] = [];
  for (const [file, text] of changed) {
    const prettierConfig = (await prettier.resolveConfig(file)) ?? {};
    const formatted = await prettier.format(text, { ...prettierConfig, filepath: file });
    if (formatted !== fs.readFileSync(file, 'utf8')) rewritten.push([file, formatted]);
  }

  if (errors.length) {
    console.error(
      `${RED}✖ ${errors.length} error(s); their modules are left as they were:${RESET}`
    );
    for (const e of errors) console.error(`  ${formatFinding(e)}`);
  }
  if (isCheck) {
    if (rewritten.length) {
      console.error(`${RED}✖ ${rewritten.length} module(s) would be migrated:${RESET}`);
      for (const [file] of rewritten) console.error(`  ${toRepoPath(file)}`);
      return errors.length ? 2 : 1;
    }
    if (!errors.length) console.log(`${GREEN}✔ ${files.size} module(s) need no migration${RESET}`);
  } else {
    for (const [file, text] of rewritten) fs.writeFileSync(file, text);
    console.log(`${GREEN}✔ ${rewritten.length} of ${files.size} module(s) migrated${RESET}`);
    for (const [file] of rewritten) console.log(`  ${toRepoPath(file)}`);
  }
  return errors.length ? 2 : 0;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await mainAsync());
}
