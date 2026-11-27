// The decal material (p309 D2): mesh decals in a forward renderer, the toolkit's decal materials
// (`materials/decal/`, their JSON route). A decal is a mesh laid over a surface (a quad, a strip, a
// patch conformed to a terrain block) UV'd into its cell of a `DECAL` atlas (p309 D1: `albedoAlpha`
// RGB albedo, A opacity; `normalRough` RG normal XY, B roughness, A puddle mask), so one material
// draws every cell and a merge group of any cells shares it. Its second UV set runs 0..1 over the
// decal, which the edge fade reads (a quad's hard edges never show). `BLEND` draws it in the
// transparent pass over the surface, `CUTOUT` alpha-tested in the opaque pass; both pulled toward
// the camera by a polygon offset. Inside its opacity the decal's own albedo, normal and roughness
// replace the surface's, then the surface conditions wet it, its puddle mask a relief the puddles
// fill first (ruts, footprints).
import {
  attribute,
  float,
  max,
  min,
  normalViewGeometry,
  positionWorld,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import {
  Color,
  Vector2,
  type MeshStandardNodeMaterial,
  type Node,
  type NodeMaterial,
  type TextureNode,
} from 'three/webgpu';
import { lwarn } from 'aekasha';
import { getRainOcclusionNode, getSurfaceConditionNodes } from 'aekasha/surface';
import type { TextureSetInput } from 'aekasha/texturesets';
import { transformTangentNormalToView } from '../nodes/SampleTextureSet';
import { applySurfaceWetness, SURFACE_WETNESS_DEFAULTS, type SurfaceFrostOpts } from '../nodes/Wet';

/** `mode`: alpha-blended in the transparent pass, or alpha-tested in the opaque one */
const MODES = ['BLEND', 'CUTOUT'] as const;
/** `edgeFade`: by the second UV set (0..1 over the decal), or none */
const EDGE_FADES = ['UV1', 'NONE'] as const;
/** `wet`: the wet response's quality, or none */
const WET_QUALITIES = ['FULL', 'SIMPLE', 'NONE'] as const;
const RAIN_OCCLUSIONS = ['NORMAL_Y', 'MAP'] as const;
const DEFINE_KEYS = ['mode', 'edgeFade', 'wet', 'frost', 'rainOcclusion'];

/**
 * The render state's numbers where the material JSON's `params` leave them 0: the polygon offset
 * (both modes: a `CUTOUT` decal is as coplanar as a `BLEND` one) and `CUTOUT`'s alpha test
 */
const DEFAULT_OFFSET_FACTOR = -1;
const DEFAULT_OFFSET_UNITS = -4;
const DEFAULT_ALPHA_TEST = 0.5;
/** A relief's height where the puddle mask is 0: `applySurfaceWetness`'s flat ground */
const FLAT_HEIGHT = 0.5;
/** The narrowest edge fade the division takes: 0 fades nothing */
const MIN_EDGE_FADE = 1e-4;

/** Each optional input's default (`decal_<name>` in `userData.uniforms`) */
const DECAL_DEFAULTS = {
  /** × the albedo */
  tint: '#ffffff',
  /** × the albedo's alpha */
  opacity: 1,
  /** × the normal's XY */
  normalStrength: 1,
  /** × the sampled B */
  roughnessScale: 1,
  /** The edge fade's width at each side, a share of the second UV set's 0..1: (across u, across v) */
  edgeFade: [0.1, 0.1] as [number, number],
  /** How far below flat a full puddle mask lowers the relief (the flat height is 0.5) */
  puddleDepth: 0.5,
  /** The wet response (`SurfaceWetResponse`) */
  porosity: 0.5,
  wetDarkening: 0.5,
  wetRoughness: 0.2,
  /** Half: the masked texels fill, the unmasked ones never (1 would put the whole quad under) */
  puddleResponse: 0.5,
};

/**
 * The decal material's inputs (`setup`'s, from its material JSON): the two `DECAL` textures, the
 * optional ripple atlas and snow set, and its numbers, each a uniform with its default when left
 * out.
 */
export type DecalMaterialInputs = {
  /** RGB albedo (sRGB), A opacity: a `DECAL` atlas's slot (`{ "texture": "decalsGround.albedoAlpha" }`). Required. */
  albedoAlpha?: TextureNode;
  /** RG normal XY, B roughness, A puddle mask: the atlas's other slot. Required. */
  normalRough?: TextureNode;
  /** A ripple atlas (`{ "texture": "rippleAtlas" }`): rain rings where water stands (`wet: 'FULL'`). */
  ripples?: TextureNode;
  /** A snow texture set (`{ "textureSet": "snow01" }`): the snow covers the decal as it covers the ground. */
  snow?: TextureSetInput;
  /** × the albedo (default white). */
  tint?: Node<'color'>;
  /** × the opacity, 0..1 (default 1). */
  opacity?: Node<'float'>;
  /** × the normal's XY (default 1; 0 flat). */
  normalStrength?: Node<'float'>;
  /** × the roughness (default 1). */
  roughnessScale?: Node<'float'>;
  /** The edge fade's width at each side, a share of the second UV set (default `[0.1, 0.1]`; 0: none on that axis). */
  edgeFade?: Node<'vec2'>;
  /** How far below flat a full puddle mask lowers the relief, 0..0.5 (default 0.5: it fills first). */
  puddleDepth?: Node<'float'>;
  /** How much water the decal soaks up, 0..1 (default 0.5). */
  porosity?: Node<'float'>;
  /** How much the filled pores darken it, 0..1 (default 0.5). */
  wetDarkening?: Node<'float'>;
  /** Its roughness with the pores full (default 0.2). */
  wetRoughness?: Node<'float'>;
  /**
   * How readily water stands on it, 0..1 (default 0.5): a texel fills where the puddle level × this
   * is over its relief, 0.5 − the mask × `puddleDepth`. At the defaults a full mask is under water
   * from a level of 0.1, a half one from 0.6, and an unmasked texel never (flat ground's relief, as
   * the terrain material's); at 1 the flat would fill from 0.5, so the whole quad.
   */
  puddleResponse?: Node<'float'>;
};

type DecalDefine = {
  mode: (typeof MODES)[number];
  edgeFade: (typeof EDGE_FADES)[number];
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
      `[decal] Static define "${key}" is ${JSON.stringify(value)}: use ${values.map((v) => `"${v}"`).join(', ')}.`
    );
  }
  return value as T;
};

