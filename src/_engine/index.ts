export type { AppData, GeneratedAppJson } from './kernel/scene/AppData';
export { resolveAssetUrl } from './kernel/assets/AssetUrl';
export type { GeneratedAssetUrls } from './kernel/assets/AssetUrl';
export {
  cameraLookAtPoint,
  createCameraEntity,
  getActiveCamera,
  getActiveCameraId,
  getCameraByAppId,
  setMainCamera,
} from './kernel/camera/Camera';
export { IS_DEBUG_ENV } from './kernel/config/Config';
export type { AppConfig } from './kernel/config/Config';
export { ECSWorld, getECSWorld, getEntityIdByAppId } from './kernel/ecs/ECS';
export type {
  ComponentHook,
  ECSSystem,
  ECSWorldOptions,
  TransformResetListener,
  WorldPlugin,
} from './kernel/ecs/ECS';
export type { IComponentStorage } from './kernel/ecs/ECSComponentStorage';
export { ComponentType, Transform } from './kernel/ecs/ECSCoreComponents';
export type {
  ComponentData,
  ComponentDataMap,
  ECSPosition,
  ECSRotation,
  ECSTransformProp,
} from './kernel/ecs/ECSCoreComponents';
export { CoreComponentType } from './kernel/ecs/ECSRegistry';
export { APP_RENDER_SYNC_ORDER, ECSSystemStage } from './kernel/loop/SystemStages';
export type { EngineFeature, FeatureContext, FeatureDebugHook } from './kernel/init/Features';
export {
  createGeometry,
  deleteGeometry,
  getGeometry,
  getGeometryRegistry,
  incGeometryRef,
  saveBufferGeometry,
} from './kernel/assets/Geometry';
export type { GeoBaseProps, GeoProps, GeoTypes } from './kernel/assets/Geometry';
export {
  addToGroupEntity,
  createGroupEntity,
  getGroupByAppId,
  removeFromGroupEntity,
} from './kernel/scene/Group';
export type { GroupProps } from './kernel/scene/Group';
export { configureDraco, disposeDracoLoader } from './kernel/assets/import/DracoDecoder';
export type { DracoConfig } from './kernel/assets/import/DracoDecoder';
export type {
  TransferableAttribute,
  TransferableGeometry,
} from './kernel/assets/import/GeometryTransfer';
export { importAssetAsync, releaseImportedAsset } from './kernel/assets/import/ImportRegistry';
export type {
  ImportAssetParams,
  ImportedAssetManifest,
  ImportedGeometryInfo,
  SpawnImportedParams,
  SpawnImportedResult,
} from './kernel/assets/import/ImportTypes';
export { disposeKTX2Loader } from './kernel/assets/import/KTX2';
export { spawnImportedAsset } from './kernel/assets/import/SpawnImported';
export { playActionRecording, recordActions } from './kernel/input/ActionRecording';
export type {
  ActionPlayback,
  ActionPlaybackOpts,
  ActionRecorder,
} from './kernel/input/ActionRecording';
export type {
  ActionBinding,
  ActionBindingOf,
  ActionBindings,
  ActionContext,
  ActionDef,
  ActionDefs,
  ActionEventFn,
  ActionFrame,
  ActionFrameState,
  ActionKeys,
  ActionMap,
  ActionMapOpts,
  ActionRecording,
  ActionState,
  ActionType,
  GamepadAxisActionBinding,
  GamepadButtonActionBinding,
  GamepadStickActionBinding,
  KeyActionBinding,
  KeyActionBindingBase,
  KeyAxisActionBinding,
  KeyCompositeActionBinding,
  MouseButtonActionBinding,
  MouseDeltaActionBinding,
  TouchDragActionBinding,
  TouchTapActionBinding,
} from './kernel/input/ActionTypes';
export {
  createActionMap,
  getActionMap,
  getActionMaps,
  isActionContextEnabled,
  setActionContextEnabled,
} from './kernel/input/Actions';
export {
  getConnectedGamepads,
  onGamepadConnected,
  onGamepadDisconnected,
} from './kernel/input/GamepadInput';
export type {
  GamepadAxisName,
  GamepadButtonName,
  GamepadInfo,
  GamepadStickName,
} from './kernel/input/GamepadInput';
export {
  createKeyBinding,
  deleteKeyBinding,
  setKeyBindingEnabled,
} from './kernel/input/KeyboardInput';
export type { KeyBinding } from './kernel/input/KeyboardInput';
export {
  createMouseBinding,
  deleteMouseBinding,
  setMouseBindingEnabled,
} from './kernel/input/MouseInput';
export type { MouseBinding } from './kernel/input/MouseInput';
export {
  createTouchBinding,
  deleteTouchBinding,
  setTouchBindingEnabled,
} from './kernel/input/TouchInput';
export type { TouchBinding } from './kernel/input/TouchInput';
export {
  createLightEntity,
  getLightByAppId,
  getLightTargetId,
  setLightEnabled,
} from './kernel/light/Light';
export type { LightProps } from './kernel/light/Light';
export {
  getAppDelta,
  getDelta,
  getElapsedTime,
  transformAppSpeedValue,
  transformMainSpeedValue,
} from './kernel/loop/MainLoop';
export type { FixedStepDriver, LoopState } from './kernel/loop/MainLoop';
export {
  createMaterial,
  decMaterialRef,
  deleteMaterial,
  getMaterial,
  getMaterialVariant,
  incMaterialRef,
  loadTslMaterialFileAsync,
  saveMaterial,
} from './kernel/assets/Material';
export type { MatProps, MaterialVariantOverrides, Materials } from './kernel/assets/Material';
export {
  createMeshEntity,
  getMeshByAppId,
  removeMeshLod,
  setMeshLod,
  setMeshMaterial,
} from './kernel/mesh/Mesh';
export type { MeshProps } from './kernel/mesh/Mesh';
export type { AfterRenderHook, RenderPipelineProvider } from './kernel/render/RenderHooks';
export {
  createRenderer,
  deleteRenderer,
  getRenderer,
  isWebGPURenderer,
} from './kernel/render/Renderer';
export type { RendererOptions } from './kernel/render/Renderer';
export {
  createSceneAppLooper,
  createSceneMainLooper,
  deleteSceneAppLooper,
  deleteSceneMainLooper,
  getCurrentSceneId,
  getGeneratedAppData,
  getGeneratedSceneData,
  getRootScene,
  getScene,
  registerOnAllSceneEnterings,
  registerOnAllSceneExits,
  registerOnSceneEnter,
  registerOnSceneExit,
} from './kernel/scene/Scene';
export type { Looper, SceneData } from './kernel/scene/Scene';
export { createSceneLoader, getLoaderStatusUpdater, loadScene } from './kernel/scene/SceneLoader';
export type { LoadSceneProps, SceneLoader, ScenePrimitiveAssets } from './kernel/scene/SceneLoader';
export type { SceneHooks } from './kernel/scene/SceneHooks';
export { snapshotToBlobAsync, takeSnapshotAsync } from './kernel/render/Snapshot';
export type { Snapshot, SnapshotBlobOpts, SnapshotOpts } from './kernel/render/Snapshot';
export {
  deleteTexture,
  getAllTextures,
  getTexture,
  loadTexture,
  loadTextureAsync,
  loadTextures,
} from './kernel/assets/Texture';
export type { TexOpts, TextureProps } from './kernel/assets/Texture';
export {
  buildTextureArray,
  getArrayLayerIndex,
  getTextureArray,
  getTextureArrayInfo,
  sampleArrayLayer,
  setTextureArrayLayer,
} from './kernel/assets/TextureArray';
export type {
  BuildTextureArrayProps,
  TextureArray,
  TextureArrayMember,
} from './kernel/assets/TextureArray';
export {
  getAtlasCell,
  getTextureAtlasInfo,
  remapUVsToAtlasCell,
  sampleAtlasCell,
} from './kernel/assets/TextureAtlas';
export type {
  AtlasCellRect,
  RemapUVsToAtlasCellOpts,
  SampleAtlasCellOpts,
  TextureAtlasInfo,
} from './kernel/assets/TextureAtlas';
export {
  addViewChangeListener,
  addViewFrameListener,
  isRuntimeViewActive,
  registerView,
  setActiveView,
  unregisterView,
} from './kernel/render/Views';
export type {
  ViewChangeListener,
  ViewDef,
  ViewFrameListener,
  ViewFrameListenerPhase,
} from './kernel/render/Views';
export { InitEngine } from './kernel/init/InitEngine';
export type { InitEngineOptions } from './kernel/init/InitEngine';
export { existsOrThrow } from './utils/Assert';
export { deepMerge } from './utils/DeepMerge';
export {
  addComponent,
  createEntity,
  deleteEntity,
  getComponent,
  getPosition,
  getRotation,
  getScale,
  getStorage,
  getTransform,
  hasComponent,
  removeComponent,
  setTransform,
  teleport,
} from './kernel/ecs/ECSHelpers';
export { initECSStressTest } from './kernel/ecs/debug/ECSStressTest';
export { getQuatFromAngle, smoothDampVec3 } from './kernel/render/ThreeMath';
export { toUniqueJsIdentifier } from './utils/JsIdentifier';
export { getLogger, lerror, llog, lwarn } from './utils/Logger';
export { getRandomSeed, getRandomStream, setRandomSeed } from './utils/RandomStreams';
export { createSeededRandom } from './utils/SeededRandom';
