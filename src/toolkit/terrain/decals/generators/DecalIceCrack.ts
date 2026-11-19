// The `decalIceCrack` decal generator (p309 D5): cracks in ice from an impact, thin and bright,
// with a pale blue halo that reads as light scattered under the surface. Rays out from the centre
// (each ray a value noise's wander, every other one cut short) and a web of warped Worley edges
// near it.
import { abs, float, floor, fract, length, max, min, mix, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hash12 } from '../../nodes/noise/Hash';
import { domainWarp, valueNoise } from '../../nodes/noise/Noise';
import { worley } from '../../nodes/noise/Worley';
import { defineDecalGenerator } from '../DecalGenerator';
import { angleOf, centredPoint, edgeGuard, under } from './DecalShapes';

/**
 * `rays` cracks out from the centre to `reach` and a web over `cells` Worley cells around it,
 * `width` decal widths wide, bright (`line`) in a `halo` wide glow (`haloColor`).
 */
export const decalIceCrack = defineDecalGenerator({
  id: 'decalIceCrack',
  description:
    'Cracks in ice from an impact: thin bright rays and a web around the centre, in a pale blue halo.',
  physicalSize: [1.5, 1.5],
  heightScale: 0.002,
  params: {
    rays: { default: 9, min: 3, max: 24, isStatic: true, isInteger: true, label: 'Rays' },
    cells: { default: 6, min: 2, max: 16, isStatic: true, isInteger: true, label: 'Web cells' },
    width: { default: 0.004, min: 0.001, max: 0.02, step: 0.0005, label: 'Width' },
    halo: { default: 0.03, min: 0, max: 0.1, step: 0.005, label: 'Halo width' },
    reach: { default: 0.42, min: 0.15, max: 0.45, step: 0.01, label: 'Reach' },
    web: { default: 0.5, min: 0, max: 1, step: 0.05, label: 'Web reach' },
    line: { type: 'color', default: '#f2f9ff', label: 'Crack colour' },
    haloColor: { type: 'color', default: '#9cc3dc', label: 'Halo colour' },
  },
  build: (ctx, params) => {
    const point = centredPoint(ctx);
    const distance = length(point) as unknown as Node<'float'>;
    // The rays: a ray at each whole `around` value, each wandering by a noise along it of its
    // own (keyed by the sector it starts in: the wander stays under half a sector)
    const sector = floor(angleOf(point).mul(params.rays).add(0.5));
    const wander = valueNoise(vec2(distance.mul(6), sector.mul(7.3)) as unknown as Node<'vec2'>, {
      seed: ctx.seed(1),
    });
    const around = angleOf(point)
      .mul(params.rays)
      .add(wander.mul(0.25)) as unknown as Node<'float'>;
    const rayIndex = floor(around.add(0.5));
    // How far each ray reaches, its own share of `reach`
    const rayReach = params.reach.mul(
      hash12(vec2(rayIndex, float(0)) as unknown as Node<'vec2'>, {
        seed: ctx.seed(2),
        period: [params.rays, 1],
      })
        .mul(0.6)
        .add(0.4)
    );
    // The distance across to the nearest ray, in decal widths
    const fromRay = abs(fract(around.add(0.5)).sub(0.5))
      .mul(distance)
      .mul(Math.PI * 2)
      .div(params.rays) as unknown as Node<'float'>;
    const rayLength = under(distance, rayReach.sub(0.03), 0.03);
    // The web near the centre: warped Worley edges, in decal widths
    const webCells = ctx.cells(params.cells);
    const warped = domainWarp(webCells.p, {
      period: webCells.period,
      strength: 0.25,
      octaves: 2,
      seed: ctx.seed(3),
    });
    const cells = worley(warped, { period: webCells.period, seed: ctx.seed(4) });
    const fromWeb = cells.f2.sub(cells.f1).div(params.cells) as unknown as Node<'float'>;
    const webReach = under(distance, params.reach.mul(params.web), 0.04);
    // The nearest crack shown at this point: a ray past its reach or the web past its own is none
    const far = float(1);
    const across = min(
      mix(far, fromRay, rayLength),
      mix(far, fromWeb, webReach)
    ) as unknown as Node<'float'>;
    const crack = under(across, params.width.mul(0.5), params.width.mul(0.5));
    const glow = under(across, params.halo.mul(0.5), params.halo.mul(0.5).add(0.001));

    return {
      albedo: mix(params.haloColor, params.line, crack) as unknown as Node<'vec3'>,
      opacity: max(crack, glow.mul(0.45)).mul(edgeGuard(point)) as unknown as Node<'float'>,
      height: float(0.5).sub(crack.mul(0.3)) as unknown as Node<'float'>,
      roughness: mix(float(0.08), float(0.4), crack) as unknown as Node<'float'>,
    };
  },
});
