import * as THREE from 'three/webgpu';
import {
  ComponentType,
  createCameraEntity,
  createLightEntity,
  createMeshEntity,
  existsOrThrow,
  getActiveCamera,
  getECSWorld,
  getGeneratedSceneData,
  getGeometry,
  getMaterial,
  getRenderer,
  lerror,
  mergeGeometryParts,
  registerOnSceneExit,
  saveBufferGeometry,
  saveMaterial,
  saveTexture,
} from 'aekasha';
import { createMergeMaterialAsync, type SceneMergeMaterial } from 'aekasha/merging';
import {
  createField,
  FIELD_MODES,
  type FieldFigures,
  type FieldMode,
  type FieldView,
} from './mergeMaterialsField';
import {
  getBackendName,
  getErrorMessage,
  getHarnessHandles,
  nextFrames,
} from '../../shared/verifyHarness';

/**
 * p374's verification scene (docs/plans/_DONE_p374_multi-material-merging.md, Phase 2). The palette
 * `ruinsPalette` (four STANDARD materials: `ruinStone`, `ruinBrick`, `ruinMoss`, `ruinPlaster`,
 * each building its layers another way) on eight meshes, two per member (spheres, boxes, tori,
 * cylinders, one mirrored), drawn
 * - `REFERENCE`: as eight mesh entities with the members' own materials and textures;
 * - `BAKED`: the control, one geometry merged with a group per member and drawn by the four
 *   materials as a material array (four draws): it differs from `REFERENCE` only by the bake, so
 *   the merge material is compared with it;
 * - `MERGED`: one geometry merged with each part's palette index (`aekMatIndex`), drawn by the
 *   palette's merge material, which the scene's `mergeMaterials` list registers under
 *   `ruinsPalette` before this code runs;
 * - `SKIP`: the same geometry drawn by a merge material made from a copy of the palette's data
 *   with `missing: 'SKIP'` on `normalMap` and `orm` (over the same arrays), so the per-member
 *   branch compiles on the GPU too.
 *
 * The camera is orthographic (one view direction everywhere), so a variant shown alone at the
 * origin (`window.__mergeMaterials.show(variant)`) renders the same pixels as the control wherever
 * the merge material is right. `measureDraws()` counts each variant's draws.
 *
 * The field (Phase 3, `mergeMaterialsField.ts`): 1 600 meshes of the four members on 3 × 3 of the
 * scene's `AUTO` cells, merged by palette (`PALETTE`: the scene's `AUTO` `palettes`; `PALETTE_16`
 * capped at 65 535 vertices a group), by material (`MATERIAL`) or not (`UNMERGED`), seen by its own
 * camera: `field(mode)` shows one and resolves
 * with its groups and draws, `field('NONE')` goes back to the variants, `measureField()` counts
 * each mode, `fieldView('OVERVIEW' | 'CLOSE')` switches its camera (Phase 4's measurements).
 * `results` holds the draws, the field's figures, the backend and `ruinBrick`'s `normalScale` kind
 * (`done` once measured).
 */

const SCENE_ID = 'mergeMaterials';
const PALETTE_ID = 'ruinsPalette';
const SKIP_PALETTE_ID = 'ruinsPaletteSkip';
const VARIANTS = ['REFERENCE', 'BAKED', 'MERGED', 'SKIP'] as const;
type Variant = (typeof VARIANTS)[number];
/** Each variant's block when all are shown: a 2 × 2 grid */
const GRID_OFFSETS: Record<Variant, THREE.Vector3> = {
  REFERENCE: new THREE.Vector3(-2.6, 1.4, 0),
  BAKED: new THREE.Vector3(-2.6, -1.4, 0),
  MERGED: new THREE.Vector3(2.6, 1.4, 0),
  SKIP: new THREE.Vector3(2.6, -1.4, 0),
};
const GRID_ZOOM = 0.9;

// ---- Members ----

type Member = {
  geo: string;
  /** Palette index: `ruinsPalette.materials[mat]` */
  mat: 0 | 1 | 2 | 3;
  position: [number, number];
  rotation: [number, number, number];
  scale?: [number, number, number];
};

