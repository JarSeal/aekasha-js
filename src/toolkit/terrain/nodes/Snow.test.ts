import { describe, expect, it } from 'vitest';
import * as TSL from 'three/tsl';
import { color, texture, uniform, vec3 } from 'three/tsl';
import { StackNode, Texture, Vector2, type Node } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { sampleSnowCover, type SnowCoverInputs } from './Snow';

/** TSL's stack switch (in `three/tsl`'s build, not its typings): a test runs a `Fn`'s body */
const { setCurrentStack, getCurrentStack } = TSL as unknown as {
  setCurrentStack: (stack: unknown) => void;
  getCurrentStack: () => unknown;
};

/** Runs a TSL function's body on a stack of its own: the statements it adds */
const runOnStack = (jsFunc: () => unknown) => {
  const stack = new StackNode() as unknown as { nodes: Node[] };
  const previous = getCurrentStack();
  setCurrentStack(stack);
  try {
    jsFunc();
    return stack.nodes;
  } finally {
    setCurrentStack(previous);
  }
};

type Inspect = {
  node?: Inspect;
  structNode?: Inspect;
  shaderNode?: { jsFunc: () => unknown };
  ifNode?: { jsFunc: () => unknown };
  condNode?: Node;
  isTextureNode?: boolean;
  gradNode?: unknown;
  value?: unknown;
};

/** The nodes the roots reach, each once */
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

/** A `LITE` snow set's bundle: its two slots and its uniforms */
const makeSet = () =>
  ({
    albedoRough: texture(new Texture()),
    normalHeight: texture(new Texture()),
    averageColor: uniform(color(0.9, 0.92, 0.95)),
    physicalSize: uniform(new Vector2(3, 3)),
    heightScale: uniform(0.05),
    tint: uniform(color(1, 1, 1)),
    normalStrength: uniform(1),
    roughnessScale: uniform(1),
  }) as unknown as TextureSetInput;

const makeInputs = (far: Node<'float'> | null = null): SnowCoverInputs => ({
  set: makeSet(),
  position: vec3(1, 2, 3) as unknown as Node<'vec3'>,
  normal: vec3(0, 1, 0) as unknown as Node<'vec3'>,
  up: uniform(0.9) as unknown as Node<'float'>,
  height: uniform(0.4) as unknown as Node<'float'>,
  coverage: uniform(0.5) as unknown as Node<'float'>,
  maxSlope: uniform(1) as unknown as Node<'float'>,
  noiseScale: uniform(3) as unknown as Node<'float'>,
  edge: uniform(0.08) as unknown as Node<'float'>,
  tiling: uniform(1) as unknown as Node<'float'>,
  far,
});

/** The cover's statements: its `Fn`'s before the coverage branch, that branch's and the taps' */
const getStatements = (cover: Node<'float'>) => {
  const call = collectNodes([cover]).find(
    (node) => (node as unknown as Inspect).structNode?.node?.shaderNode
  ) as unknown as Inspect;
  const body = runOnStack(() => call.structNode?.node?.shaderNode?.jsFunc());
  const isIf = (node: Node) => Boolean((node as unknown as Inspect).ifNode);
  const outer = body.find(isIf) as unknown as Inspect;
  const branch = runOnStack(() => outer.ifNode?.jsFunc());
  const inner = branch.find(isIf) as unknown as Inspect;
  const taps = runOnStack(() => inner.ifNode?.jsFunc());
  return {
    before: body.filter((node) => !isIf(node)),
    outer,
    branch: branch.filter((node) => !isIf(node)),
    inner,
    taps,
  };
};

describe('sampleSnowCover', () => {
  it("samples the set's slots in a branch on the cover inside one on the coverage, with gradients; the branches read vars assigned before them", () => {
    const inputs = makeInputs();
    const { before, outer, branch, inner, taps } = getStatements(sampleSnowCover(inputs).cover);
    const slots = [inputs.set.albedoRough, inputs.set.normalHeight] as unknown as Inspect[];
    const isSetSample = (node: Node) => {
      const inspect = node as unknown as Inspect;
      return (
        inspect.isTextureNode &&
        slots.some((slot) => slot.value === inspect.value && slot !== inspect)
      );
    };
    const samples = collectNodes(taps).filter(isSetSample);
    expect(samples).toHaveLength(2);
    for (const sample of samples) expect((sample as unknown as Inspect).gradNode).toBeTruthy();
    expect(collectNodes(before).filter(isSetSample)).toHaveLength(0);
    expect(collectNodes(branch).filter(isSetSample)).toHaveLength(0);
    // The coverage gates the whole of it (its var, not the uniform read in the branch); the
    // mask's inputs are assigned before it
    expect(outer.condNode).toBeTruthy();
    expect(collectNodes([outer.condNode])).not.toContain(inputs.coverage);
    const assigned = collectNodes(before);
    for (const input of [inputs.coverage, inputs.up, inputs.height, inputs.normal, inputs.edge]) {
      expect(assigned).toContain(input);
    }
    expect(inner.condNode).toBeTruthy();
  });

  it('samples nothing past the far share: its taps gate on it too', () => {
    const far = uniform(0.3) as unknown as Node<'float'>;
    const { before, inner } = getStatements(sampleSnowCover(makeInputs(far)).cover);
    expect(collectNodes(before)).toContain(far);
    const plain = getStatements(sampleSnowCover(makeInputs()).cover);
    expect(collectNodes([inner.condNode]).length).toBeGreaterThan(
      collectNodes([plain.inner.condNode]).length
    );
  });
});
