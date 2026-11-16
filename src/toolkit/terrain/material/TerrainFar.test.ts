import { describe, expect, it, vi } from 'vitest';
import * as TSL from 'three/tsl';
import { color, int, texture, uniform, uniformArray } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  StackNode,
  Texture,
  Vector2,
  Vector4,
  type Node,
} from 'three/webgpu';
import type { TextureSetArrayInput, TextureSetInput } from 'aekasha/texturesets';
import { defineSurfaceGenerator } from '../procedural/SurfaceGenerator';
import { setupTerrainMaterial } from './TerrainMaterial';

// A live layer's bundle's set and its generator (p305 Phase 8)
const live = vi.hoisted(() => ({ sets: new Map<object, unknown>(), generator: null as unknown }));
vi.mock('aekasha/texturesets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('aekasha/texturesets')>()),
  getTextureSetOfInput: (bundle: object) => live.sets.get(bundle),
  getTextureSetGenerator: () => live.generator,
}));
live.generator = defineSurfaceGenerator({
  id: 'testFarRipples',
  category: 'SAND',
  physicalSize: [2, 2],
  heightScale: 0.04,
  params: {},
  build: (ctx) => ({
    albedo: color(0.8, 0.7, 0.5) as unknown as Node<'vec3'>,
    height: ctx.uv.x.fract() as unknown as Node<'float'>,
    roughness: uniform(0.9) as unknown as Node<'float'>,
  }),
});

type Packing = 'LITE' | 'FULL' | 'MINIMAL';

const PACKING_SLOTS: Record<Packing, string[]> = {
  LITE: ['albedoRough', 'normalHeight'],
  FULL: ['albedoHeight', 'normal', 'orm'],
  MINIMAL: ['albedoHeight'],
};

/** TSL's stack switch (in `three/tsl`'s build, not its typings): a test runs a `Fn`'s body */
const { setCurrentStack, getCurrentStack } = TSL as unknown as {
  setCurrentStack: (stack: unknown) => void;
  getCurrentStack: () => unknown;
};

/** A `{ textureSet }` bundle of the packing's slots and the set's uniforms, its average colour */
const makeBundle = (packing: Packing) =>
  ({
    ...Object.fromEntries(PACKING_SLOTS[packing].map((slot) => [slot, texture(new Texture())])),
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: color(1, 1, 1),
    normalStrength: uniform(1),
    roughnessScale: uniform(1),
    aoStrength: uniform(1),
    heightContrast: uniform(1),
    averageColor: uniform(color(0.4, 0.3, 0.2)),
  }) as unknown as TextureSetInput;

const makeArrayBundle = (count: number) =>
  ({
    ...Object.fromEntries(PACKING_SLOTS.LITE.map((slot) => [slot, texture(new Texture())])),
    layerParams: uniformArray(
      Array.from({ length: count * 4 }, () => new Vector4(3, 3, 0.05, 1)),
      'vec4'
    ),
    layerCount: int(count),
  }) as unknown as TextureSetArrayInput;

const layersOf = (count: number) => Array.from({ length: count }, () => ({}));

/** A `{ textureSet }` bundle of a procedural set of the live generator */
const makeLiveBundle = (packing: Packing) => {
  const bundle = makeBundle(packing);
  live.sets.set(bundle, {
    id: 'farRipples',
    physicalSize: [3, 3],
    heightScale: 0.05,
    procedural: { generator: 'testFarRipples', params: {}, seed: 0, size: 256, packing },
  });
  return bundle;
};

const FAR = { fade: [30, 90], far: 'AVERAGE_COLOR' };

type Inspect = {
  structNode?: Inspect;
  node?: Inspect;
  shaderNode?: { jsFunc: () => unknown };
  ifNode?: { jsFunc: () => unknown };
  isVarNode?: boolean;
  isTextureNode?: boolean;
  gradNode?: unknown;
  method?: string;
  value?: unknown;
  id: number;
};

/** The nodes the roots reach, each once; past a var only when `through` says so */
const collectNodes = (roots: unknown[], through: (node: Inspect) => boolean = () => true) => {
  const nodes = new Set<Node>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    const inspect = node as unknown as Inspect;
    if (inspect.isVarNode && !through(inspect)) continue;
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return [...nodes] as unknown as Inspect[];
};

