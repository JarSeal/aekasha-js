import { beforeEach, describe, expect, it, vi } from 'vitest';
import { instanceIndex, texture, uniform, uv } from 'three/tsl';
import { MeshStandardNodeMaterial, Texture, Vector2, type Node } from 'three/webgpu';
import { setup } from './leafLitter.tsl';

const stubs = vi.hoisted(() => ({ warnings: [] as string[], conditions: null as unknown }));

vi.mock('aekasha/surface', () => ({ getSurfaceConditionNodes: () => stubs.conditions }));

vi.mock('aekasha', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha')>()),
  lwarn: (message: string) => stubs.warnings.push(message),
}));

/** An atlas slot texture of two cells, a tall and a wide one, as the gatherer bakes its table */
const makeSlot = () => {
  const slot = new Texture();
  slot.image = { width: 64, height: 64 };
  slot.userData.textureAtlas = {
    id: 'leaves',
    slot: 'albedo',
    size: [64, 64],
    padding: 4,
    levels: 3,
    width: 64,
    height: 64,
    storedLevels: 3,
    cells: {
      tall: { uv: [0, 0, 0.25, 0.5], size: [16, 32] },
      wide: { uv: [0.5, 0.5, 1, 0.75], size: [32, 16] },
    },
  };
  return slot;
};

const build = (defines?: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const material = new MeshStandardNodeMaterial();
  setup({ albedo: texture(makeSlot()) as never, ...extra }, material, defines);
  return material;
};

const collectNodes = (roots: unknown[]) => {
  const nodes = new Set<Node>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return [...nodes];
};

const makeConditions = () => ({
  wetness: uniform(0.5),
  rain: uniform(0),
  puddleLevel: uniform(0),
  waterLevel: uniform(-1e9),
  snowCoverage: uniform(0),
  temperature: uniform(10),
  wind: uniform(new Vector2()),
  time: uniform(0),
});

describe('leafLitter setup', () => {
  beforeEach(() => {
    stubs.conditions = null;
    stubs.warnings.length = 0;
  });

  it("picks a cell per instance from the slot's table: the opacity and the colour read one sample", () => {
    const material = build({ wet: 'NONE' });
    expect(material.opacityNode).toBeTruthy();
    const nodes = collectNodes([material.colorNode, material.opacityNode]);
    expect(nodes).toContain(instanceIndex);
    expect(
      nodes.some(
        (node) =>
          (node as unknown as { getAttributeName?: () => string }).getAttributeName?.() ===
          uv().getAttributeName?.()
      )
    ).toBe(true);
    const arrays = nodes.filter(
      (node) => (node as unknown as { isArrayBufferNode?: boolean }).isArrayBufferNode
    ) as unknown as { array: unknown[] }[];
    // The rects, and each cell's fit into a square: the tall cell × (2, 1), the wide × (1, 2)
    const fits = arrays.find((array) => array.array[0] instanceof Vector2)!.array as Vector2[];
    expect(fits.map((fit) => fit.toArray())).toEqual([
      [2, 1],
      [1, 2],
    ]);
    expect(
      arrays.some((array) => array.array.length === 2 && !(array.array[0] instanceof Vector2))
    ).toBe(true);
  });

  it('keeps its numbers and colours as uniforms, an input in place of its default', () => {
    const autumn = uniform(0.2);
    const material = build({ wet: 'NONE' }, { autumn });
    const uniforms = material.userData.uniforms as Record<string, unknown>;
    expect(Object.keys(uniforms).sort()).toEqual([
      'leafLitter_autumn',
      'leafLitter_autumnColor',
      'leafLitter_roughness',
      'leafLitter_tint',
    ]);
    expect(uniforms.leafLitter_autumn).toBe(autumn);
  });

  it('wets the colour and the roughness by the conditions, dry without them (warned once)', () => {
    const conditions = makeConditions();
    stubs.conditions = conditions;
    const material = build();
    expect(collectNodes([material.colorNode])).toContain(conditions.wetness);
    expect(collectNodes([material.roughnessNode])).toContain(conditions.wetness);
    expect(collectNodes([build({ wet: 'NONE' }).colorNode])).not.toContain(conditions.wetness);
    stubs.conditions = null;
    build();
    build();
    expect(stubs.warnings).toHaveLength(1);
  });

  it('names a slot that is no atlas and a static define it refuses', () => {
    expect(() => setup({}, new MeshStandardNodeMaterial())).toThrow(/must be an atlas slot/);
    expect(() =>
      setup({ albedo: texture(new Texture()) as never }, new MeshStandardNodeMaterial())
    ).toThrow(/must be an atlas slot/);
    expect(() => build({ wet: 'FULL' })).toThrow(/"wet" is "FULL"/);
    expect(() => build({ quality: 'LOW' })).toThrow(/Unknown static define "quality"/);
  });
});
