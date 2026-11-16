// The terrain material's suggested quality tiers (p305 D10, measured in the gallery in Phases 6 and
// 7): a `quality` table to spread into a config, each tier its anti-tiling and sparse sampling, its
// far surface when asked for, and the cliff layers' projection through the tier's `layers` entries (a tier's material-wide fields don't
// reach a layer's own). Plain data from the config's types: no zod, nothing compiled until a tier's
// variant is asked for (`getTerrainMaterialVariant`).
import type { TerrainQualityLevel } from './TerrainMaterial';
import type {
  TerrainAntiTiling,
  TerrainProjection,
  TerrainQualityOverrides,
} from './TerrainMaterialConfig';

/** What {@link getTerrainQualityPreset} tunes per material. */
export type TerrainQualityPresetOpts = {
  /**
   * The layers projected on steep slopes (cliffs, rock faces), by index: `BIPLANAR` slope-gated on
   * `LOW`, `TRIPLANAR` slope-gated on `MEDIUM` and `HIGH`, `TRIPLANAR` on `ULTRA` (default none:
   * every layer stays as it is).
   */
  cliffLayers?: readonly number[];
  /** The slopes in degrees over which a cliff layer's projection fades in (default `[35, 50]`). */
  cliffGate?: [number, number];
  /**
   * The far surface the tiers switch to (`distance.far`, default none: the material's own
   * `distance` in every tier): `LOW` from 60 m, `MEDIUM` from 120 m, `HIGH` from 200 m, `ULTRA`
   * none (its detail normals fading out by 200 m), the detail normals fading from half that.
   * `COLOR_MAP` needs the material's `colorMap`, `AVERAGE_COLOR` its sets' average colours (and no
   * `DETAIL` colour map).
   */
  far?: 'AVERAGE_COLOR' | 'COLOR_MAP';
};

/**
 * A tier's settings: its anti-tiling, the layers it keeps, its cliffs' projection, where its far
 * surface starts (metres; null for none, the normals fading out by `farFrom`'s `ULTRA` value)
 */
type PresetTier = {
  antiTiling: TerrainAntiTiling;
  maxLayers: number;
  cliffs: { mode: 'BIPLANAR' | 'TRIPLANAR'; isGated: boolean };
  farFrom: number | null;
};

/** `ULTRA`'s detail normals' fade end, without a far surface: `HIGH`'s far start */
const ULTRA_FADE_TO = 200;

/** The tiers (p305 D10's table; macro on in every tier, the material's own) */
const PRESET_TIERS: Record<TerrainQualityLevel, PresetTier> = {
  LOW: {
    antiTiling: { mode: 'NONE' },
    maxLayers: 2,
    cliffs: { mode: 'BIPLANAR', isGated: true },
    farFrom: 60,
  },
  MEDIUM: {
    antiTiling: { mode: 'DUAL_SCALE' },
    maxLayers: 3,
    cliffs: { mode: 'TRIPLANAR', isGated: true },
    farFrom: 120,
  },
  HIGH: {
    antiTiling: { mode: 'HEX', apply: 'DOMINANT' },
    maxLayers: 3,
    cliffs: { mode: 'TRIPLANAR', isGated: true },
    farFrom: 200,
  },
  ULTRA: {
    antiTiling: { mode: 'HEX' },
    maxLayers: 4,
    cliffs: { mode: 'TRIPLANAR', isGated: false },
    farFrom: null,
  },
};

const DEFAULT_CLIFF_GATE: [number, number] = [35, 50];

