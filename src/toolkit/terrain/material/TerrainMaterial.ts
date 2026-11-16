// The terrain material generator (p305): one `MeshStandardNodeMaterial` graph built from a
// declarative config, every technique a build-time branch on its static define (D2's outline:
// coordinates → weights → per-layer samples → surface → sockets). Two routes reach the same
// `setupTerrainMaterial`: the code route (`createTerrainMaterial`, registered as `aek.terrain`) and
// the JSON route (`materials/terrain/terrain.tsl.ts`, whose `setup` it is).
import {
  color,
  float,
  mix,
  positionView,
  positionWorld,
  uniform,
  uv as meshUv,
  vec2,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import {
  Vector2,
  type MeshStandardNodeMaterial,
  type Node,
  type NodeMaterial,
  type TextureNode,
} from 'three/webgpu';
import {
  createMaterial,
  existsOrThrow,
  getMaterial,
  getMaterialVariant,
  IS_DEBUG_ENV,
  lwarn,
  registerTslMaterial,
  type MatProps,
  type TslMaterialFns,
} from 'aekasha';
import type { TextureSetInput } from 'aekasha/texturesets';
import { sampleAntiTiled, type AntiTilingNodes } from '../nodes/AntiTiling';
import { fadeDetailNormal } from '../nodes/Distance';
import { blendWeightsByHeight, getBlendHeight, normalizeWeights } from '../nodes/HeightBlend';
import { applyMacroVariation, sampleMacroTexture, type MacroNodes } from '../nodes/Macro';
import type { TextureSetSample } from '../nodes/SampleTextureSet';
import {
  bumpNormalWorld,
  getPlanarTangentFrame,
  getUvTangentFrame,
  transformTangentNormalToWorld,
  transformWorldNormalToView,
} from '../nodes/TerrainNormals';
import { getSplatMapWeights, getVertexColorWeights, type PaintedWeights } from '../nodes/Weights';
import {
  getTerrainInputs,
  readLayerBundles,
  readMacroTexture,
  readSplatMaps,
} from './TerrainInputs';
import {
  readTerrainDefine,
  type ResolvedTerrainDefine,
  type TerrainAntiTilingDefine,
} from './TerrainDefine';
import type { TerrainDebugView, TerrainDebugViewContext } from '../debug/_dbg__DebugViews';
import { getLoadedTerrainDebugViews, loadTerrainDebugViewsAsync } from './TerrainDebugViews';
import type {
  TERRAIN_QUALITY_LEVELS,
  TerrainMaterialConfig,
  TerrainMaterialDefine,
} from './TerrainMaterialConfig';

/** The id the code route registers the terrain material's functions under (`tslMaterialId`). */
export const TERRAIN_TSL_MATERIAL_ID = 'aek.terrain';

const DEG_TO_RAD = Math.PI / 180;
/** `MINIMAL`'s roughness before the scales: the packing has no roughness map (the baseline's) */
const MINIMAL_ROUGHNESS = 0.8;

/** A layer's uniforms, kept at `userData.uniforms.terrain_l<i>_<name>` */
type LayerUniforms = {
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
};

/** A layer's surface, its normal in world space: what the layers blend (one, for SINGLE) */
type LayerSurface = {
  albedo: Node<'vec3'>;
  normal: Node<'vec3'>;
  roughness: Node<'float'>;
  /** The texture AO with its influence, or null where the albedo has it baked */
  ao: Node<'float'> | null;
};

/** A material uniform kept at `userData.uniforms.terrain_<name>`, where the material editor finds it */
const keepUniform = <T>(material: NodeMaterial, name: string, node: T) => {
  const uniforms = (material.userData.uniforms ??= {}) as Record<string, unknown>;
  uniforms[`terrain_${name}`] = node;
  return node;
};

/** A layer's anti-tiling uniforms, those of its mode only */
const createAntiTilingNodes = (
  antiTiling: TerrainAntiTilingDefine,
  keep: (name: string, node: unknown) => unknown
): AntiTilingNodes => {
  if (antiTiling.mode === 'DUAL_SCALE') {
    const [from, to] = antiTiling.distance;
    return {
      mode: 'DUAL_SCALE',
      farScale: keep('farScale', uniform(antiTiling.farScale)) as Node<'float'>,
      distance: keep('antiTilingDistance', uniform(new Vector2(from, to))) as Node<'vec2'>,
    };
  }
  if (antiTiling.mode === 'HEX') {
    return {
      mode: 'HEX',
      contrast: keep('hexContrast', uniform(antiTiling.hexContrast)) as Node<'float'>,
      rotation: keep('hexRotation', uniform(antiTiling.hexRotation)) as Node<'float'>,
    };
  }
  return { mode: 'NONE' };
};

/** The macro variation's uniforms (`terrain_macro<Name>`) and its one sample */
type Macro = { nodes: MacroNodes; sample: Node<'vec4'> };

/**
 * The macro variation when the define has one: its texture (the input `macro`, which only a define
 * with `macro` takes), its uniforms and its one sample; null without
 */
const createMacro = (
  material: NodeMaterial,
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): Macro | null => {
  const macroTexture = readMacroTexture(inputs, define);
  if (!macroTexture || !define.macro) return null;
  const keep = (name: string, value: number) =>
    keepUniform(material, name, uniform(value)) as Node<'float'>;
  const nodes: MacroNodes = {
    scale: keep('macroScale', define.macro.scale),
    brightness: keep('macroBrightness', define.macro.brightness),
    hue: keep('macroHue', define.macro.hue),
    roughness: keep('macroRoughness', define.macro.roughness),
  };
  return { nodes, sample: sampleMacroTexture(macroTexture, nodes.scale) };
};

/** Makes a layer's uniforms (`terrain_l<i>_<name>`), the height blend's with it only */
const createLayerUniforms = (
  material: NodeMaterial,
  define: ResolvedTerrainDefine,
  index: number
): LayerUniforms => {
  const layer = define.layers[index];
  const keep = (name: string, node: unknown) => keepUniform(material, `l${index}_${name}`, node);
  const hasHeightBlend = define.blend.source !== 'SINGLE' && define.blend.heightBlend !== null;
  return {
    height: hasHeightBlend
      ? {
          contrast: keep('heightContrast', uniform(layer.heightContrast)) as Node<'float'>,
          offset: keep('heightOffset', uniform(layer.heightOffset)) as Node<'float'>,
        }
      : null,
    antiTiling: createAntiTilingNodes(layer.antiTiling, keep),
    tiling: keep('tiling', uniform(layer.tiling)) as Node<'float'>,
    rotation:
      layer.rotation === null ? null : (keep('rotation', uniform(layer.rotation)) as Node<'float'>),
    tint: keep('tint', uniform(color(layer.tint))) as Node<'color'>,
    normalStrength: keep('normalStrength', uniform(layer.normalStrength)) as Node<'float'>,
    roughnessScale: keep('roughnessScale', uniform(layer.roughnessScale)) as Node<'float'>,
  };
};

/** A layer's tiling: its coordinates in metres, its tile size, its UV and its turn */
type LayerUv = {
  /** The world's `(x, −z)` or the mesh's UV, metres */
  coords: Node<'vec2'>;
  /** The set's `physicalSize` × the layer's tiling, metres */
  tileSize: Node<'vec2'>;
  /** The UV sampled, in tiles */
  tileUv: Node<'vec2'>;
  /** The rotation in radians, or null for none */
  angle: Node<'float'> | null;
};

/**
 * A layer's tiling UV: the world's `(x, −z)` (seen from above, the source's orientation) or the
 * mesh's UV, over the set's tile size × the layer's tiling, turned by its rotation when it has one
 * (its angle in radians, which the planar frame turns by too)
 */
const getLayerUv = (
  define: ResolvedTerrainDefine,
  bundle: TextureSetInput,
  layer: LayerUniforms
): LayerUv => {
  const coords =
    define.uv === 'MESH_UV'
      ? (meshUv() as unknown as Node<'vec2'>)
      : (vec2(positionWorld.x, positionWorld.z.negate()) as unknown as Node<'vec2'>);
  const tileSize = (bundle.physicalSize as unknown as Node<'vec2'>).mul(layer.tiling);
  const tileUv = coords.div(tileSize) as Node<'vec2'>;
  if (!layer.rotation) return { coords, tileSize, tileUv, angle: null };
  // The pattern turns counter-clockwise from above: sample at the UV turned back
  const angle = layer.rotation.mul(DEG_TO_RAD) as Node<'float'>;
  const c = angle.cos();
  const s = angle.sin();
  const turned = vec2(c.mul(tileUv.x).add(s.mul(tileUv.y)), c.mul(tileUv.y).sub(s.mul(tileUv.x)));
  return { coords, tileSize, tileUv: turned as unknown as Node<'vec2'>, angle };
};

/** Every layer's sample in one packing, or a thrown error naming the layers' packings */
const checkOnePacking = (samples: TextureSetSample[]) => {
  const packings = samples.map((sample) => sample.packing);
  if (packings.some((packing) => packing !== packings[0])) {
    throw new Error(
      `[terrain] The layers sample different packings (${packings.map((p, i) => `layer${i}: ${p}`).join(', ')}): give the inputs one "packing" (createTerrainMaterial's packing).`
    );
  }
};

/**
 * A layer's surface from its sample (p303 D2's packings): the albedo × the set's and the layer's
 * tint; the normal in world space, the map's (`FULL`, `LITE`) through the tiling's frame (planar
 * world tiling's analytic one, a mesh UV's from its derivatives) or `MINIMAL`'s bump of its height
 * in metres, its slope × the set's and the layer's `normalStrength`; the roughness (`MINIMAL`'s
 * 0.8) × both `roughnessScale`s, capped at 1; `FULL`'s AO with the set's `aoStrength` × the
 * material's influence
 */
const getLayerSurface = (
  define: ResolvedTerrainDefine,
  bundle: TextureSetInput,
  layer: LayerUniforms,
  uv: LayerUv,
  sample: TextureSetSample,
  aoInfluence: () => Node<'float'>
): LayerSurface => {
  const strength = (bundle.normalStrength as unknown as Node<'float'>).mul(layer.normalStrength);
  let normal: Node<'vec3'>;
  if (sample.normalTS) {
    const n = sample.normalTS;
    const scaled = vec3(n.xy.mul(strength), n.z) as unknown as Node<'vec3'>;
    const frame =
      define.uv === 'MESH_UV' ? getUvTangentFrame(uv.tileUv) : getPlanarTangentFrame(uv.angle);
    normal = transformTangentNormalToWorld(scaled, frame);
  } else {
    const heightScale = bundle.heightScale as unknown as Node<'float'>;
    normal = bumpNormalWorld(sample.height.mul(heightScale).mul(strength) as Node<'float'>);
  }
  const roughness = (sample.roughness ?? float(MINIMAL_ROUGHNESS))
    .mul(bundle.roughnessScale as unknown as Node<'float'>)
    .mul(layer.roughnessScale)
    .min(1) as Node<'float'>;
  const aoStrength = bundle.aoStrength as unknown as Node<'float'>;
  return {
    albedo: sample.albedo
      .mul(bundle.tint as unknown as Node<'vec3'>)
      .mul(layer.tint) as Node<'vec3'>,
    normal,
    roughness,
    ao: sample.ao
      ? (mix(float(1), sample.ao, aoStrength.mul(aoInfluence())) as Node<'float'>)
      : null,
  };
};

/** The layers' surfaces blended by their weights (which sum to 1): the normal renormalized */
const blendSurfaces = (surfaces: LayerSurface[], weights: Node<'float'>[]): LayerSurface => {
  const sum = <T extends Node<'float'> | Node<'vec3'>>(pick: (surface: LayerSurface) => T) =>
    surfaces
      .map((surface, i) => pick(surface).mul(weights[i]) as unknown as T)
      .reduce((total, value) => total.add(value) as unknown as T);
  const [first] = surfaces;
  return {
    albedo: sum((surface) => surface.albedo),
    normal: sum((surface) => surface.normal).normalize() as Node<'vec3'>,
    roughness: sum((surface) => surface.roughness),
    // One packing: every layer has texture AO or none has
    ao: first.ao ? sum((surface) => surface.ao as Node<'float'>) : null,
  };
};

/** A layer as the graph built it: its bundle, uniforms, tiling and (anti-tiled) sample */
type BuiltLayer = {
  bundle: TextureSetInput;
  uniforms: LayerUniforms;
  uv: LayerUv;
  sample: TextureSetSample;
};

/**
 * The layers' weights of a painted source (`VERTEX_COLOR`, `SPLAT_MAP`), normalized linearly or by
 * the layers' heights (the uniform `terrain_heightBlendDepth`), and the vertex colour's AO; null
 * for `SINGLE`
 */
const getLayerWeights = (
  material: NodeMaterial,
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine,
  layers: BuiltLayer[]
): PaintedWeights | null => {
  const { blend } = define;
  // Read for every source: one without splat maps refuses a splat input
  const splatMaps = readSplatMaps(inputs, define);
  if (blend.source === 'SINGLE') return null;
  const painted =
    blend.source === 'VERTEX_COLOR'
      ? getVertexColorWeights(layers.length, blend.layout)
      : getSplatMapWeights(layers.length, splatMaps);
  if (blend.heightBlend === null) {
    return { ...painted, weights: normalizeWeights(painted.weights) };
  }
  const depth = keepUniform(material, 'heightBlendDepth', uniform(blend.heightBlend));
  const heights = layers.map(({ bundle, uniforms, sample }) => {
    const height = existsOrThrow(uniforms.height, 'A height-blended layer has height uniforms.');
    const setContrast = bundle.heightContrast as unknown as Node<'float'>;
    return getBlendHeight(sample.height, setContrast.mul(height.contrast), height.offset);
  });
  return {
    ...painted,
    weights: blendWeightsByHeight(painted.weights, heights, depth as Node<'float'>),
  };
};

/**
 * The material's `aoNode`: the blended texture AO (`FULL`) × the vertex AO (`ao.vertex`, the
 * uniform `terrain_aoVertexInfluence`: 1 for `FULL`, `ao.bakedAlbedoInfluence` where the albedo has
 * its AO baked in), or null without either
 */
const getAoNode = (
  material: NodeMaterial,
  define: ResolvedTerrainDefine,
  textureAo: Node<'float'> | null,
  painted: PaintedWeights | null,
  isAoBaked: boolean
) => {
  const vertexAo = define.aoVertex ? painted?.vertexAo : null;
  if (!vertexAo) return textureAo;
  const influence = keepUniform(
    material,
    'aoVertexInfluence',
    uniform(isAoBaked ? define.aoBakedAlbedoInfluence : 1)
  ) as Node<'float'>;
  const vertexTerm = mix(float(1), vertexAo, influence) as Node<'float'>;
  return textureAo ? (textureAo.mul(vertexTerm) as Node<'float'>) : vertexTerm;
};

/**
 * The terrain material's graph (p305 D2), the TSL `setup` both routes run: reads the static
 * define `terrain` ({@link TerrainMaterialDefine}), samples each layer's texture set input
 * (`layer0`, `layer1`, …, a `{ textureSet }` bundle each, all in one packing), weighs the layers by
 * the blend source and sets the material's sockets: the colour, the normal (each layer's in world
 * space, blended, into view space once), the roughness, metalness 0, and the AO to `aoNode`, which
 * darkens indirect light only (the texture AO of `FULL`, whose `LITE` and `MINIMAL` have it baked
 * into the albedo, and the vertex colour's). Each layer samples its set with its anti-tiling
 * (`NONE` one tap, `DUAL_SCALE` two, `HEX` three). The blend source: `SINGLE` one layer;
 * `VERTEX_COLOR` the mesh's colour attribute; `SPLAT_MAP` the splat maps `splat0` (layers 1-4) and
 * `splat1` (5-8) at the mesh's UV; layer 0 takes what the channels leave; `blend.mode` `HEIGHT`
 * (default) lets the layers' heights decide the borders, `LINEAR` the weights alone. With `macro`,
 * one fetch of the input `macro` at the world's XZ varies the surface (R the brightness, G the hue
 * and the roughness, B `DUAL_SCALE`'s patches); with `distance`, the normal fades to the
 * geometry's over its `fade` range. Only what the define enables is built. The tunables are
 * uniforms in `material.userData.uniforms`: per layer `terrain_l<i>_<name>` (`tiling`, `rotation`
 * when given, `tint`, `normalStrength`, `roughnessScale`; `heightContrast` and `heightOffset` with
 * the height blend; `farScale` and `antiTilingDistance` with `DUAL_SCALE`, `hexContrast` and
 * `hexRotation` with `HEX`), `terrain_heightBlendDepth` with the height blend,
 * `terrain_aoTextureInfluence` when a layer has texture AO, `terrain_aoVertexInfluence` with
 * `ao.vertex`, `terrain_macroScale`, `terrain_macroBrightness`, `terrain_macroHue` and
 * `terrain_macroRoughness` with `macro`, and `terrain_distanceFade` with `distance`. A
 * `qualityLevel` applies that tier's `quality` overrides first; a `debugView` (debug env, once
 * {@link loadTerrainDebugViewsAsync} has loaded the views) replaces the shading with the view. The
 * define as given is kept at `material.userData.terrainDefine`.
 * @param inputs the material's inputs: `layer<i>` bundles (the `textureSets()` feature's
 * resolver), with `SPLAT_MAP` the splat maps `splat<i>` and with `macro` the macro texture `macro`
 * (texture nodes: `{ "texture": id }`)
 * @param material the node material being built (a `STANDARDNODEMATERIAL`)
 * @param staticDefines the material's static defines, `terrain` among them
 * @throws for a missing or wrong define field, a field it doesn't know, a layer count the blend
 * source doesn't take, a missing layer, splat map or macro input (or one the define doesn't
 * take), or layers in different packings
 * @example
 * ```ts
 * // A TSL file of a material JSON whose staticDefines.terrain is the define
 * import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';
 *
 * export const setup = setupTerrainMaterial;
 * ```
 */
export const setupTerrainMaterial = (
  inputs: Record<string, unknown>,
  material: NodeMaterial,
  staticDefines: Record<string, unknown>
) => {
  const define = readTerrainDefine(staticDefines);
  const bundles = readLayerBundles(inputs, define);
  const standard = material as MeshStandardNodeMaterial;
  // As given, for a tier's or a view's variant of this material (getTerrainMaterialVariant)
  material.userData.terrainDefine = staticDefines.terrain;

  // Made on the first layer with texture AO: none without one
  let aoInfluence: Node<'float'> | null = null;
  const getAoInfluence = () =>
    (aoInfluence ??= keepUniform(
      material,
      'aoTextureInfluence',
      uniform(define.aoTextureInfluence)
    ) as Node<'float'>);

  // Shared by every layer, built before any of them: the view distance and the one macro fetch
  const viewDistance = positionView.length() as unknown as Node<'float'>;
  const macro = createMacro(material, inputs, define);
  const layers: BuiltLayer[] = define.layers.map((_, i) => {
    const bundle = bundles[i];
    const uniforms = createLayerUniforms(material, define, i);
    const uv = getLayerUv(define, bundle, uniforms);
    const sample = sampleAntiTiled(bundle, uv.tileUv, uniforms.antiTiling, {
      viewDistance,
      patches: macro ? (macro.sample.b as unknown as Node<'float'>) : null,
      seed: i,
    });
    return { bundle, uniforms, uv, sample };
  });
  checkOnePacking(layers.map((layer) => layer.sample));
  const surfaces = layers.map(({ bundle, uniforms, uv, sample }) =>
    getLayerSurface(define, bundle, uniforms, uv, sample, getAoInfluence)
  );

  // The layers blended by their weights (SINGLE: the one layer), then the material-wide effects
  const painted = getLayerWeights(material, inputs, define, layers);
  const surface = painted ? blendSurfaces(surfaces, painted.weights) : surfaces[0];
  const { albedo, roughness } = macro
    ? applyMacroVariation(surface, macro.sample, macro.nodes)
    : surface;
  const normal = define.distanceFade
    ? fadeDetailNormal(
        surface.normal,
        viewDistance,
        keepUniform(
          material,
          'distanceFade',
          uniform(new Vector2(...define.distanceFade))
        ) as Node<'vec2'>
      )
    : surface.normal;
  standard.colorNode = albedo;
  standard.normalNode = transformWorldNormalToView(normal);
  standard.roughnessNode = roughness;
  standard.metalnessNode = float(0);
  const ao = getAoNode(material, define, surface.ao, painted, layers[0].sample.isAoBaked);
  if (ao) standard.aoNode = ao;

  if (IS_DEBUG_ENV && define.debugView) {
    const [{ bundle, uv }] = layers;
    applyDebugView(standard, define.debugView, {
      coords: uv.coords,
      tileSize: uv.tileSize,
      colorTexture: (bundle.albedoRough ?? bundle.albedoHeight) as unknown as TextureNode,
      normal,
    });
  }
};

/**
 * A debug view over the material's sockets, when the views are loaded; else the load starts and
 * the material builds without it (warned): the graph can't wait for a module
 */
const applyDebugView = (
  material: MeshStandardNodeMaterial,
  view: TerrainDebugView,
  ctx: TerrainDebugViewContext
) => {
  const views = getLoadedTerrainDebugViews();
  if (views) {
    views.applyTerrainDebugView(material, view, ctx);
    return;
  }
  void loadTerrainDebugViewsAsync();
  lwarn(
    `[terrain] Material "${String(material.userData.id ?? material.name)}" asks for the debug view ${view}, but the views aren't loaded: await loadTerrainDebugViewsAsync() before creating it. It builds without the view.`
  );
};

/** The terrain material's TSL functions, as the code route registers them */
const terrainMaterialFns = { setup: setupTerrainMaterial } satisfies TslMaterialFns;

/**
 * The config's static define: no id, no packing, no layer sets, no splat maps and no macro texture
 * (the inputs carry them)
 */
const getTerrainDefine = (config: TerrainMaterialConfig): TerrainMaterialDefine => {
  const { id: _id, packing: _packing, splatMaps: _splatMaps, layers, macro, ...rest } = config;
  const define: TerrainMaterialDefine = {
    ...rest,
    layers: layers.map(({ set: _set, ...settings }) => settings),
  };
  if (macro) {
    const { texture: _texture, ...settings } = macro;
    define.macro = settings;
  }
  return define;
};

/**
 * The material props {@link createTerrainMaterial} creates from a config: a
 * `STANDARDNODEMATERIAL` of the registered `aek.terrain` functions, the config as the static
 * define `terrain` (without the id, the layers' sets, the splat maps and the macro texture), each
 * layer's set as its input `layer<i>` (`{ textureSet, packing? }`), the splat maps as the inputs
 * `splat<i>` and the macro texture as the input `macro` (`{ texture }`). Pass them to `ensureMaterialDependencies` to load the textures before creating
 * the material, or use them as a material JSON's fields.
 * @returns the props, for `createMaterial` or `ensureMaterialDependencies`
 * @example
 * ```ts
 * import { ensureMaterialDependencies } from 'aekasha';
 * import {
 *   createTerrainMaterial,
 *   getTerrainMaterialProps,
 *   type TerrainMaterialConfig,
 * } from 'aekasha/toolkit/terrain';
 *
 * // The scene doesn't list grass01: load its textures first
 * const config: TerrainMaterialConfig = { id: 'meadow', layers: [{ set: 'grass01' }] };
 * await ensureMaterialDependencies(getTerrainMaterialProps(config));
 * const meadow = createTerrainMaterial(config);
 * ```
 */
export const getTerrainMaterialProps = (
  config: TerrainMaterialConfig
): Extract<MatProps, { type: 'STANDARDNODEMATERIAL' }> => ({
  id: config.id,
  type: 'STANDARDNODEMATERIAL',
  tslMaterialId: TERRAIN_TSL_MATERIAL_ID,
  staticDefines: { terrain: getTerrainDefine(config) },
  inputs: getTerrainInputs(config),
});

/**
 * Creates a terrain material from a config (p305): one `MeshStandardNodeMaterial` whose graph has
 * only what the config enables, registered under the config's id (an id already registered
 * returns that material, as `createMaterial` does). Its layers' texture sets must be loaded: a
 * scene that lists them (`textureSets`) has them, else await `ensureMaterialDependencies` with
 * {@link getTerrainMaterialProps}' props first (a missing texture samples white, warned).
 * Variants (`getMaterialVariant`) swap a layer's set through `inputs.layer<i>` without another
 * shader. Needs the `textureSets()` feature.
 * @param config the layers' texture sets and settings, and the techniques to compile
 * @returns the registered material
 * @throws for a config the graph refuses (see {@link setupTerrainMaterial})
 * @example
 * ```ts
 * import { createMeshEntity } from 'aekasha';
 * import { createTerrainMaterial } from 'aekasha/toolkit/terrain';
 *
 * // One grass layer tiled at the world's XZ, its tiles 1.5 × the set's size, a little warmer
 * const meadow = createTerrainMaterial({
 *   id: 'meadow',
 *   layers: [{ set: 'grass01', tiling: 1.5, tint: '#fff4e0' }],
 * });
 * createMeshEntity({ geo: 'meadowBlock', mat: meadow });
 * ```
 */
export const createTerrainMaterial = (config: TerrainMaterialConfig) => {
  registerTslMaterial(TERRAIN_TSL_MATERIAL_ID, terrainMaterialFns);
  return createMaterial(getTerrainMaterialProps(config)) as MeshStandardNodeMaterial;
};

/** A quality tier of a terrain material's `quality` table: `LOW`, `MEDIUM`, `HIGH` or `ULTRA`. */
export type TerrainQualityLevel = (typeof TERRAIN_QUALITY_LEVELS)[number];

/**
 * A terrain material's variant at a quality tier (p305 D10): `getMaterialVariant` with the
 * material's own define and the tier as its `qualityLevel`, so the tier's `quality` overrides
 * apply over its fields and the tier is its own shader (one per tier used, shared by every caller).
 * Pass the material whose define has the `quality` table (the base, or a block's variant of it):
 * a variant from this call already has a tier, which another call replaces.
 * @param id a terrain material's id (`createTerrainMaterial`'s, a JSON route's, or a variant's)
 * @param level the tier whose `quality` overrides apply
 * @returns the tier's material, cached per material and tier
 * @throws for an id that isn't registered or isn't a terrain material
 * @example
 * ```ts
 * import { createTerrainMaterial, getTerrainMaterialVariant } from 'aekasha/toolkit/terrain';
 *
 * createTerrainMaterial({
 *   id: 'canyon',
 *   layers: [{ set: 'cliffs01' }],
 *   quality: { LOW: { ao: { textureInfluence: 0 } } },
 * });
 * // The low tier, its own shader
 * const canyonLow = getTerrainMaterialVariant('canyon', 'LOW');
 * ```
 */
export const getTerrainMaterialVariant = (id: string, level: TerrainQualityLevel) => {
  const material = existsOrThrow(
    getMaterial(id),
    `[terrain] getTerrainMaterialVariant: no material "${id}".`
  );
  const define = material.userData.terrainDefine as Record<string, unknown> | undefined;
  if (!define) {
    throw new Error(
      `[terrain] getTerrainMaterialVariant: material "${id}" isn't a terrain material (no terrain define).`
    );
  }
  return getMaterialVariant(id, {
    staticDefines: { terrain: { ...define, qualityLevel: level } },
  }) as MeshStandardNodeMaterial;
};
