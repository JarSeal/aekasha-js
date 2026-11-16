import { describe, expect, it } from 'vitest';
import { color, float, texture, uniform, vec2 } from 'three/tsl';
import { Texture, Vector2, type Node } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { sampleAntiTiled, type AntiTilingNodes } from './AntiTiling';
import type { TextureSetSample } from './SampleTextureSet';

type Packing = 'LITE' | 'FULL' | 'MINIMAL';

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

const MODES: Record<AntiTilingNodes['mode'], AntiTilingNodes> = {
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

const sample = (packing: Packing, mode: AntiTilingNodes['mode'], patches: Node<'float'> | null) => {
  const bundle = makeBundle(packing);
  const result = sampleAntiTiled(bundle, vec2(1, 2) as unknown as Node<'vec2'>, MODES[mode], {
    viewDistance: float(10) as unknown as Node<'float'>,
    patches,
    seed: 3,
  });
  return { bundle, result };
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

/** The texture samples a result's values reach (not the bundle's slot nodes, their reference) */
const getSamples = (bundle: TextureSetInput, result: TextureSetSample) => {
  const slots = new Set(Object.values(bundle));
  const nodes = collectNodes([
    result.albedo,
    result.normalTS,
    result.roughness,
    result.ao,
    result.height,
  ]);
  return [...nodes].filter(
    (node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode && !slots.has(node as never)
  ) as unknown as { gradNode: unknown }[];
};

describe('sampleAntiTiled', () => {
  it("samples each slot once per tap, in each packing, keeping the packing's values", () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      for (const mode of ['NONE', 'DUAL_SCALE', 'HEX'] as const) {
        const { bundle, result } = sample(packing, mode, null);
        expect(getSamples(bundle, result), `${packing} ${mode}`).toHaveLength(
          PACKING_SLOTS[packing].length * TAPS[mode]
        );
        expect(result.packing).toBe(packing);
        expect(Boolean(result.normalTS)).toBe(packing !== 'MINIMAL');
        expect(Boolean(result.roughness)).toBe(packing !== 'MINIMAL');
        expect(Boolean(result.ao)).toBe(packing === 'FULL');
        expect(result.isAoBaked).toBe(packing !== 'FULL');
      }
    }
  });

  it("gives HEX's taps the UV's gradients, the other modes' none", () => {
    for (const mode of ['NONE', 'DUAL_SCALE', 'HEX'] as const) {
      const { bundle, result } = sample('LITE', mode, null);
      for (const tap of getSamples(bundle, result)) {
        expect(Boolean(tap.gradNode), mode).toBe(mode === 'HEX');
      }
    }
  });

  it('samples every tap with the given gradients, taking no derivative', () => {
    const grad = {
      dx: vec2(0.01, 0) as unknown as Node<'vec2'>,
      dy: vec2(0, 0.01) as unknown as Node<'vec2'>,
    };
    for (const mode of ['NONE', 'DUAL_SCALE', 'HEX'] as const) {
      const bundle = makeBundle('LITE');
      const result = sampleAntiTiled(bundle, vec2(1, 2) as unknown as Node<'vec2'>, MODES[mode], {
        viewDistance: float(10) as unknown as Node<'float'>,
        patches: null,
        seed: 3,
        grad,
      });
      const taps = getSamples(bundle, result);
      expect(
        taps.every((tap) => tap.gradNode),
        mode
      ).toBe(true);
      const nodes = collectNodes([result.albedo, result.normalTS, result.height]);
      const derivatives = [...nodes].filter((node) =>
        ['dFdx', 'dFdy'].includes((node as unknown as { method?: string }).method ?? '')
      );
      expect(derivatives, mode).toHaveLength(0);
      // NONE's one tap takes them as they are
      if (mode === 'NONE') {
        expect(collectNodes(taps[0].gradNode as unknown[]).has(grad.dx as never)).toBe(true);
      }
    }
  });

  it("reads the macro patches only in DUAL_SCALE's share", () => {
    const patches = float(0.5) as unknown as Node<'float'>;
    const reaches = (mode: AntiTilingNodes['mode']) => {
      const { result } = sample('LITE', mode, patches);
      return collectNodes([result.albedo]).has(patches as unknown as Node);
    };
    expect(reaches('DUAL_SCALE')).toBe(true);
    expect(reaches('HEX')).toBe(false);
    expect(reaches('NONE')).toBe(false);
  });
});
