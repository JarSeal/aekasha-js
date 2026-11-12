import * as THREE from 'three/webgpu';
import { createMaterial, createMeshEntity, getGeometry, saveBufferGeometry } from 'aekasha';
import type { LodDef } from 'aekasha/lod';
import { createMergeGroup } from 'aekasha/merging';
import { getConservativeGeometryRadius } from 'aekasha/spatial';
import type { ShowcaseLane } from '../layout';

/** The lane's merge group (scene-scoped: made again on every visit). */
const GROUP_ID = 'lodShowcaseBatch';

/** Each shape's levels, finest first: the same shape at fewer segments. About 1 m in radius, so
 * one level definition switches them all at about the same distances. */
const SHAPES: { name: string; levels: (() => THREE.BufferGeometry)[] }[] = [
  {
    name: 'sphere',
    levels: [
      () => new THREE.SphereGeometry(1, 32, 16),
      () => new THREE.SphereGeometry(1, 16, 8),
      () => new THREE.SphereGeometry(1, 8, 4),
    ],
  },
  {
    name: 'torus',
    levels: [
      () => new THREE.TorusGeometry(0.7, 0.3, 16, 48),
      () => new THREE.TorusGeometry(0.7, 0.3, 8, 24),
      () => new THREE.TorusGeometry(0.7, 0.3, 4, 12),
    ],
  },
  {
    name: 'capsule',
    levels: [
      () => new THREE.CapsuleGeometry(0.5, 1, 8, 32),
      () => new THREE.CapsuleGeometry(0.5, 1, 4, 12),
      () => new THREE.CapsuleGeometry(0.5, 1, 2, 6),
    ],
  },
];

/** The hand-made lane's thresholds: a batched member's levels switch as a plain mesh's would. */
const SCREEN_SIZES = [0.06, 0.025, 0];
const LOD: Omit<LodDef, 'levels'> = { cullScreenSize: 0.01 };

/** A shape's level geometry id. */
const getLevelId = (shape: string, level: number) => `lodShowcaseBatch_${shape}Lod${level}`;

/**
 * The batched members lane: per-member LOD in a `BATCHED` merge group (p375). Three shapes
 * (sphere, torus, capsule), each with hand-made levels, side by side in every band: one batch
 * draws them all, each member at its own level, with the cross-fades and the cull fade of a plain
 * mesh, a draw per geometry and level in use on WebGPU.
 */
export const batchedMembersLane: ShowcaseLane = {
  id: 'batchedMembers',
  title: 'Batched group',
  description:
    'A BATCHED merge group of three shapes with hand-made levels each: one batch, every member at its own level and fading on its own.',
  create: async (ctx) => {
    let radius = 0;
    for (const shape of SHAPES) {
      shape.levels.forEach((make, level) => {
        const id = getLevelId(shape.name, level);
        const geometry = getGeometry(id) ?? saveBufferGeometry(make(), { id });
        if (level === 0) radius = Math.max(radius, getConservativeGeometryRadius(geometry));
      });
    }
    const material = createMaterial({
      id: 'lodShowcaseBatchMat',
      type: 'STANDARD',
      params: { color: '#c2a878', roughness: 0.7, metalness: 0 },
    });
    createMergeGroup(
      { id: GROUP_ID, mode: 'BATCHED', castShadow: true, receiveShadow: true },
      ctx.world
    );

    const def: LodDef = { ...LOD, levels: SCREEN_SIZES.map((screenSize) => ({ screenSize })) };
    // One of each shape in every level's band, one past the cull distance
    const slots = ctx.getSlots(radius, def, SHAPES.length);
    const entityIds = slots.map((slot, i) => {
      const shape = SHAPES[i % SHAPES.length];
      // #region batched-lod-member (shown in the Hub: Mesh merging, Per-member LOD)
      return createMeshEntity(
        {
          geo: getLevelId(shape.name, 0),
          mat: material,
          castShadow: true,
          receiveShadow: true,
          // Standing on the ground (each shape is about 1 m in radius around its centre)
          position: ctx.placeAt(slot.distance, 1),
          lod: {
            ...LOD,
            levels: SCREEN_SIZES.map((screenSize, level) =>
              level === 0 ? { screenSize } : { screenSize, geo: getLevelId(shape.name, level) }
            ),
          },
          merge: GROUP_ID,
        },
        {
          appId: `lodShowcaseBatch_${i}`,
          debugData: {
            name: `LOD showcase: batched ${shape.name} ${i}`,
            description: `A member of the "${GROUP_ID}" BATCHED merge group, ${slot.distance.toFixed(0)} m from the start camera (${slot.level < 0 ? 'LOD culled' : `level ${slot.level}`} there).`,
          },
          world: ctx.world,
        }
      );
      // #endregion batched-lod-member
    });

    return {
      getEntityIds: () => entityIds,
      radius,
      switchDistances: ctx.getSwitchDistances(radius, def),
    };
  },
};
