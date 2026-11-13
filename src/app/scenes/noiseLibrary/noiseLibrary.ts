import * as THREE from 'three/webgpu';
import { vec2, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  bakeTexture,
  createCameraEntity,
  createMaterial,
  createMeshEntity,
  getGeometry,
  getRenderer,
  lerror,
  saveBufferGeometry,
  type BakedTexture,
} from 'aekasha';
import { loadDebugModuleAsync } from 'aekasha/debug';
import { getBackendName, getErrorMessage, meshUv, sampleTexture } from '../../shared/verifyHarness';
import {
  checkNoiseRow,
  getChannelMaxByte,
  getChannelStats,
  type NoiseRowResult,
} from './noiseChecks';
import { getNoiseRows, type NoiseRow } from './noiseRows';

/**
 * The noise library's verification scene (p304 Phase 3): the toolkit's noise functions
 * (`aekasha/toolkit/terrain`), a pair of tiles each, in a 3 × 3 grid read left to right, top to
 * bottom (`getNoiseRows`): value noise, gradient noise, fbm, a domain warp, Worley, `hash12`,
 * `heightToNormal` and `heightToCavity`. The left tile of a pair is the periodic bake (256², one
 * tile) repeated 3 × 3 on one quad: a seam shows as a line through it. The right one is the same
 * graph without a period, evaluated live in its material over the same three tiles: no seam to
 * show, and nothing repeats.
 *
 * During the load it checks the exit criteria and logs an error for each failure, so the scene
 * runner (`yarn verify:scenes --only noiseLibrary`, `--webgl` for SwiftShader) fails on one. Each
 * function is baked at 32 cells over 256², periodic and non-periodic (offset to other cells), and
 * read back (`noiseChecks.ts`): the periodic bake must step no more across its wrap than inside,
 * repeat exactly a whole tile away, and match the non-periodic bake's mean and spread.
 * `window.__noiseLibrary` holds the results, and the debug env's "Noise library" tab
 * (`_dbg__noiseLibrary.ts`) shows them.
 */

const NOISE_LIBRARY_SCENE_ID = 'noiseLibrary';
/** The bakes' size: one tile, read back for the checks (256 RGBA8 texels: no row padding). */
const BAKE_SIZE = 256;
/** The checks' cells per tile: enough cells for the statistics to settle. */
const CHECK_CELLS = 32;
/** The non-periodic check bake's offset, in tiles: other cells than the periodic bake's. */
const PLAIN_OFFSET = [13.37, 7.21] as const;
/** The periodicity check's shift, in whole tiles. */
const PERIOD_SHIFT = [1, -2] as const;
/** A tile pair's quads (3 tiles across), their gap, and the grid's gaps. */
const QUAD = 3;
const PAIR_GAP = 0.3;
const GRID_GAP = { x: 1.2, y: 0.9 };
const COLUMNS = 3;

/** What `window.__noiseLibrary` holds. */
type NoiseLibraryState = {
  results: {
    backend?: string;
    rows?: Record<string, NoiseRowResult & { label: string }>;
    /** Every row passed */
    passed?: boolean;
    error?: string;
    done?: boolean;
  };
};

const state: NoiseLibraryState = { results: {} };

const getQuadGeometry = () =>
  getGeometry('noiseLibraryQuad') ??
  saveBufferGeometry(new THREE.PlaneGeometry(QUAD, QUAD), { id: 'noiseLibraryQuad' });

/** The left and right tile centres of the pair in grid slot `index`. */
const getPairPositions = (index: number) => {
  const pairWidth = QUAD * 2 + PAIR_GAP;
  const rows = Math.ceil(getNoiseRows().length / COLUMNS);
  const width = COLUMNS * pairWidth + (COLUMNS - 1) * GRID_GAP.x;
  const height = rows * QUAD + (rows - 1) * GRID_GAP.y;
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const left = -width / 2 + column * (pairWidth + GRID_GAP.x) + QUAD / 2;
  const y = height / 2 - row * (QUAD + GRID_GAP.y) - QUAD / 2;
  return { left: { x: left, y }, right: { x: left + QUAD + PAIR_GAP, y } };
};

const createTile = (id: string, position: { x: number; y: number }, color: Node<'vec4'>) => {
  const mat = createMaterial({ id, type: 'BASICNODEMATERIAL', params: {} });
  (mat as THREE.MeshBasicNodeMaterial).colorNode = color;
  createMeshEntity(
    { geo: getQuadGeometry(), mat, position: { x: position.x, y: position.y, z: 0 } },
    { appId: `${id}_tile` }
  );
};

/** A row's pair: its periodic bake repeated 3 × 3, and the graph live without a period. */
const createRowTilesAsync = async (row: NoiseRow, index: number) => {
  const baked = await bakeTexture({
    id: `p304_noise_${row.id}`,
    size: BAKE_SIZE,
    outputs: [{ name: 'shown' }],
    build: ({ uv }) => ({
      shown: vec4(row.show({ uv, cells: row.shownCells, period: row.shownCells }), 1),
    }),
  });
  const { left, right } = getPairPositions(index);
  const tiles = meshUv().mul(3) as Node<'vec2'>;
  createTile(
    `p304_noise_${row.id}_periodic`,
    left,
    sampleTexture(baked.textures.shown, tiles) as unknown as Node<'vec4'>
  );
  createTile(
    `p304_noise_${row.id}_live`,
    right,
    vec4(row.show({ uv: tiles, cells: row.shownCells, period: 0 }), 1) as unknown as Node<'vec4'>
  );
};

