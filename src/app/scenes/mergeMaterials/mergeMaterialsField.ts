import type * as THREE from 'three/webgpu';
import {
  ComponentType,
  createCameraEntity,
  createMeshEntity,
  getECSWorld,
  getRenderer,
  setMainCamera,
} from 'aekasha';
import { getMergeGroupOf, type MeshMergeDef } from 'aekasha/merging';
import { nextFrames } from '../../shared/verifyHarness';

/**
 * The `mergeMaterials` scene's field (docs/plans/p374_multi-material-merging.md, Phase 3, D5's
 * test scene): 1 600 meshes, 400 of each `ruinsPalette` member (Phase 0's shapes, each material
 * on every shape), on a 40 × 40 grid over 3 × 3 cells of the scene's `AUTO` cell size, away from
 * the verification variants at the origin and seen by a camera of its own. Made in one of four
 * modes:
 * - `PALETTE`: `merge: 'AUTO'`, so the scene's `AUTO` entry's `palettes: ["ruinsPalette"]` puts
 *   the four materials of a cell into one group, drawn by the merge material (9 groups of ~86 k
 *   vertices, so each has a 32-bit index);
 * - `PALETTE_16`: the same with `maxVertices: 65535`, so each group keeps a 16-bit index (Phase 4,
 *   D5's measurements: two groups a cell);
 * - `MATERIAL`: `merge: { palettes: [] }`, one group per material and cell (36);
 * - `UNMERGED`: no `merge`, a draw per mesh.
 *
 * `showFieldAsync(mode)` deletes the field it showed before, makes the new one, waits for its
 * groups' builds (the palette groups build in the assets worker: each is over 65 536 vertices)
 * and counts its groups and draws.
 *
 * Two views (Phase 4, D5's measurements): `OVERVIEW`, the whole field from above (every group in
 * view, the meshes small: what the draws cost), and `CLOSE`, low over its near edge, where the
 * meshes fill the frame and hide each other (what a pixel costs). `setFieldView(view)` switches.
 */

/** The field's modes */
export const FIELD_MODES = ['PALETTE', 'PALETTE_16', 'MATERIAL', 'UNMERGED'] as const;
export type FieldMode = (typeof FIELD_MODES)[number];

/** The field's views: from above, or low over its near edge */
export const FIELD_VIEWS = ['OVERVIEW', 'CLOSE'] as const;
export type FieldView = (typeof FIELD_VIEWS)[number];

/** One mode's figures: its meshes, the merge groups they're in, the frame's draws */
export type FieldFigures = { meshes: number; groups: number; draws: number };

/** The scene JSON's `AUTO` `cellSize` */
const CELL_SIZE = 8;
const CELLS = 3;
/** The field's first cell on x and z: far from the variants at the origin */
const FIRST_CELL = 10;
const GRID = 40;
const SPACING = (CELL_SIZE * CELLS) / GRID;
const MESH_SCALE = 0.42;
const SHAPES = ['sphere', 'box', 'torus', 'cylinder'];
/** How long a merged field may take to build before the wait gives up */
const MAX_BUILD_FRAMES = 600;

const ORIGIN = FIRST_CELL * CELL_SIZE;
const CENTRE = ORIGIN + (CELL_SIZE * CELLS) / 2;
/** The field's +z edge, the close view's side */
const EDGE_Z = ORIGIN + CELL_SIZE * CELLS;

const MERGE_DEFS: Record<FieldMode, MeshMergeDef | undefined> = {
  PALETTE: 'AUTO',
  // The merge writes a 16-bit index up to 65 535 vertices
  PALETTE_16: { maxVertices: 65535 },
  MATERIAL: { palettes: [] },
  UNMERGED: undefined,
};

type FieldOptions = {
  /** The palette's member materials, by palette index */
  members: THREE.Material[];
  /** A shape's registered geometry (the scene's own) */
  getGeometry: (shape: string) => THREE.BufferGeometry;
  /** The variants' camera, made the main one again when the field is hidden */
  variantsCameraId: number;
};

