// The terrain material generator (p305): one `MeshStandardNodeMaterial` graph built from a
// declarative config, every technique a build-time branch on its static define (D2's outline:
// coordinates → weights → per-layer samples → surface → sockets). Two routes reach the same
// `setupTerrainMaterial`: the code route (`createTerrainMaterial`, registered as `aek.terrain`) and
// the JSON route (`materials/terrain/terrain.tsl.ts`, whose `setup` it is). The near surface is
// `TerrainSurface.ts`' (its layers `TerrainLayers.ts`', each at its own index, or a few slots at the
// layers weighing most at the pixel, `TerrainSlots.ts`: sparse sampling, `DOMINANT`); with a far
// mode it's built in a branch the far surface skips (`TerrainFar.ts`).
import { float, mix, positionView, uniform } from 'three/tsl';
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
import { sampleColorMap } from '../nodes/ColorMap';
import { fadeDetailNormal, getFarShare } from '../nodes/Distance';
import { normalizeWeights } from '../nodes/HeightBlend';
import { applyMacroVariation, sampleMacroTexture, type MacroNodes } from '../nodes/Macro';
import { createProjectionContext, type ProjectionContext } from '../nodes/Projection';
import { applyRules, createRuleContext, createRuleNodes } from '../nodes/Rules';
import { getBundlePacking } from '../nodes/SampleTextureSet';
import { spreadSlotWeights } from '../nodes/Sparse';
import { bumpNormalWorld, transformWorldNormalToView } from '../nodes/TerrainNormals';
import { getSplatMapWeights, getVertexColorWeights, type PaintedWeights } from '../nodes/Weights';
import {
  getTerrainDefine,
  getTerrainInputs,
  readLayerSources,
  readColorMapTexture,
  readMacroTexture,
  readSplatMaps,
  type LayerParams,
} from './TerrainInputs';
import {
  buildFarBranch,
  createBranchCoords,
  getFarSurface,
  type BranchSurface,
} from './TerrainFar';
import {
  checkOnePacking,
  createLayerUniforms,
  keepUniform,
  type LayerUniforms,
} from './TerrainLayers';
import { checkTextureBudget, type TerrainBinding } from './TerrainStorage';
import { buildNearSurface, createSurfaceUniforms, type NearSurface } from './TerrainSurface';
import {
  getPaintedLayerCount,
  getPaintedSource,
  readTerrainDefine,
  type ResolvedTerrainDefine,
} from './TerrainDefine';
import type { TerrainDebugView, TerrainDebugViewContext } from '../debug/_dbg__DebugViews';
import { getLoadedTerrainDebugViews, loadTerrainDebugViewsAsync } from './TerrainDebugViews';
import type { TERRAIN_QUALITY_LEVELS, TerrainMaterialConfig } from './TerrainMaterialConfig';

/** The id the code route registers the terrain material's functions under (`tslMaterialId`). */
export const TERRAIN_TSL_MATERIAL_ID = 'aek.terrain';

/** The macro variation's uniforms (`terrain_macro<Name>`) and its one sample */
type Macro = { nodes: MacroNodes; sample: Node<'vec4'> };

/**
 * The macro variation when the define has one: its uniforms and its one sample of the macro
 * texture (the input `macro`); null without
 */
