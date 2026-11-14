// The noise library scene's rows (p304 Phase 3): each toolkit noise function as a graph of a uv,
// built periodic (a period of `cells`, so it tiles over the uv's unit) or not (period 0), as the
// colour the tiles show and as one 0..1 scalar the checks read back.
import { smoothstep, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  domainWarp,
  fbm,
  gradientNoise,
  hash12,
  heightToCavity,
  heightToNormal,
  valueNoise,
  worley,
} from 'aekasha/toolkit/terrain';

/** What a row's graph gets: the uv (a tile per unit), its cells per unit and the period. */
export type NoiseRowInput = {
  uv: Node<'vec2'>;
  cells: number;
  /** `cells` for the periodic graph, 0 for the non-periodic one. */
  period: number;
};

/** One toolkit function, as the tiles show it and as the checks read it. */
export type NoiseRow = {
  id: string;
  /** What the row shows, for the debug tab. */
  label: string;
  /** The cells per tile the tiles show. */
  shownCells: number;
  /** The tiles' colour. */
  show: (input: NoiseRowInput) => Node<'vec3'>;
  /** The checks' scalar, 0..1. */
  scalar: (input: NoiseRowInput) => Node<'float'>;
};

/** One texel of the bakes (256²): the height helpers' step, live too, so both show the same. */
export const NOISE_TEXEL = 1 / 256;

const to01 = (n: Node<'float'>) => n.mul(0.5).add(0.5) as Node<'float'>;
const grey = (n: Node<'float'>) => vec3(n) as unknown as Node<'vec3'>;
const cellsOf = ({ uv, cells }: NoiseRowInput) => uv.mul(cells) as Node<'vec2'>;
const texel = vec2(NOISE_TEXEL, NOISE_TEXEL) as unknown as Node<'vec2'>;

const fbmHeight =
  ({ cells, period }: NoiseRowInput) =>
  (at: Node<'vec2'>) =>
    to01(fbm(at.mul(cells) as Node<'vec2'>, { period, octaves: 5, seed: 11 }));

const pebbleHeight =
  ({ cells, period }: NoiseRowInput) =>
  (at: Node<'vec2'>) =>
    worley(at.mul(cells) as Node<'vec2'>, {
      period,
      seed: 12,
      jitter: 0.8,
    }).f1.oneMinus() as Node<'float'>;

/**
 * The rows, in reading order (left to right, top to bottom).
 * @returns each toolkit noise function's row
 */
export const getNoiseRows = (): NoiseRow[] => [
  {
    id: 'valueNoise',
    label: 'valueNoise',
    shownCells: 6,
    show: (input) => grey(to01(valueNoise(cellsOf(input), { period: input.period, seed: 1 }))),
    scalar: (input) => to01(valueNoise(cellsOf(input), { period: input.period, seed: 1 })),
  },
  {
    id: 'gradientNoise',
    label: 'gradientNoise',
    shownCells: 6,
    show: (input) => grey(to01(gradientNoise(cellsOf(input), { period: input.period, seed: 2 }))),
    scalar: (input) => to01(gradientNoise(cellsOf(input), { period: input.period, seed: 2 })),
  },
  {
    id: 'fbm',
    label: 'fbm (6 octaves)',
    shownCells: 4,
    // × 2 for contrast: an fbm stays mostly within ±0.5
    show: (input) =>
      grey(
        to01(
          fbm(cellsOf(input), { period: input.period, octaves: 6, seed: 3 })
            .mul(2)
            .clamp(-1, 1) as Node<'float'>
        )
      ),
    scalar: (input) => to01(fbm(cellsOf(input), { period: input.period, octaves: 6, seed: 3 })),
  },
  {
    id: 'domainWarp',
    label: 'fbm of a domainWarp',
    shownCells: 4,
    show: (input) => {
      const warped = domainWarp(cellsOf(input), { period: input.period, strength: 0.8, seed: 9 });
      const n = fbm(warped, { period: input.period, octaves: 5, seed: 4 });
      return vec3(
        to01(n.mul(2.5).clamp(-1, 1) as Node<'float'>),
        to01(n),
        0.45
      ) as unknown as Node<'vec3'>;
    },
    scalar: (input) => {
      const warped = domainWarp(cellsOf(input), { period: input.period, strength: 0.8, seed: 9 });
      return to01(fbm(warped, { period: input.period, octaves: 5, seed: 4 }));
    },
  },
  {
    id: 'worley',
    label: 'worley: plates (cellId) and cracks (f2 − f1)',
    shownCells: 6,
    show: (input) => {
      const cells = worley(cellsOf(input), { period: input.period, seed: 5, jitter: 0.9 });
      const crack = smoothstep(0, 0.08, cells.f2.sub(cells.f1));
      const shade = cells.cellId.mul(0.6).add(0.3);
      return vec3(shade, shade.mul(0.75), cells.f1.mul(0.6)).mul(crack) as unknown as Node<'vec3'>;
    },
    // f1 runs to about 1.06 at jitter 0.9: × 0.8 keeps it under 1
    scalar: (input) =>
      worley(cellsOf(input), { period: input.period, seed: 5, jitter: 0.9 }).f1.mul(
        0.8
      ) as Node<'float'>,
  },
  {
    id: 'hash12',
    label: 'hash12 per cell',
    shownCells: 8,
    show: (input) => grey(hash12(cellsOf(input), { period: input.period, seed: 6 })),
    scalar: (input) => hash12(cellsOf(input), { period: input.period, seed: 6 }),
  },
  {
    id: 'heightToNormal',
    label: 'heightToNormal of an fbm',
    shownCells: 4,
    show: (input) =>
      heightToNormal(fbmHeight(input), { uv: input.uv, texel, heightScale: 0.4 })
        .mul(0.5)
        .add(0.5) as Node<'vec3'>,
    scalar: (input) =>
      to01(
        heightToNormal(fbmHeight(input), { uv: input.uv, texel, heightScale: 0.08 })
          .x as Node<'float'>
      ),
  },
  {
    id: 'heightToCavity',
    label: 'heightToCavity of pebbles (1 − worley f1)',
    shownCells: 6,
    // Stronger than the checks' (3), so the hollows read at the scene's distance
    show: (input) =>
      grey(
        heightToCavity(pebbleHeight(input), { uv: input.uv, radius: NOISE_TEXEL * 6, strength: 8 })
      ),
    scalar: (input) =>
      heightToCavity(pebbleHeight(input), { uv: input.uv, radius: NOISE_TEXEL * 6, strength: 3 }),
  },
];
