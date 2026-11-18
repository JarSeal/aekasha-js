import { describe, expect, it } from 'vitest';
import { uniform, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { getShoreline } from './Shoreline';

/** The nodes the roots reach, each once */
const collectNodes = (roots: unknown[]) => {
  const nodes = new Set<unknown>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return nodes;
};

const float = (value: number) => uniform(value) as unknown as Node<'float'>;

const makeInputs = () => ({
  waterLevel: float(0),
  band: float(1.5),
  noise: float(0.3),
  time: float(2),
  position: vec3(1, 0.5, 2) as unknown as Node<'vec3'>,
});

describe('getShoreline', () => {
  it('measures every band from the water level, the waterline wandering by the noise', () => {
    const inputs = makeInputs();
    const { wash, saturated, damp } = getShoreline({ ...inputs, runUp: null });
    for (const band of [wash, saturated, damp]) {
      const reached = collectNodes([band]);
      expect(reached.has(inputs.waterLevel)).toBe(true);
      expect(reached.has(inputs.noise)).toBe(true);
      expect(reached.has(inputs.position)).toBe(true);
      // Still water: no clock
      expect(reached.has(inputs.time)).toBe(false);
    }
    expect(collectNodes([damp]).has(inputs.band)).toBe(true);
    expect(collectNodes([wash, saturated]).has(inputs.band)).toBe(false);
  });

  it('moves the wash and the saturated sand with the run-up on the clock', () => {
    const inputs = makeInputs();
    const runUp = { height: float(0.5), period: float(6) };
    const { wash, saturated, damp } = getShoreline({ ...inputs, runUp });
    const washed = collectNodes([wash]);
    for (const node of [inputs.time, runUp.height, runUp.period])
      expect(washed.has(node)).toBe(true);
    const saturatedNodes = collectNodes([saturated]);
    for (const node of [inputs.time, runUp.height]) expect(saturatedNodes.has(node)).toBe(true);
    expect(collectNodes([damp]).has(inputs.time)).toBe(false);
  });
});
