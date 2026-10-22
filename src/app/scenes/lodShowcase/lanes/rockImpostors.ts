import { createMeshEntity, existsOrThrow } from 'aekasha';
import type { ShowcaseLane } from '../layout';
import {
  createLargeWorldRockMaterial,
  generateLargeWorldRockImpostor,
  saveLargeWorldRockGeometry,
} from '../../../shared/largeWorldRock';

/** Not exported: baked at load. */
const BAKED_ID = 'lodShowcaseRockBaked';
/** The rows' distances from the start camera. */
const ROW_DISTANCES = [33, 55, 95];
/** Between the rocks of a row. */
const SPACING = 3;

/**
 * The baked against exported lane: the large world's rock (`src/app/shared/largeWorldRock.ts`,
 * so its export's fingerprint matches), in rows of three: its octahedral impostor baked at load,
 * the mesh, and the impostor built from the export. Both impostors are drawn as plain meshes,
 * held at the impostor level (no LOD), so they can be compared with each other and with the mesh
 * at any distance.
 */
export const rockImpostorsLane: ShowcaseLane = {
  id: 'rockImpostors',
  title: 'Baked against exported',
  description:
    'The same rock in rows of three: an octahedral impostor baked at load, the mesh, and the impostor loaded from its export.',
  create: async (ctx) => {
    const rockGeo = saveLargeWorldRockGeometry('lodShowcaseRockGeo');
    const rockMat = createLargeWorldRockMaterial('lodShowcaseRockMat');
    const baked = generateLargeWorldRockImpostor(rockGeo, rockMat, BAKED_ID);
    const exported = generateLargeWorldRockImpostor(rockGeo, rockMat);

    rockGeo.computeBoundingBox();
    // Resting on the ground
    const y = -existsOrThrow(rockGeo.boundingBox, 'The rock has no bounding box.').min.y;
    const columns = [
      { name: 'baked impostor', geo: baked.geometry, mat: baked.material },
      { name: 'mesh', geo: rockGeo, mat: rockMat },
      { name: 'exported impostor', geo: exported.geometry, mat: exported.material },
    ];

    const entityIds: number[] = [];
    ROW_DISTANCES.forEach((distance, row) => {
      const { x, z } = ctx.placeAt(distance, y);
      columns.forEach((column, i) => {
        entityIds.push(
          createMeshEntity(
            {
              geo: column.geo,
              mat: column.mat,
              castShadow: true,
              receiveShadow: true,
              position: { x: x + (i - 1) * SPACING, y, z },
            },
            {
              appId: `lodShowcaseRock_${row}_${i}`,
              debugData: {
                name: `LOD showcase: rock, ${column.name} (${distance} m)`,
                description: `The baked against exported lane's row at ${distance} m from the start camera: baked impostor, mesh, exported impostor (left to right).`,
              },
            },
            ctx.world
          )
        );
      });
    });

    return { getEntityIds: () => entityIds, radius: 0, switchDistances: [] };
  },
};
