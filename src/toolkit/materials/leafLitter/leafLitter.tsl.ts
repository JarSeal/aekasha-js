import {
  float,
  floor,
  instanceIndex,
  int,
  luminance,
  mix,
  uniform,
  uniformArray,
  uv,
  vec2,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import {
  Color,
  Vector2,
  Vector4,
  type MeshStandardNodeMaterial,
  type Node,
  type Texture,
  type TextureNode,
} from 'three/webgpu';
import { getTextureAtlasInfo, lwarn, sampleAtlasCell } from 'aekasha';
import { getSurfaceConditionNodes } from 'aekasha/surface';
import { applySurfaceWetness, hash12 } from 'aekasha/toolkit/terrain';

/** `wet`: the wet response's quality, or none */
const WET_QUALITIES = ['SIMPLE', 'NONE'] as const;
const DEFINE_KEYS = ['wet'];

/** A green leaf's albedo luminance, linear: the brown keeps the leaf's veins and spots around it */
const LEAF_LUMINANCE = 0.17;
/** The hashes' seeds: the leaf's cell, whether it turned, and how far */
const CELL_SEED = 1;
const TURN_SEED = 2;
const DEPTH_SEED = 3;
/** How far a turned leaf goes brown at least (the rest of the way by its own hash) */
const MIN_TURN = 0.6;

/** Each optional input's default (`leafLitter_<name>` in `userData.uniforms`) */
const DEFAULTS = {
  /** The share of the leaves turned brown, 0..1 */
  autumn: 0.6,
  /** The brown a turned leaf takes, its veins kept */
  autumnColor: '#7a4b24',
  /** × the albedo */
  tint: '#ffffff',
  roughness: 0.6,
  /** The wet response: a leaf soaks little and glosses soon */
  porosity: 0.3,
  wetDarkening: 0.35,
  wetRoughness: 0.25,
};

/** The material's inputs: the atlas slot, and its numbers and colours (uniforms with defaults). */
type LeafLitterInputs = {
  albedo?: TextureNode;
  autumn?: Node<'float'>;
  autumnColor?: Node<'color'>;
  tint?: Node<'color'>;
  roughness?: Node<'float'>;
  porosity?: Node<'float'>;
  wetDarkening?: Node<'float'>;
  wetRoughness?: Node<'float'>;
};

/** Whether a material with `wet` has warned that the feature isn't installed (once a page load) */
let isMissingFeatureWarned = false;

const readWet = (defines: Record<string, unknown> = {}) => {
  const unknown = Object.keys(defines).filter((key) => !DEFINE_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(
      `[leafLitter] Unknown static define ${unknown.map((key) => `"${key}"`).join(', ')}: it takes ${DEFINE_KEYS.join(', ')}.`
    );
  }
  const value = defines.wet ?? 'SIMPLE';
  if (!WET_QUALITIES.includes(value as (typeof WET_QUALITIES)[number])) {
    throw new Error(
      `[leafLitter] Static define "wet" is ${JSON.stringify(value)}: use "SIMPLE" or "NONE".`
    );
  }
  return value as (typeof WET_QUALITIES)[number];
};

// p308 D5
/**
 * Leaf litter cards: the toolkit's leaf atlas (`leafLitter`, ambientCG LeafSet024) on
 * `generateLeafCard`'s quads, a leaf per instance. Each instance of an `InstancedMesh` (a
 * scatter's cell) picks its atlas cell by a hash of its `instanceIndex`, fitted into the card at
 * its own aspect (the rest of the card transparent), so one material and one draw a cell serve
 * every leaf; a plain mesh shows the first pick. A share of the leaves (`autumn`) turns toward
 * `autumnColor`, keeping its veins; × `tint` and the instance's colour (a scatter's `tint`).
 * Alpha-tested at the material's `alphaTest` (its JSON: 0.5, the atlas slot's alpha coverage),
 * with `alphaToCoverage` under MSAA. `wet` (`'SIMPLE'` default, `'NONE'`): `applySurfaceWetness`
 * over the surface conditions by `porosity`, `wetDarkening` and `wetRoughness` (dry, warned once,
 * without the feature).
 *
 * Input `albedo`: an atlas slot texture (`{ "texture": "leafLitter.albedo" }`, loaded with the
 * scene: its cell table is read at setup); the others uniforms with their defaults.
 * Asset code: the material's generated loader imports it.
 * @internal
 */
export const setup = (
  inputs: LeafLitterInputs,
  material: MeshStandardNodeMaterial,
  staticDefines?: Record<string, unknown>
) => {
  const slot = (inputs.albedo as { value?: Texture } | undefined)?.value;
  const info = slot && getTextureAtlasInfo(slot);
  if (!slot || !info) {
    throw new Error(
      '[leafLitter] Input "albedo" must be an atlas slot texture ({ "texture": "leafLitter.albedo" }), loaded with the scene.'
    );
  }
  const wet = readWet(staticDefines);
  const uniforms = (material.userData.uniforms ??= {}) as Record<string, unknown>;
  const get = <T>(name: keyof typeof DEFAULTS): T => {
    const fallback = DEFAULTS[name];
    const node =
      inputs[name] ??
      (typeof fallback === 'string' ? uniform(new Color(fallback)) : uniform(fallback));
    uniforms[`leafLitter_${name}`] = node;
    return node as T;
  };

  // The cells' content rects and the scale that fits each into a square at its aspect
  const cells = Object.values(info.cells);
  const rects = uniformArray(
    cells.map(({ uv: rect }) => new Vector4(...rect)),
    'vec4'
  );
  const fits = uniformArray(
    cells.map(({ size: [width, height] }) => {
      const side = Math.max(width, height);
      return new Vector2(side / width, side / height);
    }),
    'vec2'
  );
  const instance = vec2(float(instanceIndex), 0) as unknown as Node<'vec2'>;
  const pick = hash12(instance, { seed: CELL_SEED });
  const cell = int(floor(pick.mul(cells.length).min(cells.length - 1)));
  const cellUv = (uv() as unknown as Node<'vec2'>)
    .sub(0.5)
    .mul(fits.element(cell) as unknown as Node<'vec2'>)
    .add(0.5) as Node<'vec2'>;
  const sample = sampleAtlasCell(
    slot,
    cellUv,
    rects.element(cell) as unknown as Node<'vec4'>
  ) as unknown as Node<'vec4'>;

  const green = sample.rgb as Node<'vec3'>;
  const turned = hash12(instance, { seed: TURN_SEED }).lessThan(get<Node<'float'>>('autumn'));
  const depth = float(MIN_TURN).add(hash12(instance, { seed: DEPTH_SEED }).mul(1 - MIN_TURN));
  const brown = get<Node<'vec3'>>('autumnColor').mul(luminance(green).div(LEAF_LUMINANCE));
  const albedo = mix(green, brown, turned.select(depth, float(0))).mul(
    get<Node<'vec3'>>('tint')
  ) as Node<'vec3'>;
  const roughness = get<Node<'float'>>('roughness');

  material.opacityNode = sample.a as Node<'float'>;
  material.metalnessNode = float(0);
  material.colorNode = albedo;
  material.roughnessNode = roughness;
  if (wet === 'NONE') return;
  const conditions = getSurfaceConditionNodes();
  if (!conditions) {
    if (!isMissingFeatureWarned) {
      isMissingFeatureWarned = true;
      lwarn(
        `[leafLitter] Material "${String(material.userData.id ?? material.name)}" has wet, but the surface conditions feature isn't installed: it builds dry (list surfaceConditions() from 'aekasha/surface' in InitEngine's features).`
      );
    }
    return;
  }
  const wetSurface = applySurfaceWetness(
    {
      albedo,
      roughness,
      response: {
        porosity: get('porosity'),
        wetDarkening: get('wetDarkening'),
        wetRoughness: get('wetRoughness'),
      },
    },
    conditions,
    { quality: 'SIMPLE' }
  );
  material.colorNode = wetSurface.albedo;
  material.roughnessNode = wetSurface.roughness;
};
