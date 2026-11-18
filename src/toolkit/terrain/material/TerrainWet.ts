// The terrain material's wet response (p307 D2): the blended surface wet by the surface conditions
// (`nodes/Wet.ts`' `applySurfaceWetness`) after the layers, the far branch and the macro, its
// relief the layers' blended height, its response their sets' `porosity`, `wetDarkening`,
// `wetRoughness` and `dryingSpeed` by weight, its cavities the AO. The conditions are the
// `surfaceConditions()` feature's stable uniforms; without the feature the material builds dry,
// warned once a page load.
import { float, uniform } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import { Vector2, type Node, type NodeMaterial } from 'three/webgpu';
import { lwarn } from 'aekasha';
import { getSurfaceConditionNodes } from 'aekasha/surface';
import type { SurfaceSpace } from '../nodes/SurfaceSpace';
import { applySurfaceWetness, type SurfaceWetnessMasks } from '../nodes/Wet';
import type { ResolvedTerrainDefine } from './TerrainDefine';
import { keepUniform, type LayerWet } from './TerrainLayers';

/** Whether a material with `wet` has warned that the feature isn't installed (once a page load) */
let isMissingFeatureWarned = false;

/**
 * The surface the wet response gets: the albedo, the roughness, the shaded normal in the
 * material's space, the AO (the material's `aoNode`, or null) and what the layers' wet reads
 * @internal
 */
export type TerrainWetInput = {
  albedo: Node<'vec3'>;
  roughness: Node<'float'>;
  normal: Node<'vec3'>;
  ao: Node<'float'> | null;
  wet: LayerWet | null;
};

/**
 * The surface wet by the surface conditions with the define's `wet` (uniforms
 * `terrain_wetShelter`, and with `FULL` `terrain_wetHeightInfluence` and
 * `terrain_wetCavityInfluence`), and its masks (the `WETNESS` view's); as given, masks null,
 * without `wet` or without the `surfaceConditions()` feature (warned once a page load).
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
  const keep = <T>(name: string, node: unknown) => keepUniform(material, name, node) as T;
  const isFull = settings.quality === 'FULL';
  const { height, response, puddleResponse } = surface.wet;
  const wet = applySurfaceWetness(
    {
      albedo: surface.albedo,
      roughness: surface.roughness,
      normal: surface.normal,
      height,
      ...(surface.ao ? { cavity: float(1).sub(surface.ao) as Node<'float'> } : {}),
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
