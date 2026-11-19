// A ribbon decal's patch on a terrain block (p309 Phase 4, D4): a strip along a path (tyre
// tracks), its rows at stations along the path at most `step` apart and its columns across its
// width as close, each vertex on the block's triangles (sampled) and lifted along the block's
// normal there. Its faces aren't the block's (the path crosses its cells at any angle), so a step
// of half the block's grid spacing and a lift of about 15 mm keep it over the block: Phase 3
// measured such faces at +7…+31 mm with a 15 mm lift, none under. The cell repeats along the path,
// `tileLength` metres a tile from `along` metres into one: a station where a tile ends is two rows,
// the tile's end and the next one's start. `uv1` runs 0..1 across (v: the edge fade's sides) and
// along it holds a fade coordinate: 0.5 inside, falling to 0 at a faded end over `endFadeMeters` at
// the material's share, so the same material fades any length of ribbon over metres. Its rows turn
// at the path's points along the bisector, widened to keep the width (a miter, at most twice), and
// at its ends along a given direction at their own width, so two ribbons joined at a point (the
// first's own last direction the second's start) share that row and meet without a gap. A path
// too long for the arrays takes longer steps. The stations go into reused lists, so a spawn
// allocates nothing here once they've grown.
import type { AtlasCellRect } from 'aekasha';
import { createBlockSurfaceSample, sampleBlockSurface } from '../blocks/BlockSurface';
import type { BlockSurface } from '../blocks/BlockSurface';
import type { DecalPatchArrays, DecalPatchCounts } from './DecalPatch';

/** A step's growth when the rows don't fit the arrays */
const STEP_GROWTH = 1.25;
/** A row's widening at a sharp turn at most */
const MAX_MITER = 2;
/** Metres under which two stations are one (and a segment has no length) */
const EPSILON = 1e-6;

/**
 * Where a ribbon goes and what it shows. Points and directions are in world space (x, z).
 * @internal
 */
export type DecalRibbonSpec = {
  /** The path; its first `pointCount` points are used */
  points: readonly { x: number; z: number }[];
  pointCount: number;
  /** Metres across */
  width: number;
  /** Metres along the path one tile of the cell covers */
  tileLength: number;
  /** Metres into a tile where the path starts */
  along: number;
  /** The atlas cell's UV rect */
  cellRect: AtlasCellRect;
  /** Metres along the block's normal */
  lift: number;
  /** The longest step between rows and between columns, metres */
  step: number;
  /** Whether the start and the end fade out, over `endFadeMeters` */
  fadeStart: boolean;
  fadeEnd: boolean;
  endFadeMeters: number;
  /** The decal material's edge fade along u (a share of `uv1`'s 0..1; 0: none) */
  edgeShareU: number;
  /** The rows' direction at the start and the end (unit), else their segment's: a joined
   * ribbon's, so the two meet */
  startDirection?: { x: number; z: number };
  endDirection?: { x: number; z: number };
  /** The block's place in the world */
  origin: { x: number; z: number };
};

/**
 * What {@link writeRibbonPatch} wrote: {@link DecalPatchCounts} (`stride` the factor the step grew
 * by to fit the arrays, rounded up; 0 vertices when even the longest step didn't) and the path's
 * length.
 * @internal
 */
export type DecalRibbonCounts = DecalPatchCounts & { length: number };

/** The path's per-point distances and per-segment directions, and the rows, reused */
const cumulative: number[] = [];
const dirX: number[] = [];
const dirZ: number[] = [];
const rowS: number[] = [];
const rowFrac: number[] = [];
const rowSegment: number[] = [];
const sample = createBlockSurfaceSample();

/** The tile fraction at a distance along the path */
const getFraction = (spec: DecalRibbonSpec, s: number) => {
  const t = (spec.along + s) / spec.tileLength;
  return t - Math.floor(t);
};

const pushRow = (s: number, frac: number, segment: number) => {
  rowS.push(s);
  rowFrac.push(frac);
  rowSegment.push(segment);
};

/** A station's rows: two at a tile's end inside the path (the end, then the next tile's start),
 * one elsewhere (the path's start a tile's start, its end a tile's end) */
const pushStation = (spec: DecalRibbonSpec, s: number, segment: number, length: number) => {
  const frac = getFraction(spec, s);
  const atSeam = frac < 1e-6 || frac > 1 - 1e-6;
  if (rowS.length === 0) pushRow(s, atSeam ? 0 : frac, segment);
  else if (s >= length - EPSILON) pushRow(s, atSeam ? 1 : frac, segment);
  else if (atSeam) {
    pushRow(s, 1, segment);
    pushRow(s, 0, segment);
  } else pushRow(s, frac, segment);
};

/** Fills the rows for a step: each segment's stations, the tiles' ends doubled */
const collectRows = (spec: DecalRibbonSpec, step: number, length: number, segments: number) => {
  rowS.length = 0;
  rowFrac.length = 0;
  rowSegment.length = 0;
  const { tileLength, along } = spec;
  for (let i = 0; i < segments; i++) {
    const s0 = cumulative[i];
    const span = cumulative[i + 1] - s0;
    if (span < EPSILON) continue;
    const count = Math.max(1, Math.ceil(span / step));
    for (let j = 0; j < count; j++) {
      const s = s0 + (span * j) / count;
      const next = s0 + (span * (j + 1)) / count;
      if (rowS.length === 0 || s > rowS[rowS.length - 1] + EPSILON) {
        pushStation(spec, s, i, length);
      }
      // The tiles' ends strictly between this station and the next
      let seam = (Math.floor((along + s) / tileLength) + 1) * tileLength - along;
      while (seam < next - EPSILON) {
        if (seam > s + EPSILON) pushStation(spec, seam, i, length);
        seam += tileLength;
      }
    }
  }
  let last = segments - 1;
  while (last > 0 && cumulative[last + 1] - cumulative[last] < EPSILON) last--;
  pushStation(spec, length, last, length);
};