/** Each row's scalar in a channel: 8 rows, two RGBA outputs. */
const packScalars = (rows: NoiseRow[], scalar: (row: NoiseRow) => Node<'float'>) => {
  const scalars = rows.map(scalar);
  return [
    vec4(scalars[0], scalars[1], scalars[2], scalars[3]),
    vec4(scalars[4], scalars[5], scalars[6], scalars[7]),
  ];
};

/**
 * The check bakes: the periodic one (the scalars, and their periodicity differences × 100) and the
 * non-periodic one (the scalars, offset to other cells), each output read back.
 */
const bakeChecksAsync = async (rows: NoiseRow[]) => {
  const periodic = await bakeTexture({
    id: 'p304_noiseChecksPeriodic',
    size: BAKE_SIZE,
    mipmaps: false,
    outputs: [{ name: 'scalars0' }, { name: 'scalars1' }, { name: 'shift0' }, { name: 'shift1' }],
    build: ({ uv }) => {
      const shifted = uv.add(vec2(...PERIOD_SHIFT)) as Node<'vec2'>;
      const at = (input: Node<'vec2'>) => (row: NoiseRow) =>
        row.scalar({ uv: input, cells: CHECK_CELLS, period: CHECK_CELLS });
      const [scalars0, scalars1] = packScalars(rows, at(uv));
      const [shift0, shift1] = packScalars(
        rows,
        (row) => at(uv)(row).sub(at(shifted)(row)).abs().mul(100) as Node<'float'>
      );
      return { scalars0, scalars1, shift0, shift1 };
    },
  });
  const plain = await bakeTexture({
    id: 'p304_noiseChecksPlain',
    size: BAKE_SIZE,
    mipmaps: false,
    outputs: [{ name: 'scalars0' }, { name: 'scalars1' }],
    build: ({ uv }) => {
      const offset = uv.add(vec2(...PLAIN_OFFSET)) as Node<'vec2'>;
      const [scalars0, scalars1] = packScalars(rows, (row) =>
        row.scalar({ uv: offset, cells: CHECK_CELLS, period: 0 })
      );
      return { scalars0, scalars1 };
    },
  });
  return { periodic, plain };
};

/** An output of a bake, read back as RGBA8 bytes (level 0). */
const readOutputAsync = async (baked: BakedTexture, name: string, index: number) => {
  const renderer = getRenderer(true) as THREE.Renderer;
  const target = baked.textures[name].renderTarget as THREE.RenderTarget;
  const pixels = await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    BAKE_SIZE,
    BAKE_SIZE,
    index
  );
  return pixels as Uint8Array;
};

/** Reads the check bakes back and checks each row; an error for each failure. */
const runChecksAsync = async (rows: NoiseRow[]) => {
  const { periodic, plain } = await bakeChecksAsync(rows);
  const periodicBytes = [
    await readOutputAsync(periodic, 'scalars0', 0),
    await readOutputAsync(periodic, 'scalars1', 1),
  ];
  const shiftBytes = [
    await readOutputAsync(periodic, 'shift0', 2),
    await readOutputAsync(periodic, 'shift1', 3),
  ];
  const plainBytes = [
    await readOutputAsync(plain, 'scalars0', 0),
    await readOutputAsync(plain, 'scalars1', 1),
  ];
  const results: NonNullable<NoiseLibraryState['results']['rows']> = {};
  rows.forEach((row, i) => {
    const output = Math.floor(i / 4);
    const channel = i % 4;
    const result = checkNoiseRow(
      getChannelStats(periodicBytes[output], BAKE_SIZE, BAKE_SIZE, channel),
      getChannelStats(plainBytes[output], BAKE_SIZE, BAKE_SIZE, channel),
      getChannelMaxByte(shiftBytes[output], channel)
    );
    results[row.id] = { ...result, label: row.label };
    for (const failure of result.failures) {
      lerror(`[noiseLibrary] ${row.label} (${getBackendName()}): ${failure}.`);
    }
  });
  // The check bakes are the scene's textures (released on its exit), but needed no longer
  periodic.dispose();
  plain.dispose();
  return results;
};

/** Builds the scene; see the file's header. */
export const scene = async () => {
  (window as unknown as { __noiseLibrary: NoiseLibraryState }).__noiseLibrary = state;
  state.results = {};
  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 45,
      position: { x: 0, y: 0, z: 15.5 },
      lookAtPoint: { x: 0, y: 0, z: 0 },
      active: true,
    },
    { appId: 'noiseLibraryCam', debugData: { name: 'Noise library' } }
  );
  const rows = getNoiseRows();
  try {
    for (let i = 0; i < rows.length; i++) await createRowTilesAsync(rows[i], i);
    state.results.rows = await runChecksAsync(rows);
    state.results.passed = Object.values(state.results.rows).every(
      (row) => row.failures.length === 0
    );
    state.results.backend = getBackendName();
    state.results.done = true;
  } catch (error) {
    lerror('[noiseLibrary] Build failed', error);
    state.results.error = getErrorMessage(error);
  }
  const debugTab = await loadDebugModuleAsync(
    () => import('./_dbg__noiseLibrary'),
    false,
    'noiseLibrary tab'
  );
  debugTab?.current?.createNoiseLibraryTab(NOISE_LIBRARY_SCENE_ID, state.results);
};