/** Runs a TSL function's body on a stack of its own: the statements it adds, and its return */
const runOnStack = (jsFunc: () => unknown) => {
  const stack = new StackNode() as unknown as { nodes: Node[] };
  const previous = getCurrentStack();
  setCurrentStack(stack);
  try {
    return { nodes: stack.nodes, output: jsFunc() };
  } finally {
    setCurrentStack(previous);
  }
};

/** A stack lists every node made in it; an assignable one is built only when something reads it */
const getBuilt = (nodes: Node[]) =>
  nodes.filter((node) => !(node as unknown as { assignable?: boolean }).assignable);

/**
 * The nodes with those a nested `Fn` call among them builds (its body and its `If`'s, run as
 * three's build would): a slope gate's in the far branch
 */
const expandCalls = (nodes: Inspect[]): Inspect[] => {
  const all = new Set(nodes);
  const opened = new Set<Inspect>();
  // The terrain's own `Fn`s take no builder (three's accessors do, and need one)
  const isOwnCall = (node: Inspect) => node.shaderNode?.jsFunc.length === 0;
  let calls = nodes.filter(isOwnCall);
  while (calls.length) {
    const found: Inspect[] = [];
    for (const call of calls) {
      if (opened.has(call)) continue;
      opened.add(call);
      const body = runOnStack(() => call.shaderNode?.jsFunc()).nodes;
      const conds = body.filter((node) => (node as unknown as Inspect).ifNode);
      const statements = [
        ...getBuilt(body),
        ...conds.flatMap((cond) =>
          getBuilt(runOnStack(() => (cond as unknown as Inspect).ifNode?.jsFunc()).nodes)
        ),
      ];
      for (const node of collectNodes(statements)) {
        if (!all.has(node)) found.push(node);
        all.add(node);
      }
    }
    calls = found.filter(isOwnCall);
  }
  return [...all];
};

const build = (terrain: object, inputs: Record<string, unknown>) => {
  const material = new MeshStandardNodeMaterial();
  setupTerrainMaterial(inputs, material, { terrain });
  return material;
};

/**
 * The far branch's statements: its `Fn`'s before the `If` (the declared inputs, the far surface)
 * and the `If`'s body, run as three's build would; and the vars outside the branch (reached from
 * the statements before it), which the branch reads without building
 */
const getBranch = (material: MeshStandardNodeMaterial) => {
  const member = collectNodes([material.colorNode]).find(
    (node) => node.structNode?.node?.shaderNode
  );
  const call = member?.structNode?.node;
  if (!call?.shaderNode) throw new Error('No far branch in the colour.');
  const body = runOnStack(() => call.shaderNode?.jsFunc());
  const cond = body.nodes.find((node) => (node as unknown as Inspect).ifNode) as unknown as Inspect;
  const before = getBuilt(body.nodes.filter((node) => node !== (cond as unknown)));
  const branch = getBuilt(runOnStack(() => cond.ifNode?.jsFunc()).nodes);
  const outside = new Set(
    collectNodes(before)
      .filter((node) => node.isVarNode)
      .map((n) => n.id)
  );
  outside.add((member?.structNode as Inspect).id);
  // A var made in the branch is built there: walk through it, not through one made before
  const inBranch = expandCalls(collectNodes(branch, (node) => !outside.has(node.id)));
  return { before, branch, inBranch, members: member?.structNode };
};

/** The texture samples among the nodes: texture nodes that aren't the inputs' own */
const getSamples = (nodes: Inspect[], inputs: Record<string, unknown>) => {
  const references = new Set<unknown>();
  for (const input of Object.values(inputs)) {
    if ((input as Inspect).isTextureNode) references.add(input);
    else for (const value of Object.values(input as object)) references.add(value);
  }
  return nodes.filter((node) => node.isTextureNode && !references.has(node));
};

/** The layer slots' textures of the inputs, by their `value` */
const getLayerTextures = (inputs: Record<string, unknown>) =>
  new Set(
    Object.entries(inputs)
      .filter(([key]) => key.startsWith('layer'))
      .flatMap(([, bundle]) =>
        Object.values(bundle as object)
          .filter((value) => (value as Inspect).isTextureNode)
          .map((value) => (value as Inspect).value)
      )
  );

