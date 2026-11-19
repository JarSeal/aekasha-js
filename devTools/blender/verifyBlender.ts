/**
 * The terrain add-on's check (`yarn verify:blender`, p306 Phase 5 step 9): runs
 * `checkTerrainAddon.py` in a background Blender (`findBlender`, at least the add-on's `bl_info`
 * minimum), which loads `src/toolkit/terrain/blender/aekasha_terrain_tools.py` from its path and
 * checks every operator (Add, Validate, Normalize, the preview material, Bake AO, Bake Colour Map,
 * Split, Export, a trimesh block, New Splat Map, a decal set's Add and Export), then the plan's path
 * end to end: Add → paint the
 * corner markers → Bake AO →
 * Validate → Export, and Split's 2 × 2 blocks exported. Then it reads each exported GLB as the
 * engine does (`terrainBlockChecks.ts`): the custom props' HEIGHTFIELD and the import's
 * derivation of it, the UVs against the positions, the workflow block's markers, bump and AO,
 * and the split blocks' shared edges.
 *
 *   yarn verify:blender
 *
 * Not in `yarn test`: Blender isn't a dependency. The package script fetches `grass01` and
 * `rocks01` first (the preview material's check draws them). Its output folder is
 * `.cache/verify/blender/` (emptied first): `report.json` (each check `ok` or its traceback, and
 * the timings), `blender.log` (Blender's whole output), the renders and `export/`. Every line also
 * goes to `.cache/verify/progress.log`. Exits 1 on a failed check, 2 on an error.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO, type Accessor } from '@gltf-transform/core';
import { ROOT } from '../paths';
import { out, PROGRESS_LOG_WATCH } from '../progressLog';
import { findBlender, formatBlenderVersion, type BlenderVersion } from './findBlender';
import {
  type ExportedBlock,
  type WorkflowExpectations,
  checkHeightfield,
  checkSharedEdges,
  checkUvs,
  checkWorkflowBlock,
} from './terrainBlockChecks';

const ADDON_FILE = path.join(ROOT, 'src/toolkit/terrain/blender/aekasha_terrain_tools.py');
const CHECK_SCRIPT = path.join(ROOT, 'devTools/blender/checkTerrainAddon.py');
const OUT_DIR = path.join(ROOT, '.cache/verify/blender');
/** The check script's lines to show; the rest of Blender's output goes to `blender.log` only */
const PROGRESS_PREFIX = '[aek] ';
/** The whole Blender run (about a minute on a desktop CPU) */
const BLENDER_TIMEOUT_MS = 10 * 60_000;

const color = (code: string) => (process.env.NO_COLOR ? '' : `\x1b[${code}m`);
const RED = color('31');
const GREEN = color('32');
const DIM = color('2');
const RESET = color('0');

/** Prints the message and exits 2 */
function fail(msg: string): never {
  out(`${RED}${msg}${RESET}`, true);
  process.exit(2);
}

