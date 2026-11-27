// Structure materials (p305 D8): concrete walls, bunkers, rock faces and other large pieces, the
// terrain material with a structure's defaults. A thin preset: the config `createTerrainMaterial`
// gets, its fields over the defaults (object space, so the texture sticks to a piece that moves or
// turns; triplanar, a structure's faces point every way; dual-scale anti-tiling; a macro at a
// structure's scale). Wear layers are a painted blend (`VERTEX_COLOR`, `RGBA`: clean, stained,
// damaged), and decals (p309) add unique detail.
import { createTerrainMaterial } from './TerrainMaterial';
import type { TerrainLayer, TerrainMaterialConfig } from './TerrainMaterialConfig';

/** The macro's tile on a structure, metres: stains a few metres across, not a valley's */
const STRUCTURE_MACRO_SCALE = 12;

/**
 * What {@link createStructureMaterial} takes beside its layers: a terrain material config's fields
 * (its id required), each over the structure's default.
 */
export type StructureMaterialOpts = Partial<Omit<TerrainMaterialConfig, 'id' | 'layers'>> & {
  /** The material's registry id. */
  id: string;
};

// p305 D8
/**
 * A structure material's config: the terrain material's with a structure's defaults,
 * `space: 'OBJECT'` (the texture sticks to the piece; `WORLD` for static pieces that must run on
 * seamlessly), `TRIPLANAR` projection, `DUAL_SCALE` anti-tiling and a `macroNoise` macro at 12 m,
 * each replaced by the options' field (`macro: undefined` for none). Load its textures with
 * `ensureMaterialDependencies(getTerrainMaterialProps(config))` when no scene lists its sets.
 * @param layers a texture set's id (one layer), or the layers (wear: a painted blend)
 * @param opts the id and any terrain material field over the defaults
 * @returns the config, for `createTerrainMaterial` or `getTerrainMaterialProps`
 * @example
 * ```ts
 * import { getStructureMaterialConfig, getTerrainMaterialProps } from 'aekasha/toolkit/terrain';
 * import { ensureMaterialDependencies } from 'aekasha';
 *
 * const config = getStructureMaterialConfig('concrete02', { id: 'bunkerConcrete' });
 * await ensureMaterialDependencies(getTerrainMaterialProps(config));
 * ```
 */
export const getStructureMaterialConfig = (
  layers: string | TerrainLayer[],
  opts: StructureMaterialOpts
): TerrainMaterialConfig => ({
  space: 'OBJECT',
  projection: { mode: 'TRIPLANAR' },
  antiTiling: { mode: 'DUAL_SCALE' },
  macro: { texture: 'macroNoise', scale: STRUCTURE_MACRO_SCALE },
  ...opts,
  layers: typeof layers === 'string' ? [{ set: layers }] : layers,
});

// p305 D8
/**
 * Creates a structure material: a terrain material for concrete walls, bunkers, rock
 * faces and other large pieces, in the piece's own space (`OBJECT`: the texture sticks to a piece
 * that moves or turns; an `InstancedMesh`'s instances share its space), projected `TRIPLANAR`,
 * `DUAL_SCALE` anti-tiled, a `macroNoise` macro at 12 m; the options' fields over these (see
 * {@link getStructureMaterialConfig}). Its sets must be loaded, as for `createTerrainMaterial`.
 * @param layers a texture set's id (one layer), or the layers: eg. clean, stained and damaged
 * concrete weighed by the vertex colour (`blend: { source: 'VERTEX_COLOR', vertexColor: { layout:
 * 'RGBA' } }`)
 * @param opts the id and any terrain material field over the defaults
 * @returns the registered material
 * @throws for a config the terrain material refuses
 * @example
 * ```ts
 * import { createMeshEntity } from 'aekasha';
 * import { createStructureMaterial } from 'aekasha/toolkit/terrain';
 *
 * // Damaged concrete on a wall, its stains sticking to it when it moves
 * const concrete = createStructureMaterial('concrete02', { id: 'wallConcrete' });
 * createMeshEntity({ geo: 'wallPiece', mat: concrete });
 * ```
 */
export const createStructureMaterial = (
  layers: string | TerrainLayer[],
  opts: StructureMaterialOpts
) => createTerrainMaterial(getStructureMaterialConfig(layers, opts));