const MEMBERS: Member[] = [
  { geo: 'sphere', mat: 0, position: [-1.8, 0.6], rotation: [0.3, -0.5, 0] },
  { geo: 'box', mat: 1, position: [-0.6, 0.6], rotation: [0.5, 0.7, 0.1] },
  { geo: 'torus', mat: 2, position: [0.6, 0.6], rotation: [0.9, 0.2, 0] },
  { geo: 'cylinder', mat: 3, position: [1.8, 0.6], rotation: [0.4, 0, 0.3] },
  { geo: 'box', mat: 3, position: [-1.8, -0.6], rotation: [-0.4, 0.6, 0] },
  { geo: 'sphere', mat: 2, position: [-0.6, -0.6], rotation: [0.2, 1.1, 0] },
  { geo: 'cylinder', mat: 0, position: [0.6, -0.6], rotation: [-0.5, 0.3, 0.2] },
  // Mirrored and normal-mapped: the merge flips its winding, the reference mesh its front face
  { geo: 'torus', mat: 1, position: [1.8, -0.6], rotation: [0.7, -0.4, 0], scale: [-1, 1, 1] },
];

const GEOMETRIES: Record<string, () => THREE.BufferGeometry> = {
  sphere: () => new THREE.SphereGeometry(0.5, 40, 20),
  box: () => new THREE.BoxGeometry(0.75, 0.75, 0.75),
  torus: () => new THREE.TorusGeometry(0.34, 0.15, 20, 40),
  cylinder: () => new THREE.CylinderGeometry(0.35, 0.35, 0.8, 32),
};

const getMemberGeometry = (name: string) => {
  const id = `mergeMaterials/${name}`;
  return getGeometry(id) ?? saveBufferGeometry(GEOMETRIES[name](), { id });
};

const getMemberMatrix = (member: Member) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(member.position[0], member.position[1], 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...member.rotation)),
    new THREE.Vector3(...(member.scale ?? [1, 1, 1]))
  );

/** The scene data's palette (the gather inlined it: `mergeMaterials` in the scene JSON) */
const getScenePalette = () =>
  existsOrThrow(
    getGeneratedSceneData(SCENE_ID)?.mergeMaterials?.find((p) => p.id === PALETTE_ID),
    `The scene data has no palette "${PALETTE_ID}".`
  );

const getMemberMaterial = (palette: SceneMergeMaterial, index: number) =>
  existsOrThrow(
    getMaterial(palette.materials[index]),
    `No material "${palette.materials[index]}".`
  );

/** The control: the members merged with one geometry group per member material, drawn by the
 * materials themselves (a material array, one draw per group). It differs from the reference
 * only by the bake, so the merge material is checked against it. */
const createBakedGeometry = () =>
  saveBufferGeometry(
    mergeGeometryParts(
      MEMBERS.map((member, i) => ({
        geo: getMemberGeometry(member.geo),
        matrix: getMemberMatrix(member),
        materialSlot: member.mat,
        key: String(i),
      })),
      { groups: 'BY_SLOT' }
    ),
    { id: 'mergeMaterials/baked' }
  );

/** The members merged in block space, each part's vertices tagged with its palette index */
const createMergedGeometry = () =>
  saveBufferGeometry(
    mergeGeometryParts(
      MEMBERS.map((member, i) => ({
        geo: getMemberGeometry(member.geo),
        matrix: getMemberMatrix(member),
        paletteIndex: member.mat,
        key: String(i),
      }))
    ),
    { id: 'mergeMaterials/merged' }
  );

/** A merge material from a copy of the palette's data with `normalMap` and `orm` as `SKIP`,
 * over the palette's arrays: registered (with its table) under its own id, owned by the scene */
