// The terrain material's near surface (p305 D2): the layers sampled and blended into one surface.
// Every layer at its own index (dense), or a few slots at the layers weighing most at the pixel
// (`TerrainSlots.ts`: sparse sampling, `DOMINANT`); their weights blended (linearly or by height);
// their surfaces blended by them; a `DETAIL` colour map's colour over their detail. The setup
// builds it directly, or the far branch inside its `If` (`TerrainFar.ts`), from inputs declared
// before it: so every uniform it reads is made before (`createSurfaceUniforms`), and the material
// has them at setup however late the branch is built.
import { uniform } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import { Vector2, type Node, type NodeMaterial } from 'three/webgpu';
import { existsOrThrow } from 'aekasha';
import type { TextureSetArrayInput, TextureSetPacking } from 'aekasha/texturesets';
import { applyColorMapDetail } from '../nodes/ColorMap';
import { blendWeightsByHeight, getBlendHeight, normalizeWeights } from '../nodes/HeightBlend';
import type { ProjectionContext } from '../nodes/Projection';
import { selectTopLayers, type KeptLayer } from '../nodes/Sparse';
import { getSurfaceSpace } from '../nodes/SurfaceSpace';
import type { ResolvedTerrainDefine } from './TerrainDefine';
import type { LayerSources } from './TerrainInputs';
import {
  blendSurfaces,
  getLayerSurface,
  getLayerUv,
  keepUniform,
  sampleLayer,
  type BuiltLayer,
  type LayerSurface,
  type LayerUniforms,
  type SharedCoords,
} from './TerrainLayers';
import { buildSlots } from './TerrainSlots';

/**
 * The material-wide uniforms the near surface reads, made before it: the height blend's depth
 * (`terrain_heightBlendDepth`), the detail's fade (`terrain_detailDistance`) and the texture AO's
 * influence (`terrain_aoTextureInfluence`), each null where the define has none
 * @internal
 */
export type SurfaceUniforms = {
  heightBlendDepth: Node<'float'> | null;
  detailDistance: Node<'vec2'> | null;
  aoTextureInfluence: Node<'float'> | null;
};

/**
 * Makes the near surface's material-wide uniforms: the height blend's with it, the detail's fade
 * with a `DETAIL` colour map's `detailDistance`, the texture AO's influence with `FULL` (the
 * packing with texture AO).
 * @internal
 */
export const createSurfaceUniforms = (
  material: NodeMaterial,
  define: ResolvedTerrainDefine,
  packing: TextureSetPacking
): SurfaceUniforms => {
  const { blend, colorMap } = define;
  const keep = <T>(name: string, node: unknown) => keepUniform(material, name, node) as T;
  const depth = blend.source !== 'SINGLE' ? blend.heightBlend : null;
  const detailDistance = colorMap?.mode === 'DETAIL' ? colorMap.detailDistance : null;
  return {
    heightBlendDepth: depth === null ? null : keep('heightBlendDepth', uniform(depth)),
    detailDistance: detailDistance
      ? keep('detailDistance', uniform(new Vector2(...detailDistance)))
      : null,
    aoTextureInfluence:
      packing === 'FULL' ? keep('aoTextureInfluence', uniform(define.aoTextureInfluence)) : null,
  };
};

/**
 * What the layers or slots read besides their own: the shared nodes, built before any of them (a
 * far branch's declared before it)
 * @internal
 */
export type LayerBuildContext = {
  define: ResolvedTerrainDefine;
  sources: LayerSources;
  uniforms: LayerUniforms[];
  viewDistance: Node<'float'>;
  /** The macro texture's patches (its B), `DUAL_SCALE`'s, or null without a macro */
  patches: Node<'float'> | null;
  getProjectionContext: () => ProjectionContext;
  /**
   * The coordinates and their gradients every layer samples with (a far branch's, made before
   * it), or undefined: a layer's taps take their own derivatives, the slots their coordinates'
   */
  shared?: SharedCoords;
};

/** Every layer at its own index: its tiling, anti-tiling and projection, its own seed */
const buildLayers = (ctx: LayerBuildContext): BuiltLayer[] =>
  ctx.sources.layers.map((source, i) => {
    const uniforms = ctx.uniforms[i];
    const uv = getLayerUv(ctx.define, source.params, uniforms, ctx.shared);
    const antiTiling = {
      viewDistance: ctx.viewDistance,
      patches: ctx.patches,
      seed: i,
      layer: source.layer,
      grad: uv.grad ?? undefined,
    };
    const sampled = sampleLayer(
      ctx.define,
      { source, uniforms, uv },
      antiTiling,
      ctx.getProjectionContext
    );
    return { source, uniforms, uv, ...sampled };
  });

