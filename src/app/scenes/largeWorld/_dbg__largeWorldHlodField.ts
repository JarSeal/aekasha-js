import type * as THREE from 'three/webgpu';
import {
  ComponentType,
  createMaterial,
  createMeshEntity,
  createSeededRandom,
  getEntityIdByAppId,
  llog,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { createRuins } from './largeWorldRuins';
import type { RuinMaterials, RuinSite } from './largeWorldRuins';

// p376 Phase 0 step 3 (docs/plans/p376_hlod-merged-cluster-proxies.md §3): `?hlodField=<sites>`
// adds that many ruin sites (`largeWorldRuins.ts`' kit) in a ring 200 m-1 km from the origin,
// past the 200 m terrain, on a flat ground of their own at y = 0, merged `AUTO` in 32 m cells:
// the kit-terrain far field p370 §10 makes HLOD for. The overview camera's far plane goes to
// 3 km so the ring isn't clipped. The same field on every load (seeded).

const RING = { inner: 200, outer: 1000 };
const FIELD_SEED = 3760;
const CELL_SIZE = 32;
const GROUND_SIZE = 2 * (RING.outer + 200);
const CAMERA_FAR = 3000;

/** `count` sites spread evenly over the ring's area, each 4-7 × 3-5 tiles, turned at random. */
const createFieldSites = (count: number): RuinSite[] => {
  const random = createSeededRandom(FIELD_SEED);
  const inner2 = RING.inner * RING.inner;
  const outer2 = RING.outer * RING.outer;
  return Array.from({ length: count }, () => {
    const radius = Math.sqrt(inner2 + random() * (outer2 - inner2));
    const theta = random() * Math.PI * 2;
    return {
      x: Math.cos(theta) * radius,
      z: Math.sin(theta) * radius,
      cols: 4 + Math.floor(random() * 4),
      rows: 3 + Math.floor(random() * 3),
      angle: random() * Math.PI,
    };
  });
};

/** With `?hlodField=<sites>`: the far field, its ground and the camera's far plane; else nothing. */
export const createHlodField = (world: ECSWorld, materials: RuinMaterials) => {
  const count = Math.floor(Number(new URLSearchParams(window.location.search).get('hlodField')));
  if (!(count > 0)) return;

  // The ground: its top just under the terrain's lowest point (0), so the terrain covers it
  createMeshEntity(
    {
      geo: { type: 'BOX', params: { width: GROUND_SIZE, height: 0.2, depth: GROUND_SIZE } },
      mat: createMaterial({
        id: 'largeWorldHlodFieldGroundMat',
        type: 'PHONG',
        params: { color: '#55784a' },
      }),
      receiveShadow: true,
      position: { x: 0, y: -0.15, z: 0 },
    },
    { appId: 'largeWorldHlodFieldGround', debugData: { name: 'HLOD field ground' }, world }
  );
  createRuins(world, () => 0, materials, {
    sites: createFieldSites(count),
    seed: FIELD_SEED,
    merge: { group: 'AUTO', cellSize: CELL_SIZE },
  });

  const cameraId = getEntityIdByAppId('largeWorldOverview', world);
  const camera =
    cameraId === undefined
      ? undefined
      : (world.getComponent(cameraId, ComponentType.OBJECT3D)?.value as
          | THREE.PerspectiveCamera
          | undefined);
  if (camera?.isPerspectiveCamera) {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }
  llog(
    `[HLOD spike] Far field: ${count} ruin sites ${RING.inner}-${RING.outer} m out, AUTO cells of ${CELL_SIZE} m; camera far ${camera ? CAMERA_FAR : '(no overview camera)'}.`
  );
};