/**
 * The suggested quality tiers of a terrain material (p305 D10), a `quality` table for its config:
 * each tier's anti-tiling (`LOW` none, `MEDIUM` `DUAL_SCALE`, `HIGH` `HEX` on the dominant layer
 * and `DUAL_SCALE` on the others, `ULTRA` `HEX` on all), sparse sampling (`LOW` 2 layers a pixel,
 * `MEDIUM` and `HIGH` 3, `ULTRA` 4), the cliff layers' projection, and with `far` the far surface
 * (`LOW` from 60 m, `MEDIUM` 120 m, `HIGH` 200 m, `ULTRA` none). On an 8-layer terrain at
 * 1080p (p305 Phase 6, an AMD RDNA 3 GPU) `LOW` cost about half of `MEDIUM`, `HIGH` about a fifth
 * more than `MEDIUM` (1.7 ms for the whole frame) and `ULTRA` 1.7-2.6 × `HIGH`. Sparse sampling and
 * `DOMINANT` read the layers from a set array: the code route's `storage: 'AUTO'` takes `ARRAY`
 * for such a material, whose set array must be built (a scene's `textureSetArrays`, or
 * `buildTextureSetArray`). A layer's own anti-tiling must then be the tier's mode, every layer
 * sampled alike. A tier's variant is `getTerrainMaterialVariant(id, level)`.
 * @param opts the cliff layers and their slope gate, the far surface
 * @returns the `quality` table: `LOW`, `MEDIUM`, `HIGH` and `ULTRA`
 * @throws for a cliff layer that isn't a whole number of 0 or more
 * @example
 * ```ts
 * import {
 *   createTerrainMaterial,
 *   getTerrainMaterialVariant,
 *   getTerrainQualityPreset,
 * } from 'aekasha/toolkit/terrain';
 *
 * // A painted valley whose layer 3 is its cliffs, then its high tier
 * createTerrainMaterial({
 *   id: 'valley',
 *   layers: [{ set: 'grass01' }, { set: 'sand01' }, { set: 'rocks02' }, { set: 'cliffs01' }],
 *   blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
 *   quality: getTerrainQualityPreset({ cliffLayers: [3] }),
 * });
 * const valleyHigh = getTerrainMaterialVariant('valley', 'HIGH');
 * ```
 */
export const getTerrainQualityPreset = (
  opts: TerrainQualityPresetOpts = {}
): Record<TerrainQualityLevel, TerrainQualityOverrides> => {
  const cliffLayers = opts.cliffLayers ?? [];
  const cliffGate = opts.cliffGate ?? DEFAULT_CLIFF_GATE;
  for (const layer of cliffLayers) {
    if (!Number.isInteger(layer) || layer < 0) {
      throw new Error(
        `[terrain] getTerrainQualityPreset: cliff layer ${layer} isn't a layer index (a whole number of 0 or more).`
      );
    }
  }
  const length = cliffLayers.length ? Math.max(...cliffLayers) + 1 : 0;
  const getDistance = (farFrom: number | null): Pick<TerrainQualityOverrides, 'distance'> => {
    if (!opts.far) return {};
    if (farFrom === null) return { distance: { fade: [ULTRA_FADE_TO / 2, ULTRA_FADE_TO] } };
    return { distance: { fade: [farFrom / 2, farFrom], far: opts.far } };
  };
  const getTier = ({
    antiTiling,
    maxLayers,
    cliffs,
    farFrom,
  }: PresetTier): TerrainQualityOverrides => {
    const projection: TerrainProjection = {
      mode: cliffs.mode,
      ...(cliffs.isGated ? { slopeGate: [...cliffGate] as [number, number] } : {}),
    };
    return {
      antiTiling: { ...antiTiling },
      sparse: { maxLayers },
      ...getDistance(farFrom),
      ...(length
        ? {
            layers: Array.from({ length }, (_, i) =>
              cliffLayers.includes(i) ? { projection: { ...projection } } : {}
            ),
          }
        : {}),
    };
  };
  return {
    LOW: getTier(PRESET_TIERS.LOW),
    MEDIUM: getTier(PRESET_TIERS.MEDIUM),
    HIGH: getTier(PRESET_TIERS.HIGH),
    ULTRA: getTier(PRESET_TIERS.ULTRA),
  };
};
