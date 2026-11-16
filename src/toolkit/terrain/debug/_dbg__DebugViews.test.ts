import { describe, expect, it } from 'vitest';
import { float, texture, uniform, vec2, vec3 } from 'three/tsl';
import {
  MeshStandardNodeMaterial,
  Texture,
  Vector2,
  type Node,
  type TextureNode,
} from 'three/webgpu';
import { readTerrainDefine } from '../material/TerrainDefine';
import type { ProjectionNodes } from '../nodes/Projection';
import {
  applyTerrainDebugView,
  estimateTerrainFetches,
  type TerrainDebugView,
  type TerrainDebugViewContext,
  type TerrainDebugViewLayer,
} from './_dbg__DebugViews';

const makeLayer = (projection: ProjectionNodes = { mode: 'PLANAR' }): TerrainDebugViewLayer => ({
  tileSize: uniform(new Vector2(3, 3)) as unknown as Node<'vec2'>,
  colorTexture: texture(new Texture()) as unknown as TextureNode,
  projection,
});

const ctx: TerrainDebugViewContext = {
  coords: vec2(1, 2) as unknown as Node<'vec2'>,
  layers: [makeLayer()],
  weights: null,
  sampled: [{ antiTiling: 'NONE', projection: { mode: 'PLANAR' } }],
  slots: null,
  normal: vec3(0, 1, 0) as unknown as Node<'vec3'>,
  define: readTerrainDefine({ terrain: { layers: [{}] } }),
  packing: 'LITE',
};

/** How many of a view's nodes run a method, each node once */
const countMethod = (root: unknown, method: string) => {
  const nodes = new Set<Node>();
  const stack = [root] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return [...nodes].filter((node) => (node as unknown as { method?: string }).method === method)
    .length;
};