const createSkipMaterialAsync = async (palette: SceneMergeMaterial) => {
  const slots = { ...palette.__slots };
  for (const slot of ['normalMap', 'orm'] as const) {
    const info = existsOrThrow(slots[slot], `The palette has no "${slot}" slot.`);
    slots[slot] = { ...info, missing: 'SKIP' };
  }
  const tableId = `${SKIP_PALETTE_ID}.table`;
  const { material, table } = await createMergeMaterialAsync(
    { ...palette, id: SKIP_PALETTE_ID, __slots: slots },
    tableId
  );
  saveTexture(table, tableId);
  saveMaterial(material, SKIP_PALETTE_ID);
  return material;
};

// ---- The variants ----

/** A variant's entities and each one's position in its block */
type VariantEntities = { entityId: number; local: THREE.Vector3 }[];

/** The field of this visit (made with the scene) */
let field: ReturnType<typeof createField> | undefined;

/** What `window.__mergeMaterials` holds: the results and the console's handles */
const state = {
  ...getHarnessHandles(),
  results: {} as Record<string, unknown>,
  variants: {} as Partial<Record<Variant, VariantEntities>>,
  /** Shows one variant alone at the origin, all in a grid, or none */
  show: (shown: Variant | 'ALL' | 'NONE') => {
    const world = getECSWorld();
    for (const variant of VARIANTS) {
      const isShown = shown === 'ALL' || shown === variant;
      const offset = shown === 'ALL' ? GRID_OFFSETS[variant] : new THREE.Vector3();
      for (const { entityId, local } of state.variants[variant] ?? []) {
        world.setDisabled(entityId, !isShown);
        const pos = local.clone().add(offset);
        world.setTransform(entityId, { pos: { x: pos.x, y: pos.y, z: pos.z } });
      }
    }
    // The grid is two blocks wide: zoomed out for it
    const camera = getActiveCamera() as THREE.OrthographicCamera | undefined;
    if (camera?.isOrthographicCamera) {
      camera.zoom = shown === 'ALL' ? GRID_ZOOM : 1;
      camera.updateProjectionMatrix();
    }
    state.shown = shown;
  },
  shown: 'ALL' as Variant | 'ALL' | 'NONE',
  /** The renderer's draws per frame with each variant shown alone (and with none) */
  measureDraws: async () => {
    const draws: Record<string, number> = {};
    const renderer = getRenderer() as unknown as { info: { render: { drawCalls: number } } };
    const built = VARIANTS.filter((variant) => state.variants[variant]);
    for (const shown of ['NONE', ...built] as const) {
      state.show(shown);
      await nextFrames(3);
      draws[shown] = renderer.info.render.drawCalls;
    }
    state.show('ALL');
    return draws;
  },
  /** Shows the field in a mode (the variants hidden) and resolves with its figures, or goes back
   * to the variants (`NONE`) */
  field: async (mode: FieldMode | 'NONE'): Promise<FieldFigures | undefined> => {
    const current = existsOrThrow(field, 'The field is made with the scene.');
    if (mode === 'NONE') {
      await current.showFieldAsync('NONE');
      state.show('ALL');
      return undefined;
    }
    state.show('NONE');
    return current.showFieldAsync(mode);
  },
  /** The field's camera: from above (the default) or low over its near edge */
  fieldView: (view: FieldView) =>
    existsOrThrow(field, 'The field is made with the scene.').setFieldView(view),
  /** Each field mode's figures, then back to the variants */
  measureField: async () => {
    const figures: Partial<Record<FieldMode, FieldFigures>> = {};
    for (const mode of FIELD_MODES) figures[mode] = await state.field(mode);
    await state.field('NONE');
    return figures;
  },
};