/**
 * The layers the graph blends and their raw weights: every layer at its own index, or (sparse,
 * `DOMINANT`) the slots the top-K selection keeps of the raw weights, each at its layer, and the
 * slots' layers; null weights for `SINGLE`
 */
const buildBlendedLayers = (ctx: LayerBuildContext, raw: Node<'float'>[] | null) => {
  const { define, sources } = ctx;
  if (define.slotCount === null || !raw) {
    return { layers: buildLayers(ctx), weights: raw, slots: null };
  }
  if (!sources.isArray) {
    throw new Error(
      '[terrain] Sparse sampling and HEX\'s apply DOMINANT read each layer at a per-pixel index, which needs ARRAY storage: give a { "textureSetArray": [ids], "packing" } input "layers" (createTerrainMaterial\'s storage AUTO or ARRAY).'
    );
  }
  const slots = selectTopLayers(raw, define.slotCount);
  const layers = buildSlots(slots, {
    define,
    bundle: sources.layers[0].bundle as TextureSetArrayInput,
    layers: ctx.uniforms,
    antiTiling: { viewDistance: ctx.viewDistance, patches: ctx.patches },
    getProjectionContext: ctx.getProjectionContext,
    shared: ctx.shared,
  });
  return { layers, weights: slots.map((slot) => slot.weight), slots };
};

/**
 * The built layers' (or slots') final weights from their raw ones: normalized linearly, or by
 * their heights (the height blend's depth), which sum to 1
 */
const blendWeights = (
  define: ResolvedTerrainDefine,
  weights: Node<'float'>[],
  layers: BuiltLayer[],
  depth: Node<'float'> | null
) => {
  if (define.blend.source === 'SINGLE' || !depth) return normalizeWeights(weights);
  const heights = layers.map(({ source, uniforms, sample }) => {
    const height = existsOrThrow(uniforms.height, 'A height-blended layer has height uniforms.');
    const contrast = source.params.heightContrast.mul(height.contrast) as Node<'float'>;
    return getBlendHeight(sample.height, contrast, height.offset);
  });
  return blendWeightsByHeight(weights, heights, depth);
};

/**
 * The near surface as built: the blended surface (a `DETAIL` colour map's colour over the layers'
 * detail), the layers or slots, their final weights (null for `SINGLE`) and the slots (null for
 * every layer at its own index)
 * @internal
 */
export type NearSurface = {
  surface: LayerSurface;
  layers: BuiltLayer[];
  weights: Node<'float'>[] | null;
  slots: KeptLayer[] | null;
};

/**
 * The near surface (p305 D2): the layers or slots sampled, their weights blended, their surfaces
 * blended by them; with a `DETAIL` colour map, the albedo the colour map × the layers' detail,
 * faded out over `detailDistance`. With `deferBump` the bump (`MINIMAL`'s, a slot's) is left to
 * the caller as the surface's `bumpHeight` (a far branch can't take its derivatives), else a slot's
 * bump is the blended height's.
 * @internal
 * @param ctx the shared nodes the layers read
 * @param raw the raw weights (null for `SINGLE`)
 * @param nodes the material-wide uniforms, the colour map's sample (`DETAIL`)
 */
export const buildNearSurface = (
  ctx: LayerBuildContext,
  raw: Node<'float'>[] | null,
  nodes: { uniforms: SurfaceUniforms; colorMap: Node<'vec3'> | null; deferBump: boolean }
): NearSurface => {
  const { define } = ctx;
  const { layers, weights: rawWeights, slots } = buildBlendedLayers(ctx, raw);
  const { uniforms } = nodes;
  const getAoInfluence = () =>
    existsOrThrow(uniforms.aoTextureInfluence, 'A FULL material has its AO influence.');
  // A slot's bump is the blend's: its own height jumps where its layer changes
  const deferBump = nodes.deferBump || slots !== null;
  const surfaces = layers.map((layer) => getLayerSurface(define, layer, getAoInfluence, deferBump));
  const weights = rawWeights && blendWeights(define, rawWeights, layers, uniforms.heightBlendDepth);
  const space = getSurfaceSpace(define.space);
  const blended = weights ? blendSurfaces(surfaces, weights, deferBump, space) : surfaces[0];
  // DETAIL: the layers' albedo is their detail, which the colour map's colour multiplies
  const fade = uniforms.detailDistance && {
    range: uniforms.detailDistance,
    viewDistance: ctx.viewDistance,
  };
  const surface = nodes.colorMap
    ? { ...blended, albedo: applyColorMapDetail(nodes.colorMap, blended.albedo, fade) }
    : blended;
  return { surface, layers, weights, slots };
};
