import { describe, expect, it } from 'vitest';
import * as TSL from 'three/tsl';
import { color, float, texture, uniform } from 'three/tsl';
import { StackNode, Texture, Vector2, type Node } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { sampleAntiTiled } from './AntiTiling';
import { createProjectionContext, type ProjectedLayer } from './Projection';
import { sampleSlopeGated } from './SlopeGate';

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

const makeBundle = (packing: Packing) =>
  ({
    ...Object.fromEntries(PACKING_SLOTS[packing].map((slot) => [slot, texture(new Texture())])),
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: color(1, 1, 1),
  }) as unknown as TextureSetInput;

const gate = (mode: 'BIPLANAR' | 'TRIPLANAR', packing: Packing = 'LITE') => {
  const bundle = makeBundle(packing);
  const ctx = createProjectionContext();
  const slopeGate = uniform(new Vector2(30, 50)) as unknown as Node<'vec2'>;
  const layer: ProjectedLayer = {
    bundle,
    projection: {
      mode,
      sharpness: uniform(4) as unknown as Node<'float'>,
      normalBlend: 'WHITEOUT',
      slopeGate,
    },
    tiling: { tileSize: uniform(new Vector2(3, 3)) as unknown as Node<'vec2'>, turn: null },
    strength: uniform(1) as unknown as Node<'float'>,
    antiTiling: { mode: 'NONE' },
    antiTilingContext: {
      viewDistance: float(10) as unknown as Node<'float'>,
      patches: null,
      seed: 0,
    },
  };
  const planarSample = sampleAntiTiled(
    bundle,
    TSL.vec2(1, 2) as unknown as Node<'vec2'>,
    { mode: 'NONE' },
    layer.antiTilingContext
  );
  // The graph's is the tap's normal through the planar frame: here the tap's own stands in
  const planarNormal = planarSample.normalTS;
  const result = sampleSlopeGated(layer, { sample: planarSample, normal: planarNormal }, ctx);
  return { bundle, ctx, layer, slopeGate, result };
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

type Inspect = {
  structNode?: Inspect;
  node?: Inspect;
  shaderNode?: { jsFunc: () => unknown };
  ifNode?: { jsFunc: () => unknown };
  isVarNode?: boolean;
  isTextureNode?: boolean;
  gradNode?: unknown;
  method?: string;
};

/**
 * The gate's statements: its `Fn`'s (the vars before the branch) and its branch's (the `If`'s
 * body), run as three's build would
 */
const getStatements = (result: ReturnType<typeof gate>['result']) => {
  const member = result.sample.albedo as unknown as Inspect;
  const call = member.structNode?.node;
  const body = runOnStack(() => call?.shaderNode?.jsFunc());
  const cond = body.nodes.find((node) => (node as unknown as Inspect).ifNode) as unknown as Inspect;
  const branch = runOnStack(() => cond.ifNode?.jsFunc());
  return { before: body.nodes.filter((node) => node !== (cond as unknown)), branch: branch.nodes };
};

/** The nodes the roots reach, each once, not past a var (the branch reads a var, not its value) */
const collectNodes = (roots: unknown[], { throughVars }: { throughVars: boolean }) => {
  const nodes = new Set<Node>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    if (!throughVars && (node as unknown as Inspect).isVarNode) continue;
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return [...nodes];
};

const getSamples = (nodes: Node[], bundle: TextureSetInput) => {
  const slots = new Set(Object.values(bundle));
  return nodes.filter(
    (node) => (node as unknown as Inspect).isTextureNode && !slots.has(node as never)
  ) as unknown as Inspect[];
};

describe('sampleSlopeGated', () => {
  it("samples the projection's planes in the branch only, every tap with gradients", () => {
    for (const packing of ['LITE', 'FULL', 'MINIMAL'] as const) {
      for (const [mode, planes] of [
        // TRIPLANAR's top plane is the planar tap
        ['TRIPLANAR', 2],
        ['BIPLANAR', 2],
      ] as const) {
        const { bundle, result } = gate(mode, packing);
        const { before, branch } = getStatements(result);
        const name = `${packing} ${mode}`;
        const inBranch = getSamples(collectNodes(branch, { throughVars: false }), bundle);
        expect(inBranch, name).toHaveLength(PACKING_SLOTS[packing].length * planes);
        expect(
          inBranch.every((tap) => tap.gradNode),
          name
        ).toBe(true);
        // Before it: the planar tap, at its own derivatives
        const outside = getSamples(collectNodes(before, { throughVars: true }), bundle);
        expect(outside, name).toHaveLength(PACKING_SLOTS[packing].length);
        expect(outside.some((tap) => tap.gradNode)).toBe(false);
      }
    }
  });

  it('reads what the rest of the graph shares through vars declared before the branch', () => {
    const { ctx, layer, result } = gate('TRIPLANAR');
    const { before, branch } = getStatements(result);
    const reached = new Set(collectNodes(branch, { throughVars: false }));
    const shared = [ctx.position, ctx.dpdx, ctx.dpdy, ctx.normal, layer.tiling.tileSize];
    for (const node of shared) expect(reached.has(node as unknown as Node)).toBe(false);
    expect(
      [...reached].some((node) =>
        ['dFdx', 'dFdy'].includes((node as unknown as Inspect).method ?? '')
      )
    ).toBe(false);
    // Each var it reads is assigned before it (three declares an unassigned var at its first use)
    // By id: TSL hands out proxies of a node
    const assigned = new Set(
      before.map((node) => (node as unknown as { targetNode?: { id: number } }).targetNode?.id)
    );
    const read = [...reached].filter((node) => (node as unknown as Inspect).isVarNode);
    const inputs = read.filter((node) => assigned.has(node.id));
    // The share and the struct are vars of their own value; every other is assigned
    expect(read.length - inputs.length).toBe(2);
    expect(inputs.length).toBeGreaterThanOrEqual(6);
  });

  it("branches on the gate's share of the slope, and returns the layer's values as one var's", () => {
    const { result, slopeGate } = gate('TRIPLANAR');
    const { before } = getStatements(result);
    expect(collectNodes(before, { throughVars: true }).includes(slopeGate as unknown as Node)).toBe(
      true
    );
    const vars = [
      result.sample.albedo,
      result.sample.height,
      result.sample.roughness,
      result.normal,
    ].map((member) => (member as unknown as Inspect).structNode);
    expect(vars.every((node) => node?.isVarNode && node === vars[0])).toBe(true);
    const minimal = gate('TRIPLANAR', 'MINIMAL').result;
    expect(minimal.normal).toBeNull();
    expect(minimal.sample.roughness).toBeNull();
    expect(gate('TRIPLANAR', 'FULL').result.sample.ao).toBeTruthy();
  });
});