/**
 * The static defines with their defaults, checked (no zod in a build)
 * @internal
 */
export const readDecalDefine = (defines: Record<string, unknown> = {}): DecalDefine => {
  const unknown = Object.keys(defines).filter((key) => !DEFINE_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(
      `[decal] Unknown static define ${unknown.map((key) => `"${key}"`).join(', ')}: it takes ${DEFINE_KEYS.join(', ')}.`
    );
  }
  const frost = defines.frost ?? true;
  if (typeof frost !== 'boolean') {
    throw new Error(`[decal] Static define "frost" is ${JSON.stringify(frost)}: use a boolean.`);
  }
  return {
    mode: readChoice(defines, 'mode', MODES, 'BLEND'),
    edgeFade: readChoice(defines, 'edgeFade', EDGE_FADES, 'NONE'),
    wet: readChoice(defines, 'wet', WET_QUALITIES, 'FULL'),
    frost,
    rainOcclusion: readChoice(defines, 'rainOcclusion', RAIN_OCCLUSIONS, 'NORMAL_Y'),
  };
};

/** The node of an input, or a uniform of its default; kept at `userData.uniforms.decal_<name>` */
const getInput = <T>(
  material: NodeMaterial,
  inputs: DecalMaterialInputs,
  name: keyof typeof DECAL_DEFAULTS
): T => {
  const fallback = DECAL_DEFAULTS[name];
  const node =
    inputs[name] ??
    (typeof fallback === 'string'
      ? uniform(new Color(fallback))
      : Array.isArray(fallback)
        ? uniform(new Vector2(...fallback))
        : uniform(fallback));
  const uniforms = (material.userData.uniforms ??= {}) as Record<string, unknown>;
  uniforms[`decal_${name}`] = node;
  return node as T;
};

/** An input that must be a whole texture sample (`{ "texture": id }`, no `channel`) */
const getTextureInput = (inputs: DecalMaterialInputs, name: 'albedoAlpha' | 'normalRough') => {
  const node = inputs[name] as (TextureNode & { isTextureNode?: boolean }) | undefined;
  if (!node?.isTextureNode) {
    throw new Error(
      `[decal] Input "${name}" must be a texture in the DECAL packing, sampled whole ({ "texture": "decalsGround.${name}" }, no channel).`
    );
  }
  return node;
};

/**
 * The render state by the mode: the polygon offset on both, `BLEND` transparent without depth
 * writes, `CUTOUT` opaque, alpha-tested with alpha to coverage (three enables it only under MSAA).
 * The JSON's `params` numbers win where they aren't 0.
 */
