// The terrain material generator (p305): one `MeshStandardNodeMaterial` graph built from a
// declarative config, every technique a build-time branch on its static define (D2's outline:
// coordinates → weights → per-layer samples → surface → sockets). Two routes reach the same
// `setupTerrainMaterial`: the code route (`createTerrainMaterial`, registered as `aek.terrain`) and
// the JSON route (`materials/terrain/terrain.tsl.ts`, whose `setup` it is).
import { float, positionWorld, uniform, uv as meshUv, vec2, color } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, NodeMaterial } from 'three/webgpu';
import { createMaterial, registerTslMaterial, type MatProps, type TslMaterialFns } from 'aekasha';
import type { TextureSetInput } from 'aekasha/texturesets';
import { sampleTextureSet, type TextureSetSample } from '../nodes/SampleTextureSet';
import {
  readTerrainDefine,
  type ResolvedTerrainDefine,
  type TerrainLayerDefine,
} from './TerrainDefine';
import type { TerrainMaterialConfig, TerrainMaterialDefine } from './TerrainMaterialConfig';

/** The id the code route registers the terrain material's functions under (`tslMaterialId`). */
export const TERRAIN_TSL_MATERIAL_ID = 'aek.terrain';

const DEG_TO_RAD = Math.PI / 180;

/** A layer's input key: `layer0`, `layer1`, … */
const getLayerInputKey = (index: number) => `layer${index}`;

/** A layer's uniforms, kept at `userData.uniforms.terrain_l<i>_<name>` */
type LayerUniforms = {
  tiling: Node<'float'>;
  rotation: Node<'float'> | null;
  tint: Node<'color'>;
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

/** Makes a layer's uniforms and keeps them where the material editor finds them */
const createLayerUniforms = (
  material: NodeMaterial,
  layer: TerrainLayerDefine,
  index: number
): LayerUniforms => {
  const uniforms = (material.userData.uniforms ??= {}) as Record<string, unknown>;
  const keep = <T>(name: string, node: T) => {
    uniforms[`terrain_l${index}_${name}`] = node;
    return node;
  };
  return {
    tiling: keep('tiling', uniform(layer.tiling)) as unknown as Node<'float'>,
    rotation:
      layer.rotation === null
        ? null
        : (keep('rotation', uniform(layer.rotation)) as unknown as Node<'float'>),
    tint: keep('tint', uniform(color(layer.tint))) as unknown as Node<'color'>,
  };
};

/**
 * A layer's tiling UV: the world's `(x, −z)` (seen from above, the source's orientation) or the
 * mesh's UV, over the set's tile size × the layer's tiling, turned by its rotation when it has one
 */
const getLayerUv = (
  define: ResolvedTerrainDefine,
  bundle: TextureSetInput,
  layer: LayerUniforms
): Node<'vec2'> => {
  const coords =
    define.uv === 'MESH_UV'
      ? (meshUv() as unknown as Node<'vec2'>)
      : (vec2(positionWorld.x, positionWorld.z.negate()) as unknown as Node<'vec2'>);
  const tileSize = (bundle.physicalSize as unknown as Node<'vec2'>).mul(layer.tiling);
  const tileUv = coords.div(tileSize) as Node<'vec2'>;
  if (!layer.rotation) return tileUv;
  // The pattern turns counter-clockwise from above: sample at the UV turned back
  const angle = layer.rotation.mul(DEG_TO_RAD);
  const c = angle.cos();
  const s = angle.sin();
  return vec2(
    c.mul(tileUv.x).add(s.mul(tileUv.y)),
    c.mul(tileUv.y).sub(s.mul(tileUv.x))
  ) as unknown as Node<'vec2'>;
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
 * The terrain material's graph (p305 D2), the TSL `setup` both routes run: reads the static
 * define `terrain` ({@link TerrainMaterialDefine}), samples each layer's texture set input
 * (`layer0`, `layer1`, …, a `{ textureSet }` bundle each, all in one packing) and sets the
 * material's sockets. Only what the define enables is built. A layer's tunables are uniforms at
 * `material.userData.uniforms.terrain_l<i>_<name>` (`tiling`, `rotation` when given, `tint`).
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

  const layers = define.layers.map((layerDefine, i) => {
    const bundle = bundles[i];
    const uniforms = createLayerUniforms(material, layerDefine, i);
    const tileUv = getLayerUv(define, bundle, uniforms);
    return { bundle, uniforms, tileUv, sample: sampleTextureSet(bundle, tileUv) };
  });
  checkOnePacking(layers.map((layer) => layer.sample));

  // SINGLE: the one layer is the surface
  const [layer] = layers;
  standard.metalnessNode = float(0);
  standard.colorNode = layer.sample.albedo
    .mul(layer.bundle.tint as unknown as Node<'vec3'>)
    .mul(layer.uniforms.tint);
};

/** The terrain material's TSL functions, as the code route registers them */
const terrainMaterialFns = { setup: setupTerrainMaterial } satisfies TslMaterialFns;

/** The config's static define: no id, no packing, no layer sets (the inputs carry them) */
const getTerrainDefine = (config: TerrainMaterialConfig): TerrainMaterialDefine => {
  const { id: _id, packing: _packing, layers, ...rest } = config;
  return { ...rest, layers: layers.map(({ set: _set, ...settings }) => settings) };
};

/**
 * The material props {@link createTerrainMaterial} creates from a config: a
 * `STANDARDNODEMATERIAL` of the registered `aek.terrain` functions, the config as the static
 * define `terrain` (without the id and the layers' sets) and each layer's set as its input
 * `layer<i>` (`{ textureSet, packing? }`). Pass them to `ensureMaterialDependencies` to load the
 * sets' textures before creating the material, or use them as a material JSON's fields.
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
  inputs: Object.fromEntries(
    config.layers.map((layer, i) => [
      getLayerInputKey(i),
      config.packing
        ? { textureSet: layer.set, packing: config.packing }
        : { textureSet: layer.set },
    ])
  ),
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
