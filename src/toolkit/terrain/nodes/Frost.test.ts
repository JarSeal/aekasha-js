import { describe, expect, it } from 'vitest';
import * as TSL from 'three/tsl';
import { float, uniform, vec3 } from 'three/tsl';
import { StackNode, Vector2, type Node } from 'three/webgpu';
import { applyFrost, getFrost, getSparkle } from './Frost';

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
  shaderNode?: { jsFunc: () => unknown; layout?: { name?: string } };
  ifNode?: { jsFunc: () => unknown };
  condNode?: Node;
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

describe('getFrost', () => {
  it('reads the temperature against its range, × the strength, the response and the facing', () => {
    const inputs = {
      temperature: uniform(-3) as unknown as Node<'float'>,
      range: uniform(new Vector2(0, -5)) as unknown as Node<'vec2'>,
      strength: uniform(1) as unknown as Node<'float'>,
      response: uniform(0.8) as unknown as Node<'float'>,
      exposure: uniform(1) as unknown as Node<'float'>,
    };
    const nodes = collectNodes([getFrost(inputs)]);
    for (const input of Object.values(inputs)) expect(nodes).toContain(input);
  });

  it('whitens the albedo and raises the roughness by the frost', () => {
    const frost = uniform(0.5) as unknown as Node<'float'>;
    const frosted = applyFrost(
      vec3(0.3) as unknown as Node<'vec3'>,
      float(0.1) as unknown as Node<'float'>,
      frost
    );
    expect(collectNodes([frosted.albedo])).toContain(frost);
    expect(collectNodes([frosted.roughness])).toContain(frost);
  });
});

describe('getSparkle', () => {
  it('hashes its cells in a branch on the weight only; its inputs are assigned before it', () => {
    const inputs = {
      position: vec3(1, 2, 3) as unknown as Node<'vec3'>,
      density: uniform(80) as unknown as Node<'float'>,
      weight: uniform(0.7) as unknown as Node<'float'>,
    };
    const call = (getSparkle(inputs) as unknown as Inspect).node;
    const body = runOnStack(() => call?.shaderNode?.jsFunc());
    const cond = body.find((node) => (node as unknown as Inspect).ifNode) as unknown as Inspect;
    const before = body.filter((node) => node !== (cond as unknown));
    const branch = runOnStack(() => cond.ifNode?.jsFunc());
    // The hashes are layout functions (`hash12` / `hash22`), called in the branch alone
    const isHash = (node: Node) =>
      /hash/i.test((node as unknown as Inspect).shaderNode?.layout?.name ?? '');
    expect(collectNodes(branch).some(isHash)).toBe(true);
    expect(collectNodes(before).some(isHash)).toBe(false);
    const assigned = collectNodes(before);
    for (const input of Object.values(inputs)) expect(assigned).toContain(input);
    expect(cond.condNode).toBeTruthy();
  });
});
