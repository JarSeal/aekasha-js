import { beforeEach, describe, expect, it, vi } from 'vitest';
import { color, positionView, texture, uniform } from 'three/tsl';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
  Texture,
  Vector2,
  type Node,
} from 'three/webgpu';
import type { BakeTextureOpts } from 'aekasha';
import type { TextureSetInput } from 'aekasha/texturesets';
import { bakeTerrainColorMap } from './TerrainColorMapBake';
import { setupTerrainMaterial } from './TerrainMaterial';

const bakes = vi.hoisted(() => ({ opts: [] as BakeTextureOpts[] }));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  bakeTexture: (opts: BakeTextureOpts) => {
    bakes.opts.push(opts);
    return Promise.resolve({ id: opts.id });
  },
}));

const makeBundle = () =>
  ({
    albedoRough: texture(new Texture()),
    normalHeight: texture(new Texture()),
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: color(1, 1, 1),
    normalStrength: uniform(1),
    roughnessScale: uniform(1),
    aoStrength: uniform(1),
    heightContrast: uniform(1),
    averageColor: uniform(color(0.4, 0.3, 0.2)),
  }) as unknown as TextureSetInput;

/** The nodes the root reaches, each once */
const collectNodes = (root: unknown) => {
  const nodes = new Set<Node>();
  const stack = [root] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return [...nodes];
};

/** A block whose terrain material has a far mode, a DETAIL colour map and the vertex AO */
const makeBlock = () => {
  const material = new MeshStandardNodeMaterial();
  material.name = 'blockTerrain';
  const terrain = {
    layers: [{}, {}],
    blend: { source: 'VERTEX_COLOR' },
    ao: { vertex: true },
    colorMap: { mode: 'DETAIL' },
    distance: { fade: [30, 90], far: 'COLOR_MAP' },
    quality: { LOW: { distance: { fade: [10, 40], far: 'COLOR_MAP' } } },
  };
  const colorMap = texture(new Texture());
  setupTerrainMaterial({ layer0: makeBundle(), layer1: makeBundle(), colorMap }, material, {
    terrain,
  });
  material.userData.terrainDefine = terrain;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const mesh = new Mesh(geometry, material);
  mesh.position.set(40, 2, -8);
  return { mesh, material, colorMap };
};

beforeEach(() => {
  bakes.opts.length = 0;
});

describe('bakeTerrainColorMap', () => {
  it("bakes the material's colour in the mesh's UV space, sRGB, clamped", async () => {
    const { mesh } = makeBlock();
    await bakeTerrainColorMap({ id: 'block', mesh, size: 512 });
    const [opts] = bakes.opts;
    expect(opts).toMatchObject({ id: 'block', size: 512, wrap: 'CLAMP' });
    expect(opts.outputs).toHaveLength(1);
    expect(opts.outputs[0]).toMatchObject({ name: 'color', colorSpace: 'SRGB' });
    expect(opts.mesh?.geometry).toBe(mesh.geometry);
    // Its world placement, updated
    expect(opts.mesh?.matrixWorld?.elements[12]).toBe(40);
  });

  it('leaves out the colour map, the far surface and the camera: the near look', async () => {
    const { mesh, colorMap } = makeBlock();
    await bakeTerrainColorMap({ id: 'block', mesh });
    const nodes = collectNodes(bakes.opts[0].outputs[0].node);
    // The bake's colour has no colour map, no camera and no far branch (a struct of the share)
    expect(nodes.some((n) => (n as { value?: unknown }).value === colorMap.value)).toBe(false);
    expect(nodes).not.toContain(positionView);
    expect(nodes.some((n) => (n as { structNode?: unknown }).structNode)).toBe(false);
  });

  it("multiplies the material's AO in when asked", async () => {
    const { mesh } = makeBlock();
    await bakeTerrainColorMap({ id: 'plain', mesh });
    await bakeTerrainColorMap({ id: 'ao', mesh, ao: true });
    const isVertexColor = (node: Node) =>
      (node as unknown as { getAttributeName?: () => string }).getAttributeName?.() === 'color';
    const reachesVertexColor = (i: number) =>
      collectNodes(bakes.opts[i].outputs[0].node).some(isVertexColor);
    // The weights read the vertex colour either way; the AO is its A, multiplied in
    const countOf = (i: number) =>
      collectNodes(bakes.opts[i].outputs[0].node).filter((n) => (n as { op?: string }).op === '*')
        .length;
    expect(reachesVertexColor(0) && reachesVertexColor(1)).toBe(true);
    expect(countOf(1)).toBeGreaterThan(countOf(0));
  });

  it("refuses a material that isn't a terrain material", () => {
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardNodeMaterial());
    expect(() => bakeTerrainColorMap({ id: 'x', mesh })).toThrow(/isn't a terrain material/);
    const { material } = makeBlock();
    const multi = new Mesh(new BufferGeometry(), [material, material]);
    expect(() => bakeTerrainColorMap({ id: 'y', mesh: multi })).toThrow(/several materials/);
    expect(() => bakeTerrainColorMap({ id: 'z', mesh: multi, material })).not.toThrow();
  });
});