const createVariantsAsync = async () => {
  const palette = getScenePalette();
  const members = palette.materials.map((_, i) => getMemberMaterial(palette, i));

  state.variants.REFERENCE = MEMBERS.map((member, i) => {
    const local = new THREE.Vector3(member.position[0], member.position[1], 0);
    const rotation = { x: member.rotation[0], y: member.rotation[1], z: member.rotation[2] };
    const [sx, sy, sz] = member.scale ?? [1, 1, 1];
    const entityId = createMeshEntity(
      {
        geo: getMemberGeometry(member.geo),
        mat: members[member.mat],
        position: { x: local.x, y: local.y, z: 0 },
        rotation,
        scale: { x: sx, y: sy, z: sz },
      },
      { appId: `mergeMaterials_ref${i}` }
    );
    return { entityId, local };
  });

  const bakedId = createMeshEntity(
    { geo: createBakedGeometry(), mat: members[0], position: { x: 0, y: 0, z: 0 } },
    { appId: 'mergeMaterials_baked' }
  );
  // createMeshEntity takes one material: the array goes on the mesh (all are the scene's)
  const bakedMesh = getECSWorld().getComponent(bakedId, ComponentType.OBJECT3D)?.value;
  (bakedMesh as THREE.Mesh).material = members;
  state.variants.BAKED = [{ entityId: bakedId, local: new THREE.Vector3() }];

  const merged = createMergedGeometry();
  const mergeMaterial = existsOrThrow(
    getMaterial(PALETTE_ID),
    `No merge material "${PALETTE_ID}" (the scene lists the palette).`
  );
  const skipMaterial = await createSkipMaterialAsync(palette);
  for (const [variant, material] of [
    ['MERGED', mergeMaterial],
    ['SKIP', skipMaterial],
  ] as const) {
    const entityId = createMeshEntity(
      { geo: merged, mat: material, position: { x: 0, y: 0, z: 0 } },
      { appId: `mergeMaterials_${variant.toLowerCase()}` }
    );
    state.variants[variant] = [{ entityId, local: new THREE.Vector3() }];
  }
};

/** `ruinBrick`'s `normalScale` as the reference draws it (its JSON gives `[0.8, 0.8]`) */
const describeNormalScale = () => {
  const scale = (getMaterial('ruinBrick') as THREE.MeshStandardMaterial | undefined)?.normalScale;
  if (!scale) return 'missing';
  return scale.isVector2 ? `Vector2(${scale.x}, ${scale.y})` : JSON.stringify(scale);
};

export const scene = async () => {
  (window as unknown as { __mergeMaterials: typeof state }).__mergeMaterials = state;
  state.results = {};
  state.variants = {};

  const variantsCameraId = createCameraEntity(
    {
      type: 'ORTHOGRAPHIC',
      frustumSize: 6.4,
      position: { x: 0, y: 0, z: 10 },
      lookAtPoint: { x: 0, y: 0, z: 0 },
      active: true,
    },
    { appId: 'mergeMaterialsCam', debugData: { name: 'Merge materials' } }
  );
  createLightEntity(
    { type: 'AMBIENT', color: '#ffffff', intensity: 0.5 },
    { appId: 'mergeMaterialsAmbient' }
  );
  createLightEntity(
    {
      type: 'DIRECTIONAL',
      color: '#ffffff',
      intensity: 2.5,
      position: { x: 3, y: 4, z: 6 },
      targetPos: { x: 0, y: 0, z: 0 },
    },
    { appId: 'mergeMaterialsSun' }
  );

  const visit = { isLeft: false };
  registerOnSceneExit(SCENE_ID, () => {
    visit.isLeft = true;
  });
  try {
    await createVariantsAsync();
    const palette = getScenePalette();
    field = createField({
      members: palette.materials.map((_, i) => getMemberMaterial(palette, i)),
      getGeometry: getMemberGeometry,
      variantsCameraId,
    });
    state.show('ALL');
  } catch (error) {
    lerror('[mergeMaterials] Build failed', error);
    state.results.buildError = getErrorMessage(error);
    return;
  }

  // After the load: nothing is drawn while it runs
  void (async () => {
    await nextFrames(10);
    if (visit.isLeft) return;
    state.results.backend = getBackendName();
    state.results.ruinBrickNormalScale = describeNormalScale();
    state.results.draws = await state.measureDraws();
    if (visit.isLeft) return;
    state.results.field = await state.measureField();
    if (visit.isLeft) return;
    state.results.done = true;
  })().catch((error) => {
    if (visit.isLeft) return;
    lerror('[mergeMaterials] Measuring failed', error);
    state.results.measureError = getErrorMessage(error);
  });
};
