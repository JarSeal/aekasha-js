import { describe, expect, it } from 'vitest';
import { float, texture } from 'three/tsl';
import { Texture, type Node, type TextureNode } from 'three/webgpu';
import type { TerrainRuleDefine } from '../material/TerrainDefine';
import { applyRules, createRuleContext, createRuleNodes, getRuleCoverage } from './Rules';

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

const reaches = (root: unknown, target: unknown) => collectNodes([root]).includes(target as Node);

const countMethod = (root: unknown, method: string) =>
  collectNodes([root]).filter((node) => (node as unknown as { method?: string }).method === method)
    .length;

/** A rule of no tests, these given */
const ruleOf = (rule: Partial<TerrainRuleDefine>): TerrainRuleDefine => ({
  layer: 1,
  slope: null,
  height: null,
  aspect: null,
  noise: null,
  strength: 1,
  ...rule,
});

/** A rule's uniforms, kept in a record */
const createNodes = (rule: TerrainRuleDefine) => {
  const kept: Record<string, { value: unknown }> = {};
  const nodes = createRuleNodes(rule, (name, node) => {
    kept[name] = node as unknown as { value: unknown };
    return node;
  });
  return { nodes, kept };
};

const makeTexture = () => texture(new Texture()) as unknown as TextureNode;

/** The samples of a texture the root reaches (not the texture's own reference node) */
const countSamplesOf = (root: unknown, map: TextureNode) =>
  collectNodes([root]).filter(
    (node) =>
      (node as unknown as { isTextureNode?: boolean }).isTextureNode &&
      (node as unknown as { value: unknown }).value === map.value &&
      node !== (map as unknown as Node)
  ).length;

describe('createRuleNodes', () => {
  it("keeps the uniforms of the rule's tests only, a range's given ends only", () => {
    const { kept } = createNodes(
      ruleOf({
        slope: { min: 30, max: null, softness: 5 },
        aspect: { direction: [0, -1], range: 40, softness: 15 },
        strength: 0.75,
      })
    );
    expect(Object.keys(kept).sort()).toEqual([
      'aspectDirection',
      'aspectRange',
      'aspectSoftness',
      'slopeMin',
      'slopeSoftness',
      'strength',
    ]);
    expect(kept.slopeMin.value).toBe(30);
    expect(kept.strength.value).toBe(0.75);
    expect(kept.aspectDirection.value).toMatchObject({ x: 0, y: -1 });
    const noisy = createNodes(
      ruleOf({
        height: { min: null, max: 12, softness: 2 },
        noise: { scale: 40, amount: 0.3, channel: 'A' },
      })
    );
    expect(Object.keys(noisy.kept).sort()).toEqual([
      'heightMax',
      'heightSoftness',
      'noiseAmount',
      'noiseScale',
      'strength',
    ]);
  });
});

describe('getRuleCoverage', () => {
  it('measures what its tests need: the slope, the height, the facing', () => {
    const ctx = createRuleContext(null);
    const slope = createNodes(ruleOf({ slope: { min: 30, max: 60, softness: 5 } })).nodes;
    const bySlope = getRuleCoverage(slope, ctx);
    expect(reaches(bySlope, ctx.slope)).toBe(true);
    expect(reaches(bySlope, ctx.height)).toBe(false);
    // Both ends: two smoothsteps
    expect(countMethod(bySlope, 'smoothstep')).toBe(2);
    const height = createNodes(ruleOf({ height: { min: 10, max: null, softness: 2 } })).nodes;
    const byHeight = getRuleCoverage(height, ctx);
    expect(reaches(byHeight, ctx.height)).toBe(true);
    expect(reaches(byHeight, ctx.slope)).toBe(false);
    expect(countMethod(byHeight, 'smoothstep')).toBe(1);
    const aspect = { direction: [1, 0] as [number, number], range: 45, softness: 15 };
    const byFacing = getRuleCoverage(createNodes(ruleOf({ aspect })).nodes, ctx);
    expect(reaches(byFacing, ctx.normal)).toBe(true);
    expect(reaches(byFacing, ctx.slope)).toBe(false);
    // The facing's angle, and the fade in from flat ground
    expect(countMethod(byFacing, 'acos')).toBe(1);
    expect(countMethod(byFacing, 'smoothstep')).toBe(2);
  });

  it('samples the noise texture once per rule with noise, and wants it', () => {
    const noiseTexture = makeTexture();
    const noise = { scale: 40, amount: 0.5, channel: 'B' as const };
    const rule = createNodes(ruleOf({ slope: { min: 20, max: null, softness: 5 }, noise })).nodes;
    const coverage = getRuleCoverage(rule, createRuleContext(noiseTexture));
    expect(countSamplesOf(coverage, noiseTexture)).toBe(1);
    const quiet = createNodes(ruleOf({ slope: { min: 20, max: null, softness: 5 } })).nodes;
    expect(
      countSamplesOf(getRuleCoverage(quiet, createRuleContext(noiseTexture)), noiseTexture)
    ).toBe(0);
    expect(() => getRuleCoverage(rule, createRuleContext(null))).toThrow(/needs the noise texture/);
  });
});

describe('applyRules', () => {
  it("composites each rule over every layer's weight, adding its coverage to its layer", () => {
    const ctx = createRuleContext(null);
    const weights = [float(1), float(0), float(0)] as unknown as Node<'float'>[];
    const snow = createNodes(ruleOf({ layer: 2, height: { min: 40, max: null, softness: 2 } }));
    const rocks = createNodes(ruleOf({ layer: 1, slope: { min: 35, max: null, softness: 5 } }));
    const result = applyRules(weights, [rocks.nodes, snow.nodes], ctx);
    expect(result).toHaveLength(3);
    // Every weight reads both rules: the later scales the earlier's
    const strengths = [rocks.kept.strength, snow.kept.strength];
    for (const weight of result) {
      for (const strength of strengths) expect(reaches(weight, strength)).toBe(true);
    }
    // The last rule's layer: its kept share plus its coverage
    expect((result[2] as unknown as { op?: string }).op).toBe('+');
    expect((result[0] as unknown as { op?: string }).op).toBe('*');
    expect(applyRules(weights, [], ctx)).toBe(weights);
  });
});
