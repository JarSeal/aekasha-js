import { describe, expect, it } from 'vitest';
import { color, float, normalWorldGeometry, positionWorld, texture, uniform } from 'three/tsl';
import { Texture, Vector2, type Node } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import type { AntiTilingNodes } from './AntiTiling';
import { createProjectionContext, sampleProjected, type ProjectionNodes } from './Projection';
import type { TextureSetSample } from './SampleTextureSet';

type Packing = 'LITE' | 'FULL' | 'MINIMAL';
type Projected = Exclude<ProjectionNodes, { mode: 'PLANAR' }>;

const PACKING_SLOTS: Record<Packing, string[]> = {
  LITE: ['albedoRough', 'normalHeight'],
  FULL: ['albedoHeight', 'normal', 'orm'],
  MINIMAL: ['albedoHeight'],
};

const makeBundle = (packing: Packing) =>
  ({
    ...Object.fromEntries(PACKING_SLOTS[packing].map((slot) => [slot, texture(new Texture())])),
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: color(1, 1, 1),
  }) as unknown as TextureSetInput;

const ANTI_TILING: Record<AntiTilingNodes['mode'], AntiTilingNodes> = {
  NONE: { mode: 'NONE' },
  DUAL_SCALE: {
    mode: 'DUAL_SCALE',
    farScale: uniform(0.23) as unknown as Node<'float'>,
    distance: uniform(new Vector2(6, 40)) as unknown as Node<'vec2'>,
  },
  HEX: {
    mode: 'HEX',
    contrast: uniform(0.5) as unknown as Node<'float'>,
    rotation: uniform(1) as unknown as Node<'float'>,
  },
};
const TAPS = { NONE: 1, DUAL_SCALE: 2, HEX: 3 };
const PLANES = { BIPLANAR: 2, TRIPLANAR: 3 };

const projectionOf = (
  mode: Projected['mode'],
  normalBlend: Projected['normalBlend'] = 'WHITEOUT'
) => ({ mode, sharpness: uniform(4) as unknown as Node<'float'>, normalBlend }) as Projected;

type Opts = {
  packing?: Packing;
  antiTiling?: AntiTilingNodes['mode'];
  projection?: Projected;
  turn?: { cos: Node<'float'>; sin: Node<'float'> } | null;
  top?: TextureSetSample;
};

const project = (opts: Opts) => {
  const { packing = 'LITE', antiTiling = 'NONE', projection, turn = null, top } = opts;
  const bundle = makeBundle(packing);
  const strength = uniform(1) as unknown as Node<'float'>;
  const used = projection ?? projectionOf('TRIPLANAR');
  const result = sampleProjected(
    {
      bundle,
      projection: used,
      tiling: { tileSize: uniform(new Vector2(3, 3)) as unknown as Node<'vec2'>, turn },
      strength,
      antiTiling: ANTI_TILING[antiTiling],
      antiTilingContext: {
        viewDistance: float(10) as unknown as Node<'float'>,
        patches: null,
        seed: 1,
      },
    },
    createProjectionContext(),
    top
  );
  return { bundle, strength, projection: used, ...result };
};

/** The nodes the roots reach, each once (three's `traverse` walks a shared node once per path) */
const collectNodes = (roots: unknown[]) => {
  const nodes = new Set<Node>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return nodes;
};

const getRoots = ({ sample, normal }: ReturnType<typeof project>) => [
  sample.albedo,
  sample.roughness,
  sample.ao,
  sample.height,
  normal,
];