/** Defines over the far surface the branch must keep uniform, and their inputs */
const CASES: [string, object, () => Record<string, unknown>][] = [
  [
    'DUAL_SCALE vertex colour, macro',
    {
      layers: layersOf(2),
      blend: { source: 'VERTEX_COLOR' },
      antiTiling: { mode: 'DUAL_SCALE' },
      macro: { scale: 64 },
      distance: FAR,
    },
    () => ({
      layer0: makeBundle('LITE'),
      layer1: makeBundle('LITE'),
      macro: texture(new Texture()),
    }),
  ],
  [
    'HEX splat map',
    {
      layers: layersOf(2),
      blend: { source: 'SPLAT_MAP' },
      antiTiling: { mode: 'HEX' },
      distance: FAR,
    },
    () => ({
      layer0: makeBundle('LITE'),
      layer1: makeBundle('LITE'),
      splat0: texture(new Texture()),
    }),
  ],
  [
    'MESH_UV FULL',
    { layers: [{ rotation: 20 }], uv: 'MESH_UV', distance: FAR },
    () => ({ layer0: makeBundle('FULL') }),
  ],
  [
    'MINIMAL rules',
    {
      layers: layersOf(2),
      blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 30 } }] },
      distance: FAR,
    },
    () => ({ layer0: makeBundle('MINIMAL'), layer1: makeBundle('MINIMAL') }),
  ],
  [
    'gated TRIPLANAR',
    {
      layers: [{ projection: { mode: 'TRIPLANAR', slopeGate: [30, 50] } }],
      distance: FAR,
    },
    () => ({ layer0: makeBundle('LITE') }),
  ],
  [
    'sparse slots, HEX DOMINANT',
    {
      layers: layersOf(4),
      blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
      sparse: { maxLayers: 2 },
      antiTiling: { mode: 'HEX', apply: 'DOMINANT' },
      distance: FAR,
    },
    () => ({ layers: makeArrayBundle(4) }),
  ],
  [
    'a live layer, gated TRIPLANAR',
    {
      layers: [
        {},
        { source: 'PROCEDURAL_LIVE', projection: { mode: 'TRIPLANAR', slopeGate: [30, 50] } },
      ],
      blend: { source: 'VERTEX_COLOR' },
      distance: FAR,
    },
    () => ({ layer0: makeBundle('LITE'), layer1: makeLiveBundle('LITE') }),
  ],
  [
    'COLOR_MAP far, DETAIL',
    {
      layers: [{}],
      colorMap: { mode: 'DETAIL' },
      distance: { fade: [30, 90], far: 'COLOR_MAP', farBlend: 0 },
    },
    () => ({ layer0: makeBundle('LITE'), colorMap: texture(new Texture()) }),
  ],
];

