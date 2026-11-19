import * as THREE from 'three/webgpu';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScatterGenerator, ScatterGeneratorInput, ScatterItemDef } from 'aekasha/instancing';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  createBlockSurfaceSample,
  readBlockSurface,
  sampleBlockSurface,
} from '../blocks/BlockSurface';
import { generateTerrainScatterAsync } from './TerrainScatter';
import { registerTerrainScatter } from './RegisterTerrainScatter';

// The items' geometries: a 1 m box (bottom at −0.5) and a 2 m tall one standing on its origin
const geometries = vi.hoisted(() => new Map<string, unknown>());
vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  getGeometry: (id: string) => geometries.get(id),
}));

// The textures read back from the GPU: a 2 × 1 splat map, its left texel R 0, its right R 255
const readTexels = vi.hoisted(() =>
  vi.fn(async () => ({ data: [0, 0, 0, 0, 255, 0, 0, 0], width: 2, height: 1 }))
);
vi.mock('../textures/ReadTexels', () => ({ readTextureTexelsAsync: readTexels }));

const registered = vi.hoisted(() => new Map<string, unknown>());
vi.mock('aekasha/instancing', () => ({
  registerScatterGenerator: (id: string, generator: unknown) => registered.set(id, generator),
}));

const ITEMS: ScatterItemDef[] = [
  {
    geometry: 'box',
    material: 'stone',
    weight: 3,
    castShadow: false,
    receiveShadow: true,
    collider: 'NONE',
  },
  {
    geometry: 'tall',
    material: 'stone',
    weight: 1,
    castShadow: false,
    receiveShadow: true,
    collider: 'NONE',
  },
];

/** A world whose one entity (1) is `mesh` */
const worldOf = (mesh?: THREE.Object3D) =>
  ({
    getComponent: (id: number) => (id === 1 && mesh ? { value: mesh } : undefined),
  }) as unknown as ScatterGeneratorInput['world'];

const inputOf = (
  params: Record<string, unknown>,
  opts: { seed?: number; mesh?: THREE.Object3D; position?: THREE.Vector3Like } = {}
): ScatterGeneratorInput => ({
  scatterId: 'rocks',
  params,
  seed: opts.seed ?? 21,
  items: ITEMS,
  target: {
    position: opts.position ?? { x: 0, y: 0, z: 0 },
    grid: { x: 0, z: 0 },
    size: 16,
    ...(opts.mesh ? { entityId: 1 } : {}),
  },
  world: worldOf(opts.mesh),
});

/** Each instance's position, read from its matrix */
const positionsOf = (matrices: Float32Array) => {
  const positions: THREE.Vector3[] = [];
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < matrices.length; i += 16) {
    positions.push(new THREE.Vector3().setFromMatrixPosition(matrix.fromArray(matrices, i)));
  }
  return positions;
};

/** A 16 m block of 17 × 17 vertices: its left half (x < 0) layer 0, its right half layer 1
 * (its vertex colour's R), with a terrain material weighing them by the vertex colour */
const createPaintedBlock = (params: { heightFn?: (x: number, z: number) => number } = {}) => {
  const terrain = generateTerrain({
    width: 16,
    depth: 16,
    widthSegments: 16,
    depthSegments: 16,
    heightFn: params.heightFn ?? (() => 0),
    vertexColors: { layout: 'RGBA', rules: [] },
  });
  const colors = terrain.geometry.getAttribute('color');
  const positions = terrain.geometry.getAttribute('position');
  for (let i = 0; i < colors.count; i++) colors.setX(i, positions.getX(i) > 0 ? 1 : 0);
  const material = new THREE.MeshStandardNodeMaterial();
  material.userData.terrainDefine = {
    layers: [{}, {}],
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
  };
  return { terrain, mesh: new THREE.Mesh(terrain.geometry, material) };
};

beforeEach(() => {
  geometries.set('box', new THREE.BoxGeometry(1, 1, 1));
  geometries.set('tall', new THREE.BoxGeometry(1, 2, 1).translate(0, 1, 0));
  readTexels.mockClear();
});

