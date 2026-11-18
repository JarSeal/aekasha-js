import { describe, expect, it } from 'vitest';
import * as TSL from 'three/tsl';
import { texture, uniform, vec3 } from 'three/tsl';
import { StackNode, Texture, type Node, type TextureNode } from 'three/webgpu';
import { sampleRainRipples, type RainRippleInputs } from './Ripples';

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

const makeInputs = (): RainRippleInputs => ({
  atlas: texture(new Texture()) as unknown as TextureNode,
  position: vec3(1, 0, 2) as unknown as Node<'vec3'>,
  scale: uniform(1.5) as unknown as Node<'float'>,
  lifetime: uniform(0.7) as unknown as Node<'float'>,
  strength: uniform(0.5) as unknown as Node<'float'>,
  rain: uniform(0.8) as unknown as Node<'float'>,
  time: uniform(3) as unknown as Node<'float'>,
  weight: uniform(1) as unknown as Node<'float'>,
});

/** The ripples' statements: its `Fn`'s before the branch, and the branch's */
const getStatements = (offset: Node<'vec3'>) => {
  const call = (offset as unknown as Inspect).node;
  const body = runOnStack(() => call?.shaderNode?.jsFunc());
  const cond = body.find((node) => (node as unknown as Inspect).ifNode) as unknown as Inspect;
  const branch = runOnStack(() => cond.ifNode?.jsFunc());
  return { before: body.filter((node) => node !== (cond as unknown)), branch, cond };
};

describe('sampleRainRipples', () => {
  it('samples the atlas twice in the branch only, with gradients; the branch reads the rain and the weight', () => {
    const inputs = makeInputs();
    const { before, branch, cond } = getStatements(sampleRainRipples(inputs));
    const isAtlasSample = (node: Node) =>
      (node as unknown as Inspect).isTextureNode &&
      (node as unknown as Inspect).value === (inputs.atlas as unknown as Inspect).value &&
      node !== (inputs.atlas as unknown as Node);
    const samples = collectNodes(branch).filter(isAtlasSample);
    expect(samples).toHaveLength(2);
    for (const sample of samples) expect((sample as unknown as Inspect).gradNode).toBeTruthy();
    expect(collectNodes(before).filter(isAtlasSample)).toHaveLength(0);
    // The values the branch reads are assigned before it: the rain, the weight, the clock
    const assigned = collectNodes(before);
    for (const input of [inputs.rain, inputs.weight, inputs.time, inputs.lifetime, inputs.scale]) {
      expect(assigned).toContain(input);
    }
    expect(cond.condNode).toBeTruthy();
  });
});
