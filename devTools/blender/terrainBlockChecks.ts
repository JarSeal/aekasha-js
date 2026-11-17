/* eslint-disable no-console -- the import's logs are captured from the console */
import { deriveHeightfield } from '../../src/_engine/features/physics/import/HeightfieldFromGeometry';
import { parseCustomProps } from '../../src/_engine/kernel/assets/import/CustomProps';

/**
 * `yarn verify:blender`'s checks on the terrain add-on's exported GLBs (p306 Phase 5 step 9),
 * read as the engine reads them: the node's custom props through `parseCustomProps`, the
 * HEIGHTFIELD collider through the import's own derivation (`deriveHeightfield`). Pure: the CLI
 * (`verifyBlender.ts`) decodes the GLBs into {@link ExportedBlock}s. Each check returns its
 * problems, empty when it passes.
 */

/** A block the add-on exported, as the check script reports it and its GLB holds it */
export type ExportedBlock = {
  id: string;
  size: number;
  resolution: number;
  gridX: number;
  gridZ: number;
  layout: 'RGB_AO' | 'RGBA';
  /** The mesh node's name and extras (its custom props) */
  nodeName: string;
  extras: Record<string, unknown>;
  /** The engine's (glTF's) x, y, z a vertex */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** `COLOR_0`, RGBA a vertex, normalized to 0..1 */
  colors: Float32Array;
  indices: Uint32Array | null;
};

/** The check script's workflow block: its bump and its corner markers */
export type WorkflowExpectations = {
  id: string;
  bump: { x: number; z: number; height: number; radius: number };
  /** The markers' rows and columns from the corner (red at -x, -z; green at +x, -z) */
  markerVertices: number;
};

const TOLERANCE = 1e-5;

type DeriveParams = Parameters<typeof deriveHeightfield>;