describe('terrainScatter', () => {
  it('places Poisson-disk instances over the target, the boxes on the surface, items by weight', async () => {
    const result = await generateTerrainScatterAsync(
      inputOf({ minSpacing: 0.5 }, { position: { x: 100, y: 3, z: -50 } })
    );
    const count = result.items!.length;
    // About 0.65 points per spacing² over (16 − 0.5)²
    expect(count).toBeGreaterThan(550);
    expect(count).toBeLessThan(750);
    expect(result.matrices.length).toBe(count * 16);
    expect(result.colors).toBeUndefined();
    const positions = positionsOf(result.matrices);
    let boxes = 0;
    positions.forEach((position, i) => {
      // Inset by half the spacing
      expect(Math.abs(position.x - 100)).toBeLessThanOrEqual(7.75 + 1e-4);
      expect(Math.abs(position.z + 50)).toBeLessThanOrEqual(7.75 + 1e-4);
      // The box is lifted by its half height, the tall one stands on its origin
      expect(position.y).toBeCloseTo(result.items![i] === 0 ? 3.5 : 3, 5);
      if (result.items![i] === 0) boxes++;
    });
    expect(boxes / count).toBeGreaterThan(0.68);
    expect(boxes / count).toBeLessThan(0.82);
  });

  it('gives the same instances for the same seed, others for another', async () => {
    const params = { minSpacing: 0.8, density: 0.5, scale: [0.5, 2], tint: 0.2 };
    const first = await generateTerrainScatterAsync(inputOf(params));
    const again = await generateTerrainScatterAsync(inputOf(params));
    expect(again).toEqual(first);
    const other = await generateTerrainScatterAsync(inputOf(params, { seed: 22 }));
    expect(other.matrices).not.toEqual(first.matrices);
  });

  it('keeps the share of candidates `density` gives, scaled, tinted and sunk', async () => {
    const all = await generateTerrainScatterAsync(inputOf({ minSpacing: 0.5 }));
    const half = await generateTerrainScatterAsync(
      inputOf({ minSpacing: 0.5, density: 0.5, scale: 2, tint: 0.3, sink: 0.5 })
    );
    const ratio = half.items!.length / all.items!.length;
    expect(ratio).toBeGreaterThan(0.44);
    expect(ratio).toBeLessThan(0.56);
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    positionsOf(half.matrices).forEach((position, i) => {
      matrix
        .fromArray(half.matrices, i * 16)
        .decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
      expect(scale.x).toBeCloseTo(2, 5);
      // Its bottom on the surface, then half its height under it: the box's centre at 0, the
      // tall one's origin 2 m down
      expect(position.y).toBeCloseTo(half.items![i] === 0 ? 0 : -2, 5);
      const tint = half.colors![i * 3];
      expect(tint).toBeGreaterThanOrEqual(0.7);
      expect(tint).toBeLessThanOrEqual(1);
      expect(half.colors![i * 3 + 1]).toBe(tint);
    });
  });

  it("follows the block's painted layers", async () => {
    const { mesh } = createPaintedBlock();
    const result = await generateTerrainScatterAsync(
      inputOf({ minSpacing: 0.5, mask: { layers: { '1': 1 } } }, { mesh })
    );
    const positions = positionsOf(result.matrices);
    // Layer 1 is the right half; the colour fades over the cell at x = 0
    expect(positions.length).toBeGreaterThan(200);
    for (const position of positions) expect(position.x).toBeGreaterThan(-1);
    const inverse = await generateTerrainScatterAsync(
      inputOf({ minSpacing: 0.5, mask: { layers: { '0': 1 } } }, { mesh })
    );
    for (const position of positionsOf(inverse.matrices)) expect(position.x).toBeLessThan(1);
  });

  it("thins by slope and height, sits on the block's mesh and tilts toward its normal", async () => {
    // A slope rising along +x: 45° on the right half, flat on the left
    const { terrain, mesh } = createPaintedBlock({ heightFn: (x) => Math.max(0, x) });
    const surface = readBlockSurface(terrain.geometry, 16, 'test');
    const sample = createBlockSurfaceSample();
    const flat = await generateTerrainScatterAsync(
      inputOf({ minSpacing: 0.5, mask: { slope: { max: 20, softness: 1 } } }, { mesh })
    );
    for (const position of positionsOf(flat.matrices)) expect(position.x).toBeLessThan(0.5);
    const high = await generateTerrainScatterAsync(
      inputOf(
        { minSpacing: 0.5, alignToNormal: 1, mask: { height: { min: 4, softness: 0.1 } } },
        { mesh }
      )
    );
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3();
    expect(high.items!.length).toBeGreaterThan(50);
    positionsOf(high.matrices).forEach((position, i) => {
      matrix.fromArray(high.matrices, i * 16).decompose(new THREE.Vector3(), quaternion, up);
      up.set(0, 1, 0).applyQuaternion(quaternion);
      // Along the 45° slope's normal
      expect(up.x).toBeCloseTo(-Math.SQRT1_2, 3);
      expect(up.y).toBeCloseTo(Math.SQRT1_2, 3);
      // Its bottom on the mesh: the origin lifted along the normal by the item's bottom
      const lift = high.items![i] === 0 ? 0.5 : 0;
      // The surface point under it is in the height range (4 m and up, softened by 0.1)
      expect(position.x - up.x * lift).toBeGreaterThan(3.9 - 1e-4);
      sampleBlockSurface(surface, position.x - up.x * lift, position.z - up.z * lift, sample);
      expect(position.y - up.y * lift).toBeCloseTo(sample.height, 3);
    });
  });

  it('clusters by its noise, continuing across blocks', async () => {
    const params = { minSpacing: 0.5, mask: { noise: { scale: 4, amount: 1 } } };
    const clustered = await generateTerrainScatterAsync(inputOf(params));
    const all = await generateTerrainScatterAsync(inputOf({ minSpacing: 0.5 }));
    expect(clustered.items!.length).toBeLessThan(all.items!.length * 0.75);
    // The noise is the world's: another block's seed doesn't change its value at a point, so a
    // block with the noise at full keeps a share in each region that matches the other's
    const other = await generateTerrainScatterAsync(inputOf(params, { seed: 99 }));
    const share = (matrices: Float32Array, isIn: (p: THREE.Vector3) => boolean) => {
      const positions = positionsOf(matrices);
      return positions.filter(isIn).length / positions.length;
    };
    const left = (p: THREE.Vector3) => p.x < 0;
    expect(Math.abs(share(clustered.matrices, left) - share(other.matrices, left))).toBeLessThan(
      0.1
    );
  });

  it("reads a splat material's maps back, once each", async () => {
    const { mesh } = createPaintedBlock();
    (mesh.material as THREE.Material).userData.terrainDefine = {
      layers: [{}, {}],
      blend: { source: 'SPLAT_MAP' },
    };
    const result = await generateTerrainScatterAsync(
      inputOf(
        { minSpacing: 0.5, mask: { layers: { '1': 1 } }, splatMaps: ['blockSplat'] },
        { mesh }
      )
    );
    expect(readTexels).toHaveBeenCalledTimes(1);
    expect(readTexels).toHaveBeenCalledWith('blockSplat');
    // The map's right texel is layer 1: past its centre (x 4) all of it
    const positions = positionsOf(result.matrices);
    expect(positions.length).toBeGreaterThan(100);
    for (const position of positions) expect(position.x).toBeGreaterThan(-4);
  });

  it('refuses params, targets and surfaces it can’t scatter on, naming the scatter', async () => {
    const fails = (params: Record<string, unknown>, mesh?: THREE.Object3D) =>
      expect(generateTerrainScatterAsync(inputOf(params, { mesh }))).rejects.toThrow(
        /^terrainScatter: the scatter "rocks"/
      );
    await fails({ count: 3 });
    await fails({ density: 2 });
    await fails({ mask: { layers: { a: 1 } } });
    await fails({ mask: { slope: { min: 30, max: 10 } } });
    await fails({ mask: { noise: { amount: 0.5 } } });
    await fails({ scale: [2, 1] });
    await fails({ minSpacing: 0.001 });
    await fails({ minSpacing: 20 });
    await expect(generateTerrainScatterAsync(inputOf({ density: 2 }))).rejects.toThrow(
      'params.density is 2, not within 0..1.'
    );
    // A layer past the material's, a splat material without its maps, a sphere for a block
    const { mesh } = createPaintedBlock();
    await expect(
      generateTerrainScatterAsync(inputOf({ mask: { layers: { '2': 1 } } }, { mesh }))
    ).rejects.toThrow(/names the layer 2, but the surface's material has 2 layers/);
    (mesh.material as THREE.Material).userData.terrainDefine = {
      layers: [{}, {}],
      blend: { source: 'SPLAT_MAP' },
    };
    await expect(
      generateTerrainScatterAsync(inputOf({ mask: { layers: { '1': 1 } } }, { mesh }))
    ).rejects.toThrow(/splat map: give their texture ids in params.splatMaps/);
    await fails({}, new THREE.Mesh(new THREE.SphereGeometry(4)));
    await fails({}, new THREE.Group());
    await expect(
      generateTerrainScatterAsync({
        ...inputOf({}),
        target: { position: { x: 0, y: 0, z: 0 }, grid: { x: 0, z: 0 } },
      })
    ).rejects.toThrow(/its target has no size/);
  });
});

describe('registerTerrainScatter', () => {
  it('registers terrainScatter, its code loaded with its first use', async () => {
    registerTerrainScatter();
    const generator = registered.get('terrainScatter') as ScatterGenerator;
    const result = await generator(inputOf({ minSpacing: 2 }));
    expect(result).toEqual(await generateTerrainScatterAsync(inputOf({ minSpacing: 2 })));
  });
});
