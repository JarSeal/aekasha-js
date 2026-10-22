import {
  getEntityIdByAppId,
  getGeometry,
  getMaterial,
  createMeshEntity,
  existsOrThrow,
  lwarn,
} from 'aekasha';
import type { LodDef } from 'aekasha/lod';
import { getConservativeGeometryRadius } from 'aekasha/spatial';
import type { ShowcaseLane } from '../layout';

/** The lane's mesh JSON (lodShowcaseHandMade.mesh.json), listed in lodShowcase.scene.json. */
const MESH_APP_ID = 'lodShowcaseHandMade';

/**
 * The hand-made levels lane: levels on plain meshes, authored in JSON: three sphere geometries at fewer segments, the mesh's `lod` with a cull distance and its
 * own `fadeSeconds`. The JSON mesh is the lane's first object, in level 0's band; the lane puts
 * copies of its definition in the other bands.
 */
export const handMadeLevelsLane: ShowcaseLane = {
  id: 'handMadeLevels',
  title: 'Hand-made levels',
  description:
    'A *.mesh.json with `lod` levels (the same sphere at fewer segments), a cull distance and its own fadeSeconds.',
  create: async (ctx) => {
    const entry = ctx.sceneData.meshes?.find(
      (mesh) => typeof mesh !== 'string' && mesh.props.appId === MESH_APP_ID
    );
    const lod = entry && typeof entry !== 'string' ? entry.props.lod : undefined;
    if (!entry || typeof entry === 'string' || typeof lod !== 'object' || !('levels' in lod)) {
      throw new Error(
        `The lodShowcase scene needs the mesh "${MESH_APP_ID}" with lod levels (lodShowcaseHandMade.mesh.json).`
      );
    }
    const { props } = entry;
    const def: LodDef = lod;
    const geometry = existsOrThrow(
      typeof props.geo === 'string' ? getGeometry(props.geo) : undefined,
      `The lodShowcase scene needs the geometry of "${MESH_APP_ID}" by id.`
    );
    const material = existsOrThrow(
      typeof props.mat === 'string' ? getMaterial(props.mat) : undefined,
      `The lodShowcase scene needs the material of "${MESH_APP_ID}" by id.`
    );
    const radius = getConservativeGeometryRadius(geometry);
    const y = props.position?.y ?? radius;
    if (props.position?.x !== ctx.x) {
      lwarn(
        `[lodShowcase] "${MESH_APP_ID}" stands at x ${props.position?.x}, off its lane's line (x ${ctx.x}).`
      );
    }

    // The JSON mesh shows level 0: copies for every farther band
    const copyIds: number[] = [];
    const copySlots = ctx.getSlots(radius, def).filter((slot) => slot.level !== 0);
    copySlots.forEach((slot, i) => {
      copyIds.push(
        createMeshEntity(
          {
            ...props,
            // props.appId would win over the copy's own
            appId: undefined,
            geo: geometry,
            mat: material,
            position: ctx.placeAt(slot.distance, y),
          },
          {
            appId: `${MESH_APP_ID}_${i + 1}`,
            debugData: {
              name: `LOD showcase: hand-made levels ${i + 1}`,
              description: `A copy of ${MESH_APP_ID}, ${slot.distance.toFixed(0)} m from the start camera (${slot.level < 0 ? 'LOD culled' : `level ${slot.level}`} there).`,
            },
          },
          ctx.world
        )
      );
    });

    return {
      getEntityIds: () => {
        const jsonId = getEntityIdByAppId(MESH_APP_ID, ctx.world);
        return jsonId === undefined ? copyIds : [jsonId, ...copyIds];
      },
      radius,
      switchDistances: ctx.getSwitchDistances(radius, def),
    };
  },
};
