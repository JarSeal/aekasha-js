// The terrain material's layers (p305 D2): a layer's uniforms (`terrain_l<i>_<name>`), its tiling
// UV, its sample (anti-tiled, projected, slope-gated) and its surface in world space, and the
// surfaces blended by weight. The dense path builds one per layer at its own index
// (`TerrainMaterial.ts`), the slot path one per slot at the layer weighing most there
// (`TerrainSlots.ts`, sparse sampling and `DOMINANT`): the same code over picked uniforms.
import { color, float, mix, uniform, uv as meshUv, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import { Vector2, type Node, type NodeMaterial } from 'three/webgpu';
import { existsOrThrow } from 'aekasha';
import type { AntiTilingContext, AntiTilingNodes } from '../nodes/AntiTiling';
import { sampleAntiTiled } from '../nodes/AntiTiling';
import { getLayerDetail } from '../nodes/ColorMap';
import {
  sampleProjected,
  type ProjectedLayer,
  type ProjectionContext,
  type ProjectionNodes,
} from '../nodes/Projection';
import type { TextureSetPacking } from 'aekasha/texturesets';
import type { TextureSetSample } from '../nodes/SampleTextureSet';
import { sampleSlopeGated } from '../nodes/SlopeGate';
import { getSurfaceSpace, type SurfaceSpace } from '../nodes/SurfaceSpace';
import {
  bumpNormalWorld,
  getPlanarTangentFrame,
  getUvTangentFrame,
  transformTangentNormalToWorld,
  type WorldTangentFrame,
} from '../nodes/TerrainNormals';
import type {
  ResolvedTerrainDefine,
  TerrainAntiTilingDefine,
  TerrainProjectionDefine,
} from './TerrainDefine';
import type { LayerParams, LayerSource } from './TerrainInputs';

const DEG_TO_RAD = Math.PI / 180;
/**
 * `MINIMAL`'s roughness before the scales: the packing has no roughness map (the baseline's); the
 * far surface's too, where no layer is sampled.
 * @internal
 */
export const MINIMAL_ROUGHNESS = 0.8;

/** `DUAL_SCALE`'s uniforms */
type DualScaleNodes = Extract<AntiTilingNodes, { mode: 'DUAL_SCALE' }>;

/**
 * A layer's uniforms, kept at `userData.uniforms.terrain_l<i>_<name>` (a slot's: the kept layer's,
 * picked)
 * @internal
 */
export type LayerUniforms = {
  tiling: Node<'float'>;
  rotation: Node<'float'> | null;
  tint: Node<'color'>;
  normalStrength: Node<'float'>;
  roughnessScale: Node<'float'>;
  /** The height blend's `heightContrast` and `heightOffset`, or null without the height blend */
  height: { contrast: Node<'float'>; offset: Node<'float'> } | null;
  /** The anti-tiling's mode and its uniforms (`farScale`, `antiTilingDistance`; `hexContrast`,
   * `hexRotation`) */
  antiTiling: AntiTilingNodes;
  /**
   * `HEX`'s `DOMINANT` in slots: the `DUAL_SCALE` the layer samples in a slot past the first
   * (`farScale`, `antiTilingDistance`), else null
   */
  dominant: DualScaleNodes | null;
  /** The projection's mode and its uniforms (`projectionSharpness`, `slopeGate`) */
  projection: ProjectionNodes;
};

/**
 * A layer's surface, its normal in world space: what the layers blend (one, for `SINGLE`)
 * @internal
 */
export type LayerSurface = {
  albedo: Node<'vec3'>;
  normal: Node<'vec3'>;
  roughness: Node<'float'>;
  /** The texture AO with its influence, or null where the albedo has it baked */
  ao: Node<'float'> | null;
  /**
   * The height in metres the normal bumps (`MINIMAL`, or a projection without normal maps), or
   * null where a normal map gives it; a slot's bump is the blend's (`bumpBlendedHeight`)
   */
  bumpHeight: Node<'float'> | null;
};

/**
 * A material uniform kept at `userData.uniforms.terrain_<name>`, where the material editor finds it
 * @internal
 */
export const keepUniform = <T>(material: NodeMaterial, name: string, node: T) => {
  const uniforms = (material.userData.uniforms ??= {}) as Record<string, unknown>;
  uniforms[`terrain_${name}`] = node;
  return node;
};

/** `DUAL_SCALE`'s uniforms (`farScale`, `antiTilingDistance`) */
const createDualScaleNodes = (
  { farScale, distance }: { farScale: number; distance: [number, number] },
  keep: (name: string, node: unknown) => unknown
): DualScaleNodes => ({
  mode: 'DUAL_SCALE',
  farScale: keep('farScale', uniform(farScale)) as Node<'float'>,
  distance: keep('antiTilingDistance', uniform(new Vector2(...distance))) as Node<'vec2'>,
});

/** A layer's anti-tiling uniforms, those of its mode only */
const createAntiTilingNodes = (
  antiTiling: TerrainAntiTilingDefine,
  keep: (name: string, node: unknown) => unknown
): AntiTilingNodes => {
  if (antiTiling.mode === 'DUAL_SCALE') return createDualScaleNodes(antiTiling, keep);
  if (antiTiling.mode === 'HEX') {
    return {
      mode: 'HEX',
      contrast: keep('hexContrast', uniform(antiTiling.hexContrast)) as Node<'float'>,
      rotation: keep('hexRotation', uniform(antiTiling.hexRotation)) as Node<'float'>,
    };
  }
  return { mode: 'NONE' };
};

/** A layer's projection uniforms, a projecting mode's only, the gate's with a gate */
const createProjectionNodes = (
  projection: TerrainProjectionDefine,
  keep: (name: string, node: unknown) => unknown
): ProjectionNodes => {
  if (projection.mode === 'PLANAR') return { mode: 'PLANAR' };
  return {
    mode: projection.mode,
    sharpness: keep('projectionSharpness', uniform(projection.sharpness)) as Node<'float'>,
    normalBlend: projection.normalBlend,
    slopeGate: projection.slopeGate
      ? (keep('slopeGate', uniform(new Vector2(...projection.slopeGate))) as Node<'vec2'>)
      : null,
  };
};

/**
 * Makes a layer's uniforms (`terrain_l<i>_<name>`), the height blend's with it only, `DOMINANT`'s
 * `DUAL_SCALE` in slots only.
 * @internal
 */
export const createLayerUniforms = (
  material: NodeMaterial,
  define: ResolvedTerrainDefine,
  index: number
): LayerUniforms => {
  const layer = define.layers[index];
  const keep = (name: string, node: unknown) => keepUniform(material, `l${index}_${name}`, node);
  const hasHeightBlend = define.blend.source !== 'SINGLE' && define.blend.heightBlend !== null;
  const { antiTiling } = layer;
  return {
    height: hasHeightBlend
      ? {
          contrast: keep('heightContrast', uniform(layer.heightContrast)) as Node<'float'>,
          offset: keep('heightOffset', uniform(layer.heightOffset)) as Node<'float'>,
        }
      : null,
    antiTiling: createAntiTilingNodes(antiTiling, keep),
    dominant:
      antiTiling.mode === 'HEX' && antiTiling.dominant && define.slotCount !== null
        ? createDualScaleNodes(antiTiling.dominant, keep)
        : null,
    projection: createProjectionNodes(layer.projection, keep),
    tiling: keep('tiling', uniform(layer.tiling)) as Node<'float'>,
    rotation:
      layer.rotation === null ? null : (keep('rotation', uniform(layer.rotation)) as Node<'float'>),
    tint: keep('tint', uniform(color(layer.tint))) as Node<'color'>,
    normalStrength: keep('normalStrength', uniform(layer.normalStrength)) as Node<'float'>,
    roughnessScale: keep('roughnessScale', uniform(layer.roughnessScale)) as Node<'float'>,
  };
};

/** A UV's screen-space gradients */
type UvGradients = { dx: Node<'vec2'>; dy: Node<'vec2'> };

/**
 * The tiling's coordinates every layer or slot shares and their gradients, built once before them
 * (a slot's UV jumps where its layer changes; a far branch can't take derivatives): with the world
 * position's gradients, which a mesh UV's frame reads, when they're built before a branch
 * @internal
 */
export type SharedCoords = {
  coords: Node<'vec2'>;
  grad: UvGradients;
  positionGrad?: { dx: Node<'vec3'>; dy: Node<'vec3'> };
};

/**
 * A layer's tiling: its coordinates in metres, its tile size, its UV and its turn
 * @internal
 */
export type LayerUv = {
  /** The world's `(x, −z)` or the mesh's UV, metres */
  coords: Node<'vec2'>;
  /** The set's `physicalSize` × the layer's tiling, metres */
  tileSize: Node<'vec2'>;
  /** The UV sampled, in tiles */
  tileUv: Node<'vec2'>;
  /** The rotation in radians, or null for none */
  angle: Node<'float'> | null;
  /** The rotation's cosine and sine, or null for none */
  turn: { cos: Node<'float'>; sin: Node<'float'> } | null;
  /**
   * The UV's gradients from the coordinates' (a slot's: its UV jumps where its layer changes), or
   * null: each tap's own
   */
  grad: UvGradients | null;
  /** The tangent frame of a mesh UV (`MESH_UV`): the UV's, or a slot's from the coordinates */
  getUvFrame: () => WorldTangentFrame;
};

/**
 * The tiling's coordinates in metres: the surface's `(x, −z)` in the material's space (the world's
 * or the mesh's own; seen from above, the source's orientation) or the mesh's UV.
 * @internal
 */
export const getLayerCoords = (define: ResolvedTerrainDefine) => {
  if (define.uv === 'MESH_UV') return meshUv() as unknown as Node<'vec2'>;
  const { position } = getSurfaceSpace(define.space);
  return vec2(position.x, position.z.negate()) as unknown as Node<'vec2'>;
};

/**
 * A layer's tiling UV: its coordinates over the set's tile size × the layer's tiling, turned by
 * its rotation when it has one (its angle in radians, which the planar frame turns by too). A slot
 * passes the coordinates every slot shares and their gradients, which its taps sample with.
 * @internal
 */
export const getLayerUv = (
  define: ResolvedTerrainDefine,
  params: LayerParams,
  layer: LayerUniforms,
  shared?: SharedCoords
): LayerUv => {
  const coords = shared?.coords ?? getLayerCoords(define);
  const tileSize = params.physicalSize.mul(layer.tiling) as Node<'vec2'>;
  // The pattern turns counter-clockwise from above: sample at the UV turned back
  const angle = layer.rotation ? (layer.rotation.mul(DEG_TO_RAD) as Node<'float'>) : null;
  const turn = angle
    ? { cos: angle.cos() as Node<'float'>, sin: angle.sin() as Node<'float'> }
    : null;
  const toTiles = (v: Node<'vec2'>) => {
    const t = v.div(tileSize) as Node<'vec2'>;
    if (!turn) return t;
    const { cos: c, sin: s } = turn;
    return vec2(c.mul(t.x).add(s.mul(t.y)), c.mul(t.y).sub(s.mul(t.x))) as unknown as Node<'vec2'>;
  };
  const tileUv = toTiles(coords);
  return {
    coords,
    tileSize,
    tileUv,
    angle,
    turn,
    grad: shared ? { dx: toTiles(shared.grad.dx), dy: toTiles(shared.grad.dy) } : null,
    getUvFrame: () => {
      const space = getSurfaceSpace(define.space);
      if (!shared) return getUvTangentFrame(tileUv, undefined, undefined, space);
      const { positionGrad: position, grad } = shared;
      const derivatives = position && {
        dpdx: position.dx,
        dpdy: position.dy,
        duvdx: grad.dx,
        duvdy: grad.dy,
      };
      return getUvTangentFrame(coords, { tileSize, turn }, derivatives, space);
    },
  };
};

/**
 * The layers' one packing (their bundles'), or a thrown error naming each layer's.
 * @internal
 */
export const checkOnePacking = (packings: TextureSetPacking[]) => {
  if (packings.some((packing) => packing !== packings[0])) {
    throw new Error(
      `[terrain] The layers sample different packings (${packings.map((p, i) => `layer${i}: ${p}`).join(', ')}): give the inputs one "packing" (createTerrainMaterial's packing).`
    );
  }
  return packings[0];
};

/** The normal's strength of a layer: the set's × the layer's `normalStrength` */
const getNormalStrength = (params: LayerParams, layer: LayerUniforms) =>
  params.normalStrength.mul(layer.normalStrength) as Node<'float'>;

/**
 * A layer's tangent normal (its slopes × the strength) through its tiling's frame, in world space:
 * planar world tiling's analytic frame, or a mesh UV's from its derivatives
 */
const getFrameNormal = (
  define: ResolvedTerrainDefine,
  uv: LayerUv,
  normalTS: Node<'vec3'>,
  strength: Node<'float'>
) => {
  const scaled = vec3(normalTS.xy.mul(strength), normalTS.z) as unknown as Node<'vec3'>;
  const frame =
    define.uv === 'MESH_UV'
      ? uv.getUvFrame()
      : getPlanarTangentFrame(uv.angle, getSurfaceSpace(define.space));
  return transformTangentNormalToWorld(scaled, frame);
};

/**
 * A layer as the graph built it: its set, uniforms, tiling and (anti-tiled, projected) sample, and
 * a projection's world normal.
 * @internal
 */
export type BuiltLayer = {
  source: LayerSource;
  uniforms: LayerUniforms;
  uv: LayerUv;
  sample: TextureSetSample;
  /** The projection's normal in world space, or null (`PLANAR`, or no normal map) */
  normal: Node<'vec3'> | null;
};

/**
 * A layer's surface from its sample (p303 D2's packings): the albedo × the set's and the layer's
 * tint (with a `DETAIL` colour map, its detail instead: the albedo over the set's average colour,
 * no tints, the colour map carrying the colour); the normal in world space, a projection's (made with the strength), else the map's
 * (`FULL`, `LITE`) through the tiling's frame (planar world tiling's analytic one, a mesh UV's
 * from its derivatives) or `MINIMAL`'s bump of its height in metres, its slope × the set's and
 * the layer's `normalStrength`; the roughness (`MINIMAL`'s 0.8) × both `roughnessScale`s, capped
 * at 1; `FULL`'s AO with the set's `aoStrength` × the material's influence. With `deferBump`
 * (slots) the bump is left to the blend: a slot's height jumps where its layer changes, so its own
 * derivatives would draw a seam; the normal is then the geometry's.
 * @internal
 */
export const getLayerSurface = (
  define: ResolvedTerrainDefine,
  layer: Pick<BuiltLayer, 'source' | 'uniforms' | 'uv' | 'sample' | 'normal'>,
  aoInfluence: () => Node<'float'>,
  deferBump = false
): LayerSurface => {
  const { source, uniforms, uv, sample, normal: projected } = layer;
  const { params } = source;
  const strength = getNormalStrength(params, uniforms);
  let normal: Node<'vec3'> | null = null;
  let bumpHeight: Node<'float'> | null = null;
  if (projected) {
    normal = projected;
  } else if (sample.normalTS) {
    normal = getFrameNormal(define, uv, sample.normalTS, strength);
  } else {
    bumpHeight = sample.height.mul(params.heightScale).mul(strength) as Node<'float'>;
    normal = deferBump
      ? (vec3(0, 0, 0) as unknown as Node<'vec3'>)
      : bumpNormalWorld(bumpHeight, getSurfaceSpace(define.space));
  }
  const roughness = (sample.roughness ?? float(MINIMAL_ROUGHNESS))
    .mul(params.roughnessScale)
    .mul(uniforms.roughnessScale)
    .min(1) as Node<'float'>;
  const aoStrength = params.aoStrength;
  const albedo =
    define.colorMap?.mode === 'DETAIL'
      ? getLayerDetail(
          sample.albedo,
          existsOrThrow(params.averageColor, "A DETAIL layer's set has an average colour.")
        )
      : (sample.albedo.mul(params.tint).mul(uniforms.tint) as Node<'vec3'>);
  return {
    albedo,
    normal,
    roughness,
    ao: sample.ao
      ? (mix(float(1), sample.ao, aoStrength.mul(aoInfluence())) as Node<'float'>)
      : null,
    bumpHeight,
  };
};

/**
 * The layers' surfaces blended by their weights (which sum to 1): the normal renormalized; with
 * `bumpBlended` (slots whose normals bump), the blended height bumped instead, in the space.
 * @internal
 */
export const blendSurfaces = (
  surfaces: LayerSurface[],
  weights: Node<'float'>[],
  bumpBlended = false,
  space: SurfaceSpace = getSurfaceSpace()
): LayerSurface => {
  const sum = <T extends Node<'float'> | Node<'vec3'>>(pick: (surface: LayerSurface) => T) =>
    surfaces
      .map((surface, i) => pick(surface).mul(weights[i]) as unknown as T)
      .reduce((total, value) => total.add(value) as unknown as T);
  const [first] = surfaces;
  const bumpHeight =
    bumpBlended && first.bumpHeight ? sum((surface) => surface.bumpHeight as Node<'float'>) : null;
  return {
    albedo: sum((surface) => surface.albedo),
    normal: bumpHeight
      ? bumpNormalWorld(bumpHeight, space)
      : (sum((surface) => surface.normal).normalize() as Node<'vec3'>),
    roughness: sum((surface) => surface.roughness),
    // One packing: every layer has texture AO or none has
    ao: first.ao ? sum((surface) => surface.ao as Node<'float'>) : null,
    bumpHeight,
  };
};

/**
 * A layer's sample: with its anti-tiling at its tiling UV (`PLANAR`), on its projection's planes
 * with their normals met with the geometry's, or with a slope gate both: the planar tap (its
 * normal through the planar frame) and the projection in a branch past the gate's first slope.
 * @internal
 */
export const sampleLayer = (
  define: ResolvedTerrainDefine,
  layer: Pick<BuiltLayer, 'source' | 'uniforms' | 'uv'>,
  antiTiling: AntiTilingContext,
  getProjectionContext: () => ProjectionContext
): Pick<BuiltLayer, 'sample' | 'normal'> => {
  const { source, uniforms, uv } = layer;
  const { projection } = uniforms;
  const sampleAtUv = () =>
    sampleAntiTiled(source.bundle, uv.tileUv, uniforms.antiTiling, antiTiling);
  if (projection.mode === 'PLANAR') return { sample: sampleAtUv(), normal: null };
  const projected: ProjectedLayer = {
    bundle: source.bundle,
    projection,
    tiling: { tileSize: uv.tileSize, turn: uv.turn },
    strength: getNormalStrength(source.params, uniforms),
    antiTiling: uniforms.antiTiling,
    antiTilingContext: antiTiling,
  };
  if (!projection.slopeGate) return sampleProjected(projected, getProjectionContext());
  const sample = sampleAtUv();
  const normal = sample.normalTS
    ? getFrameNormal(define, uv, sample.normalTS, projected.strength)
    : null;
  return sampleSlopeGated(projected, { sample, normal }, getProjectionContext());
};