const applyMode = (material: MeshStandardNodeMaterial, mode: DecalDefine['mode']) => {
  material.polygonOffset = true;
  material.polygonOffsetFactor ||= DEFAULT_OFFSET_FACTOR;
  material.polygonOffsetUnits ||= DEFAULT_OFFSET_UNITS;
  if (mode === 'BLEND') {
    material.transparent = true;
    material.depthWrite = false;
    material.alphaToCoverage = false;
    return;
  }
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest ||= DEFAULT_ALPHA_TEST;
  material.alphaToCoverage = true;
};

/**
 * The edge fade: 1 inside, falling smoothly to 0 at each edge of the second UV set's 0..1 over its
 * axis's width (0: none on that axis)
 * @internal
 */
export const getDecalEdgeFade = (decalUv: Node<'vec2'>, widths: Node<'vec2'>): Node<'float'> => {
  const inset = min(decalUv, vec2(1).sub(decalUv)) as unknown as Node<'vec2'>;
  const t = inset.div(max(widths, MIN_EDGE_FADE)).saturate() as Node<'vec2'>;
  const s = t.mul(t).mul(vec2(3).sub(t.mul(2))) as Node<'vec2'>;
  return s.x.mul(s.y) as Node<'float'>;
};

/** The surface conditions' nodes for a material with `wet`, or null (warned once without them) */
const getConditions = (material: NodeMaterial) => {
  const conditions = getSurfaceConditionNodes();
  if (!conditions && !isMissingFeatureWarned) {
    isMissingFeatureWarned = true;
    lwarn(
      `[decal] Material "${String(material.userData.id ?? material.name)}" has wet, but the surface conditions feature isn't installed: it builds dry (list surfaceConditions() from 'aekasha/surface' in InitEngine's features).`
    );
  }
  return conditions;
};

/** The rain occlusion map's node with `MAP`, or undefined (warned once without the feature) */
const getRainOcclusion = (material: NodeMaterial, define: DecalDefine) => {
  if (define.rainOcclusion !== 'MAP') return undefined;
  const occlusion = getRainOcclusionNode();
  if (!occlusion && !isMissingMapWarned) {
    isMissingMapWarned = true;
    lwarn(
      `[decal] Material "${String(material.userData.id ?? material.name)}" has rainOcclusion 'MAP', but the rain occlusion feature isn't installed: it builds with the facing alone (list rainOcclusion() from 'aekasha/surface' in InitEngine's features, after surfaceConditions()).`
    );
  }
  return occlusion ?? undefined;
};

// p309 D2
/**
 * The decal material's graph, the toolkit's decal materials' `setup`
 * (`decalsGround_blend`, `decalsGround_cutout`, `decalsStructure_blend`, `decalsStructure_cutout`):
 * a cell of a `DECAL` atlas on a decal mesh, wet with the ground.
 *
 * - **Sampling:** the inputs `albedoAlpha` and `normalRough` at the mesh's UV, which is in the
 *   atlas's space (a Blender decal's, or `remapUVsToAtlasCell`'s), so one material draws every
 *   cell; the normal XY in the frame of that UV's derivatives.
 * - **`mode`** (`'BLEND'` default): transparent, no depth writes, sorted with the transparents
 *   (soft decals: stains, tracks); `'CUTOUT'`: alpha-tested at `alphaTest` (default 0.5) with alpha
 *   to coverage under MSAA, in the opaque pass (footprints, cracks, leaves). Both have a polygon
 *   offset (default factor −1, units −4). The JSON's `params` give `alphaTest`,
 *   `polygonOffsetFactor` and `polygonOffsetUnits` where they aren't 0; the mode sets the flags.
 * - **Opacity:** the A × `opacity` × the edge fade × a `BATCHED` merge member's opacity
 *   (`setMergeMemberColor`: three multiplies a batch's colour into the diffuse colour, alpha too).
 *   **`edgeFade`** (`'NONE'` default; the toolkit's JSONs `'UV1'`): by the mesh's second UV set,
 *   0..1 over the decal, falling to 0 over `edgeFade`'s width at each edge (a strip's u runs along
 *   it: width 0 there). A mesh without that set reads 0 there: no decal.
 * - **Lighting:** the decal's albedo × `tint`, its roughness × `roughnessScale` and its normal
 *   (× `normalStrength`) replace the surface's inside its opacity; metalness 0.
 * - **`wet`** (`'FULL'` default, `'SIMPLE'`, `'NONE'`): `applySurfaceWetness` over the surface
 *   conditions by its numbers (`porosity`, `wetDarkening`, `wetRoughness`, `puddleResponse`); the
 *   puddle mask lowers its relief by up to `puddleDepth` below flat, so `'FULL'`'s puddles fill the
 *   masked texels first; with **`frost`** (default true), **`rainOcclusion`** (`'NORMAL_Y'`, or
 *   `'MAP'`), the optional inputs `ripples` (`'FULL'`) and `snow`. Without the surface conditions
 *   feature it builds dry, warned once.
 *
 * The numbers are uniforms at `userData.uniforms.decal_<name>`. A decal casts no shadow (the
 * mesh's `castShadow: false`) and receives them (`receiveShadow: true`); draw it after the surface
 * (`renderOrder`, eg. 10 with the terrain at 0).
 * @param inputs the two `DECAL` textures, the ripple atlas, the snow set and the numbers
 * @param material the node material the graph sets
 * @param staticDefines `mode`, `edgeFade`, `wet`, `frost`, `rainOcclusion`
 * @throws without the two textures, or for a static define it doesn't take
 * @remarks A logarithmic depth buffer writes each fragment's depth, which the polygon offset
 * doesn't move: decals z-fight there.
 * @example
 * ```ts
 * // stoneDecals.tsl.ts, the TSL file of an app's decal material JSON whose inputs albedoAlpha and
 * // normalRough are its own DECAL atlas's slots
 * import { setupDecalMaterial } from 'aekasha/toolkit/terrain';
 *
 * export const setup = setupDecalMaterial;
 * ```
 */