/**
 * Writes a ribbon decal along a path on a block into `arrays`.
 * @internal
 * @param surface the block's grid (`readBlockSurface`)
 * @param spec the path, the cell and its tiling, the fades, the step and the lift
 * @param arrays the patch's arrays; their size bounds the rows (see the counts' `stride`)
 * @param out filled and returned
 * @returns `out` (no vertices for a path without length)
 */
export const writeRibbonPatch = (
  surface: BlockSurface,
  spec: DecalRibbonSpec,
  arrays: DecalPatchArrays,
  out: DecalRibbonCounts
) => {
  const { points, pointCount, width, origin, lift, cellRect } = spec;
  const { positions, normals, uvs, decalUvs, indices } = arrays;
  const maxVertices = positions.length / 3;
  out.vertexCount = 0;
  out.indexCount = 0;
  out.stride = 1;
  out.length = 0;
  if (pointCount < 2) return out;

  // The path: each point's distance along it, each segment's direction (a point repeated takes
  // its neighbour's)
  cumulative.length = 0;
  dirX.length = 0;
  dirZ.length = 0;
  cumulative.push(0);
  const segments = pointCount - 1;
  for (let i = 0; i < segments; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dz = points[i + 1].z - points[i].z;
    const span = Math.sqrt(dx * dx + dz * dz);
    cumulative.push(cumulative[i] + span);
    dirX.push(span < EPSILON ? NaN : dx / span);
    dirZ.push(span < EPSILON ? NaN : dz / span);
  }
  const length = cumulative[segments];
  if (length < EPSILON) return out;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < segments; i++) {
      const from = pass === 0 ? i - 1 : i + 1;
      if (Number.isNaN(dirX[i]) && from >= 0 && from < segments && !Number.isNaN(dirX[from])) {
        dirX[i] = dirX[from];
        dirZ[i] = dirZ[from];
      }
    }
  }

  let step = spec.step;
  let columns = 0;
  for (;;) {
    columns = Math.max(1, Math.ceil(width / step)) + 1;
    collectRows(spec, step, length, segments);
    if (rowS.length * columns <= maxVertices) break;
    if (step > length + width) return out;
    step *= STEP_GROWTH;
  }
  out.stride = Math.ceil(step / spec.step - 1e-9);

  const [u0, v0, u1, v1] = cellRect;
  const share = spec.edgeShareU;
  const fade = spec.endFadeMeters;
  let vertex = 0;
  for (let r = 0; r < rowS.length; r++) {
    const s = rowS[r];
    const segment = rowSegment[r];
    let dx = dirX[segment];
    let dz = dirZ[segment];
    // The row's direction: a given end's, a point's bisector, else its segment's
    let turn: { x: number; z: number } | undefined;
    if (s < EPSILON) turn = spec.startDirection;
    else if (s > length - EPSILON) turn = spec.endDirection;
    let tx = dx;
    let tz = dz;
    if (turn) {
      tx = turn.x;
      tz = turn.z;
    } else if (segment > 0 && Math.abs(s - cumulative[segment]) < EPSILON) {
      tx = dx + dirX[segment - 1];
      tz = dz + dirZ[segment - 1];
      const norm = Math.sqrt(tx * tx + tz * tz) || 1;
      tx /= norm;
      tz /= norm;
    }
    // Across: the normal × the direction (v grows to its left seen from above), widened at a
    // point's turn; an end's given direction keeps the width, as the ribbon joined there does
    const miter = turn ? 1 : Math.min(MAX_MITER, 1 / Math.max(1e-3, tx * dx + tz * dz));
    const cx = tz * miter;
    const cz = -tx * miter;
    const offset = s - cumulative[segment];
    dx = points[segment].x - origin.x + dirX[segment] * offset;
    dz = points[segment].z - origin.z + dirZ[segment] * offset;

    let fadeU = 0.5;
    if (share > 0 && fade > 0) {
      if (spec.fadeStart) fadeU = Math.min(fadeU, (share * s) / fade);
      if (spec.fadeEnd) fadeU = Math.min(fadeU, (share * (length - s)) / fade);
    }
    const u = u0 + rowFrac[r] * (u1 - u0);
    for (let j = 0; j < columns; j++) {
      const across = j / (columns - 1);
      const o = (across - 0.5) * width;
      const x = dx + cx * o;
      const z = dz + cz * o;
      sampleBlockSurface(surface, x, z, sample);
      positions[vertex * 3] = origin.x + x + sample.normalX * lift;
      positions[vertex * 3 + 1] = sample.height + sample.normalY * lift;
      positions[vertex * 3 + 2] = origin.z + z + sample.normalZ * lift;
      normals[vertex * 3] = sample.normalX;
      normals[vertex * 3 + 1] = sample.normalY;
      normals[vertex * 3 + 2] = sample.normalZ;
      decalUvs[vertex * 2] = fadeU;
      decalUvs[vertex * 2 + 1] = across;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v0 + across * (v1 - v0);
      vertex++;
    }
  }

  let index = 0;
  for (let r = 0; r < rowS.length - 1; r++) {
    // A tile's end and the next one's start share a place: no faces between them
    if (rowS[r + 1] - rowS[r] < EPSILON) continue;
    for (let j = 0; j < columns - 1; j++) {
      const a = r * columns + j;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      // Facing up: c is along the path, b across it to the left
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = c;
      indices[index++] = d;
    }
  }
  out.vertexCount = vertex;
  out.indexCount = index;
  out.length = length;
  return out;
};
