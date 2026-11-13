// The `iceSheet` surface generator (p304 D3, ICE): a sheet of ice, deep and pale patches (a broad
// fbm), cracks at two scales (Worley edges: the large ones bold, the fine ones faint and only in
// places), small white bubble specks, and a low roughness the cracks raise.
import { float, mix, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { domainWarp, fbm } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineSurfaceGenerator } from '../SurfaceGenerator';
import { below, toUnit } from '../SurfaceNodes';

/** The bubble cells per metre (about 2.5 cm apart). */
const BUBBLES_PER_METRE = 40;

/**
 * Sheet ice: cracks at `crackSize` and `fineCrackSize` metres, `bubbles` specks, between the
 * `deep` and `tint` colours, crack lines in `crackColour`.
 */
export const generator = defineSurfaceGenerator({
  id: 'iceSheet',
  category: 'ICE',
  description:
    'Sheet ice: deep and pale patches, bold and fine cracks, small bubble specks, a low roughness.',
  physicalSize: [4, 4],
  heightScale: 0.008,
  params: {
    crackSize: { default: 0.8, min: 0.2, max: 3, step: 0.05, label: 'Crack size (m)' },
    fineCrackSize: { default: 0.18, min: 0.05, max: 0.8, step: 0.01, label: 'Fine cracks (m)' },
    bubbles: { default: 0.4, min: 0, max: 1, step: 0.05, label: 'Bubbles' },
    tint: { type: 'color', default: '#a7c4d4', label: 'Pale colour' },
    deep: { type: 'color', default: '#58798f', label: 'Deep colour' },
    crackColour: { type: 'color', default: '#e4eef4', label: 'Crack colour' },
  },
  build: (ctx, params) => {
    const large = ctx.cells(ctx.tileSize.x.div(params.crackSize) as Node<'float'>);
    const largeCells = worley(
      domainWarp(large.p, { period: large.period, strength: 0.25, seed: ctx.seed(1) }),
      { period: large.period, seed: ctx.seed(2) }
    );
    const boldCrack = below(largeCells.f2.sub(largeCells.f1), 0.025, 0.015);

    const small = ctx.cells(ctx.tileSize.x.div(params.fineCrackSize) as Node<'float'>);
    const smallCells = worley(small.p, { period: small.period, seed: ctx.seed(3) });
    const broad = ctx.cells(2);
    const patches = toUnit(fbm(broad.p, { period: broad.period, octaves: 4, seed: ctx.seed(4) }));
    const fineCrack = below(smallCells.f2.sub(smallCells.f1), 0.015, 0.01).mul(
      smoothstep(0.45, 0.65, patches).mul(0.5)
    );
    const crack = boldCrack.max(fineCrack);

    const bubbleCells = ctx.cells(ctx.tileSize.x.mul(BUBBLES_PER_METRE) as Node<'float'>);
    const bubble = worley(bubbleCells.p, { period: bubbleCells.period, seed: ctx.seed(5) });
    const speck = below(bubble.f1, 0.1, 0.03).mul(
      below(bubble.cellId, params.bubbles.mul(0.5), 0.001)
    );

    const ice = mix(params.deep, params.tint, smoothstep(0.2, 0.8, patches));
    const albedo = mix(ice, params.crackColour, crack.mul(0.8).max(speck.mul(0.7)));
    const height = float(0.6)
      .sub(crack.mul(0.35))
      .add(patches.mul(0.05)) as unknown as Node<'float'>;
    return {
      albedo: albedo as unknown as Node<'vec3'>,
      height,
      roughness: float(0.06).add(crack.mul(0.35)).add(speck.mul(0.1)) as unknown as Node<'float'>,
    };
  },
});