describe('applyTerrainDebugView', () => {
  it('replaces the shading with an unlit view', () => {
    const views = ['TEXEL_DENSITY', 'NORMALS', 'WEIGHTS', 'PROJECTION', 'TAPS', 'LAYER_COUNT'];
    for (const view of views as TerrainDebugView[]) {
      const material = new MeshStandardNodeMaterial();
      material.aoNode = vec3(1) as never;
      applyTerrainDebugView(material, view, ctx);
      expect(material.emissiveNode, view).toBeTruthy();
      expect(material.colorNode).toBeTruthy();
      expect(material.roughnessNode).toBeTruthy();
      expect(material.aoNode).toBeNull();
    }
  });

  it("reads every layer's density and weight", () => {
    const weights = [float(0.25), float(0.75)] as unknown as Node<'float'>[];
    const blended = { ...ctx, layers: [makeLayer(), makeLayer()], weights };
    const density = new MeshStandardNodeMaterial();
    applyTerrainDebugView(density, 'TEXEL_DENSITY', blended);
    expect(countMethod(density.emissiveNode, 'log2')).toBe(2);
    const weightView = new MeshStandardNodeMaterial();
    applyTerrainDebugView(weightView, 'WEIGHTS', blended);
    const reached = new Set<unknown>();
    const stack = [weightView.emissiveNode] as (Node | null)[];
    while (stack.length) {
      const node = stack.pop();
      if (!node || reached.has(node)) continue;
      reached.add(node);
      for (const child of node.getChildren()) stack.push(child as Node);
    }
    for (const weight of weights) expect(reached.has(weight)).toBe(true);
  });

  /** A view context of a define (its layers planar but where the projections say) and packing */
  const contextOf = (
    terrain: object,
    packing: TerrainDebugViewContext['packing'],
    projections: ProjectionNodes[] = []
  ): TerrainDebugViewContext => {
    const define = readTerrainDefine({ terrain });
    const layers = define.layers.map((_, i) => makeLayer(projections[i]));
    return {
      ...ctx,
      layers,
      weights: define.layers.length > 1 ? define.layers.map(() => float(0.5) as never) : null,
      sampled: define.layers.map(({ antiTiling }, i) => ({
        antiTiling: antiTiling.mode,
        projection: layers[i].projection,
      })),
      define,
      packing,
    };
  };
  const gatedNodes = (mode: 'BIPLANAR' | 'TRIPLANAR'): ProjectionNodes => ({
    mode,
    sharpness: uniform(4) as unknown as Node<'float'>,
    normalBlend: 'WHITEOUT',
    slopeGate: uniform(new Vector2(30, 50)) as unknown as Node<'vec2'>,
  });

  it('counts the fetches every pixel makes and those of the slope gates past their first slope', () => {
    expect(estimateTerrainFetches(contextOf({ layers: [{}] }, 'LITE'))).toEqual({
      always: 2,
      gated: [],
    });
    const hexTriplanar = {
      layers: [{}],
      antiTiling: { mode: 'HEX' },
      projection: { mode: 'TRIPLANAR' },
    };
    const triplanar = { ...gatedNodes('TRIPLANAR'), slopeGate: null };
    expect(estimateTerrainFetches(contextOf(hexTriplanar, 'FULL', [triplanar])).always).toBe(
      3 * 3 * 3
    );
    // The gate: the planar tap always, the branch's two planes past its first slope
    const gated = {
      layers: [{}],
      antiTiling: { mode: 'DUAL_SCALE' },
      projection: { mode: 'TRIPLANAR', slopeGate: [30, 50] },
    };
    const estimate = estimateTerrainFetches(contextOf(gated, 'LITE', [gatedNodes('TRIPLANAR')]));
    expect(estimate.always).toBe(2 * 2);
    expect(estimate.gated.map(({ fetches }) => fetches)).toEqual([2 * 2 * 2]);
    // Three MINIMAL layers' taps, one splat map (two painted layers), the macro and a rule's noise
    const blended = {
      layers: [{}, {}, {}],
      blend: {
        source: 'SPLAT_MAP_AND_RULES',
        paintedLayers: 2,
        rules: [{ layer: 2, slope: { min: 40 }, noise: { scale: 20, amount: 0.3 } }],
      },
      macro: { scale: 64 },
    };
    expect(estimateTerrainFetches(contextOf(blended, 'MINIMAL')).always).toBe(3 + 1 + 1 + 1);
    const colorMapped = { ...blended, colorMap: { mode: 'DETAIL' } };
    expect(estimateTerrainFetches(contextOf(colorMapped, 'MINIMAL')).always).toBe(
      3 + 1 + 1 + 1 + 1
    );
  });

  it("counts the slots' fetches, not the layers', a slot's gate its own", () => {
    const painted = {
      layers: [{}, {}, {}, {}],
      blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
    };
    // Two slots of four layers: DOMINANT's HEX in the first, DUAL_SCALE in the second (LITE)
    const dominant = {
      ...contextOf(painted, 'LITE'),
      sampled: [
        { antiTiling: 'HEX' as const, projection: { mode: 'PLANAR' as const } },
        { antiTiling: 'DUAL_SCALE' as const, projection: { mode: 'PLANAR' as const } },
      ],
    };
    expect(estimateTerrainFetches(dominant)).toEqual({ always: 2 * 3 + 2 * 2, gated: [] });
    // A gated slot: its planar tap always, its branch where its picked gate opens
    const gate = gatedNodes('TRIPLANAR');
    const gated = {
      ...contextOf(painted, 'LITE'),
      sampled: [0, 1].map(() => ({ antiTiling: 'NONE' as const, projection: gate })),
    };
    const estimate = estimateTerrainFetches(gated);
    expect(estimate.always).toBe(2 * 2);
    expect(estimate.gated.map(({ fetches }) => fetches)).toEqual([2 * 2, 2 * 2]);
  });

  it('counts the weighed layers, in slots before the cut, and stripes where the slots drop one', () => {
    const reachesAll = (root: unknown, targets: unknown[]) => {
      const nodes = new Set<unknown>();
      const stack = [root] as (Node | null)[];
      while (stack.length) {
        const node = stack.pop();
        if (!node || nodes.has(node)) continue;
        nodes.add(node);
        for (const child of node.getChildren()) stack.push(child as Node);
      }
      return targets.every((target) => nodes.has(target));
    };
    const painted = {
      layers: [{}, {}, {}],
      blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
    };
    const dense = contextOf(painted, 'LITE');
    const denseView = new MeshStandardNodeMaterial();
    applyTerrainDebugView(denseView, 'LAYER_COUNT', dense);
    expect(reachesAll(denseView.emissiveNode, dense.weights ?? [])).toBe(true);
    const layerWeights = [0.6, 0.3, 0.1].map((w) => float(w) as unknown as Node<'float'>);
    const sparse = { ...dense, slots: { count: 2, layerWeights } };
    const sparseView = new MeshStandardNodeMaterial();
    applyTerrainDebugView(sparseView, 'LAYER_COUNT', sparse);
    expect(reachesAll(sparseView.emissiveNode, layerWeights)).toBe(true);
    expect(reachesAll(sparseView.emissiveNode, dense.weights ?? [])).toBe(false);
    // The stripes: a fract of the position, in slots only
    expect(countMethod(sparseView.emissiveNode, 'fract')).toBe(1);
    expect(countMethod(denseView.emissiveNode, 'fract')).toBe(0);
  });

  it("colours the planes' weights by the sharpness, a gate's band by its uniform", () => {
    const reaches = (root: unknown, target: unknown) => {
      const nodes = new Set<unknown>();
      const stack = [root] as (Node | null)[];
      while (stack.length) {
        const node = stack.pop();
        if (!node || nodes.has(node)) continue;
        nodes.add(node);
        for (const child of node.getChildren()) stack.push(child as Node);
      }
      return nodes.has(target);
    };
    const projection = gatedNodes('BIPLANAR');
    const define = { layers: [{}, { projection: { mode: 'BIPLANAR', slopeGate: [30, 50] } }] };
    const view = new MeshStandardNodeMaterial();
    applyTerrainDebugView(
      view,
      'PROJECTION',
      contextOf({ ...define, blend: { source: 'VERTEX_COLOR' } }, 'LITE', [
        { mode: 'PLANAR' },
        projection,
      ])
    );
    if (projection.mode === 'PLANAR') throw new Error('unreachable');
    expect(reaches(view.emissiveNode, projection.sharpness)).toBe(true);
    expect(reaches(view.emissiveNode, projection.slopeGate)).toBe(true);
    const taps = new MeshStandardNodeMaterial();
    applyTerrainDebugView(
      taps,
      'TAPS',
      contextOf({ ...define, blend: { source: 'VERTEX_COLOR' } }, 'LITE', [
        { mode: 'PLANAR' },
        projection,
      ])
    );
    expect(reaches(taps.emissiveNode, projection.slopeGate)).toBe(true);
  });
});
