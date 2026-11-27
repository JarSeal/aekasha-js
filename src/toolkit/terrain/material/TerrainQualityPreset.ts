// The terrain material's suggested quality tiers (p305 D10, measured in the gallery in Phases 6 and
// 7): a `quality` table to spread into a config, each tier its anti-tiling and sparse sampling, its
// far surface when asked for, and the cliff layers' projection and the live layers' source through
// the tier's `layers` entries (a tier's material-wide fields don't reach a layer's own). Plain data from the config's types: no zod, nothing compiled until a tier's
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
  // p305 Phase 8
  /**
   * The live layers (`source: 'PROCEDURAL_LIVE'`), by index: `LOW` and `MEDIUM` sample their set's
   * bake (`source: 'TEXTURE'`), `HIGH` and `ULTRA` run them live (default none). A live layer
   * about doubled a 48 m block's cost with the cheapest generator.
   */
  liveLayers?: readonly number[];
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
  /** Whether the live layers run live, else their bake */
  isLive: boolean;
};

/** `ULTRA`'s detail normals' fade end, without a far surface: `HIGH`'s far start */
const ULTRA_FADE_TO = 200;

// p305 D10's table
/** The tiers (macro on in every tier, the material's own) */
const PRESET_TIERS: Record<TerrainQualityLevel, PresetTier> = {
  LOW: {
    antiTiling: { mode: 'NONE' },
    maxLayers: 2,
    cliffs: { mode: 'BIPLANAR', isGated: true },
    farFrom: 60,
    isLive: false,
  },
  MEDIUM: {
    antiTiling: { mode: 'DUAL_SCALE' },
    maxLayers: 3,
    cliffs: { mode: 'TRIPLANAR', isGated: true },
    farFrom: 120,
    isLive: false,
  },
  HIGH: {
    antiTiling: { mode: 'HEX', apply: 'DOMINANT' },
    maxLayers: 3,
    cliffs: { mode: 'TRIPLANAR', isGated: true },
    farFrom: 200,
    isLive: true,
  },
  ULTRA: {
    antiTiling: { mode: 'HEX' },
    maxLayers: 4,
    cliffs: { mode: 'TRIPLANAR', isGated: false },
    farFrom: null,
    isLive: true,
  },
};

const DEFAULT_CLIFF_GATE: [number, number] = [35, 50];

// p305 D10
// The tiers' costs: p305 Phase 6
/**
 * The suggested quality tiers of a terrain material, a `quality` table for its config:
 * each tier's anti-tiling (`LOW` none, `MEDIUM` `DUAL_SCALE`, `HIGH` `HEX` on the dominant layer
 * and `DUAL_SCALE` on the others, `ULTRA` `HEX` on all), sparse sampling (`LOW` 2 layers a pixel,
 * `MEDIUM` and `HIGH` 3, `ULTRA` 4), the cliff layers' projection, and with `far` the far surface
 * (`LOW` from 60 m, `MEDIUM` 120 m, `HIGH` 200 m, `ULTRA` none), and with `liveLayers` their
 * bake on `LOW` and `MEDIUM`, their generator live on `HIGH` and `ULTRA`. On an 8-layer terrain at
 * 1080p (an AMD RDNA 3 GPU) `LOW` cost about half of `MEDIUM`, `HIGH` about a fifth
 * more than `MEDIUM` (1.7 ms for the whole frame) and `ULTRA` 1.7-2.6 × `HIGH`. Sparse sampling and
 * `DOMINANT` read the layers from a set array: the code route's `storage: 'AUTO'` takes `ARRAY`
 * for such a material, whose set array must be built (a scene's `textureSetArrays`, or
 * `buildTextureSetArray`). A layer's own anti-tiling must then be the tier's mode, every layer
 * sampled alike. A tier's variant is `getTerrainMaterialVariant(id, level)`.
 * @param opts the cliff layers and their slope gate, the far surface, the live layers
 * @returns the `quality` table: `LOW`, `MEDIUM`, `HIGH` and `ULTRA`
 * @throws for a cliff or live layer that isn't a whole number of 0 or more
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
  const liveLayers = opts.liveLayers ?? [];
  const cliffGate = opts.cliffGate ?? DEFAULT_CLIFF_GATE;
  for (const [kind, layers] of [
    ['cliff', cliffLayers],
    ['live', liveLayers],
  ] as const) {
    for (const layer of layers) {
      if (!Number.isInteger(layer) || layer < 0) {
        throw new Error(
          `[terrain] getTerrainQualityPreset: ${kind} layer ${layer} isn't a layer index (a whole number of 0 or more).`
        );
      }
    }
  }
  const named = [...cliffLayers, ...liveLayers];
  const length = named.length ? Math.max(...named) + 1 : 0;
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
    isLive,
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
            layers: Array.from({ length }, (_, i) => ({
              ...(liveLayers.includes(i)
                ? { source: isLive ? ('PROCEDURAL_LIVE' as const) : ('TEXTURE' as const) }
                : {}),
              ...(cliffLayers.includes(i) ? { projection: { ...projection } } : {}),
            })),
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