/** The add-on's minimum Blender, from its `bl_info` */
const readAddonMinimum = (): BlenderVersion => {
  const match = /"blender":\s*\((\d+),\s*(\d+)/.exec(fs.readFileSync(ADDON_FILE, 'utf8'));
  if (!match) fail(`No "blender" version in ${path.relative(ROOT, ADDON_FILE)}'s bl_info`);
  return [Number(match[1]), Number(match[2])];
};

/** A path as the Blender takes it: a Windows `blender.exe` from WSL2 takes Windows paths */
const toBlenderPath = (file: string, isWindows: boolean) => {
  if (!isWindows) return file;
  const result = spawnSync('wslpath', ['-w', file], { encoding: 'utf8' });
  const converted = result.stdout?.trim();
  if (result.status !== 0 || !converted) fail(`wslpath -w couldn't convert ${file}`);
  return converted;
};

/** Runs the check script; resolves to Blender's exit code (null: killed by the timeout) */
const runBlenderAsync = (exe: string, args: string[], logFile: string) =>
  new Promise<number | null>((resolve, reject) => {
    const log = fs.createWriteStream(logFile);
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), BLENDER_TIMEOUT_MS);
    let pending = '';
    const onData = (chunk: Buffer) => {
      log.write(chunk);
      pending += chunk.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith(PROGRESS_PREFIX)) out(`  ${line.slice(PROGRESS_PREFIX.length)}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      log.end();
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      log.end(() => resolve(code));
    });
  });

/** A block the check script exported: its settings and its GLB, relative to the output folder */
type ExportEntry = Pick<
  ExportedBlock,
  'id' | 'size' | 'resolution' | 'gridX' | 'gridZ' | 'layout'
> & {
  glb: string;
};

/** `report.json`: each check `ok` or its traceback, the exports, and the timings */
type Report = {
  blender: string;
  checks: Record<string, string>;
  exports: ExportEntry[];
  workflow?: WorkflowExpectations;
};

/** An accessor's values as floats, a normalized integer one scaled to 0..1 */
const readFloats = (accessor: Accessor | null, name: string) => {
  if (!accessor) throw new Error(`no ${name}`);
  const array = accessor.getArray();
  if (!array) throw new Error(`${name} has no data`);
  if (!accessor.getNormalized()) return Float32Array.from(array);
  const max = array instanceof Uint16Array ? 65535 : array instanceof Uint8Array ? 255 : 1;
  return Float32Array.from(array, (value) => value / max);
};

/** The GLB's one mesh node, as `terrainBlockChecks` reads it */
const readBlockAsync = async (entry: ExportEntry): Promise<ExportedBlock> => {
  const document = await new NodeIO().read(path.join(OUT_DIR, entry.glb));
  const node = document
    .getRoot()
    .listNodes()
    .find((n) => n.getMesh());
  const primitive = node?.getMesh()?.listPrimitives()[0];
  if (!node || !primitive) throw new Error('no mesh node');
  const indices = primitive.getIndices()?.getArray();
  return {
    ...entry,
    nodeName: node.getName(),
    extras: node.getExtras(),
    positions: readFloats(primitive.getAttribute('POSITION'), 'POSITION'),
    normals: readFloats(primitive.getAttribute('NORMAL'), 'NORMAL'),
    uvs: readFloats(primitive.getAttribute('TEXCOORD_0'), 'TEXCOORD_0'),
    colors: readFloats(primitive.getAttribute('COLOR_0'), 'COLOR_0'),
    indices: indices ? Uint32Array.from(indices) : null,
  };
};

const printResult = (title: string, problems: string[]) => {
  out(`  ${problems.length ? `${RED}✗` : `${GREEN}✓`} ${title}${RESET}`);
  for (const problem of problems) out(`    ${RED}${problem}${RESET}`);
  return problems.length ? 1 : 0;
};

/** The exported GLBs as the engine reads them; returns the failed checks' count */
const checkExportsAsync = async (report: Report) => {
  let failed = 0;
  const blocks: ExportedBlock[] = [];
  for (const entry of report.exports) {
    let block: ExportedBlock;
    try {
      block = await readBlockAsync(entry);
    } catch (error) {
      failed += printResult(`${entry.id}: ${(error as Error).message}`, ['unreadable']);
      continue;
    }
    blocks.push(block);
    const cells = block.resolution - 1;
    failed += printResult(
      `${block.id}: a HEIGHTFIELD of ${cells} × ${cells} cells, read by the import`,
      checkHeightfield(block)
    );
    failed += printResult(`${block.id}: the UVs follow the positions`, checkUvs(block));
    if (block.id === report.workflow?.id) {
      const { problems, ao } = checkWorkflowBlock(block, report.workflow);
      failed += printResult(
        `${block.id}: the corner markers, the bump and the AO ${DIM}(darkest ${ao.min.toFixed(2)}, flat ${ao.flat.toFixed(2)})`,
        problems
      );
    }
  }
  const split = blocks.filter((block) => block.id !== report.workflow?.id);
  const { problems, shared, normalGap } = checkSharedEdges(split);
  // 2 × 2 blocks of 33: two lines of 65 grid points through the middle, crossing at one
  const expectedShared = 2 * (2 * 32 + 1) - 1;
  if (shared !== expectedShared)
    problems.push(`${shared} shared grid points, not ${expectedShared}`);
  failed += printResult(
    `the split blocks' shared edges ${DIM}(${shared} grid points, normals within ${normalGap.toExponential(1)})`,
    problems
  );
  return failed;
};

const mainAsync = async () => {
  if (process.argv.length > 2)
    fail(`Unknown arguments: ${process.argv.slice(2).join(' ')} (yarn verify:blender takes none)`);
  const started = Date.now();
  const blender = findBlender(readAddonMinimum());
  const isWindows = blender.path.toLowerCase().endsWith('.exe');
  out(
    `Blender check: Blender ${formatBlenderVersion(blender.version)} ${DIM}(${blender.path})${RESET}`
  );
  out(`${DIM}Watch it: ${PROGRESS_LOG_WATCH}${RESET}`);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const args = [
    '-b',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    toBlenderPath(CHECK_SCRIPT, isWindows),
    '--',
    ...[ADDON_FILE, OUT_DIR, ROOT].map((file) => toBlenderPath(file, isWindows)),
  ];
  const logFile = path.join(OUT_DIR, 'blender.log');
  const code = await runBlenderAsync(blender.path, args, logFile);
  const reportFile = path.join(OUT_DIR, 'report.json');
  if (!fs.existsSync(reportFile)) {
    fail(
      `Blender exited ${code ?? 'on the timeout'} without a report: see ${path.relative(ROOT, logFile)}`
    );
  }
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Report;
  let failed = 0;
  for (const [name, result] of Object.entries(report.checks)) {
    if (result !== 'ok')
      failed += printResult(`${name} (in Blender)`, result.trimEnd().split('\n'));
  }
  if (code !== 0 && !failed) {
    failed += printResult(`Blender exited ${code ?? 'on the timeout'}`, [
      `see ${path.relative(ROOT, logFile)}`,
    ]);
  }

  out('The exported GLBs, as the engine reads them:');
  failed += await checkExportsAsync(report);

  const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
  if (failed) {
    out(
      `\n${RED}${failed} check(s) failed${RESET} in ${took} ${DIM}(${path.relative(ROOT, reportFile)})${RESET}`
    );
    process.exit(1);
  }
  out(`\n${GREEN}All Blender checks passed${RESET} in ${took}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mainAsync().catch((error: Error) => fail(`The Blender check stopped: ${error.message}`));
}
