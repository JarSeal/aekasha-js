// The material editor's stage (p806 D11, out of `_dbg__MaterialEditor.ts`): its private scene
// with the preview objects, lights and studio environment, the settings on it, and the view's
// orbit camera with each material's pose.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getRenderer } from '../../../kernel/render/Renderer';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';
import { createViewCamera, type ViewCamera, type ViewCameraPose } from '../_dbg__ViewCamera';
import { createMaterialCameraStore, readMaterialSettings } from './_dbg__MaterialEditorStore';
import type {
  MaterialEditorSettingKey,
  MaterialEditorSettings,
} from './_dbg__MaterialEditorSettings';

export const MATERIAL_EDITOR_VIEW_ID = 'materialEditor';

const ERROR_COLOR = 0xff00ff;

/** The camera pose of a material without a saved one (and of the view's own pose). */
export const DEFAULT_CAMERA_POSE: ViewCameraPose = {
  position: { x: 0, y: 0.6, z: 4.8 },
  target: { x: 0, y: 0, z: 0 },
  fov: 45,
};

/** How a material type is previewed: on the ball, as points or lines on a sphere, as a sprite, or
 * not at all (a notice in its place). */
export type PreviewKind = 'MESH' | 'POINTS' | 'LINES' | 'SPRITE' | 'NONE';

export const getPreviewKind = (type: MaterialAsset['type']): PreviewKind => {
  switch (type) {
    case 'POINTS':
      return 'POINTS';
    case 'LINEBASIC':
    case 'LINEDASHED':
      return 'LINES';
    case 'SPRITE':
      return 'SPRITE';
    // Shadow, depth and distance materials need a scene pass of their own, and ShaderMaterials
    // don't work on WebGPU at all
    case 'SHADOW':
    case 'DEPTH':
    case 'DISTANCE':
    case 'SHADER':
    case 'SHADERRAW':
      return 'NONE';
    default:
      return 'MESH';
  }
};

type PreviewObject = THREE.Mesh | THREE.Points | THREE.LineSegments | THREE.Sprite;

/** The editor's stage: one private scene with the preview objects, its lights and its
 * environment. */
type Stage = {
  scene: THREE.Scene;
  lights: {
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
  };
  /** The studio environment, baked on the first enter (the scene's `environment` while the
   * setting is 'STUDIO'). */
  environmentTexture: THREE.Texture | null;
  /** Holds the preview objects (the auto-rotation turns it). */
  previewRoot: THREE.Group;
  objects: Record<Exclude<PreviewKind, 'NONE'>, PreviewObject>;
  /** Each object's own material, put back while it isn't showing an editor copy. */
  defaultMaterials: Map<PreviewObject, THREE.Material>;
  /** A flat magenta, on the ball when a material fails to load. */
  errorMaterial: THREE.Material;
};

let stage: Stage | null = null;
let viewCam: ViewCamera | null = null;
/** The stage's settings: a material's (its saved ones over the defaults), the defaults without
 * one. They change with the swap to a material's copy, not with its selection (the previous
 * material stays on the stage while the textures load). */
let stageSettings: MaterialEditorSettings = readMaterialSettings(null);
/** The material `stageSettings` belong to. */
let stageSettingsMaterialId: string | null = null;

const createStage = (): Stage => {
  const scene = new THREE.Scene();
  scene.name = 'materialEditorStage';
  // The colour and the intensities are the settings' (applyStageSettings)
  scene.background = new THREE.Color();

  // Fixed to the stage, not to the camera: orbiting shows the lit and the shadowed side
  const hemi = new THREE.HemisphereLight(0xffffff, 0x606060);
  const key = new THREE.DirectionalLight(0xffffff);
  key.position.set(-3, 4, 4);
  const fill = new THREE.DirectionalLight(0xffffff);
  fill.position.set(4, 1, 1);
  scene.add(hemi, key, fill);

  const previewRoot = new THREE.Group();
  previewRoot.name = 'materialEditorPreview';
  scene.add(previewRoot);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    new THREE.MeshStandardNodeMaterial({ color: 0x808080 })
  );
  ball.name = 'materialEditorBall';
  // Points and lines read better on a coarser sphere
  const coarseSphere = new THREE.SphereGeometry(1, 48, 24);
  const points = new THREE.Points(coarseSphere, new THREE.PointsNodeMaterial());
  points.name = 'materialEditorPoints';
  const lines = new THREE.LineSegments(
    new THREE.WireframeGeometry(coarseSphere),
    new THREE.LineBasicNodeMaterial()
  );
  lines.name = 'materialEditorLines';
  lines.computeLineDistances(); // For LineDashedMaterial
  const sprite = new THREE.Sprite(new THREE.SpriteNodeMaterial());
  sprite.name = 'materialEditorSprite';
  sprite.scale.setScalar(2); // The ball's diameter

  const objects = { MESH: ball, POINTS: points, LINES: lines, SPRITE: sprite };
  const defaultMaterials = new Map<PreviewObject, THREE.Material>();
  for (const object of Object.values(objects)) {
    object.visible = false;
    defaultMaterials.set(object, object.material as THREE.Material);
    previewRoot.add(object);
  }
  ball.visible = true;

  const errorMaterial = new THREE.MeshBasicNodeMaterial({ color: ERROR_COLOR });
  errorMaterial.name = 'materialEditorError';

  return {
    scene,
    lights: { hemi, key, fill },
    environmentTexture: null,
    previewRoot,
    objects,
    defaultMaterials,
    errorMaterial,
  };
};

