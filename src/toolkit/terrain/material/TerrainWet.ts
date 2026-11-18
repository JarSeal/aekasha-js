// The terrain material's wet response (p307 D2): the blended surface wet by the surface conditions
// (`nodes/Wet.ts`' `applySurfaceWetness`) after the layers, the far branch and the macro, its
// relief the layers' blended height, its response their sets' `porosity`, `wetDarkening`,
// `wetRoughness` and `dryingSpeed` by weight, its cavities the AO; its puddles (T3) by the sets'
// `puddleResponse`, their patches one fetch of the macro texture at their own scale; its regional
// wetness (T7) a vertex attribute or the first splat map's A; its rain ripples (T4) the input
// `ripples`' atlas, faded out by the view distance; its rain streaks (T5) one fetch of the macro
// texture's R stretched down steep faces, in both qualities; its shoreline (T8) along the water
// level, arithmetic at the world's position, in both qualities. The conditions are the
// `surfaceConditions()` feature's stable uniforms; without the feature the material builds dry,
// warned once a page load.
import { attribute, float, smoothstep, uniform } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import { Vector2, type Node, type NodeMaterial, type TextureNode } from 'three/webgpu';
import { lwarn } from 'aekasha';
import { getSurfaceConditionNodes } from 'aekasha/surface';
import { sampleMacroTexture } from '../nodes/Macro';
import type { SurfaceSpace } from '../nodes/SurfaceSpace';
import {
  applySurfaceWetness,
  type SurfacePuddleOpts,
  type SurfaceRippleOpts,
  type SurfaceShorelineOpts,
  type SurfaceStreakOpts,
  type SurfaceWetnessMasks,
} from '../nodes/Wet';
import type { ResolvedTerrainDefine, TerrainWetDefine } from './TerrainDefine';
import { keepUniform, type LayerWet } from './TerrainLayers';

/** Whether a material with `wet` has warned that the feature isn't installed (once a page load) */
let isMissingFeatureWarned = false;

/**
 * The surface the wet response gets: the albedo, the roughness, the shaded normal in the
 * material's space, the AO (the material's `aoNode`, or null), what the layers' wet reads, the
 * macro texture (the puddle patches' and the streaks'), the ripple atlas, the first splat map's A (a regional
 * wetness's) and the view distance (the ripples' fade)
 * @internal
 */
export type TerrainWetInput = {
  albedo: Node<'vec3'>;
  roughness: Node<'float'>;
  normal: Node<'vec3'>;
  ao: Node<'float'> | null;
  wet: LayerWet | null;
  macroTexture: TextureNode | null;
  rippleTexture: TextureNode | null;
  splatAlpha: Node<'float'> | null;
  viewDistance: Node<'float'>;
};

type Keep = <T>(name: string, node: unknown) => T;

/**
 * The puddles' options (uniforms `terrain_wetPuddleMaxSlope`, `terrain_wetPuddleEdge`, and with
 * patches `terrain_wetPuddlePatchScale` and `terrain_wetPuddlePatchAmount`: one fetch of the
 * macro texture's B at the material's XZ over the scale), or undefined without
 */
const getPuddleOpts = (
  settings: TerrainWetDefine,
  surface: TerrainWetInput,
  space: SurfaceSpace,
  keep: Keep
): SurfacePuddleOpts | undefined => {
  const { puddles } = settings;
  if (!puddles) return undefined;
  const opts: SurfacePuddleOpts = {
    maxSlope: keep('wetPuddleMaxSlope', uniform(puddles.maxSlope)),
    edge: keep('wetPuddleEdge', uniform(puddles.edge)),
  };
  if (!puddles.patches) return opts;
  // The reader requires the macro input with patches (`takesMacroTexture`)
  const texture = surface.macroTexture as TextureNode;
  const scale = keep<Node<'float'>>('wetPuddlePatchScale', uniform(puddles.patches.scale));
  return {
    ...opts,
    patches: sampleMacroTexture(texture, scale, space.position).b as unknown as Node<'float'>,
    patchAmount: keep('wetPuddlePatchAmount', uniform(puddles.patches.amount)),
  };
};

/**
 * The ripples' options (uniforms `terrain_wetRippleScale`, `terrain_wetRippleLifetime`,
 * `terrain_wetRippleStrength` and `terrain_wetRippleDistance`: faded out over its view distances),
 * at the material's position, or undefined without
 */
const getRippleOpts = (
  settings: TerrainWetDefine,
  surface: TerrainWetInput,
  space: SurfaceSpace,
  keep: Keep
): SurfaceRippleOpts | undefined => {
  const { ripples } = settings;
  if (!ripples) return undefined;
  const distance = keep<Node<'vec2'>>(
    'wetRippleDistance',
    uniform(new Vector2(...ripples.distance))
  );
  return {
    // The reader requires the ripples input with ripples (`takesRippleTexture`)
    atlas: surface.rippleTexture as TextureNode,
    position: space.position,
    scale: keep('wetRippleScale', uniform(ripples.scale)),
    lifetime: keep('wetRippleLifetime', uniform(ripples.lifetime)),
    strength: keep('wetRippleStrength', uniform(ripples.strength)),
    fade: float(1).sub(
      smoothstep(distance.x, distance.y, surface.viewDistance)
    ) as unknown as Node<'float'>,
  };
};