const createMacro = (
  material: NodeMaterial,
  macroTexture: TextureNode | null,
  define: ResolvedTerrainDefine
): Macro | null => {
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

/**
 * The distance's uniforms: the detail normals' fade (`terrain_distanceFade`, the far surface's
 * start its end) and the far surface's band (`terrain_farBlend`, with a far mode), null without
 */
const createDistanceUniforms = (material: NodeMaterial, define: ResolvedTerrainDefine) => ({
  fade: define.distanceFade
    ? (keepUniform(
        material,
        'distanceFade',
        uniform(new Vector2(...define.distanceFade))
      ) as Node<'vec2'>)
    : null,
  farBlend: define.far
    ? (keepUniform(material, 'farBlend', uniform(define.far.blend)) as Node<'float'>)
    : null,
});

/**
 * What the material binds: the layers' textures, the splat maps, the macro texture (the macro
 * variation's and the rules' noise's) and the colour map
 */
const getBindings = (
  layerBindings: TerrainBinding[],
  splatMaps: TextureNode[],
  hasMacro: boolean,
  hasColorMap: boolean
): TerrainBinding[] => [
  ...layerBindings,
  ...(splatMaps.length ? [{ name: 'splat maps', count: splatMaps.length }] : []),
  ...(hasMacro ? [{ name: 'macro', count: 1 }] : []),
  ...(hasColorMap ? [{ name: 'colour map', count: 1 }] : []),
];

/**
 * The incoming weights before the rules: the paint's for its layers (the vertex colour or the
 * splat maps, from layer 0) and 0 for the rest, or the base layer alone (`RULES`); and the vertex
 * colour's AO
 */
const getIncomingWeights = (
  define: ResolvedTerrainDefine,
  splatMaps: TextureNode[]
): PaintedWeights => {
  const { blend } = define;
  const count = define.layers.length;
  const zero = float(0) as unknown as Node<'float'>;
  const paintedCount = getPaintedLayerCount(blend, count);
  let painted: PaintedWeights;
  if (blend.source !== 'SINGLE' && 'layout' in blend) {
    painted = getVertexColorWeights(paintedCount, blend.layout);
  } else if (getPaintedSource(blend) === 'SPLAT_MAP') {
    painted = getSplatMapWeights(paintedCount, splatMaps);
  } else {
    painted = { weights: [float(1) as unknown as Node<'float'>], vertexAo: null };
  }
  const rest = Array.from({ length: count - painted.weights.length }, () => zero);
  return { ...painted, weights: [...painted.weights, ...rest] };
};

/**
 * The layers' raw weights of a blend past `SINGLE`: the paint's or the base layer's, the rules (the
 * uniforms `terrain_r<i>_<name>`) composited over them in order, not yet normalized; and the
 * vertex colour's AO. Null for `SINGLE`
 */
const getRawWeights = (
  material: NodeMaterial,
  define: ResolvedTerrainDefine,
  splatMaps: TextureNode[],
  macroTexture: TextureNode | null
): PaintedWeights | null => {
  const { blend } = define;
  if (blend.source === 'SINGLE') return null;
  const incoming = getIncomingWeights(define, splatMaps);
  const rules = blend.rules.map((rule, i) =>
    createRuleNodes(rule, (name, node) => keepUniform(material, `r${i}_${name}`, node))
  );
  if (!rules.length) return incoming;
  return {
    ...incoming,
    weights: applyRules(incoming.weights, rules, createRuleContext(macroTexture)),
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
 * define `terrain` ({@link TerrainMaterialDefine}), samples each layer's texture set (`SEPARATE`:
 * the inputs `layer0`, `layer1`, …, a `{ textureSet }` bundle each; `ARRAY`: the input `layers`,
 * one `{ textureSetArray }` bundle whose layer `i` is layer `i`; one packing), weighs the layers by
 * the blend source and sets the material's sockets: the colour, the normal (each layer's in world
 * space, blended, into view space once), the roughness, metalness 0, and the AO to `aoNode`, which
 * darkens indirect light only (the texture AO of `FULL`, whose `LITE` and `MINIMAL` have it baked
 * into the albedo, and the vertex colour's). Each layer samples its set with its anti-tiling
 * (`NONE` one tap, `DUAL_SCALE` two, `HEX` three) on its projection's planes (`PLANAR` the
 * tiling's coordinates alone; `BIPLANAR` the two world planes the surface faces most, chosen per
 * pixel; `TRIPLANAR` all three; the planes' normal maps met with the geometry's by `normalBlend`,
 * a projecting mode needing `uv` `WORLD`; with `slopeGate`, planar under its first slope and the
 * projection, in a dynamic branch, past it). The blend source: `SINGLE` one layer;
 * `VERTEX_COLOR` the mesh's colour attribute; `SPLAT_MAP` the splat maps `splat0` (layers 1-4) and
 * `splat1` (5-8) at the mesh's UV; layer 0 takes what the channels leave; `RULES` the base layer
 * under the rules, `VERTEX_COLOR_AND_RULES` and `SPLAT_MAP_AND_RULES` the paint under them (each
 * rule lays its layer over the weights so far where the geometry's slope, the world height and
 * the facing are in its ranges, its coverage moved by a channel of the input `macro`, one fetch a
 * rule with noise); `blend.mode` `HEIGHT` (default) lets the layers' heights decide the borders,
 * `LINEAR` the weights alone. With `sparse` (fewer layers kept than there are) or `HEX`'s
 * `apply: 'DOMINANT'`, the layers are sampled in slots: at each pixel the layers weighing most,
 * sorted (sparse's `maxLayers` of them, else all), each read from the `ARRAY` input at its layer,
 * their weights renormalized (the height blend among them); `DOMINANT` samples `HEX` in the first
 * slot and `DUAL_SCALE` in the others. With `macro`, one fetch of the input `macro` at the world's
 * XZ varies the surface (R the brightness, G the hue and the roughness, B `DUAL_SCALE`'s patches);
 * with a `DETAIL` `colorMap`, the input `colorMap` at the mesh's UV gives the albedo and the layers
 * their detail (each one's albedo over its set's average colour, no tints), faded out over
 * `detailDistance`; with `distance`, the normal fades to the geometry's over its `fade` range, and
 * with a `far` mode the layers aren't sampled past it (a dynamic branch): the far surface is the
 * sets' average colours by the weights (`AVERAGE_COLOR`) or the colour map (`COLOR_MAP`), mixed in
 * over `farBlend` metres, its normal the geometry's (a `debugView` shows the near surface
 * everywhere). Only what the define enables is built. The textures it binds (the layers', the splat
 * maps, the macro texture, the colour map) must fit the budget: the renderer's sampled textures a
 * stage (16) less `reservedTextures` (6). The tunables are uniforms in
 * `material.userData.uniforms`: per layer `terrain_l<i>_<name>` (`tiling`, `rotation` when given,
 * `tint`, `normalStrength`, `roughnessScale`; `heightContrast` and `heightOffset` with the height
 * blend; `farScale` and `antiTilingDistance` with `DUAL_SCALE` or `DOMINANT` in slots,
 * `hexContrast` and `hexRotation` with `HEX`; `projectionSharpness` with `BIPLANAR` or `TRIPLANAR`,
 * `slopeGate` with a gate), per rule `terrain_r<i>_<name>` (its tests' only: `slopeMin`,
 * `slopeMax`, `slopeSoftness`, `heightMin`, `heightMax`, `heightSoftness`, a range's given ends
 * only; `aspectDirection`, `aspectRange`, `aspectSoftness`; `noiseScale`, `noiseAmount`; and
 * `strength`), `terrain_heightBlendDepth` with the height blend, `terrain_aoTextureInfluence` when
 * a layer has texture AO, `terrain_aoVertexInfluence` with `ao.vertex`, `terrain_macroScale`,
 * `terrain_macroBrightness`, `terrain_macroHue` and `terrain_macroRoughness` with `macro`,
 * `terrain_detailDistance` with a colour map's `detailDistance`, `terrain_distanceFade` with
 * `distance`, and `terrain_farBlend` with a far mode. A `qualityLevel` applies that tier's
 * `quality` overrides first; a `debugView` (debug env, once {@link loadTerrainDebugViewsAsync} has
 * loaded the views) replaces the shading with the view. The define as given is kept at
 * `material.userData.terrainDefine`.
 * @param inputs the material's inputs: `layer<i>` bundles or the `layers` set array bundle (the
 * `textureSets()` feature's resolvers), with the splat map sources the splat maps `splat<i>` and
 * with `macro` or a rule's noise the macro texture `macro`, with `colorMap` the colour map
 * `colorMap` (texture nodes: `{ "texture": id }`)
 * @param material the node material being built (a `STANDARDNODEMATERIAL`)
 * @param staticDefines the material's static defines, `terrain` among them
 * @throws for a missing or wrong define field, a field it doesn't know, a layer count the blend
 * source doesn't take, a missing layer, splat map or macro input (or one the define doesn't
 * take), a layer's set without an average colour that a `DETAIL` colour map or the `AVERAGE_COLOR`
 * far surface reads, `layer<i>` and `layers` both, a set array of another layer count, layers in
 * different packings, slots (sparse, `DOMINANT`) without the `layers` set array, or textures over
 * the budget (naming what it binds)
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
  materialInputs.set(material, inputs);
  buildTerrainGraph(inputs, material, staticDefines);
};

