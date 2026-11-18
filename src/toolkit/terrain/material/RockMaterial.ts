// The rock material (p308 D5): scatter rocks textured by a texture set, the toolkit's
// `rockScatter` (`materials/rockScatter/`, its JSON route). A procedural rock samples the set of the
// ground it lies on triplanar in its own space (`positionGeometry`: an `InstancedMesh`'s cell
// shares one model matrix, so the terrain material's `OBJECT` space would be the cell's), each
// plane `DUAL_SCALE` anti-tiled and its normal turned to view space by the plane's own derivative
// frame (the instance matrix isn't a node, so there's no `toWorld`); an imported rock samples a set
// of its own maps at its UV. Then a macro tint at the world's position (neighbouring rocks differ),
// a dust blend toward the ground's colour on the faces turned up, and the surface conditions' wet
// response with frost, as the terrain material's.
import {
  float,
  mix,
  normalGeometry,
  normalViewGeometry,
  normalWorldGeometry,
  positionGeometry,
  positionView,
  positionWorld,
  smoothstep,
  uniform,
  uv,
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
import { lwarn } from 'aekasha';
import { getRainOcclusionNode, getSurfaceConditionNodes } from 'aekasha/surface';
import type { TextureSetInput } from 'aekasha/texturesets';
import { sampleAntiTiled, type AntiTilingNodes } from '../nodes/AntiTiling';
import { applyMacroVariation, sampleMacroTexture } from '../nodes/Macro';
import {
  bumpNormalView,
  sampleTextureSet,
  transformTangentNormalToView,
  type TextureSetSample,
} from '../nodes/SampleTextureSet';
import { applySurfaceWetness, SURFACE_WETNESS_DEFAULTS, type SurfaceFrostOpts } from '../nodes/Wet';

/** `tiling`: the set triplanar in the rock's own space, or at the mesh's UV (its own maps) */
const TILINGS = ['TRIPLANAR', 'UV'] as const;
const ANTI_TILINGS = ['DUAL_SCALE', 'NONE'] as const;
/** `wet`: the wet response's quality, or none */
const WET_QUALITIES = ['FULL', 'SIMPLE', 'NONE'] as const;
const RAIN_OCCLUSIONS = ['NORMAL_Y', 'MAP'] as const;
const DEFINE_KEYS = ['tiling', 'antiTiling', 'wet', 'frost', 'rainOcclusion'];

/** The roughness of a packing without a roughness map (`MINIMAL`) */
const MINIMAL_ROUGHNESS = 0.8;
/** The roughness dust raises a surface toward */
const DUST_ROUGHNESS = 0.9;
/** How far the relief keeps dust off the peaks: its weight × 1 − this × the height */
const DUST_RELIEF = 0.5;

/** Each optional number input's default (`rock_<name>` in `userData.uniforms`) */
const ROCK_DEFAULTS = {
  /** The triplanar weights' exponent on the facing: higher, narrower plane seams */
  sharpness: 4,
  /** `DUAL_SCALE`'s second tap: the UV's scale, under 1 */
  farScale: 0.23,
  /** `DUAL_SCALE`'s view distances over which the second tap's share grows to a half, metres */
  antiTilingDistance: [3, 20] as [number, number],
  /** The macro tile, metres, and its variation (with the `macro` input) */
  macroScale: 8,
  macroBrightness: 0.2,
  macroHue: 5,
  macroRoughness: 0.15,
  /** The dust's most weight, 0..1, and the world normal's Y over which it fades in */
  dustAmount: 0.2,
  dustFacing: [0.4, 0.9] as [number, number],
};

/**
 * The rock material's inputs (`setup`'s, from its material JSON): the texture set, the optional
 * macro texture and dust colour, and its numbers, each a uniform with its default when left out.
 */
export type RockMaterialInputs = {
  /** The texture set: the ground's (`TRIPLANAR`), or the rock's own maps (`UV`). Required. */
  surface?: TextureSetInput;
  /** The macro texture (`{ "texture": "macroNoise" }`): the tint at the world's position. */
  macro?: TextureNode;
  /** The dust's colour (default the set's `averageColor`; no dust without either). */
  dustColor?: Node<'color'>;
  /** `TRIPLANAR`'s exponent on the facing, over 0 (default 4): higher, narrower seams. */
  sharpness?: Node<'float'>;
  /** `DUAL_SCALE`'s second tap: the UV's scale, under 1 (default 0.23). */
  farScale?: Node<'float'>;
  /** `DUAL_SCALE`'s view distances over which the second tap's share grows to a half, metres
   * (default `[3, 20]`). */
  antiTilingDistance?: Node<'vec2'>;
  /** The macro tile, metres (default 8). */
  macroScale?: Node<'float'>;
  /** How far the macro lightens and darkens the albedo, 0..1 (default 0.2). */
  macroBrightness?: Node<'float'>;
  /** How far the macro turns the albedo's hue, degrees either way (default 5). */
  macroHue?: Node<'float'>;
  /** How far the macro scales the roughness, 0..1 (default 0.15). */
  macroRoughness?: Node<'float'>;
  /** The dust's most weight, 0..1 (default 0.2; 0 none). */
  dustAmount?: Node<'float'>;
  /** The world geometry normal's Y over which the dust fades in (default `[0.4, 0.9]`). */
  dustFacing?: Node<'vec2'>;
};

type RockDefine = {
  tiling: (typeof TILINGS)[number];
  antiTiling: (typeof ANTI_TILINGS)[number];
  wet: (typeof WET_QUALITIES)[number];
  frost: boolean;
  rainOcclusion: (typeof RAIN_OCCLUSIONS)[number];
};

/** Whether a material with `wet` has warned that the feature isn't installed (once a page load) */
let isMissingFeatureWarned = false;
/** Whether a `MAP` material has warned that the rain occlusion feature isn't installed (once) */
let isMissingMapWarned = false;

const readChoice = <T extends string>(
  defines: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T
): T => {
  const value = defines[key] ?? fallback;
  if (!values.includes(value as T)) {
    throw new Error(
      `[rockScatter] Static define "${key}" is ${JSON.stringify(value)}: use ${values.map((v) => `"${v}"`).join(', ')}.`
    );
  }
  return value as T;
};

/**
 * The static defines with their defaults, checked (no zod in a build)
 * @internal
 */
export const readRockDefine = (defines: Record<string, unknown> = {}): RockDefine => {
  const unknown = Object.keys(defines).filter((key) => !DEFINE_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(
      `[rockScatter] Unknown static define ${unknown.map((key) => `"${key}"`).join(', ')}: it takes ${DEFINE_KEYS.join(', ')}.`
    );
  }
  const tiling = readChoice(defines, 'tiling', TILINGS, 'TRIPLANAR');
  const antiTiling = readChoice(
    defines,
    'antiTiling',
    ANTI_TILINGS,
    tiling === 'UV' ? 'NONE' : 'DUAL_SCALE'
  );
  if (tiling === 'UV' && antiTiling !== 'NONE') {
    throw new Error(
      '[rockScatter] Static define "antiTiling" is "DUAL_SCALE" with "tiling" "UV": a rock\'s own maps are laid out on its UV, so they take no anti-tiling.'
    );
  }
  const frost = defines.frost ?? true;
  if (typeof frost !== 'boolean') {
    throw new Error(
      `[rockScatter] Static define "frost" is ${JSON.stringify(frost)}: use a boolean.`
    );
  }
  return {
    tiling,
    antiTiling,
    wet: readChoice(defines, 'wet', WET_QUALITIES, 'FULL'),
    frost,
    rainOcclusion: readChoice(defines, 'rainOcclusion', RAIN_OCCLUSIONS, 'NORMAL_Y'),
  };
};

/** The node of an input, or a uniform of its default; kept at `userData.uniforms.rock_<name>` */
const getInput = <T>(
  material: NodeMaterial,
  inputs: RockMaterialInputs,
  name: keyof typeof ROCK_DEFAULTS
): T => {
  const given = inputs[name];
  const fallback = ROCK_DEFAULTS[name];
  const node =
    given ?? (Array.isArray(fallback) ? uniform(new Vector2(...fallback)) : uniform(fallback));
  const uniforms = (material.userData.uniforms ??= {}) as Record<string, unknown>;
  uniforms[`rock_${name}`] = node;
  return node as T;
};

/** The blended sample and the view-space normal (null: bump the height) */
type RockSample = { sample: TextureSetSample; normal: Node<'vec3'> | null };

/** A tangent normal scaled by the set's strength, in view space at the UV it was sampled at */
const toViewNormal = (sample: TextureSetSample, set: TextureSetInput, at: Node<'vec2'>) => {
  const n = sample.normalTS as Node<'vec3'>;
  const strength = set.normalStrength as unknown as Node<'float'>;
  return transformTangentNormalToView(vec3(n.xy.mul(strength), n.z) as unknown as Node<'vec3'>, at);
};

/** The set at the mesh's UV over its `physicalSize` (an imported rock's own maps: 1 m) */
const sampleAtUv = (set: TextureSetInput): RockSample => {
  const at = (uv() as unknown as Node<'vec2'>).div(
    set.physicalSize as unknown as Node<'vec2'>
  ) as Node<'vec2'>;
  const sample = sampleTextureSet(set, at);
  return { sample, normal: sample.normalTS ? toViewNormal(sample, set, at) : null };
};

/** A weighted sum of the planes' values, or null where the packing has none */
const sumOf = <T extends Node<'float'> | Node<'vec3'>>(
  values: (T | null)[],
  weights: Node<'float'>[]
): T | null => {
  if (values.some((value) => !value)) return null;
  return (values as T[])
    .map((value, i) => value.mul(weights[i]) as unknown as T)
    .reduce((total, value) => total.add(value) as unknown as T);
};

/**
 * The set triplanar in the rock's own space: the planes X `(−z, y)`, Y `(x, −z)`, Z `(x, y)` of
 * `positionGeometry` over `physicalSize`, each anti-tiled, weighted by the geometry normal's facing
 * to `sharpness`; each plane's normal in view space by its UV's derivative frame, then blended
 */
const sampleTriplanar = (
  set: TextureSetInput,
  antiTiling: AntiTilingNodes,
  sharpness: Node<'float'>
): RockSample => {
  const p = positionGeometry as unknown as Node<'vec3'>;
  const size = set.physicalSize as unknown as Node<'vec2'>;
  const uvs = [vec2(p.z.negate(), p.y), vec2(p.x, p.z.negate()), vec2(p.x, p.y)].map(
    (plane) => (plane as unknown as Node<'vec2'>).div(size) as Node<'vec2'>
  );
  const facing = (normalGeometry as unknown as Node<'vec3'>).normalize().abs().pow(vec3(sharpness));
  const total = facing.x.add(facing.y).add(facing.z);
  const weights = [facing.x, facing.y, facing.z].map(
    (w) => w.div(total) as unknown as Node<'float'>
  );
  const viewDistance = (positionView as unknown as Node<'vec3'>).length() as Node<'float'>;
  const samples = uvs.map((at) =>
    sampleAntiTiled(set, at, antiTiling, { viewDistance, patches: null, seed: 0 })
  );
  const [first] = samples;
  const normal = first.normalTS
    ? (sumOf(
        samples.map((sample, i) => toViewNormal(sample, set, uvs[i])),
        weights
      ) as Node<'vec3'>)
    : null;
  return {
    sample: {
      packing: first.packing,
      albedo: sumOf(
        samples.map((sample) => sample.albedo),
        weights
      ) as Node<'vec3'>,
      normalTS: null,
      roughness: sumOf(
        samples.map((sample) => sample.roughness),
        weights
      ),
      ao: sumOf(
        samples.map((sample) => sample.ao),
        weights
      ),
      isAoBaked: first.isAoBaked,
      height: sumOf(
        samples.map((sample) => sample.height),
        weights
      ) as Node<'float'>,
    },
    normal: normal ? (normal.normalize() as Node<'vec3'>) : null,
  };
};

/** The surface conditions' nodes for a material with `wet`, or null (warned once without them) */
const getConditions = (material: NodeMaterial) => {
  const conditions = getSurfaceConditionNodes();
  if (!conditions && !isMissingFeatureWarned) {
    isMissingFeatureWarned = true;
    lwarn(
      `[rockScatter] Material "${String(material.userData.id ?? material.name)}" has wet, but the surface conditions feature isn't installed: it builds dry (list surfaceConditions() from 'aekasha/surface' in InitEngine's features).`
    );
  }
  return conditions;
};

/** The rain occlusion map's node with `MAP`, or undefined (warned once without the feature) */
const getRainOcclusion = (material: NodeMaterial, define: RockDefine) => {
  if (define.rainOcclusion !== 'MAP') return undefined;
  const occlusion = getRainOcclusionNode();
  if (!occlusion && !isMissingMapWarned) {
    isMissingMapWarned = true;
    lwarn(
      `[rockScatter] Material "${String(material.userData.id ?? material.name)}" has rainOcclusion 'MAP', but the rain occlusion feature isn't installed: it builds with the facing alone (list rainOcclusion() from 'aekasha/surface' in InitEngine's features, after surfaceConditions()).`
    );
  }
  return occlusion ?? undefined;
};

/**
 * The rock material's graph (p308 D5), the toolkit material `rockScatter`'s `setup`: a texture set
 * on scatter rocks, wet with the ground.
 *
 * - **`tiling: 'TRIPLANAR'`** (default; the procedural rocks, `generateRock`): the input
 *   `surface`'s set, the ground's (the rocks cost no texture memory of their own), triplanar in
 *   the rock's own space (`positionGeometry`, so each instance of an `InstancedMesh` keeps its
 *   texture as it turns; its texel density follows the instance's scale), the planes weighted by
 *   the facing to `sharpness`, each `DUAL_SCALE` anti-tiled (`antiTiling: 'NONE'` for one tap a
 *   plane) and its normal in view space by its UV's derivative frame.
 * - **`tiling: 'UV'`** (an imported rock): its own maps as a set, at the mesh's UV over the set's
 *   `physicalSize` (1 for a model's maps); no anti-tiling.
 *
 * Then the set's `tint`, `roughnessScale` and `aoStrength` (`FULL`'s AO); with the input `macro` (a
 * macro texture: `macroNoise`) its brightness, hue and roughness variation at the world's position
 * over `macroScale`; dust on the faces turned up (the world normal's Y over `dustFacing`, less on
 * the peaks) toward `dustColor` (default the set's `averageColor`) × `dustAmount`, rougher; the
 * instance's colour (a scatter's `tint`, three's `instanceColor`) × the albedo. **`wet`** (`'FULL'`
 * default, `'SIMPLE'`, `'NONE'`): `applySurfaceWetness` over the surface conditions by the set's
 * wet response (its relief and, `FULL`, the AO's cavities), with **`frost`** (default true; its
 * sparkle with `FULL`) and **`rainOcclusion`** (`'NORMAL_Y'` default, or `'MAP'`: the rain
 * occlusion feature's map); without the surface conditions feature it builds dry, warned once.
 * Metalness 0. The numbers are uniforms at `userData.uniforms.rock_<name>`.
 *
 * A scatter item can't override a material's inputs, so rocks on another ground set are a
 * material JSON of their own over that set, with a two-line TSL file setting this graph.
 * @param inputs the texture set, the macro texture, the dust colour and the numbers
 * @param material the node material the graph sets
 * @param staticDefines `tiling`, `antiTiling`, `wet`, `frost`, `rainOcclusion`
 * @throws without the `surface` input, or for a static define it doesn't take
 * @example
 * ```ts
 * // sandRocks.tsl.ts, the TSL file of an app's rock material JSON whose input surface is
 * // { "textureSet": "sand01" }
 * import { setupRockMaterial } from 'aekasha/toolkit/terrain';
 *
 * export const setup = setupRockMaterial;
 * ```
 */
export const setupRockMaterial = (
  inputs: RockMaterialInputs,
  material: MeshStandardNodeMaterial,
  staticDefines?: Record<string, unknown>
) => {
  const set = inputs.surface;
  if (!set) {
    throw new Error(
      '[rockScatter] Missing input "surface": a { "textureSet": id } (the textureSets() feature).'
    );
  }
  const define = readRockDefine(staticDefines);
  const get = <T>(name: keyof typeof ROCK_DEFAULTS) => getInput<T>(material, inputs, name);

  const antiTiling: AntiTilingNodes =
    define.antiTiling === 'DUAL_SCALE'
      ? {
          mode: 'DUAL_SCALE',
          farScale: get('farScale'),
          distance: get('antiTilingDistance'),
        }
      : { mode: 'NONE' };
  const { sample, normal: mapNormal } =
    define.tiling === 'UV' ? sampleAtUv(set) : sampleTriplanar(set, antiTiling, get('sharpness'));

  let albedo = sample.albedo.mul(set.tint as unknown as Node<'vec3'>) as Node<'vec3'>;
  let roughness = (sample.roughness ?? float(MINIMAL_ROUGHNESS))
    .mul(set.roughnessScale as unknown as Node<'float'>)
    .min(1) as Node<'float'>;
  const ao = sample.ao
    ? (mix(float(1), sample.ao, set.aoStrength as unknown as Node<'float'>) as Node<'float'>)
    : null;
  const normal =
    mapNormal ??
    bumpNormalView(
      sample.height
        .mul(set.heightScale as unknown as Node<'float'>)
        .mul(set.normalStrength as unknown as Node<'float'>) as Node<'float'>
    );

  if (inputs.macro) {
    const macro = sampleMacroTexture(
      inputs.macro,
      get('macroScale'),
      positionWorld as unknown as Node<'vec3'>
    );
    ({ albedo, roughness } = applyMacroVariation({ albedo, roughness }, macro, {
      scale: get('macroScale'),
      brightness: get('macroBrightness'),
      hue: get('macroHue'),
      roughness: get('macroRoughness'),
    }));
  }

  const dustColor = inputs.dustColor ?? set.averageColor;
  if (dustColor) {
    const facing = get<Node<'vec2'>>('dustFacing');
    const up = (normalWorldGeometry as unknown as Node<'vec3'>).y;
    const weight = get<Node<'float'>>('dustAmount')
      .mul(smoothstep(facing.x, facing.y, up))
      .mul(float(1).sub(sample.height.mul(DUST_RELIEF))) as Node<'float'>;
    albedo = mix(albedo, dustColor as unknown as Node<'vec3'>, weight) as Node<'vec3'>;
    roughness = mix(roughness, roughness.max(DUST_ROUGHNESS), weight) as Node<'float'>;
  }

  material.metalnessNode = float(0);
  if (ao) material.aoNode = ao;
  const conditions = define.wet === 'NONE' ? null : getConditions(material);
  if (!conditions) {
    material.colorNode = albedo;
    material.roughnessNode = roughness;
    material.normalNode = normal;
    return;
  }
  const isFull = define.wet === 'FULL';
  const frost: SurfaceFrostOpts | undefined = define.frost
    ? {
        temperature: SURFACE_WETNESS_DEFAULTS.frostTemperature,
        strength: SURFACE_WETNESS_DEFAULTS.frostStrength,
        ...(isFull ? { sparkle: { position: positionWorld as unknown as Node<'vec3'> } } : {}),
      }
    : undefined;
  const rainOcclusion = getRainOcclusion(material, define);
  const wet = applySurfaceWetness(
    {
      albedo,
      roughness,
      normal,
      height: sample.height,
      ...(ao ? { cavity: float(1).sub(ao) as Node<'float'> } : {}),
      response: {
        porosity: set.porosity as unknown as Node<'float'>,
        wetDarkening: set.wetDarkening as unknown as Node<'float'>,
        wetRoughness: set.wetRoughness as unknown as Node<'float'>,
        dryingSpeed: set.dryingSpeed as unknown as Node<'float'>,
        puddleResponse: set.puddleResponse as unknown as Node<'float'>,
      },
    },
    conditions,
    {
      quality: isFull ? 'FULL' : 'SIMPLE',
      geometryNormal: normalViewGeometry as unknown as Node<'vec3'>,
      ...(frost ? { frost } : {}),
      ...(rainOcclusion ? { rainOcclusion } : {}),
    }
  );
  material.colorNode = wet.albedo;
  material.roughnessNode = wet.roughness;
  material.normalNode = wet.normal ?? normal;
};
