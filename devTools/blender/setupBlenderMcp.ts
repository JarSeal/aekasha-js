/* eslint-disable no-console -- a command's own output */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFileAtomic } from '../files';
import { ROOT } from '../paths';
import { findBlender, formatBlenderVersion } from './findBlender';

/**
 * Sets up the Blender MCP server (Blender Lab's, `projects.blender.org/lab/blender_mcp`) for
 * Claude Code: a Python venv in the gitignored `.tools/blender-mcp/` with the server pinned to a
 * commit, and the Blender its background tools start (`blender-path`, read by
 * `devTools/blender/blenderMcp.sh`, the launcher `.mcp.json` names). Does nothing when that commit
 * is already installed. The Blender side, its extension, is installed in Blender (the
 * `blender-assets` skill's Setup).
 *
 * Usage: `yarn setupBlenderMcp [--force]` (`--force` rebuilds the venv)
 */

/** The server's commit (2026-09-29, server 1.0.2, add-on 1.0.0, Blender 5.1+) */
export const BLENDER_MCP_COMMIT = 'dbbf836ad4b1025f14a2b3b504c43903f39e0b04';
const BLENDER_MCP_REPO = 'https://projects.blender.org/lab/blender_mcp.git';
/** The add-on's `blender_version_min` */
const MIN_BLENDER: [number, number] = [5, 1];

export const BLENDER_MCP_DIR = path.join(ROOT, '.tools', 'blender-mcp');
const VENV_DIR = path.join(BLENDER_MCP_DIR, 'venv');
const STAMP_FILE = path.join(BLENDER_MCP_DIR, 'installed.json');
const BLENDER_PATH_FILE = path.join(BLENDER_MCP_DIR, 'blender-path');

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw new Error(`${command} didn't start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
};

/** The server's Python needs 3.10+ (its `pyproject.toml`) */
const checkPython = () => {
  const result = spawnSync('python3', ['-c', 'import sys; print(sys.version_info >= (3, 10))'], {
    encoding: 'utf8',
  });
  if (result.error || result.stdout.trim() !== 'True') {
    throw new Error(
      'python3 3.10 or newer with venv is needed (Ubuntu: apt install python3-venv).'
    );
  }
};

const readStamp = (): string | null => {
  try {
    return (JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8')) as { commit?: string }).commit ?? null;
  } catch {
    return null;
  }
};

const installServer = (force: boolean) => {
  const installed = readStamp() === BLENDER_MCP_COMMIT;
  if (installed && !force && fs.existsSync(path.join(VENV_DIR, 'bin', 'blender-mcp'))) {
    console.log(`  server ${BLENDER_MCP_COMMIT.slice(0, 7)} already installed`);
    return;
  }
  checkPython();
  fs.rmSync(VENV_DIR, { recursive: true, force: true });
  fs.mkdirSync(BLENDER_MCP_DIR, { recursive: true });
  console.log(`  creating the venv in ${path.relative(ROOT, VENV_DIR)}/`);
  run('python3', ['-m', 'venv', VENV_DIR]);
  console.log(`  installing the server at ${BLENDER_MCP_COMMIT.slice(0, 7)}`);
  run(path.join(VENV_DIR, 'bin', 'pip'), [
    'install',
    '--disable-pip-version-check',
    '--quiet',
    `blender-mcp @ git+${BLENDER_MCP_REPO}@${BLENDER_MCP_COMMIT}#subdirectory=mcp`,
  ]);
  writeFileAtomic(STAMP_FILE, `${JSON.stringify({ commit: BLENDER_MCP_COMMIT }, null, 2)}\n`);
};

/** The Blender the background tools start; missing only costs those tools */
const recordBlender = () => {
  try {
    const blender = findBlender(MIN_BLENDER);
    writeFileAtomic(BLENDER_PATH_FILE, `${blender.path}\n`);
    console.log(`  Blender ${formatBlenderVersion(blender.version)}: ${blender.path}`);
  } catch (error) {
    fs.rmSync(BLENDER_PATH_FILE, { force: true });
    console.log(`  ${(error as Error).message} The background (_for_cli) tools won't run.`);
  }
};

const main = () => {
  const force = process.argv.includes('--force');
  try {
    installServer(force);
    recordBlender();
    console.log('\x1b[32m✓ [Blender MCP] the server is set up (.mcp.json starts it)\x1b[0m');
    console.log(
      '  In Blender: add the extensions repository https://lab.blender.org/, install and enable "MCP", and tick its auto-start (the blender-assets skill, Setup).'
    );
  } catch (error) {
    console.error(`\x1b[31m✗ [Blender MCP] ${(error as Error).message}\x1b[0m`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
