// The terrain gallery tab's Decals section (p309 Phases 1-2): the camera over the row's panels,
// the whole row or one atlas's views; and the stage's decals (Phase 2): the weather they're judged
// in (dry, wet, rain: the surface conditions every row shares), the camera at 1, 50 and 200 m (the
// exit's z-fighting distances) and on the wall, and the polygon offset and the edge fade switched
// off on the four decal materials, to see what each prevents.
import * as THREE from 'three/webgpu';
import { getMaterial } from 'aekasha';
import { updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { getSurfaceConditions, setSurfaceConditions } from 'aekasha/surface';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import { DECALS_PANELS, DECALS_ROW_BOUNDS } from './decalsRow';
import { DECALS_STAGE_BLOCKS, DECALS_STAGE_BOUNDS, DECALS_STAGE_MATERIAL_IDS } from './decalsStage';

/** In front of the panels (+z) and above them, looking down at their middle */
const getPose = (minX: number, maxX: number, minZ: number, maxZ: number): GalleryCameraPose => {
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  return { pos: { x, y: span * 0.7, z: z + span * 0.45 }, look: { x, y: 0, z } };
};

/** One atlas's panels' pose */
const getAtlasPose = (atlasId: string) => {
  const panels = DECALS_PANELS.filter((panel) => panel.atlas.id === atlasId);
  const { width, depth } = panels[0].atlas;
  return getPose(
    Math.min(...panels.map((panel) => panel.x)) - width / 2,
    Math.max(...panels.map((panel) => panel.x)) + width / 2,
    panels[0].z - depth / 2,
    panels[0].z + depth / 2
  );
};

/** The weathers: the wetness, the puddle level and the rain (wet: the scene JSON's start) */
const WEATHERS = {
  DRY: { wetness: 0, puddleLevel: 0, rain: 0 },
  WET: { wetness: 0.6, puddleLevel: 0.6, rain: 0 },
  RAIN: { wetness: 1, puddleLevel: 0.8, rain: 1 },
} as const;
type Weather = keyof typeof WEATHERS | 'OTHER';

const [BLEND_BLOCK] = DECALS_STAGE_BLOCKS;
const STAGE_X = (DECALS_STAGE_BOUNDS.minX + DECALS_STAGE_BOUNDS.maxX) / 2;
const STAGE_Z = BLEND_BLOCK.z;
/** The camera's angle above the ground for the far stops: low, where z-fighting shows first */
const FAR_ELEVATION = THREE.MathUtils.degToRad(12);

/** From the front (+z), `distance` metres from the stage's middle, low over the ground */
const getDistancePose = (distance: number): GalleryCameraPose => ({
  pos: {
    x: STAGE_X,
    y: distance * Math.sin(FAR_ELEVATION),
    z: STAGE_Z + distance * Math.cos(FAR_ELEVATION),
  },
  look: { x: STAGE_X, y: 0, z: STAGE_Z },
});

/** 1 m from the `BLEND` block's tyre tracks over the asphalt damage */
const CLOSE_POSE: GalleryCameraPose = {
  pos: { x: BLEND_BLOCK.x + 0.5, y: 0.8, z: BLEND_BLOCK.z - 2.6 },
  look: { x: BLEND_BLOCK.x + 0.5, y: 0, z: BLEND_BLOCK.z - 3.4 },
};

/** In front of both walls, at eye height */
const WALL_POSE: GalleryCameraPose = {
  pos: { x: STAGE_X, y: 2, z: DECALS_STAGE_BOUNDS.minZ + 12 },
  look: { x: STAGE_X, y: 2, z: DECALS_STAGE_BOUNDS.minZ },
};

/** The stage's decal materials loaded with the scene */
const getStageMaterials = () =>
  DECALS_STAGE_MATERIAL_IDS.map((id) => getMaterial(id)).filter(
    (material): material is THREE.Material => material !== undefined
  );

/** Each material's own offset and edge fade, kept while they're switched off */
const savedOffsets = new WeakMap<THREE.Material, [factor: number, units: number]>();
const savedEdgeFades = new WeakMap<THREE.Material, THREE.Vector2>();

const getEdgeFadeUniform = (material: THREE.Material) =>
  (material.userData.uniforms as Record<string, { value: THREE.Vector2 }> | undefined)
    ?.decal_edgeFade;

/** The fields' bindings: read from the materials and the conditions, so a reload shows the truth */
const binding = {
  get weather(): Weather {
    const conditions = getSurfaceConditions();
    const match = Object.entries(WEATHERS).find(([, values]) =>
      Object.entries(values).every(
        ([key, value]) => conditions?.[key as keyof typeof values] === value
      )
    );
    return (match?.[0] as Weather | undefined) ?? 'OTHER';
  },
  set weather(value: Weather) {
    if (value !== 'OTHER') setSurfaceConditions({ ...WEATHERS[value] });
  },
  get isOffsetOn() {
    return getStageMaterials().every((material) => material.polygonOffset);
  },
  set isOffsetOn(isOn: boolean) {
    for (const material of getStageMaterials()) {
      if (material.polygonOffset === isOn) continue;
      if (isOn) {
        const [factor, units] = savedOffsets.get(material) ?? [-1, -4];
        material.polygonOffsetFactor = factor;
        material.polygonOffsetUnits = units;
      } else {
        savedOffsets.set(material, [material.polygonOffsetFactor, material.polygonOffsetUnits]);
        material.polygonOffsetFactor = 0;
        material.polygonOffsetUnits = 0;
      }
      material.polygonOffset = isOn;
      material.needsUpdate = true;
    }
  },
  get isEdgeFadeOn() {
    return getStageMaterials().every((material) => {
      const uniform = getEdgeFadeUniform(material);
      return !uniform || uniform.value.lengthSq() > 0;
    });
  },
  set isEdgeFadeOn(isOn: boolean) {
    for (const material of getStageMaterials()) {
      const uniform = getEdgeFadeUniform(material);
      if (!uniform) continue;
      if (isOn) {
        uniform.value.copy(savedEdgeFades.get(material) ?? new THREE.Vector2(0.1, 0.1));
      } else if (uniform.value.lengthSq() > 0) {
        savedEdgeFades.set(material, uniform.value.clone());
        uniform.value.set(0, 0);
      }
    }
  },
};

/**
 * The Decals section of the gallery's tab: the camera over the row or an atlas's panels, and the
 * stage's weather, camera stops and switches.
 * @param tabId the gallery's tab, refreshed from here
 * @returns the section
 */
export const getDecalsSections = (tabId: string): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Decals',
    id: 'terrainGalleryDecals',
    content: [
      {
        type: 'button',
        title: 'Camera',
        label: 'Over the row',
        onClick: () =>
          flyGalleryCamera(
            getPose(
              DECALS_ROW_BOUNDS.minX,
              DECALS_ROW_BOUNDS.maxX,
              DECALS_ROW_BOUNDS.minZ,
              DECALS_ROW_BOUNDS.maxZ
            )
          ),
      },
      {
        type: 'button',
        title: '',
        label: 'Ground decals',
        onClick: () => flyGalleryCamera(getAtlasPose('decalsGround')),
      },
      {
        type: 'button',
        title: '',
        label: 'Structure decals',
        onClick: () => flyGalleryCamera(getAtlasPose('decalsStructure')),
      },
      { type: 'separator' },
      {
        key: 'weather',
        target: binding,
        label: 'Stage weather',
        kind: 'segmented',
        options: [
          { label: 'Dry', value: 'DRY' },
          { label: 'Wet', value: 'WET' },
          { label: 'Rain', value: 'RAIN' },
        ],
        hint: 'The surface conditions’ wetness, puddle level and rain (every row’s): dry 0, 0, 0; wet 0.6, 0.6, 0 (the scene’s start); rain 1, 0.8, 1 (ripples). A decal’s puddle mask fills first: the tyre tracks’ tread and the asphalt damage’s dips',
        onChange: () => updateDebuggerTab(tabId, { rebuild: true }),
      },
      {
        type: 'button',
        title: 'Stage camera',
        label: '1 m',
        onClick: () => flyGalleryCamera(CLOSE_POSE),
      },
      {
        type: 'button',
        title: '',
        label: '50 m',
        onClick: () => flyGalleryCamera(getDistancePose(50)),
      },
      {
        type: 'button',
        title: '',
        label: '200 m',
        onClick: () => flyGalleryCamera(getDistancePose(200)),
      },
      {
        type: 'button',
        title: '',
        label: 'The walls',
        onClick: () => flyGalleryCamera(WALL_POSE),
      },
      {
        key: 'isOffsetOn',
        target: binding,
        label: 'Polygon offset',
        kind: 'switch',
        hint: 'The decal materials’ polygon offset (factor −1, units −4): off, the quads z-fight with the ground and the wall they’re coplanar with',
        onChange: () => updateDebuggerTab(tabId),
      },
      {
        key: 'isEdgeFadeOn',
        target: binding,
        label: 'Edge fade',
        kind: 'switch',
        hint: 'The decal materials’ edge fade (10 % of the second UV set at each edge): off, an opaque cell’s quad edges show',
        onChange: () => updateDebuggerTab(tabId),
      },
    ],
  },
];
