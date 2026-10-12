/* eslint-disable no-console */
/**
 * Applies the move map (p608 §4, the codemod's command):
 *
 *   npx tsx devTools/refactor/applyMoveMap.ts --plan p608                  # apply to the working tree
 *   npx tsx devTools/refactor/applyMoveMap.ts --plan p608 --dry-run        # in a scratch worktree, then the checks and the build
 *   npx tsx devTools/refactor/applyMoveMap.ts --verify-commit <sha>        # is <sha> exactly the tool's output on its parent?
 *   npx tsx devTools/refactor/applyMoveMap.ts --plan p608 --leftovers <base-sha>  # old paths still named, by <base-sha>'s map
 *
 * - **Apply:** the preconditions (§4.2: a clean working tree, `moveMap.ts --check`, the path map
 *   checked on the tree), then everything in memory (`rewriteTree` with `MOVE_EDITS`, Prettier),
 *   then the report (`.cache/refactor/<plan>-report.md`, and a summary printed). On any error
 *   nothing is written. Then `git mv` through a temporary name (case-only renames on macOS, a move
 *   onto a path another one leaves), `git rm` the deletes and the split files, the new texts
 *   written and `git add`ed, the emptied folders removed.
 * - **Prettier** formats a written file only when its text before the move was formatted (a longer
 *   path can wrap a line), and every created one: no other formatting. The report lists the ones
 *   it left alone.
 * - **`--dry-run`:** the working tree as it is (uncommitted and untracked files included, through
 *   a temporary index) checked out in a scratch worktree with a `node_modules` symlink; the
 *   tool's own copy there applies the plan, then `tsc`, `tsc -p hub`, `yarn test`, `yarn lint`
 *   and `yarn build` (the Vite build: the stylesheets' loads and the `?worker` / `?raw` / `?url`
 *   imports; the Hub: its `api:` and `hub:` links) run in it. The worktree is removed after
 *   (`--keep-worktree` keeps it). The scratch worktrees are outside the repo, in the system's
 *   temporary folder: inside it, TypeDoc names the sources from the repo's root
 *   (`.cache/…/src/_engine/…`) and the Hub's API model finds no module.
 * - **`--verify-commit <sha>`:** reruns the tool on `<sha>`'s parent in a scratch worktree and
 *   compares the trees; the plan comes from the commit message (`applyMoveMap.ts --plan p608`)
 *   unless `--plan` names it.
 * - **`--leftovers <base-sha>`:** every mention of a path `<base-sha>`'s map moved, deleted or
 *   split, in today's tree outside the history (D6): Phase 6's list. Exits 1 on any.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import prettier from 'prettier';
import { ROOT } from '../assetPipeline/sources';
import { buildPathMap, type PathMap } from './moveApply';
import { MOVE_EDITS } from './moveEdits';
import type { MoveEntry, MovePlan } from './moveRules';
import { createTextContext, findLeftovers, type Leftover } from './moveText';
import { rewriteTree, type TreeRewrite } from './moveTree';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const PLANS: MovePlan[] = ['p608', 'p609'];
const MOVE_MAP = 'devTools/refactor/moveMap.json';
const CACHE_DIR = '.cache/refactor';
const TOOL = 'devTools/refactor/applyMoveMap.ts';

// Arguments

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) fail(`${flag} needs a value`);
  return value;
};

function fail(message: string): never {
  console.error(`${RED}✖ ${message}${RESET}`);
  process.exit(1);
}

const USAGE = [
  'Usage:',
  `  npx tsx ${TOOL} --plan <plan> [--dry-run [--keep-worktree]]`,
  `  npx tsx ${TOOL} --verify-commit <sha> [--plan <plan>]`,
  `  npx tsx ${TOOL} --plan <plan> --leftovers <base-sha>`,
].join('\n');

const toPlan = (value: string | undefined): MovePlan | undefined => {
  if (value === undefined) return undefined;
  if (!(PLANS as string[]).includes(value)) fail(`Unknown plan '${value}' (${PLANS.join(', ')})`);
  return value as MovePlan;
};

// Git and the file system

const git = (root: string, gitArgs: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : undefined,
    maxBuffer: 64 * 1024 * 1024,
  });

const gitList = (root: string, gitArgs: string[]) => git(root, gitArgs).split('\0').filter(Boolean);

/** Runs `paths` through a git command in batches (the argument list's length) */
const gitEach = (root: string, command: string[], paths: string[]) => {
  for (let i = 0; i < paths.length; i += 200) {
    git(root, [...command, '--', ...paths.slice(i, i + 200)]);
  }
};