/** Runs `run` with the console's warnings and errors collected instead of printed */
const captureConsole = <T>(run: () => T): { result: T; logs: string[] } => {
  const logs: string[] = [];
  const { warn, error } = console;
  console.warn = (...data: unknown[]) => logs.push(`warning: ${data.join(' ')}`);
  console.error = (...data: unknown[]) => logs.push(`error: ${data.join(' ')}`);
  try {
    return { result: run(), logs };
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

/** The vertex's row (along +z) and column (along +x) from its position */
const getGridPoint = (block: ExportedBlock, i: number) => {
  const spacing = block.size / (block.resolution - 1);
  const half = block.size / 2;
  return {
    row: Math.round((block.positions[i * 3 + 2] + half) / spacing),
    col: Math.round((block.positions[i * 3] + half) / spacing),
  };
};

/**
 * The node's custom props make a visible, fixed HEIGHTFIELD body of `resolution - 1` cells each
 * way, and the import's derivation reads the grid without a log, centred, with every vertex's
 * height where Rapier's layout puts its row and column (`heights[row + col · (nrows + 1)]`).
 */
export const checkHeightfield = (block: ExportedBlock): string[] => {
  const cells = block.resolution - 1;
  const parsed = parseCustomProps(block.extras);
  const collider = parsed.colliderParams;
  const problems = parsed.warnings.map((warning) => `custom props: ${warning}`);
  if (!parsed.isPhysObj || !parsed.keepMesh || parsed.rigidType !== 'FIXED') {
    problems.push(
      `not a visible fixed body (isPhysObj ${parsed.isPhysObj}, keepMesh ${parsed.keepMesh}, rigidType ${parsed.rigidType})`
    );
  }
  if (collider?.type !== 'HEIGHTFIELD') {
    return [...problems, `the collider is ${collider?.type ?? 'missing'}, not HEIGHTFIELD`];
  }
  if (collider.nrows !== cells || collider.ncols !== cells) {
    problems.push(`${collider.ncols} × ${collider.nrows} cells, not ${cells} × ${cells}`);
  }
  const info: DeriveParams[3] = {
    geometryId: `${block.id}/${block.nodeName}`,
    importId: block.id,
    nodeName: block.nodeName,
    parentPath: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    customProps: parsed,
    isDracoCompressed: false,
  };
  const { result, logs } = captureConsole(() =>
    deriveHeightfield(collider, block.positions, block.indices, info)
  );
  problems.push(...logs.map((log) => `the import's ${log}`));
  if (result?.type !== 'HEIGHTFIELD' || !result.heights || !result.scale) {
    return [...problems, 'the import derived no heightfield'];
  }
  if (result.translation) {
    problems.push(`the collider is offset by ${JSON.stringify(result.translation)}: not centred`);
  }
  if (result.scale.x !== block.size || result.scale.z !== block.size || result.scale.y !== 1) {
    problems.push(
      `its scale is ${JSON.stringify(result.scale)}, not ${block.size} × 1 × ${block.size}`
    );
  }
  let worst = 0;
  let worstAt = -1;
  for (let i = 0; i < block.positions.length / 3; i++) {
    const { row, col } = getGridPoint(block, i);
    const gap = Math.abs(result.heights[row + col * (cells + 1)] - block.positions[i * 3 + 1]);
    if (gap > worst) [worst, worstAt] = [gap, i];
  }
  if (worst > TOLERANCE) {
    problems.push(`the collider misses vertex ${worstAt} by ${worst} m`);
  }
  return problems;
};

/** UV0 is the top-down projection (D1): U along +x and V along +z from the -x, -z corner */
export const checkUvs = (block: ExportedBlock): string[] => {
  const half = block.size / 2;
  for (let i = 0; i < block.positions.length / 3; i++) {
    const u = (block.positions[i * 3] + half) / block.size;
    const v = (block.positions[i * 3 + 2] + half) / block.size;
    if (
      Math.abs(block.uvs[i * 2] - u) > TOLERANCE ||
      Math.abs(block.uvs[i * 2 + 1] - v) > TOLERANCE
    ) {
      return [
        `vertex ${i}'s UV is (${block.uvs[i * 2]}, ${block.uvs[i * 2 + 1]}), not (${u}, ${v}) from its position`,
      ];
    }
  }
  return [];
};

/**
 * The workflow block: the bump's peak at its place (a flipped axis puts it in another corner),
 * red only on the -x, -z corner's markers and green only on the +x, -z one's (found by position,
 * not vertex order), and the baked AO darker at the bump's foot than on the far flat corner.
 * Returns the problems and the AO figures.
 */
export const checkWorkflowBlock = (
  block: ExportedBlock,
  expected: WorkflowExpectations
): { problems: string[]; ao: { min: number; flat: number } } => {
  const problems: string[] = [];
  const count = block.positions.length / 3;
  let peak = 0;
  for (let i = 1; i < count; i++) {
    if (block.positions[i * 3 + 1] > block.positions[peak * 3 + 1]) peak = i;
  }
  const spacing = block.size / (block.resolution - 1);
  const [px, pz] = [block.positions[peak * 3], block.positions[peak * 3 + 2]];
  if (Math.hypot(px - expected.bump.x, pz - expected.bump.z) > spacing) {
    problems.push(
      `the bump's peak is at x ${px}, z ${pz}, not x ${expected.bump.x}, z ${expected.bump.z}`
    );
  }
  const last = block.resolution - 1;
  let flat = 0;
  let min = 1;
  let wrong = 0;
  let firstWrong = '';
  for (let i = 0; i < count; i++) {
    const { row, col } = getGridPoint(block, i);
    const isTop = row < expected.markerVertices;
    const red = isTop && col < expected.markerVertices ? 1 : 0;
    const green = isTop && col > last - expected.markerVertices ? 1 : 0;
    const [r, g, b, a] = block.colors.subarray(i * 4, i * 4 + 4);
    if (Math.abs(r - red) > TOLERANCE || Math.abs(g - green) > TOLERANCE || b > TOLERANCE) {
      if (!wrong++)
        firstWrong = `row ${row}, column ${col} is (${r}, ${g}, ${b}), not (${red}, ${green}, 0)`;
    }
    min = Math.min(min, a);
    if (row === last && col === 0) flat = a;
  }
  if (wrong)
    problems.push(`${wrong} vertices' splat off the corner markers, the first: ${firstWrong}`);
  if (!(flat > 0.95)) problems.push(`the far flat corner (-x, +z) is occluded: AO ${flat}`);
  if (!(min < 0.9)) problems.push(`nothing is occluded (the darkest AO ${min}): was it baked?`);
  return { problems, ao: { min, flat } };
};

/**
 * How far apart two blocks' shared normals may be: Blender stores custom normals to about 1e-4
 * (Split's on a 2 × 2 split: up to 1.1e-4, 0.006°), and without them an edge's normals differ by
 * about 0.045 (2.6°)
 */
const NORMAL_TOLERANCE = 1e-3;

/** The largest difference between two vertices' values of `width` floats each */
const getGap = (a: Float32Array, i: number, b: Float32Array, j: number, width: number) => {
  let gap = 0;
  for (let k = 0; k < width; k++)
    gap = Math.max(gap, Math.abs(a[i * width + k] - b[j * width + k]));
  return gap;
};

/**
 * Neighbouring blocks share their edge vertices exactly (D1): every world grid point two or more
 * blocks have is one height, one normal (within {@link NORMAL_TOLERANCE}: the add-on's custom
 * normals) and one colour. Returns the problems, how many points were shared and the largest
 * normal gap.
 */
export const checkSharedEdges = (
  blocks: ExportedBlock[]
): { problems: string[]; shared: number; normalGap: number } => {
  const seen = new Map<string, { i: number; block: ExportedBlock }>();
  const sharedKeys = new Set<string>();
  const problems: string[] = [];
  let normalGap = 0;
  for (const block of blocks) {
    const cells = block.resolution - 1;
    for (let i = 0; i < block.positions.length / 3; i++) {
      const { row, col } = getGridPoint(block, i);
      // In world grid steps: the block's corner plus its own row and column
      const key = `${block.size}:${block.gridX * cells + col},${block.gridZ * cells + row}`;
      const other = seen.get(key);
      if (!other) {
        seen.set(key, { i, block });
        continue;
      }
      sharedKeys.add(key);
      const at = `${block.id} vertex ${i} and ${other.block.id} vertex ${other.i}`;
      const [height, otherHeight] = [
        block.positions[i * 3 + 1],
        other.block.positions[other.i * 3 + 1],
      ];
      const normals = getGap(block.normals, i, other.block.normals, other.i, 3);
      normalGap = Math.max(normalGap, normals);
      if (height !== otherHeight) {
        problems.push(`${at}: heights ${height} and ${otherHeight}`);
      } else if (normals > NORMAL_TOLERANCE) {
        problems.push(`${at}: the normals differ by ${normals}`);
      } else if (getGap(block.colors, i, other.block.colors, other.i, 4) > TOLERANCE) {
        problems.push(`${at}: the colours differ`);
      }
    }
  }
  const more = problems.length > 5 ? [`… and ${problems.length - 5} more`] : [];
  return { problems: [...problems.slice(0, 5), ...more], shared: sharedKeys.size, normalGap };
};