/**
 * The inputs each terrain material was built from (its resolved bundles and texture nodes), for a
 * bake of its surface (`bakeTerrainColorMap`): a material doesn't keep them, and `userData` is
 * cloned as JSON
 */
const materialInputs = new WeakMap<NodeMaterial, Record<string, unknown>>();

/**
 * The resolved inputs a terrain material was built from, or undefined for a material that isn't
 * one.
 * @internal
 */
export const getTerrainMaterialInputs = (material: NodeMaterial) => materialInputs.get(material);

/**
 * The terrain material's graph ({@link setupTerrainMaterial}'s), with what a bake overrides: the
 * view distance (default the camera's), which a bake's camera at the origin can't give.
 * @internal
 */
export const buildTerrainGraph = (
  inputs: Record<string, unknown>,
  material: NodeMaterial,
  staticDefines: Record<string, unknown>,
  opts: { viewDistance?: Node<'float'> } = {}
) => {
  const define = readTerrainDefine(staticDefines);
  const sources = readLayerSources(inputs, define);
  // Read for every source: one without splat maps refuses a splat input, and a define that takes
  // no macro texture the macro input
  const splatMaps = readSplatMaps(inputs, define);
  const macroTexture = readMacroTexture(inputs, define);
  const colorMapTexture = readColorMapTexture(inputs, define);
  checkTextureBudget(
    getBindings(sources.bindings, splatMaps, macroTexture !== null, colorMapTexture !== null),
    define.reservedTextures,
    sources.isArray
  );
  const standard = material as MeshStandardNodeMaterial;
  // As given, for a tier's or a view's variant of this material (getTerrainMaterialVariant)
  material.userData.terrainDefine = staticDefines.terrain;
  // From the bundles' slots, before anything samples: the far branch's members depend on it
  const packing = checkOnePacking(sources.layers.map(({ bundle }) => getBundlePacking(bundle)));

  // Made before the layers: every uniform (a far branch builds them late), the view distance, the
  // one macro fetch, the colour map's, the raw weights (the paint, the rules' noise)
  const surfaceUniforms = createSurfaceUniforms(material, define, packing);
  const distance = createDistanceUniforms(material, define);
  const viewDistance = opts.viewDistance ?? (positionView.length() as unknown as Node<'float'>);
  const macro = createMacro(material, macroTexture, define);
  const patches = macro ? (macro.sample.b as unknown as Node<'float'>) : null;
  const colorMap =
    colorMapTexture && (define.colorMap?.mode === 'DETAIL' || define.far?.mode === 'COLOR_MAP')
      ? sampleColorMap(colorMapTexture)
      : null;
  const detailColorMap = define.colorMap?.mode === 'DETAIL' ? colorMap : null;
  const uniforms = define.layers.map((_, i) => createLayerUniforms(material, define, i));
  const raw = getRawWeights(material, define, splatMaps, macroTexture);
  const layerContext = { define, sources, uniforms };

  // A far mode skips the layers past its band (a dynamic branch); a debug view shows the near
  // surface everywhere (its views read the layers)
  let near: NearSurface | null = null;
  let surface: BranchSurface;
  if (distance.fade && distance.farBlend && !(IS_DEBUG_ENV && define.debugView)) {
    const layers = sources.layers.map(({ params }, i) => ({ params, uniforms: uniforms[i] }));
    surface = buildFarBranch({
      packing,
      from: distance.fade.y,
      blend: distance.farBlend,
      inputs: {
        weights: raw?.weights ?? null,
        viewDistance,
        patches,
        colorMap,
        ...createBranchCoords(define),
      },
      getFar: (inputs) => getFarSurface(define, layers, inputs),
      buildNear: (inputs) =>
        buildNearSurface(
          {
            ...layerContext,
            viewDistance: inputs.viewDistance,
            patches: inputs.patches,
            getProjectionContext: () => inputs.projection,
            shared: inputs.shared,
          },
          inputs.weights,
          {
            uniforms: surfaceUniforms,
            colorMap: detailColorMap && inputs.colorMap,
            deferBump: true,
          }
        ).surface,
    });
  } else {
    // Made on the first projected layer: the projections' position, derivatives and normal
    let projection: ProjectionContext | null = null;
    const getProjectionContext = () => (projection ??= createProjectionContext());
    near = buildNearSurface(
      { ...layerContext, viewDistance, patches, getProjectionContext },
      raw?.weights ?? null,
      { uniforms: surfaceUniforms, colorMap: detailColorMap, deferBump: false }
    );
    surface = near.surface;
  }

  // The material-wide effects over the blended surface, the normal into view space once
  const { albedo, roughness } = macro
    ? applyMacroVariation(surface, macro.sample, macro.nodes)
    : surface;
  const shaded =
    surface.normal ??
    bumpNormalWorld(existsOrThrow(surface.bumpHeight, 'A surface without a normal has a bump.'));
  const normal = distance.fade ? fadeDetailNormal(shaded, viewDistance, distance.fade) : shaded;
  standard.colorNode = albedo;
  standard.normalNode = transformWorldNormalToView(normal);
  standard.roughnessNode = roughness;
  standard.metalnessNode = float(0);
  const ao = getAoNode(material, define, surface.ao, raw, packing !== 'FULL');
  if (ao) standard.aoNode = ao;

  if (IS_DEBUG_ENV && define.debugView && near) {
    const { layers, weights, slots } = near;
    // Per layer: a slot's weight goes to the layer kept there
    const layerWeights =
      weights && slots ? spreadSlotWeights(slots, weights, define.layers.length) : weights;
    applyDebugView(standard, define.debugView, {
      coords: layers[0].uv.coords,
      layers: sources.layers.map(({ bundle, params }, i) => ({
        tileSize: slots ? getDebugTileSize(params, uniforms[i]) : layers[i].uv.tileSize,
        colorTexture: (bundle.albedoRough ?? bundle.albedoHeight) as unknown as TextureNode,
        projection: uniforms[i].projection,
      })),
      weights: layerWeights,
      sampled: layers.map(({ uniforms: { antiTiling, projection } }) => ({
        antiTiling: antiTiling.mode,
        projection,
      })),
      slots:
        slots && raw ? { count: slots.length, layerWeights: normalizeWeights(raw.weights) } : null,
      far:
        distance.fade && distance.farBlend
          ? { share: getFarShare(viewDistance, distance.fade.y, distance.farBlend) }
          : null,
      normal,
      define,
      packing,
    });
  }
};