/** Makes the field's camera, and returns the function that shows a mode (or none) */
export const createField = ({ members, getGeometry, variantsCameraId }: FieldOptions) => {
  const cameraIds: Record<FieldView, number> = {
    OVERVIEW: createCameraEntity(
      {
        type: 'PERSPECTIVE',
        fov: 50,
        position: { x: CENTRE, y: 18, z: CENTRE + 30 },
        lookAtPoint: { x: CENTRE, y: 0, z: CENTRE },
      },
      { appId: 'mergeMaterialsFieldCam', debugData: { name: 'Merge materials field' } }
    ),
    CLOSE: createCameraEntity(
      {
        type: 'PERSPECTIVE',
        fov: 50,
        position: { x: CENTRE, y: 2.5, z: EDGE_Z + 0.4 },
        lookAtPoint: { x: CENTRE, y: 0, z: EDGE_Z - 4 },
      },
      { appId: 'mergeMaterialsFieldCloseCam', debugData: { name: 'Merge materials field, close' } }
    ),
  };
  let view: FieldView = 'OVERVIEW';
  let entityIds: number[] = [];

  const createMeshes = (merge: MeshMergeDef | undefined) => {
    const ids: number[] = [];
    for (let gx = 0; gx < GRID; gx++) {
      for (let gz = 0; gz < GRID; gz++) {
        // 400 of each material, each on every shape
        const material = members[(gx + gz) % members.length];
        const shape = SHAPES[gx % SHAPES.length];
        const angle = ((gx * GRID + gz) * 0.618) % (Math.PI * 2);
        ids.push(
          createMeshEntity({
            geo: getGeometry(shape),
            mat: material,
            position: {
              x: ORIGIN + (gx + 0.5) * SPACING,
              y: 0.25,
              z: ORIGIN + (gz + 0.5) * SPACING,
            },
            rotation: { x: angle * 0.5, y: angle, z: 0 },
            scale: { x: MESH_SCALE, y: MESH_SCALE, z: MESH_SCALE },
            ...(merge !== undefined && { merge }),
          })
        );
      }
    }
    return ids;
  };

  /** Resolves once every mesh is drawn merged (its group built), or throws after the cap */
  const waitForBuildsAsync = async (ids: number[]) => {
    const world = getECSWorld();
    for (let frame = 0; frame < MAX_BUILD_FRAMES; frame++) {
      const isBuilt = ids.every(
        (id) => (world.getComponent(id, ComponentType.MERGE_MEMBER)?.partIndex ?? -1) !== -1
      );
      if (isBuilt) return;
      await nextFrames(1);
    }
    throw new Error(`The field's merge groups didn't build in ${MAX_BUILD_FRAMES} frames.`);
  };

  /** Shows a mode's field (the one shown before deleted), or none: its figures */
  const showFieldAsync = async (mode: FieldMode | 'NONE'): Promise<FieldFigures | undefined> => {
    const world = getECSWorld();
    for (const id of entityIds) if (world.isAlive(id)) world.deleteEntity(id);
    entityIds = [];
    if (mode === 'NONE') {
      setMainCamera(world, variantsCameraId);
      return undefined;
    }
    setMainCamera(world, cameraIds[view]);
    const merge = MERGE_DEFS[mode];
    entityIds = createMeshes(merge);
    if (merge !== undefined) await waitForBuildsAsync(entityIds);
    await nextFrames(3);
    const groups = new Set(entityIds.map((id) => getMergeGroupOf(id)).filter(Boolean));
    const renderer = getRenderer() as unknown as { info: { render: { drawCalls: number } } };
    return { meshes: entityIds.length, groups: groups.size, draws: renderer.info.render.drawCalls };
  };

  /** Switches the field's camera (the next field shown keeps it); a frame later it draws so */
  const setFieldView = (next: FieldView) => {
    view = next;
    if (entityIds.length) setMainCamera(getECSWorld(), cameraIds[view]);
  };

  return { showFieldAsync, setFieldView };
};