/** The stage, created on its first use (no GPU work: the environment waits for the renderer). */
export const ensureStage = () => (stage ??= createStage());

/** The stage, once created. */
export const getStage = () => stage;

/** Shows one preview object with `material` (its own material when null), or none ('NONE'). */
export const showPreview = (kind: PreviewKind, material: THREE.Material | null) => {
  if (!stage) return;
  for (const [objectKind, object] of Object.entries(stage.objects)) {
    const isShown = objectKind === kind;
    object.visible = isShown;
    // Hidden ones never keep an editor copy, which is deleted on the next load
    (object as THREE.Mesh).material = (isShown && material) || stage.defaultMaterials.get(object)!;
  }
};

/** The studio environment (a PMREM of three's RoomEnvironment). Needs the renderer, so it is
 * baked on the first enter, and kept while the view is registered. */
export const ensureEnvironment = (s: Stage) => {
  if (s.environmentTexture) return;
  const renderer = getRenderer();
  if (!renderer) return;
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  s.environmentTexture = generator.fromScene(room, 0.04).texture;
  room.dispose();
  // Its working set would otherwise stay on the GPU (see SkyEnvironment.ts' getPMREMTexture)
  if (renderer.hasInitialized()) generator.dispose();
};

/** Puts the stage settings on the stage (the auto-rotation reads them in `update`). */
const applyStageSettings = () => {
  if (!stage) return;
  const { scene, lights } = stage;
  (scene.background as THREE.Color).set(stageSettings.backgroundColor);
  // The environment is part of the render objects' cache key: switching it rebuilds them
  scene.environment = stageSettings.environment === 'STUDIO' ? stage.environmentTexture : null;
  scene.environmentIntensity = stageSettings.environmentIntensity;
  lights.key.intensity = stageSettings.keyLightIntensity;
  lights.fill.intensity = stageSettings.fillLightIntensity;
  lights.hemi.intensity = stageSettings.hemiLightIntensity;
};

export const getViewCamera = () => {
  viewCam ??= createViewCamera({
    viewId: MATERIAL_EDITOR_VIEW_ID,
    defaultPose: DEFAULT_CAMERA_POSE,
    near: 0.01,
    far: 100,
    // A material's pose in its record, the view's own (no material) in 'AEK_debugViewCams'
    store: createMaterialCameraStore(MATERIAL_EDITOR_VIEW_ID),
  });
  return viewCam;
};

/** The view's camera, once created (on the first enter). */
export const getViewCam = () => viewCam;

/** Applies the pose of a material (its saved one, or the default), or the view's own pose (null).
 * The same key keeps the camera where it is (its pose is saved on every move). */
const applyCameraPoseKey = (materialId: string | null) => {
  if (viewCam && viewCam.getPoseKey() !== materialId) viewCam.setPoseKey(materialId);
};

/** Applies a material's camera pose and its settings (the defaults for null), with the swap to
 * its copy. */
export const applyMaterialStage = (materialId: string | null) => {
  applyCameraPoseKey(materialId);
  stageSettings = readMaterialSettings(materialId);
  stageSettingsMaterialId = materialId;
  applyStageSettings();
};

/** The settings on the stage: a material's, or the defaults. */
export const getStageSettings = () => stageSettings;

/** The material whose settings are on the stage (null: the defaults). */
export const getStageSettingsMaterialId = () => stageSettingsMaterialId;

/** Sets a normalised setting's value on the stage. */
export const setStageSettingValue = (key: MaterialEditorSettingKey, value: unknown) => {
  (stageSettings as Record<string, unknown>)[key] = value;
  applyStageSettings();
};

/** Turns the preview by the auto-rotation (the view's `update`). */
export const turnPreview = (delta: number) => {
  if (!stageSettings.autoRotate || !stage) return;
  stage.previewRoot.rotation.y += delta * THREE.MathUtils.degToRad(stageSettings.autoRotateSpeed);
};