/**
 * A layer's tile size in metres for the debug views, which read it per layer: the set's
 * `physicalSize` × its tiling (a slot's is the kept layer's)
 */
const getDebugTileSize = (params: LayerParams, uniforms: LayerUniforms) =>
  params.physicalSize.mul(uniforms.tiling) as Node<'vec2'>;

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
 * The material props {@link createTerrainMaterial} creates from a config: a
 * `STANDARDNODEMATERIAL` of the registered `aek.terrain` functions, the config as the static define
 * `terrain` (without the id, the layers' sets, the splat maps, the macro texture and the colour
 * map), each layer's set as its input `layer<i>` (`{ textureSet, packing? }`), the splat maps as
 * the inputs `splat<i>`, the macro texture as the input `macro` (`{ texture }`: `macro.texture`,
 * else for rule noise `noiseTexture` or `macroNoise`) and the colour map as the input `colorMap`.
 * Pass them to `ensureMaterialDependencies` to load the textures before creating the material, or
 * use them as a material JSON's fields.
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
): Extract<MatProps, { type: 'STANDARDNODEMATERIAL' }> => {
  const define = getTerrainDefine(config);
  return {
    id: config.id,
    type: 'STANDARDNODEMATERIAL',
    tslMaterialId: TERRAIN_TSL_MATERIAL_ID,
    staticDefines: { terrain: define },
    inputs: getTerrainInputs(config, define),
  };
};

/**
 * Creates a terrain material from a config (p305): one `MeshStandardNodeMaterial` whose graph has
 * only what the config enables, registered under the config's id (an id already registered
 * returns that material, as `createMaterial` does). Its layers' texture sets must be loaded: a
 * scene that lists them (`textureSets`) has them, else await `ensureMaterialDependencies` with
 * {@link getTerrainMaterialProps}' props first (a missing texture samples white, warned). With
 * `ARRAY` storage (`storage`, or `AUTO` over the texture budget or where the layers sample in
 * slots: `sparse`, `HEX`'s `apply: 'DOMINANT'`, the material's or a tier's) its set array must be
 * built:
 * await `buildTextureSetArray({ sets, packing })` first, or list it in the scene's
 * `textureSetArrays` (an array that isn't built samples white, warned). Variants
 * (`getMaterialVariant`) swap a layer's set through `inputs.layer<i>` without another shader.
 * Needs the `textureSets()` feature.
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
