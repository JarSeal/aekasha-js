// The terrain material generator (p305): one `MeshStandardNodeMaterial` graph built from a
// declarative config, every technique a build-time branch on its static define (D2's outline:
// coordinates → weights → per-layer samples → surface → sockets). Two routes reach the same
// `setupTerrainMaterial`: the code route (`createTerrainMaterial`, registered as `aek.terrain`) and
// the JSON route (`materials/terrain/terrain.tsl.ts`, whose `setup` it is).
import { color, float, mix, positionWorld, uniform, uv as meshUv, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, NodeMaterial, TextureNode } from 'three/webgpu';
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
import { sampleTextureSet, type TextureSetSample } from '../nodes/SampleTextureSet';
import {
  bumpNormalWorld,
  getPlanarTangentFrame,
  getUvTangentFrame,
  transformTangentNormalToWorld,
  transformWorldNormalToView,
} from '../nodes/TerrainNormals';
import {
  readTerrainDefine,
  type ResolvedTerrainDefine,
  type TerrainLayerDefine,
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

/** A layer's input key: `layer0`, `layer1`, … */
const getLayerInputKey = (index: number) => `layer${index}`;
/** The macro texture's input key */
const MACRO_INPUT_KEY = 'macro';

/** A layer's uniforms, kept at `userData.uniforms.terrain_l<i>_<name>` */
type LayerUniforms = {
  tiling: Node<'float'>;
  rotation: Node<'float'> | null;
  tint: Node<'color'>;
  normalStrength: Node<'float'>;
  roughnessScale: Node<'float'>;
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

/** A layer's input bundles in the define's order, all present, the input keys none but theirs */
const readLayerBundles = (inputs: Record<string, unknown>, define: ResolvedTerrainDefine) => {
  const keys = define.layers.map((_, i) => getLayerInputKey(i));
  for (const key of Object.keys(inputs)) {
    if (/^layer\d+$/.test(key) && !keys.includes(key)) {
      throw new Error(
        `[terrain] Input "${key}" has no layer: staticDefines.terrain.layers has ${keys.length}.`
      );
    }
  }
  return keys.map((key) => {
    const bundle = inputs[key] as TextureSetInput | undefined;
    if (!bundle || typeof bundle !== 'object' || !('physicalSize' in bundle)) {
      throw new Error(
        `[terrain] Missing input "${key}": a { "textureSet": id } (the textureSets() feature) for each layer.`
      );
    }
    return bundle;
  });
};

/** Makes a layer's uniforms (`terrain_l<i>_<name>`) */
const createLayerUniforms = (
  material: NodeMaterial,
  layer: TerrainLayerDefine,
  index: number
): LayerUniforms => {
  const keep = (name: string, node: unknown) => keepUniform(material, `l${index}_${name}`, node);
  return {
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

/**
 * The terrain material's graph (p305 D2), the TSL `setup` both routes run: reads the static
 * define `terrain` ({@link TerrainMaterialDefine}), samples each layer's texture set input
 * (`layer0`, `layer1`, …, a `{ textureSet }` bundle each, all in one packing) and sets the
 * material's sockets: the colour, the normal (each layer's in world space, into view space once),
 * the roughness, metalness 0, and the texture AO (`FULL`) to `aoNode`, which darkens indirect
 * light only (`LITE` and `MINIMAL` have theirs baked into the albedo). Only what the define
 * enables is built. The tunables are uniforms in `material.userData.uniforms`: per layer
 * `terrain_l<i>_<name>` (`tiling`, `rotation` when given, `tint`, `normalStrength`,
 * `roughnessScale`), and `terrain_aoTextureInfluence` when a layer has texture AO. A
 * `qualityLevel` applies that tier's `quality` overrides first; a `debugView` (debug env, once
 * {@link loadTerrainDebugViewsAsync} has loaded the views) replaces the shading with the view. The
 * define as given is kept at `material.userData.terrainDefine`.
 * @param inputs the material's inputs: `layer<i>` bundles (the `textureSets()` feature's resolver)
 * @param material the node material being built (a `STANDARDNODEMATERIAL`)
 * @param staticDefines the material's static defines, `terrain` among them
 * @throws for a missing or wrong define field, a field it doesn't know, a missing layer input, or
 * layers in different packings
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

  const layers = define.layers.map((layerDefine, i) => {
    const bundle = bundles[i];
    const uniforms = createLayerUniforms(material, layerDefine, i);
    const uv = getLayerUv(define, bundle, uniforms);
    return { bundle, uniforms, uv, sample: sampleTextureSet(bundle, uv.tileUv) };
  });
  checkOnePacking(layers.map((layer) => layer.sample));
  const surfaces = layers.map(({ bundle, uniforms, uv, sample }) =>
    getLayerSurface(define, bundle, uniforms, uv, sample, getAoInfluence)
  );

  // SINGLE: the one layer is the surface
  const [surface] = surfaces;
  standard.colorNode = surface.albedo;
  standard.normalNode = transformWorldNormalToView(surface.normal);
  standard.roughnessNode = surface.roughness;
  standard.metalnessNode = float(0);
  if (surface.ao) standard.aoNode = surface.ao;

  if (IS_DEBUG_ENV && define.debugView) {
    const [{ bundle, uv }] = layers;
    applyDebugView(standard, define.debugView, {
      coords: uv.coords,
      tileSize: uv.tileSize,
      colorTexture: (bundle.albedoRough ?? bundle.albedoHeight) as unknown as TextureNode,
      normal: surface.normal,
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
 * The config's static define: no id, no packing, no layer sets and no macro texture (the inputs
 * carry them)
 */
const getTerrainDefine = (config: TerrainMaterialConfig): TerrainMaterialDefine => {
  const { id: _id, packing: _packing, layers, macro, ...rest } = config;
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

/** The config's inputs: each layer's set (`layer<i>`) and the macro texture (`macro`) */
const getTerrainInputs = (config: TerrainMaterialConfig) => {
  const inputs: Record<string, unknown> = Object.fromEntries(
    config.layers.map((layer, i) => [
      getLayerInputKey(i),
      config.packing
        ? { textureSet: layer.set, packing: config.packing }
        : { textureSet: layer.set },
    ])
  );
  if (config.macro) inputs[MACRO_INPUT_KEY] = { texture: config.macro.texture };
  return inputs;
};

/**
 * The material props {@link createTerrainMaterial} creates from a config: a
 * `STANDARDNODEMATERIAL` of the registered `aek.terrain` functions, the config as the static
 * define `terrain` (without the id, the layers' sets and the macro texture), each layer's set as
 * its input `layer<i>` (`{ textureSet, packing? }`) and the macro texture as the input `macro`
 * (`{ texture }`). Pass them to `ensureMaterialDependencies` to load the textures before creating
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