/**
 * The streaks' options (uniforms `terrain_wetStreakMinSlope`, `terrain_wetStreakScale`,
 * `terrain_wetStreakLength` and `terrain_wetStreakSpeed`: one fetch of the macro texture's R at
 * the material's position), or undefined without
 */
const getStreakOpts = (
  settings: TerrainWetDefine,
  surface: TerrainWetInput,
  space: SurfaceSpace,
  keep: Keep
): SurfaceStreakOpts | undefined => {
  const { streaks } = settings;
  if (!streaks) return undefined;
  return {
    // The reader requires the macro input with streaks (`takesMacroTexture`)
    texture: surface.macroTexture as TextureNode,
    position: space.position,
    minSlope: keep('wetStreakMinSlope', uniform(streaks.minSlope)),
    scale: keep('wetStreakScale', uniform(streaks.scale)),
    length: keep('wetStreakLength', uniform(streaks.length)),
    speed: keep('wetStreakSpeed', uniform(streaks.speed)),
  };
};

/**
 * The shoreline's options (uniforms `terrain_wetShoreBand`, `terrain_wetShoreNoise`, and with a
 * run-up `terrain_wetShoreRunUp`: its height and period), at the world's position (the water level
 * is the world's, whatever the material's space), or undefined without
 */
const getShorelineOpts = (
  settings: TerrainWetDefine,
  keep: Keep
): SurfaceShorelineOpts | undefined => {
  const { shoreline } = settings;
  if (!shoreline) return undefined;
  const opts: SurfaceShorelineOpts = {
    band: keep('wetShoreBand', uniform(shoreline.band)),
    noise: keep('wetShoreNoise', uniform(shoreline.noise)),
  };
  if (!shoreline.runUp) return opts;
  const { height, period } = shoreline.runUp;
  const runUp = keep<Node<'vec2'>>('wetShoreRunUp', uniform(new Vector2(height, period)));
  return {
    ...opts,
    runUp: { height: runUp.x as Node<'float'>, period: runUp.y as Node<'float'> },
  };
};

/** The regional wetness's node: the vertex attribute, or the first splat map's A; undefined without */
const getRegional = (settings: TerrainWetDefine, surface: TerrainWetInput) => {
  const { regional } = settings;
  if (!regional) return undefined;
  if ('attribute' in regional) {
    return attribute(regional.attribute, 'float') as unknown as Node<'float'>;
  }
  return surface.splatAlpha ?? undefined;
};

/**
 * The surface wet by the surface conditions with the define's `wet` (uniforms
 * `terrain_wetShelter`, the streaks', the shoreline's, and with `FULL` `terrain_wetHeightInfluence`,
 * `terrain_wetCavityInfluence`, the puddles' and the ripples'), and its masks (the `WETNESS`
 * view's); as given, masks null, without `wet` or without the `surfaceConditions()` feature
 * (warned once a page load).
 * @internal
 */
export const applyTerrainWetness = (
  material: NodeMaterial,
  define: ResolvedTerrainDefine,
  surface: TerrainWetInput,
  space: SurfaceSpace
) => {
  const dry = { ...surface, masks: null as SurfaceWetnessMasks | null };
  const { wet: settings } = define;
  if (!settings || !surface.wet) return dry;
  const conditions = getSurfaceConditionNodes();
  if (!conditions) {
    if (!isMissingFeatureWarned) {
      isMissingFeatureWarned = true;
      lwarn(
        `[terrain] Material "${String(material.userData.id ?? material.name)}" has wet, but the surface conditions feature isn't installed: it builds dry (list surfaceConditions() from 'aekasha/surface' in InitEngine's features).`
      );
    }
    return dry;
  }
  const keep: Keep = <T>(name: string, node: unknown) => keepUniform(material, name, node) as T;
  const isFull = settings.quality === 'FULL';
  const { height, response, puddleResponse } = surface.wet;
  const regional = getRegional(settings, surface);
  const puddles = isFull ? getPuddleOpts(settings, surface, space, keep) : undefined;
  const ripples = isFull ? getRippleOpts(settings, surface, space, keep) : undefined;
  const streaks = getStreakOpts(settings, surface, space, keep);
  const shoreline = getShorelineOpts(settings, keep);
  const wet = applySurfaceWetness(
    {
      albedo: surface.albedo,
      roughness: surface.roughness,
      normal: surface.normal,
      height,
      ...(surface.ao ? { cavity: float(1).sub(surface.ao) as Node<'float'> } : {}),
      ...(regional ? { regional } : {}),
      response: {
        porosity: response.x as Node<'float'>,
        wetDarkening: response.y as Node<'float'>,
        wetRoughness: response.z as Node<'float'>,
        dryingSpeed: response.w as Node<'float'>,
        puddleResponse,
      },
    },
    conditions,
    {
      quality: settings.quality,
      geometryNormal: space.normal,
      shelter: keep('wetShelter', uniform(new Vector2(...settings.shelter))),
      ...(isFull
        ? {
            heightInfluence: keep('wetHeightInfluence', uniform(settings.heightInfluence)),
            cavityInfluence: keep('wetCavityInfluence', uniform(settings.cavityInfluence)),
          }
        : {}),
      ...(puddles ? { puddles } : {}),
      ...(ripples ? { ripples } : {}),
      ...(streaks ? { streaks } : {}),
      ...(shoreline ? { shoreline } : {}),
    }
  );
  return {
    ...surface,
    albedo: wet.albedo,
    roughness: wet.roughness,
    normal: wet.normal ?? surface.normal,
    masks: wet.masks,
  };
};
