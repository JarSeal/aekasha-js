import { describe, expect, it } from 'vitest';
import * as TSL from 'three/tsl';
import { texture, uniform, vec3 } from 'three/tsl';
import { StackNode, Texture, type Node, type TextureNode } from 'three/webgpu';
import { sampleRainStreaks, type RainStreakInputs } from './Streaks';

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

const makeInputs = (): RainStreakInputs => ({
  texture: texture(new Texture()) as unknown as TextureNode,
  position: vec3(1, 2, 3) as unknown as Node<'vec3'>,
  normal: vec3(1, 0, 0) as unknown as Node<'vec3'>,
  scale: uniform(4) as unknown as Node<'float'>,
  length: uniform(8) as unknown as Node<'float'>,
  speed: uniform(1) as unknown as Node<'float'>,
  rain: uniform(0.8) as unknown as Node<'float'>,
  wetness: uniform(0.5) as unknown as Node<'float'>,
  time: uniform(3) as unknown as Node<'float'>,
  weight: uniform(1) as unknown as Node<'float'>,
});

/** The streaks' statements: its `Fn`'s before the branch, and the branch's */
const getStatements = (streaks: Node<'vec2'>) => {
  const call = (streaks as unknown as Inspect).node;
  const body = runOnStack(() => call?.shaderNode?.jsFunc());
  const cond = body.find((node) => (node as unknown as Inspect).ifNode) as unknown as Inspect;
  const branch = runOnStack(() => cond.ifNode?.jsFunc());
  return { before: body.filter((node) => node !== (cond as unknown)), branch, cond };
};

describe('sampleRainStreaks', () => {
  it('samples the texture once in the branch only, a second time in the band around 45°, with gradients; the branch reads the weather and the weight', () => {
    const inputs = makeInputs();
    const { before, branch, cond } = getStatements(sampleRainStreaks(inputs));
    const isNoiseSample = (node: Node) =>
      (node as unknown as Inspect).isTextureNode &&
      (node as unknown as Inspect).value === (inputs.texture as unknown as Inspect).value &&
      node !== (inputs.texture as unknown as Node);
    const samples = collectNodes(branch).filter(isNoiseSample);
    expect(samples).toHaveLength(1);
    expect((samples[0] as unknown as Inspect).gradNode).toBeTruthy();
    expect(collectNodes(before).filter(isNoiseSample)).toHaveLength(0);
    // The other axis's tap: in a branch of its own, on its share (mixed into the main tap's var)
    const band = branch.find((node) => (node as unknown as Inspect).ifNode) as unknown as Inspect;
    const second = collectNodes(runOnStack(() => band.ifNode?.jsFunc())).filter(
      (node) => isNoiseSample(node) && !samples.includes(node)
    );
    expect(second).toHaveLength(1);
    expect((second[0] as unknown as Inspect).gradNode).toBeTruthy();
    // The values the branch reads are assigned before it: the weather, the weight, the clock, the
    // face's axis (the normal)
    const assigned = collectNodes(before);
    for (const input of [
      inputs.rain,
      inputs.wetness,
      inputs.weight,
      inputs.time,
      inputs.speed,
      inputs.scale,
      inputs.length,
      inputs.normal,
    ]) {
      expect(assigned).toContain(input);
    }
    expect(cond.condNode).toBeTruthy();
  });
});
