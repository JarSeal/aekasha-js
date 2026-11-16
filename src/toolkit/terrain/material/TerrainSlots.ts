// The terrain material's slot path (p305 D6): sparse sampling and `HEX`'s `DOMINANT` sample a few
// slots, each the layer the top-K selection kept there (`nodes/Sparse.ts`), instead of every layer
// at its own index. A slot reads the `ARRAY` storage at its layer (`.depth(layer)`), the set's
// params from the array's `layerParams` and the layer's uniforms picked by the layer, so it's a
// layer as `TerrainLayers.ts` builds one. What differs is the build-time branches, which can't
// follow a per-pixel layer: every layer's anti-tiling is alike (the define's check; with
// `DOMINANT` the first slot `HEX`, the others `DUAL_SCALE`), and a slot projects as the projected
// layers do, a planar layer through a slope gate that never opens (so mixed slots sample the
// planar tap and branch into the projection where the kept layer's gate opens). Every tap samples
// with the gradients of the coordinates, which are continuous: a slot's UV jumps where its layer
// changes, and the GPU's own derivatives there would pick the smallest mip in a seam.
import { dFdx, dFdy, float, int, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { getTextureSetLayerParams, type TextureSetArrayInput } from 'aekasha/texturesets';
import type { AntiTilingContext, AntiTilingNodes } from '../nodes/AntiTiling';
import type { ProjectionContext, ProjectionNodes } from '../nodes/Projection';
import { pickByLayer, type KeptLayer } from '../nodes/Sparse';
import type { ResolvedTerrainDefine } from './TerrainDefine';
import type { LayerParams } from './TerrainInputs';
import {
  getLayerCoords,
  getLayerUv,
  sampleLayer,
  type BuiltLayer,
  type LayerUniforms,
  type SharedCoords,
} from './TerrainLayers';

/**
 * A slope gate that never opens (past any slope: a planar layer in a projected slot) and one
 * always open (under any slope: an ungated projected layer in a gated slot), degrees
 */
const GATE_CLOSED = [91, 92] as const;
const GATE_OPEN = [-2, -1] as const;

type ProjectingNodes = Exclude<ProjectionNodes, { mode: 'PLANAR' }>;

/**
 * A slot's projection: `PLANAR` where no layer projects; else the projected layers' mode and
 * normal blend (alike: the define's check), the sharpness picked, and where a layer is planar or
 * gated a slope gate picked (a planar layer's closed, an ungated one's open)
 */
const pickProjection = (layer: Node<'int'>, layers: LayerUniforms[]): ProjectionNodes => {
  const nodes = layers.map((uniforms) => uniforms.projection);
  const projected = nodes.find((node): node is ProjectingNodes => node.mode !== 'PLANAR');
  if (!projected) return { mode: 'PLANAR' };
  const isGated = nodes.some((node) => node.mode === 'PLANAR' || node.slopeGate);
  const unit = float(1) as unknown as Node<'float'>;
  const closed = vec2(...GATE_CLOSED) as unknown as Node<'vec2'>;
  const open = vec2(...GATE_OPEN) as unknown as Node<'vec2'>;
  return {
    mode: projected.mode,
    normalBlend: projected.normalBlend,
    sharpness: pickByLayer(
      layer,
      nodes.map((node) => (node.mode === 'PLANAR' ? unit : node.sharpness))
    ),
    slopeGate: isGated
      ? pickByLayer(
          layer,
          nodes.map((node) => (node.mode === 'PLANAR' ? closed : node.slopeGate ?? open))
        )
      : null,
  };
};

/**
 * A slot's anti-tiling: the layers' mode (alike: the define's check) with the uniforms picked;
 * with `DOMINANT` the first slot `HEX` and the others `DUAL_SCALE`
 */
const pickAntiTiling = (
  layer: Node<'int'>,
  slot: number,
  layers: LayerUniforms[]
): AntiTilingNodes => {
  const pick = <T>(values: T[]) => pickByLayer(layer, values);
  const nodes = layers.map((uniforms) =>
    slot > 0 && uniforms.dominant ? uniforms.dominant : uniforms.antiTiling
  );
  const [first] = nodes;
  if (first.mode === 'DUAL_SCALE') {
    const dualScale = nodes as Extract<AntiTilingNodes, { mode: 'DUAL_SCALE' }>[];
    return {
      mode: 'DUAL_SCALE',
      farScale: pick(dualScale.map((node) => node.farScale)),
      distance: pick(dualScale.map((node) => node.distance)),
    };
  }
  if (first.mode === 'HEX') {
    const hex = nodes as Extract<AntiTilingNodes, { mode: 'HEX' }>[];
    return {
      mode: 'HEX',
      contrast: pick(hex.map((node) => node.contrast)),
      rotation: pick(hex.map((node) => node.rotation)),
    };
  }
  return { mode: 'NONE' };
};

/**
 * A slot's uniforms: each of the kept layer's, picked by its index (the layers' own uniforms, so
 * the material editor's edits reach every slot); a rotation where any layer has one (0 for the
 * others), the height blend's where the material has it
 */
const pickLayerUniforms = (
  layer: Node<'int'>,
  slot: number,
  layers: LayerUniforms[]
): LayerUniforms => {
  const pick = <T>(values: T[]) => pickByLayer(layer, values);
  const zero = float(0) as unknown as Node<'float'>;
  const heights = layers.map((uniforms) => uniforms.height);
  const hasHeight = heights.every((height) => height !== null);
  return {
    tiling: pick(layers.map((uniforms) => uniforms.tiling)),
    rotation: layers.some((uniforms) => uniforms.rotation)
      ? pick(layers.map((uniforms) => uniforms.rotation ?? zero))
      : null,
    tint: pick(layers.map((uniforms) => uniforms.tint)),
    normalStrength: pick(layers.map((uniforms) => uniforms.normalStrength)),
    roughnessScale: pick(layers.map((uniforms) => uniforms.roughnessScale)),
    height: hasHeight
      ? {
          contrast: pick(heights.map((height) => height!.contrast)),
          offset: pick(heights.map((height) => height!.offset)),
        }
      : null,
    antiTiling: pickAntiTiling(layer, slot, layers),
    dominant: null,
    projection: pickProjection(layer, layers),
  };
};

/** What every slot reads besides its layer */
export type SlotContext = {
  define: ResolvedTerrainDefine;
  /** The layers' set array bundle (`ARRAY` storage) */
  bundle: TextureSetArrayInput;
  /** The set array's layers' uniforms, in its order */
  layers: LayerUniforms[];
  /**
   * Each array layer's index in the material, its seed (`HEX`), where they differ (layers of their
   * own inputs beside the array); undefined: the array's index
   */
  seeds?: number[];
  /** The anti-tiling's view distance and macro patches, shared */
  antiTiling: Pick<AntiTilingContext, 'viewDistance' | 'patches'>;
  getProjectionContext: () => ProjectionContext;
  /** The coordinates and their gradients when built before (a far branch's), else the slots' own */
  shared?: SharedCoords;
};

/** The tiling's coordinates and their gradients, made here when no one built them before */
const getSharedCoords = (define: ResolvedTerrainDefine): SharedCoords => {
  const coords = getLayerCoords(define);
  return {
    coords,
    grad: {
      dx: dFdx(coords) as unknown as Node<'vec2'>,
      dy: dFdy(coords) as unknown as Node<'vec2'>,
    },
  };
};

/**
 * The slots as built layers (p305 D6): each samples the set array at the layer the selection kept
 * there, with that layer's params and uniforms, its anti-tiling (`DOMINANT`: `HEX` in the first
 * slot, `DUAL_SCALE` in the others) and the slots' projection, every tap with the coordinates'
 * gradients.
 * @internal
 * @param slots the kept layers, heaviest first (`selectTopLayers`)
 * @param ctx the define, the set array, every layer's uniforms and the shared nodes
 */
export const buildSlots = (slots: KeptLayer[], ctx: SlotContext): BuiltLayer[] => {
  const { define, bundle } = ctx;
  // Continuous across the slots' layer changes, unlike a slot's UV: every tap's gradients
  const shared = ctx.shared ?? getSharedCoords(define);
  return slots.map(({ layer }, slot) => {
    const uniforms = pickLayerUniforms(layer, slot, ctx.layers);
    const params = getTextureSetLayerParams(bundle.layerParams, layer) as unknown as LayerParams;
    const source = { bundle, layer, params };
    const uv = getLayerUv(define, params, uniforms, shared);
    const antiTiling: AntiTilingContext = {
      ...ctx.antiTiling,
      seed: ctx.seeds
        ? pickByLayer(
            layer,
            ctx.seeds.map((seed) => int(seed) as unknown as Node<'int'>)
          )
        : layer,
      layer,
      grad: uv.grad ?? undefined,
    };
    const sampled = sampleLayer(
      define,
      { source, uniforms, uv },
      antiTiling,
      ctx.getProjectionContext
    );
    return { source, uniforms, uv, ...sampled };
  });
};
