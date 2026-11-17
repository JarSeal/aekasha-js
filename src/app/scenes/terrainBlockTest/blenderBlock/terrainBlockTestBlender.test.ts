import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// p306 Phase 5's orientation block, the terrain add-on's export (devTools/blender/
// exportOrientationBlock.py): its UVs and splat against its positions, in the committed files. The
// engine's (glTF's) -x, -z corner is the top view's top left: the red marker, UV (0, 0), and the
// splat map's top left pixel (its texture JSON's flipY false: V 0 samples the image's top row).

const SIZE = 32;
const RES = 33;
const MARKER = 8;
const MOUND = { x: 4, z: 10 };

type Accessor = {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
};
type Gltf = {
  nodes: {
    name: string;
    mesh?: number;
    extras?: Record<string, unknown>;
    translation?: number[];
  }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: Accessor[];
  bufferViews: { byteOffset?: number }[];
};

const readGlb = (file: string) => {
  const data = readFileSync(path.resolve(__dirname, file));
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const binary = data.subarray(20 + jsonLength + 8);
  const read = (index: number) => {
    const accessor = gltf.accessors[index];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type] ?? 1;
    const start =
      (gltf.bufferViews[accessor.bufferView].byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const length = accessor.count * width;
    const bytes = binary.buffer.slice(
      binary.byteOffset + start,
      binary.byteOffset + start + length * (accessor.componentType === 5123 ? 2 : 4)
    );
    if (accessor.componentType === 5126) return new Float32Array(bytes);
    if (accessor.componentType === 5123) {
      const values = new Uint16Array(bytes);
      return Float32Array.from(values, (v) => (accessor.normalized ? v / 65535 : v));
    }
    throw new Error(`accessor ${index}: component type ${accessor.componentType}`);
  };
  return { gltf, read };
};

/** A vertex's row (along +z) and column (along +x) from its position */
const gridPoint = (positions: Float32Array, i: number) => ({
  row: Math.round(positions[i * 3 + 2] + SIZE / 2),
  col: Math.round(positions[i * 3] + SIZE / 2),
});

describe("terrainBlockTest's orientation block", () => {
  const { gltf, read } = readGlb('terrainBlockTestBlender.glb');
  const node = gltf.nodes.find((n) => n.mesh !== undefined);
  const attributes = gltf.meshes[0].primitives[0].attributes;
  const positions = read(attributes.POSITION);
  const uvs = read(attributes.TEXCOORD_0);
  const colors = read(attributes.COLOR_0);

  it('is a 32 m / 33 heightfield block at the origin', () => {
    expect(node?.name).toBe('terrainBlockTestBlender');
    expect(node?.translation).toBeUndefined();
    expect(node?.extras).toMatchObject({ colliderType: 'HEIGHTFIELD', nCols: 32, nRows: 32 });
    expect(positions.length / 3).toBe(RES * RES);
    for (let i = 0; i < RES * RES; i++) {
      const { row, col } = gridPoint(positions, i);
      // + 0: a -0 (Blender's -y of 0) is the grid point 0
      expect([positions[i * 3] + 0, positions[i * 3 + 2] + 0]).toEqual([
        col - SIZE / 2,
        row - SIZE / 2,
      ]);
    }
  });

  it('has its UVs from the -x, -z corner: U along +x, V along +z', () => {
    for (let i = 0; i < RES * RES; i++) {
      const { row, col } = gridPoint(positions, i);
      expect(uvs[i * 2]).toBeCloseTo(col / (RES - 1), 6);
      expect(uvs[i * 2 + 1]).toBeCloseTo(row / (RES - 1), 6);
    }
  });

  it('has red on the -x, -z corner, green on the +x, -z corner, the mound at +x, +z', () => {
    let peak = 0;
    for (let i = 0; i < RES * RES; i++) {
      const { row, col } = gridPoint(positions, i);
      const isTop = row < MARKER;
      const expected = [isTop && col < MARKER ? 1 : 0, isTop && col >= RES - MARKER ? 1 : 0, 0];
      expect([...colors.subarray(i * 4, i * 4 + 3)]).toEqual(expected);
      if (positions[i * 3 + 1] > positions[peak * 3 + 1]) peak = i;
    }
    expect([positions[peak * 3], positions[peak * 3 + 2]]).toEqual([MOUND.x, MOUND.z]);
  });

  it('has the baked AO in A: darker at the mound’s foot than on the flat', () => {
    const ao = (x: number, z: number) => {
      const i = (z + SIZE / 2) * RES + (x + SIZE / 2);
      return colors[i * 4 + 3];
    };
    expect(ao(-16, 16)).toBeGreaterThan(0.95);
    const { x, z } = MOUND;
    const foot = Math.min(ao(x, z - 4), ao(x - 4, z), ao(x + 4, z), ao(x, z + 4));
    expect(foot).toBeLessThan(ao(-16, 16) - 0.02);
  });

  it('has the same corners in its splat map, sampled unflipped', async () => {
    const texture = JSON.parse(
      readFileSync(path.resolve(__dirname, 'terrainBlockTestBlender_splat0.texture.json'), 'utf8')
    ) as { texOpts: { flipY: boolean } };
    expect(texture.texOpts.flipY).toBe(false);
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(
      path.resolve(__dirname, 'terrainBlockTestBlender_splat0.png')
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    // The texel at a UV with flipY false: V 0 is the image's first (top) row
    const texel = (u: number, v: number) => {
      const x = Math.min(info.width - 1, Math.floor(u * info.width));
      const y = Math.min(info.height - 1, Math.floor(v * info.height));
      const at = (y * info.width + x) * info.channels;
      return [data[at], data[at + 1], data[at + 2]];
    };
    // Each corner vertex's UV samples what its COLOR_0 says
    for (const i of [0, RES - 1, RES * (RES - 1), RES * RES - 1]) {
      const expected = [...colors.subarray(i * 4, i * 4 + 3)].map((c) => c * 255);
      expect(texel(uvs[i * 2], uvs[i * 2 + 1])).toEqual(expected);
    }
  });
});