/** Every tracked file, and the texts of those without a NUL byte (the models and images aside) */
const readTree = (root: string) => {
  const files = gitList(root, ['ls-files', '-z']);
  const texts = new Map<string, string>();
  for (const file of files) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    const bytes = fs.readFileSync(abs);
    if (!bytes.includes(0)) texts.set(file, bytes.toString('utf-8'));
  }
  return { files, texts };
};

const folderOf = (file: string) => path.posix.dirname(file);

/** A command in `cwd`, its output shown; whether it passed and how long it took */
const run = (cwd: string, command: string, commandArgs: string[]) => {
  const started = Date.now();
  console.log(`\n${YELLOW}▶ ${command} ${commandArgs.join(' ')}${RESET}`);
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' });
  return { ok: result.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
};

// Computing the move

type Output = {
  /** The path after the move */
  to: string;
  text: string;
  /** The file's path before the move; none for a split target that's no file's path */
  from?: string;
};

type ComputedMove = {
  root: string;
  plan: MovePlan;
  head: string;
  map: PathMap;
  rewrite: TreeRewrite;
  outputs: Output[];
  /** Written as the rewrite made them: their text before the move wasn't Prettier-formatted */
  unformatted: string[];
  errors: string[];
};

/** §4.2's checks that need the file system: the targets free, no folder renamed by case alone */
const checkTargets = (root: string, map: PathMap) => {
  const errors: string[] = [];
  const oldByCase = new Set([...map.oldFiles].map((f) => f.toLowerCase()));
  const renamedTo = new Set(map.renames.map(([, to]) => to));
  const targets = [
    ...renamedTo,
    ...[...map.newFiles].filter((f) => !map.oldFiles.has(f) && !renamedTo.has(f)),
  ];
  for (const to of targets) {
    if (!oldByCase.has(to.toLowerCase()) && fs.existsSync(path.join(root, to))) {
      errors.push(`${to} is taken by a file git doesn't track`);
    }
  }
  // `git mv` through a temporary name renames files, not folders: a folder that changes only its
  // case would keep its old name on a case-insensitive file system
  const folders = new Map<string, string>();
  for (const file of map.oldFiles) {
    for (let dir = folderOf(file); dir !== '.'; dir = folderOf(dir))
      folders.set(dir.toLowerCase(), dir);
  }
  const renamed = new Set<string>();
  for (const file of map.newFiles) {
    for (let dir = folderOf(file); dir !== '.'; dir = folderOf(dir)) {
      const old = folders.get(dir.toLowerCase());
      if (old !== undefined && old !== dir) renamed.add(`${old} → ${dir}`);
    }
  }
  for (const r of renamed) errors.push(`The folder ${r} changes only its case: rename it by hand`);
  return errors;
};

const formatAll = async (root: string, pending: Output[], before: Map<string, string>) => {
  const outputs: Output[] = [];
  const unformatted: string[] = [];
  for (const output of pending) {
    const abs = path.join(root, output.to);
    const info = await prettier.getFileInfo(abs);
    const original = output.from === undefined ? undefined : before.get(output.from);
    const config = (await prettier.resolveConfig(abs)) ?? {};
    const options = { ...config, filepath: abs };
    const wasFormatted =
      original === undefined || (await prettier.check(original, options).catch(() => false));
    if (!info.inferredParser || info.ignored || !wasFormatted) {
      if (info.inferredParser && !info.ignored) unformatted.push(output.to);
      outputs.push(output);
      continue;
    }
    outputs.push({ ...output, text: await prettier.format(output.text, options) });
  }
  return { outputs, unformatted };
};

/** The preconditions, the path map, the rewrite and Prettier: everything before a write */
const computeMove = async (root: string, plan: MovePlan): Promise<ComputedMove> => {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const status = git(root, ['status', '--porcelain', '-z']);
  if (status) fail("The working tree isn't clean: commit or stash first (§4.2)");
  console.log(`Checking the move map (moveMap.ts --check)…`);
  if (!run(root, 'npx', ['tsx', 'devTools/refactor/moveMap.ts', '--check']).ok) {
    fail('The move map is out of date: run moveMap.ts and commit it (§4.2)');
  }

  const { files, texts } = readTree(root);
  const moveMap = JSON.parse(texts.get(MOVE_MAP) as string).files as Record<string, MoveEntry>;
  const map = buildPathMap({ files, moveMap, plan });
  const errors = [...map.errors, ...checkTargets(root, map)];
  const rewrite = rewriteTree(map, texts, MOVE_EDITS);
  errors.push(...rewrite.errors);

  const pending: Output[] = [];
  for (const [from, text] of rewrite.changed) {
    pending.push({ from, to: map.newPathOf(from) as string, text });
  }
  for (const [to, text] of rewrite.created) pending.push({ to, text });
  const { outputs, unformatted } = errors.length
    ? { outputs: pending, unformatted: [] }
    : await formatAll(root, pending, texts);
  return { root, plan, head, map, rewrite, outputs, unformatted, errors };
};

// The report

const isCaseOnly = ([from, to]: [string, string]) => from.toLowerCase() === to.toLowerCase();

const leftoverLines = (leftovers: Leftover[]) =>
  leftovers.map((l) => `- \`${l.file}:${l.line}\` names \`${l.path}\``);

const buildReport = (move: ComputedMove) => {
  const { map, rewrite, plan } = move;
  const lines: string[] = [];
  const out = (...l: string[]) => lines.push(...l);
  const caseOnly = map.renames.filter(isCaseOnly).length;
  out(`# ${plan}: the move map applied`, '');
  out(`- **Base:** \`${move.head}\` (\`npx tsx ${TOOL} --plan ${plan}\`)`);
  out(`- **Moves:** ${map.renames.length} (${caseOnly} case-only)`);
  out(`- **Deletes:** ${map.deletes.length}`);
  out(`- **Splits:** ${map.splits.size} into ${rewrite.created.size} new modules`);
  out(`- **Texts changed:** ${rewrite.changed.size}`);
  out(`- **Not formatted** (their text before the move wasn't): ${move.unformatted.length}`);
  out(`- **Leftovers:** ${rewrite.leftovers.length}`);
  out(`- **Errors:** ${move.errors.length}`, '');
  if (move.errors.length) out('## Errors', '', ...move.errors.map((e) => `- ${e}`), '');
  if (rewrite.leftovers.length) {
    out('## Leftovers', '', 'Old paths the rewrite left (Phase 6, by hand):', '');
    out(...leftoverLines(rewrite.leftovers), '');
  }
  if (move.unformatted.length) {
    out('## Not formatted', '', ...move.unformatted.map((f) => `- \`${f}\``), '');
  }
  out('## Moves', '', ...map.renames.map(([from, to]) => `- \`${from}\` → \`${to}\``), '');
  if (map.deletes.length) out('## Deletes', '', ...map.deletes.map((f) => `- \`${f}\``), '');
  if (map.splits.size) {
    out('## Splits', '');
    for (const [file, targets] of map.splits) {
      out(`- \`${file}\`:`);
      const byTarget = new Map<string, string[]>();
      for (const [name, to] of Object.entries(targets)) {
        byTarget.set(to, [...(byTarget.get(to) ?? []), name]);
      }
      for (const [to, names] of byTarget) out(`  - \`${to}\`: ${names.join(', ')}`);
    }
    out('');
  }
  const changed = [...rewrite.changed.keys()].map((from) => {
    const to = map.newPathOf(from) as string;
    return to === from ? `- \`${from}\`` : `- \`${to}\` (was \`${from}\`)`;
  });
  out('## Texts changed', '', ...changed.sort(), '');
  if (rewrite.created.size)
    out('## Created', '', ...[...rewrite.created.keys()].map((f) => `- \`${f}\``), '');
  return lines.join('\n');
};

const writeReport = (root: string, name: string, text: string) => {
  const file = path.join(root, CACHE_DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

const printSummary = (move: ComputedMove, reportFile: string) => {
  const { map, rewrite } = move;
  const caseOnly = map.renames.filter(isCaseOnly).length;
  console.log(
    `\n${map.renames.length} moves (${caseOnly} case-only), ${map.deletes.length} deletes, ` +
      `${map.splits.size} splits into ${rewrite.created.size} new modules, ` +
      `${rewrite.changed.size} texts changed, ${move.unformatted.length} not formatted`
  );
  for (const f of move.unformatted) console.log(`  ${YELLOW}not formatted${RESET} ${f}`);
  if (rewrite.leftovers.length) {
    console.log(`${YELLOW}! ${rewrite.leftovers.length} leftovers (Phase 6, by hand):${RESET}`);
    for (const l of rewrite.leftovers) console.log(`  ${l.file}:${l.line} ${l.path}`);
  }
  for (const e of move.errors) console.log(`${RED}✖ ${e}${RESET}`);
  console.log(`Report: ${path.relative(process.cwd(), reportFile) || reportFile}`);
};

// Writing the move

/** The folders the move leaves, deepest first; a `.DS_Store` alone doesn't keep one */
const removeEmptiedFolders = (root: string, left: string[]) => {
  const folders = new Set<string>();
  for (const file of left) {
    for (let dir = folderOf(file); dir !== '.'; dir = folderOf(dir)) folders.add(dir);
  }
  const removed: string[] = [];
  for (const dir of [...folders].sort((a, b) => b.split('/').length - a.split('/').length)) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    const entries = fs.readdirSync(abs).filter((e) => e !== '.DS_Store');
    if (entries.length) continue;
    fs.rmSync(abs, { recursive: true });
    removed.push(dir);
  }
  return removed;
};

const writeMove = (move: ComputedMove) => {
  const { root, map, plan } = move;
  const tmp = (file: string) => `${file}.${plan}tmp`;

  // Through a temporary name: a case-only rename, and no move onto a path another one leaves
  for (const [from] of map.renames) git(root, ['mv', '--', from, tmp(from)]);
  for (const [from, to] of map.renames) {
    fs.mkdirSync(path.join(root, folderOf(to)), { recursive: true });
    git(root, ['mv', '--', tmp(from), to]);
  }
  // The split files go before their parts are written (`utils/constants.ts` → `utils/Constants.ts`)
  gitEach(root, ['rm', '-q'], [...map.deletes, ...map.splits.keys()]);

  for (const { to, text } of move.outputs) {
    const abs = path.join(root, to);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  gitEach(
    root,
    ['add'],
    move.outputs.map((o) => o.to)
  );
  return removeEmptiedFolders(root, [
    ...map.renames.map(([from]) => from),
    ...map.deletes,
    ...map.splits.keys(),
  ]);
};

const apply = async (plan: MovePlan) => {
  const move = await computeMove(ROOT, plan);
  const reportFile = writeReport(ROOT, `${plan}-report.md`, buildReport(move));
  printSummary(move, reportFile);
  if (move.errors.length) fail(`${move.errors.length} errors; nothing written`);
  const removed = writeMove(move);
  console.log(
    `${GREEN}✔ ${plan} applied on ${move.head.slice(0, 7)}: ${removed.length} emptied folders removed${RESET}`
  );
  console.log(
    `Commit it alone: git commit -m "${plan}: apply the move map" -m "npx tsx ${TOOL} --plan ${plan} on ${move.head}"`
  );
};

// Scratch worktrees

const createWorktree = (name: string, commit: string) => {
  const dir = path.join(os.tmpdir(), 'aekasha-applyMoveMap', name);
  removeWorktree(dir);
  git(ROOT, ['worktree', 'add', '--detach', '--quiet', dir, commit]);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  return dir;
};

function removeWorktree(dir: string) {
  if (fs.existsSync(dir)) {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  git(ROOT, ['worktree', 'prune']);
}

/** The working tree as a commit (untracked files included), through a temporary index */
const snapshotWorkingTree = () => {
  const head = git(ROOT, ['rev-parse', 'HEAD']).trim();
  if (!git(ROOT, ['status', '--porcelain', '-z'])) return head;
  const index = path.join(ROOT, CACHE_DIR, 'snapshot.index');
  fs.mkdirSync(path.dirname(index), { recursive: true });
  fs.copyFileSync(path.join(ROOT, git(ROOT, ['rev-parse', '--git-path', 'index']).trim()), index);
  try {
    git(ROOT, ['add', '-A'], { GIT_INDEX_FILE: index });
    const tree = git(ROOT, ['write-tree'], { GIT_INDEX_FILE: index }).trim();
    const message = 'applyMoveMap.ts --dry-run: the working tree';
    return git(ROOT, ['commit-tree', tree, '-p', head, '-m', message]).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
};

const dryRun = (plan: MovePlan, keep: boolean) => {
  const snapshot = snapshotWorkingTree();
  const dir = createWorktree('worktree', snapshot);
  console.log(`Dry run in ${dir} (${snapshot.slice(0, 7)})`);
  const steps: [string, ReturnType<typeof run>][] = [];
  try {
    const applied = run(dir, 'npx', ['tsx', TOOL, '--plan', plan]);
    steps.push(['apply', applied]);
    const report = path.join(dir, CACHE_DIR, `${plan}-report.md`);
    if (fs.existsSync(report)) {
      fs.copyFileSync(report, path.join(ROOT, CACHE_DIR, `${plan}-dry-run-report.md`));
    }
    if (applied.ok) {
      steps.push(['tsc', run(dir, 'npx', ['tsc'])]);
      steps.push(['tsc -p hub', run(dir, 'npx', ['tsc', '-p', 'hub'])]);
      steps.push(['yarn test', run(dir, 'yarn', ['test'])]);
      steps.push(['yarn lint', run(dir, 'yarn', ['lint'])]);
      steps.push(['yarn build', run(dir, 'yarn', ['build'])]);
    }
  } finally {
    if (keep) console.log(`\nKept the worktree: ${dir}`);
    else removeWorktree(dir);
  }
  console.log('\nDry run:');
  for (const [name, { ok, seconds }] of steps) {
    console.log(`  ${ok ? `${GREEN}✔` : `${RED}✖`} ${name}${RESET} (${seconds} s)`);
  }
  console.log(`Report: ${path.join(CACHE_DIR, `${plan}-dry-run-report.md`)}`);
  if (steps.some(([, s]) => !s.ok)) process.exit(1);
};

const verifyCommit = (ref: string, planArg: MovePlan | undefined) => {
  const sha = git(ROOT, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const message = git(ROOT, ['log', '-1', '--format=%B', sha]);
  const plan =
    planArg ??
    toPlan(/applyMoveMap\.ts --plan (p\d+)/.exec(message)?.[1]) ??
    fail(`${sha.slice(0, 7)}'s message names no 'applyMoveMap.ts --plan <plan>': pass --plan`);
  const dir = createWorktree('verify-worktree', `${sha}^`);
  let problem: string | undefined;
  try {
    if (run(dir, 'npx', ['tsx', TOOL, '--plan', plan]).ok) {
      git(dir, ['add', '-A']);
      const made = git(dir, ['write-tree']).trim();
      const committed = git(ROOT, ['rev-parse', `${sha}^{tree}`]).trim();
      if (made !== committed) {
        console.log(git(dir, ['diff', '--stat', committed, made]));
        problem = `${sha.slice(0, 7)} isn't the tool's output on its parent (the diff: committed → tool)`;
      }
    } else problem = `The tool failed on ${sha.slice(0, 7)}^`;
  } finally {
    // process.exit skips a finally: fail only after the worktree is gone
    removeWorktree(dir);
  }
  if (problem) fail(problem);
  console.log(
    `${GREEN}✔ ${sha.slice(0, 7)} is exactly applyMoveMap.ts --plan ${plan} on its parent${RESET}`
  );
};

const reportLeftovers = (ref: string, plan: MovePlan) => {
  const base = git(ROOT, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const files = gitList(ROOT, ['ls-tree', '-r', '-z', '--name-only', base]);
  const moveMap = JSON.parse(git(ROOT, ['show', `${base}:${MOVE_MAP}`])).files;
  const map = buildPathMap({ files, moveMap, plan });
  if (map.errors.length)
    fail(`${base.slice(0, 7)}'s map doesn't fit its tree:\n  ${map.errors.join('\n  ')}`);
  const ctx = createTextContext(map);
  const leftovers: Leftover[] = [];
  for (const [file, text] of readTree(ROOT).texts)
    leftovers.push(...findLeftovers(ctx, file, text));
  const report = [
    `# ${plan}: leftovers by ${base}'s map`,
    '',
    ...(leftovers.length ? leftoverLines(leftovers) : ['None.']),
    '',
  ].join('\n');
  const reportFile = writeReport(ROOT, `${plan}-leftovers.md`, report);
  for (const l of leftovers) console.log(`  ${l.file}:${l.line} ${l.path}`);
  console.log(`Report: ${path.relative(process.cwd(), reportFile)}`);
  if (leftovers.length) fail(`${leftovers.length} mentions of old paths left`);
  console.log(`${GREEN}✔ No old path of ${plan} is named outside the history${RESET}`);
};

// Main

const plan = toPlan(valueOf('--plan'));
const verifyRef = valueOf('--verify-commit');
const leftoversRef = valueOf('--leftovers');
if (verifyRef) verifyCommit(verifyRef, plan);
else if (!plan) fail(`--plan is missing\n${USAGE}`);
else if (leftoversRef) reportLeftovers(leftoversRef, plan);
else if (args.includes('--dry-run')) dryRun(plan, args.includes('--keep-worktree'));
else await apply(plan);