export const setupDecalMaterial = (
  inputs: DecalMaterialInputs,
  material: MeshStandardNodeMaterial,
  staticDefines?: Record<string, unknown>
) => {
  const albedoAlpha = getTextureInput(inputs, 'albedoAlpha');
  const normalRough = getTextureInput(inputs, 'normalRough');
  const define = readDecalDefine(staticDefines);
  const get = <T>(name: keyof typeof DECAL_DEFAULTS) => getInput<T>(material, inputs, name);
  applyMode(material, define.mode);

  const color = albedoAlpha as unknown as Node<'vec4'>;
  const data = normalRough as unknown as Node<'vec4'>;
  const albedo = color.rgb.mul(get<Node<'vec3'>>('tint')) as Node<'vec3'>;
  let opacity = color.a.mul(get<Node<'float'>>('opacity')) as Node<'float'>;
  if (define.edgeFade === 'UV1') {
    const decalUv = attribute('uv1', 'vec2') as unknown as Node<'vec2'>;
    opacity = opacity.mul(getDecalEdgeFade(decalUv, get('edgeFade'))) as Node<'float'>;
  }
  const xy = data.rg.mul(2).sub(1) as Node<'vec2'>;
  // Z of a unit normal; the max keeps a filtered texel past the unit circle from going NaN
  const z = max(float(0), float(1).sub(xy.dot(xy))).sqrt();
  const normalTS = vec3(xy.mul(get<Node<'float'>>('normalStrength')), z) as unknown as Node<'vec3'>;
  // The frame of the UV the normal was sampled at (an `{ atlas }` input's is its cell's)
  const sampledUv = (normalRough.uvNode ?? uv()) as unknown as Node<'vec2'>;
  const normal = transformTangentNormalToView(normalTS, sampledUv);
  const roughness = data.b.mul(get<Node<'float'>>('roughnessScale')).min(1) as Node<'float'>;

  material.metalnessNode = float(0);
  material.opacityNode = opacity;
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
  const height = float(FLAT_HEIGHT)
    .sub(data.a.mul(get<Node<'float'>>('puddleDepth')))
    .max(0) as Node<'float'>;
  const wet = applySurfaceWetness(
    {
      albedo,
      roughness,
      normal,
      height,
      response: {
        porosity: get('porosity'),
        wetDarkening: get('wetDarkening'),
        wetRoughness: get('wetRoughness'),
        puddleResponse: get('puddleResponse'),
      },
    },
    conditions,
    {
      quality: isFull ? 'FULL' : 'SIMPLE',
      geometryNormal: normalViewGeometry as unknown as Node<'vec3'>,
      ...(isFull ? { puddles: {} } : {}),
      ...(isFull && inputs.ripples ? { ripples: { atlas: inputs.ripples } } : {}),
      ...(inputs.snow ? { snow: { set: inputs.snow } } : {}),
      ...(frost ? { frost } : {}),
      ...(rainOcclusion ? { rainOcclusion } : {}),
    }
  );
  material.colorNode = wet.albedo;
  material.roughnessNode = wet.roughness;
  material.normalNode = wet.normal ?? normal;
};