/** The texture samples a result reaches (not the bundle's slot nodes, their reference) */
const getSamples = (result: ReturnType<typeof project>) => {
  const slots = new Set(Object.values(result.bundle));
  return [...collectNodes(getRoots(result))].filter(
    (node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode && !slots.has(node as never)
  ) as unknown as { gradNode: unknown }[];
};

const countMethod = (result: ReturnType<typeof project>, method: string) =>
  [...collectNodes(getRoots(result))].filter(
    (node) => (node as unknown as { method?: string }).method === method
  ).length;

describe('sampleProjected', () => {
  it("samples each slot once per tap on each plane, every tap with the plane's gradients", () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      for (const mode of ['BIPLANAR', 'TRIPLANAR'] as const) {
        for (const antiTiling of ['NONE', 'DUAL_SCALE', 'HEX'] as const) {
          const name = `${packing} ${mode} ${antiTiling}`;
          const result = project({ packing, antiTiling, projection: projectionOf(mode) });
          const samples = getSamples(result);
          expect(samples, name).toHaveLength(
            PACKING_SLOTS[packing].length * TAPS[antiTiling] * PLANES[mode]
          );
          expect(
            samples.every((tap) => tap.gradNode),
            name
          ).toBe(true);
          // The position's two derivatives, shared by every plane and tap: none of a UV's
          expect(countMethod(result, 'dFdx') + countMethod(result, 'dFdy'), name).toBe(2);
        }
      }
    }
  });

  it('blends the planes into one sample, its normal in world space where the packing has one', () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      const result = project({ packing });
      expect(result.sample.packing).toBe(packing);
      expect(result.sample.normalTS).toBeNull();
      expect(Boolean(result.normal), packing).toBe(packing !== 'MINIMAL');
      expect(Boolean(result.sample.roughness)).toBe(packing !== 'MINIMAL');
      expect(Boolean(result.sample.ao)).toBe(packing === 'FULL');
      expect(result.sample.isAoBaked).toBe(packing !== 'FULL');
      expect(result.sample.height).toBeTruthy();
    }
  });

  it('meets the normal maps with the geometry normal by each blend, with the strength', () => {
    for (const blend of ['WHITEOUT', 'UDN', 'RNM'] as const) {
      const result = project({ projection: projectionOf('TRIPLANAR', blend) });
      const nodes = collectNodes([result.normal]);
      expect(nodes.has(normalWorldGeometry as unknown as Node), blend).toBe(true);
      expect(nodes.has(result.strength as unknown as Node), blend).toBe(true);
    }
    // Only RNM divides by the base's Z
    const divisions = (blend: Projected['normalBlend']) =>
      [...collectNodes([project({ projection: projectionOf('TRIPLANAR', blend) }).normal])].filter(
        (node) => (node as unknown as { op?: string }).op === '/'
      ).length;
    expect(divisions('RNM')).toBeGreaterThan(divisions('WHITEOUT'));
    expect(divisions('UDN')).toBe(divisions('WHITEOUT'));
  });

  it('weighs the planes by the sharpness uniform, from the world position', () => {
    for (const mode of ['BIPLANAR', 'TRIPLANAR'] as const) {
      const result = project({ projection: projectionOf(mode) });
      const nodes = collectNodes(getRoots(result));
      expect(nodes.has(result.projection.sharpness as unknown as Node), mode).toBe(true);
      expect(nodes.has(positionWorld as unknown as Node), mode).toBe(true);
    }
  });

  it("turns the planes with the tiling's turn, computing no angle of its own", () => {
    const turn = {
      cos: uniform(0.8) as unknown as Node<'float'>,
      sin: uniform(0.6) as unknown as Node<'float'>,
    };
    const turned = project({ turn });
    const nodes = collectNodes(getRoots(turned));
    expect(nodes.has(turn.cos as unknown as Node)).toBe(true);
    expect(nodes.has(turn.sin as unknown as Node)).toBe(true);
    expect(countMethod(turned, 'cos') + countMethod(turned, 'sin')).toBe(0);
    expect(collectNodes(getRoots(project({}))).has(turn.cos as unknown as Node)).toBe(false);
  });

  it("takes TRIPLANAR's top plane as given (the planar tap), BIPLANAR's never", () => {
    const top: TextureSetSample = {
      packing: 'LITE',
      albedo: uniform(new Vector2(1, 1)) as unknown as Node<'vec3'>,
      normalTS: uniform(new Vector2(0, 1)) as unknown as Node<'vec3'>,
      roughness: float(0.5) as unknown as Node<'float'>,
      ao: null,
      isAoBaked: true,
      height: float(0.5) as unknown as Node<'float'>,
    };
    const triplanar = project({ top });
    expect(getSamples(triplanar)).toHaveLength(2 * 2);
    const nodes = collectNodes(getRoots(triplanar));
    for (const value of [top.albedo, top.normalTS, top.roughness, top.height]) {
      expect(nodes.has(value as unknown as Node)).toBe(true);
    }
    expect(getSamples(project({ top, projection: projectionOf('BIPLANAR') }))).toHaveLength(2 * 2);
    expect(
      collectNodes(getRoots(project({ top, projection: projectionOf('BIPLANAR') }))).has(
        top.albedo as unknown as Node
      )
    ).toBe(false);
  });
});