describe('the far branch', () => {
  it("bumps a live layer by two taps at the coordinates' gradients inside the branch", () => {
    const isHeightTap = (node: Inspect) =>
      Boolean(
        (node.shaderNode as { layout?: { name?: string } } | undefined)?.layout?.name?.startsWith(
          'aekSurfaceHeight_'
        )
      );
    const inputs = { layer0: makeBundle('LITE'), layer1: makeLiveBundle('LITE') };
    const terrain = {
      layers: [{}, { source: 'PROCEDURAL_LIVE' }],
      blend: { source: 'VERTEX_COLOR' },
      distance: FAR,
    };
    const { before, inBranch } = getBranch(build(terrain, inputs));
    expect(inBranch.filter(isHeightTap)).toHaveLength(2);
    expect(collectNodes(before).filter(isHeightTap)).toHaveLength(0);
    // The same layer outside a branch bumps its height: no taps
    const near = build({ ...terrain, distance: { fade: [30, 90] } }, inputs);
    expect(collectNodes([near.normalNode]).filter(isHeightTap)).toHaveLength(0);
  });

  it('takes no derivative and samples only with gradients inside the branch', () => {
    for (const [name, terrain, makeInputs] of CASES) {
      const inputs = makeInputs();
      const { inBranch } = getBranch(build(terrain, inputs));
      expect(
        inBranch.filter((node) => ['dFdx', 'dFdy'].includes(node.method ?? '')),
        name
      ).toHaveLength(0);
      const samples = getSamples(inBranch, inputs);
      expect(samples.length, name).toBeGreaterThan(0);
      expect(
        samples.every((sample) => sample.gradNode),
        name
      ).toBe(true);
    }
  });

  it('samples no layer before the branch: the far surface reads the weights alone', () => {
    for (const [name, terrain, makeInputs] of CASES) {
      const inputs = makeInputs();
      const layerTextures = getLayerTextures(inputs);
      const { before, inBranch } = getBranch(build(terrain, inputs));
      const sampledBefore = getSamples(collectNodes(before), inputs).filter((sample) =>
        layerTextures.has(sample.value)
      );
      expect(sampledBefore, name).toHaveLength(0);
      const sampledIn = getSamples(inBranch, inputs).filter((s) => layerTextures.has(s.value));
      expect(sampledIn.length, name).toBeGreaterThan(0);
    }
  });

  it("reads the far colour from the sets' average colours, or the colour map", () => {
    const inputs = { layer0: makeBundle('LITE'), layer1: makeBundle('LITE') };
    const terrain = { layers: layersOf(2), blend: { source: 'VERTEX_COLOR' }, distance: FAR };
    const before = collectNodes(getBranch(build(terrain, inputs)).before);
    for (const bundle of [inputs.layer0, inputs.layer1]) {
      expect(before).toContain(bundle.averageColor as unknown as Inspect);
    }
    const map = texture(new Texture());
    const colorMapped = build(
      {
        layers: [{}],
        colorMap: { mode: 'FAR_ONLY' },
        distance: { fade: [30, 90], far: 'COLOR_MAP' },
      },
      { layer0: makeBundle('LITE'), colorMap: map }
    );
    const mapSamples = getSamples(collectNodes(getBranch(colorMapped).before), { map }).filter(
      (sample) => sample.value === map.value
    );
    expect(mapSamples).toHaveLength(1);
  });

  it("varies the layers' and the average colours' albedo by the macro, not the colour map's", () => {
    const macroOf = (far: string, colorMap?: object) => {
      const inputs: Record<string, unknown> = {
        layer0: makeBundle('LITE'),
        macro: texture(new Texture()),
        ...(colorMap ? { colorMap: texture(new Texture()) } : {}),
      };
      const material = build(
        {
          layers: [{}],
          macro: { scale: 64 },
          ...(colorMap ? { colorMap } : {}),
          distance: { fade: [30, 90], far },
        },
        inputs
      );
      const brightness = (material.userData.uniforms as Record<string, Inspect>)
        .terrain_macroBrightness;
      const { before, inBranch } = getBranch(material);
      return {
        far: collectNodes(before).includes(brightness),
        near: inBranch.includes(brightness),
      };
    };
    expect(macroOf('AVERAGE_COLOR')).toEqual({ far: true, near: true });
    expect(macroOf('COLOR_MAP', { mode: 'FAR_ONLY' })).toEqual({ far: false, near: true });
    expect(macroOf('COLOR_MAP', { mode: 'DETAIL' })).toEqual({ far: false, near: false });
  });

  it("returns the packing's members to the sockets, a MINIMAL bump after the branch", () => {
    const membersOf = (packing: Packing) => {
      const material = build({ layers: [{}], distance: FAR }, { layer0: makeBundle(packing) });
      const sockets = [material.colorNode, material.roughnessNode, material.normalNode];
      const members = collectNodes([...sockets, material.aoNode]).filter(
        (node) => node.structNode?.node?.shaderNode
      ) as unknown as { property: string }[];
      return { material, names: [...new Set(members.map((member) => member.property))].sort() };
    };
    expect(membersOf('LITE').names).toEqual(['albedo', 'normal', 'roughness']);
    expect(membersOf('FULL').names).toEqual(['albedo', 'ao', 'normal', 'roughness']);
    const minimal = membersOf('MINIMAL');
    expect(minimal.names).toEqual(['albedo', 'bumpHeight', 'roughness']);
    // The bump of the branch's height, outside the branch
    const normalNodes = collectNodes([minimal.material.normalNode], (node) => !node.structNode);
    expect(normalNodes.filter((node) => node.method === 'dFdx')).toHaveLength(2);
  });

  it('makes its uniforms at setup, and none with a debug view', () => {
    const terrain = {
      layers: layersOf(2),
      blend: { source: 'VERTEX_COLOR' },
      distance: { ...FAR, farBlend: 6 },
    };
    const inputs = { layer0: makeBundle('LITE'), layer1: makeBundle('LITE') };
    const material = build(terrain, inputs);
    const uniforms = material.userData.uniforms as Record<string, { value: unknown }>;
    expect(uniforms.terrain_farBlend.value).toBe(6);
    expect(uniforms.terrain_distanceFade.value).toEqual(new Vector2(30, 90));
    // Built in the branch, made before it
    expect(uniforms.terrain_heightBlendDepth.value).toBe(0.2);
    expect(uniforms.terrain_l1_heightContrast).toBeTruthy();
  });
});
