import { createMeshEntity, existsOrThrow, setMeshLod } from 'aekasha';
import { resolveAutoLod } from 'aekasha/lod';
import type { LodAutoDef } from 'aekasha/lod';
import { getConservativeGeometryRadius } from 'aekasha/spatial';
import type { ShowcaseLane } from '../layout';
import { getShowcaseKnot, getShowcaseKnotMaterial, SHOWCASE_KNOT_GEO_ID } from './showcaseKnot';

/** A quarter of AUTO's default pixel: at 1 px the knot keeps level 0 only within 5 m of the camera
 * and level 1 within 14 m, nearer than the lane starts. */
const KNOT_LOD: LodAutoDef = { auto: true, maxPixelError: 0.25 };

/**
 * Lane 2: a generated chain (docs/plans/_DONE_p347_lod-chain-generation.md) on plain meshes: a heavy
 * procedural torus knot with an AUTO `lod`, its chain simplified at load (in the assets worker).
 * Each level is used while its simplification error stays within a quarter pixel at 1080p, so the
 * thresholds come from the chain: the lane resolves them first to place the meshes.
 */
export const generatedChainLane: ShowcaseLane = {
  id: 'generatedChain',
  title: 'Generated chain',
  description:
    'A 16k-triangle torus knot with lod { auto: true, maxPixelError: 0.25 }, its LOD chain simplified at load.',
  create: async (ctx) => {
    const { geometry } = getShowcaseKnot();
    const material = getShowcaseKnotMaterial();
    const radius = getConservativeGeometryRadius(geometry);
    // Standing on the ground (the knot lies in its xy plane, facing the camera)
    const y = -existsOrThrow(geometry.boundingBox, 'The knot has no bounding box.').min.y;

    const create = (index: number, distance: number) =>
      createMeshEntity(
        {
          geo: geometry,
          mat: material,
          castShadow: true,
          receiveShadow: true,
          position: ctx.placeAt(distance, y),
        },
        {
          appId: `lodShowcaseKnot_${index}`,
          debugData: {
            name: `LOD showcase: generated chain ${index}`,
            description: `${distance.toFixed(0)} m from the start camera.`,
          },
        },
        ctx.world
      );

    // The levels AUTO resolves to (it waits for the chain), to place the meshes by
    const def = await resolveAutoLod(geometry, KNOT_LOD, SHOWCASE_KNOT_GEO_ID);
    if (!def) {
      const id = create(0, 0);
      return { getEntityIds: () => [id], radius, switchDistances: [] };
    }
    const entityIds = ctx.getSlots(radius, def).map((slot, i) => create(i, slot.distance));
    // Each mesh resolves its own, as app code would
    await Promise.all(entityIds.map((id) => setMeshLod(id, KNOT_LOD, ctx.world)));

    return {
      getEntityIds: () => entityIds,
      radius,
      switchDistances: ctx.getSwitchDistances(radius, def),
    };
  },
};
