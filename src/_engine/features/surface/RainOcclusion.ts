// The rain occlusion map (p307 T12, Phase 6): an orthographic depth render looking straight down
// around the active camera, which a wet material samples (getRainOcclusionNode) so a surface under
// a roof, a tree or a bridge stays dry in the rain. The `rainOcclusion()` feature creates the
// runtime at its install; the map's target is made and cleared at the first scene load once the
// renderer is up (a target sampled before its first render loses its texture in place: the
// destroyed-texture trap, `features/skybox/CLAUDE.md`), and nothing renders into it until a
// material has asked for its node.
//
// Rendered like three's shadow maps (r187 `ShadowNode.updateShadow`): the root scene with an
// override material (which three gives each object's own `positionNode`, alpha test and alpha
// map), through a render object function that draws only the occluders, without the background
// and fog. Occluders are what casts shadows, or what `userData.rainOccluder` says.
import * as THREE from 'three/webgpu';
import {
  float,
  min,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import { getActiveCamera } from '../../kernel/camera/Camera';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { runWithClearRenderState } from '../../kernel/render/CompileQueue';
import { getRenderer } from '../../kernel/render/Renderer';
import { getRootScene } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { isCurrentlyLoading } from '../../kernel/scene/SceneLoader';
import {
  createRainMapRenderState,
  RAIN_MAP_EDGE_FADE,
  RAIN_MAP_NORMAL_OFFSET_TEXELS,
  type RainMapRenderState,
  type ResolvedRainOcclusionOpts,
  shouldRenderRainMap,
  snapRainMapCoordinate,
} from './RainOcclusionModel';

/** The map: its target, camera, override material and the uniforms its nodes read */
type RainMap = {
  target: THREE.RenderTarget;
  depthTexture: THREE.DepthTexture;
  camera: THREE.OrthographicCamera;
  material: THREE.NodeMaterial;
  /** Whether the renderer's depth is reversed (made with the map: the compare and the bias' sign) */
  isReversed: boolean;
  /** World to the map: the uv in xy, the depth in z (three's shadow matrix) */
  matrix: THREE.UniformNode<'mat4', THREE.Matrix4>;
  /** The lookup's offset along the geometry normal, metres */
  normalOffset: THREE.UniformNode<'float', number>;
  /** The bias in the map's depth units */
  depthBias: THREE.UniformNode<'float', number>;
  /** 1 while the map is on and rendered for this scene, else 0 (every node reads open sky) */
  strength: THREE.UniformNode<'float', number>;
  isCleared: boolean;
  /** Whether a material has asked for a node: nothing renders before */
  hasConsumer: boolean;
};

/**
 * Debug hooks around every render (the debug tab's stats).
 * @internal
 */
export type RainOcclusionRenderHooks = {
  onBakeStart: () => void;
  onBakeEnd: (cpuMs: number) => void;
};

/** The running state, created by the feature's install */
type RainOcclusionRuntime = {
  opts: ResolvedRainOcclusionOpts;
  render: RainMapRenderState;
  isEnabled: boolean;
  renders: number;
  map: RainMap | null;
  hooks: RainOcclusionRenderHooks | null;
};

let runtime: RainOcclusionRuntime | null = null;

// Scratch, so a render allocates nothing
const projScreen = new THREE.Matrix4();
// three's state helpers fill these in (the clear colour made on the first save)
let rendererState = {} as THREE.RendererUtils.RendererState;
let sceneState = {} as THREE.RendererUtils.SceneState;
/** The renderer of the render in progress (the render object function's) */
let occluderRenderer: THREE.Renderer | null = null;

/**
 * Whether an object keeps the rain off what's under it: its `userData.rainOccluder` when that's a
 * boolean, else whether it casts shadows.
 * @internal
 */
export const isRainOccluder = (object: THREE.Object3D) => {
  const flag: unknown = object.userData.rainOccluder;
  return typeof flag === 'boolean' ? flag : object.castShadow;
};

/** `renderObject`'s parameters (three's typings don't export `ClippingContext`) */
type RenderObjectArgs = Parameters<THREE.Renderer['renderObject']>;

/** Draws the occluders only (the render's render object function) */
const renderOccluder = (
  object: THREE.Object3D,
  scene: THREE.Scene,
  camera: THREE.Camera,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  group: THREE.GeometryGroup | null,
  lightsNode: THREE.LightsNode,
  clippingContext: RenderObjectArgs[7],
  passId?: string | null
) => {
  if (!occluderRenderer || !isRainOccluder(object)) return;
  occluderRenderer.renderObject(
    object,
    scene,
    camera,
    geometry,
    material,
    group,
    lightsNode,
    clippingContext,
    passId
  );
};

/** The override material: depth only, both faces (a single-sided roof from either side) */
const createOccluderMaterial = () => {
  const material = new THREE.NodeMaterial();
  material.name = 'RainOcclusionMaterial';
  material.colorNode = vec4(0, 0, 0, 1);
  material.colorWrite = false;
  material.side = THREE.DoubleSide;
  // A transparent occluder's two passes would draw it twice
  material.forceSinglePass = true;
  material.blending = THREE.NoBlending;
  material.fog = false;
  return material;
};

/** The map's objects, made on first need (no GPU work: the clear is prepareMap's) */
const getOrCreateMap = (rt: RainOcclusionRuntime): RainMap => {
  if (rt.map) return rt.map;
  const { size, extent, height, bias } = rt.opts;
  const renderer = getRenderer() as THREE.Renderer | undefined;
  const isReversed = renderer?.reversedDepthBuffer === true;
  const depthTexture = new THREE.DepthTexture(size, size);
  depthTexture.name = 'RainOcclusionMap';
  depthTexture.type = isReversed ? THREE.FloatType : THREE.UnsignedIntType;
  depthTexture.compareFunction = isReversed ? THREE.GreaterEqualCompare : THREE.LessEqualCompare;
  // Hardware PCF: one compare fetch filters 2 × 2 texels
  depthTexture.minFilter = THREE.LinearFilter;
  depthTexture.magFilter = THREE.LinearFilter;
  const target = new THREE.RenderTarget(size, size, {
    format: THREE.RedFormat,
    depthBuffer: true,
    generateMipmaps: false,
  });
  target.texture.name = 'RainOcclusionColor';
  target.depthTexture = depthTexture;
  const half = extent / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0, 2 * height);
  camera.name = 'RainOcclusionCamera';
  // Looks straight down, its up the world's −z
  camera.rotation.x = -Math.PI / 2;
  rt.map = {
    target,
    depthTexture,
    camera,
    material: createOccluderMaterial(),
    isReversed,
    matrix: uniform(new THREE.Matrix4()),
    normalOffset: uniform((extent / size) * RAIN_MAP_NORMAL_OFFSET_TEXELS),
    depthBias: uniform(bias / (2 * height)),
    strength: uniform(0),
    isCleared: false,
    hasConsumer: false,
  };
  return rt.map;
};

/** Clears the map once (open sky everywhere), before anything samples it: outside any render */
const prepareMap = (rt: RainOcclusionRuntime, renderer: THREE.Renderer) => {
  const map = getOrCreateMap(rt);
  if (map.isCleared) return map;
  map.isCleared = true;
  runWithClearRenderState(renderer, () => {
    rendererState = THREE.RendererUtils.resetRendererState(renderer, rendererState);
    renderer.setRenderTarget(map.target);
    renderer.clear();
    THREE.RendererUtils.restoreRendererState(renderer, rendererState);
  });
  return map;
};

/** Writes the strength: on, and rendered since the scene's start */
const writeStrength = (rt: RainOcclusionRuntime) => {
  if (rt.map) rt.map.strength.value = rt.isEnabled && rt.render.hasRendered ? 1 : 0;
};

/**
 * Renders the map centred under (x, y, z) snapped to its texels, and sets its matrix. Allocates
 * nothing.
 */
const renderMap = (
  rt: RainOcclusionRuntime,
  map: RainMap,
  renderer: THREE.Renderer,
  scene: THREE.Scene,
  viewCamera: THREE.Camera
) => {
  const { extent, size, height } = rt.opts;
  const texel = extent / size;
  const elements = viewCamera.matrixWorld.elements;
  const state = rt.render;
  state.centreX = snapRainMapCoordinate(elements[12], texel);
  state.centreY = snapRainMapCoordinate(elements[13], texel);
  state.centreZ = snapRainMapCoordinate(elements[14], texel);
  const { camera } = map;
  camera.position.set(state.centreX, state.centreY + height, state.centreZ);
  camera.layers.mask = viewCamera.layers.mask;
  camera.updateMatrixWorld();

  const hooks = rt.hooks;
  hooks?.onBakeStart();
  const start = hooks ? performance.now() : 0;
  runWithClearRenderState(renderer, () => {
    rendererState = THREE.RendererUtils.resetRendererState(renderer, rendererState);
    sceneState = THREE.RendererUtils.resetSceneState(scene, sceneState);
    scene.overrideMaterial = map.material;
    occluderRenderer = renderer;
    renderer.setRenderObjectFunction(renderOccluder);
    renderer.setRenderTarget(map.target);
    try {
      renderer.render(scene, camera);
    } finally {
      occluderRenderer = null;
      THREE.RendererUtils.restoreSceneState(scene, sceneState);
      THREE.RendererUtils.restoreRendererState(renderer, rendererState);
    }
  });
  hooks?.onBakeEnd(performance.now() - start);

  // After the render, which sets the camera's coordinate system and depth to the renderer's:
  // three's shadow matrix (z kept in WebGPU's [0, 1], mapped there from WebGL's [−1, 1])
  projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const zScale =
    camera.coordinateSystem === THREE.WebGPUCoordinateSystem || camera.reversedDepth ? 1 : 0.5;
  // prettier-ignore
  map.matrix.value.set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, zScale, 1 - zScale,
    0, 0, 0, 1
  ).multiply(projScreen);
  state.framesSince = 0;
  state.isRequested = false;
  state.hasRendered = true;
  rt.renders++;
  writeStrength(rt);
};

/**
 * Renders the map when it's due (`shouldRenderRainMap`), with the active camera, while a material
 * reads it and no scene loads. The map is global: only the default world drives it. Allocates
 * nothing.
 */
function rainOcclusionSystem(world: ECSWorld) {
  const rt = runtime;
  if (!rt || world !== getECSWorld()) return;
  const renderer = getRenderer() as THREE.Renderer | undefined;
  if (!renderer?.hasInitialized()) return;
  const map = prepareMap(rt, renderer);
  if (!map.hasConsumer || !rt.isEnabled || isCurrentlyLoading()) return;
  rt.render.framesSince++;
  const viewCamera = getActiveCamera();
  const scene = getRootScene() as THREE.Scene | undefined;
  if (!viewCamera || !scene) return;
  const elements = viewCamera.matrixWorld.elements;
  if (!shouldRenderRainMap(rt.render, elements[12], elements[13], elements[14], rt.opts)) return;
  renderMap(rt, map, renderer, scene, viewCamera);
}

/** Options of {@link getRainOcclusionNode}. */
export type RainOcclusionNodeOpts = {
  /** The surface's world position (default `positionWorld`). */
  position?: Node<'vec3'>;
  /**
   * The surface's geometry normal in world space (default `normalWorldGeometry`): the lookup
   * moves out along it, so a wall's face or a slope isn't sheltered by its own top.
   */
  normal?: Node<'vec3'>;
};

/**
 * How far the rain occlusion map shelters the surface from the rain, 0 open sky to 1 under an
 * occluder (a roof, a tree, a bridge: an object that casts shadows, or whose
 * `userData.rainOccluder` is true), as a node for a TSL material; null without the
 * `rainOcclusion()` feature. One compare fetch (a 2 × 2 filtered edge). Open sky outside the map
 * (fading over its last tenth), below its height, while it's off (`setRainOcclusionEnabled`) and
 * from a scene's start until its first render. The first call starts the map's renders.
 * @param opts the surface's world position and geometry normal
 * @returns the occlusion node, or null without the feature
 * @remarks Sample it outside a dynamic branch (`If`): a compare fetch needs uniform control flow.
 * @example
 * ```ts
 * import { float } from 'three/tsl';
 * import { getRainOcclusionNode, getSurfaceConditionNodes } from 'aekasha/surface';
 *
 * const conditions = getSurfaceConditionNodes();
 * const occlusion = getRainOcclusionNode();
 * if (conditions) {
 *   // Wet where the rain reaches: not under the porch
 *   const wetness = occlusion
 *     ? conditions.wetness.mul(float(1).sub(occlusion))
 *     : conditions.wetness;
 *   material.colorNode = dryColor.mul(float(1).sub(wetness.mul(0.4)));
 * }
 * ```
 */
export const getRainOcclusionNode = (opts?: RainOcclusionNodeOpts): Node<'float'> | null => {
  const rt = runtime;
  if (!rt) return null;
  const map = getOrCreateMap(rt);
  map.hasConsumer = true;
  const position = opts?.position ?? (positionWorld as unknown as Node<'vec3'>);
  const normal = opts?.normal ?? (normalWorldGeometry as unknown as Node<'vec3'>);
  const lookup = position.add(normal.mul(map.normalOffset)) as Node<'vec3'>;
  const coord = map.matrix.mul(vec4(lookup, 1)) as unknown as Node<'vec4'>;
  const ndc = coord.xyz.div(coord.w) as Node<'vec3'>;
  // WebGPU's texture v runs down (three's shadow coordinates)
  const uv = vec2(ndc.x, ndc.y.oneMinus()) as unknown as Node<'vec2'>;
  // Toward the map's camera: an occluder doesn't shelter its own top
  const ref = map.isReversed ? ndc.z.add(map.depthBias) : ndc.z.sub(map.depthBias);
  const depth = texture(map.depthTexture) as unknown as TextureNode;
  const open = depth.sample(uv).compare(ref);
  const edge = min(min(uv.x, uv.y), min(uv.x.oneMinus(), uv.y.oneMinus()));
  const inside = smoothstep(0, RAIN_MAP_EDGE_FADE, edge).mul(step(0, ndc.z)).mul(step(ndc.z, 1));
  return float(1).sub(open).mul(inside).mul(map.strength) as unknown as Node<'float'>;
};

/**
 * Turns the rain occlusion map on or off (on at the install). Off, every occlusion node reads
 * open sky and the map doesn't render; on again, it renders on the next frame.
 * @param isEnabled whether the map shelters surfaces
 * @throws when the `rainOcclusion()` feature isn't installed
 */
export const setRainOcclusionEnabled = (isEnabled: boolean) => {
  const rt = assertInstalled('setRainOcclusionEnabled');
  if (isEnabled && !rt.isEnabled) rt.render.isRequested = true;
  rt.isEnabled = isEnabled;
  writeStrength(rt);
};

/**
 * Renders the rain occlusion map again on the next frame: after an occluder has moved, when its
 * `updateFrames` doesn't catch it (0, or a change that must show at once).
 * @throws when the `rainOcclusion()` feature isn't installed
 * @example
 * ```ts
 * import { requestRainOcclusionUpdate } from 'aekasha/surface';
 *
 * openGarageDoor();
 * requestRainOcclusionUpdate();
 * ```
 */
export const requestRainOcclusionUpdate = () => {
  assertInstalled('requestRainOcclusionUpdate').render.isRequested = true;
};

const assertInstalled = (caller: string): RainOcclusionRuntime => {
  if (runtime) return runtime;
  throw new Error(
    `${caller}: the rain occlusion feature isn't installed. List rainOcclusion() from 'aekasha/surface' in InitEngine's features, after surfaceConditions().`
  );
};

/**
 * The map's state for the debug tab, or null without the feature.
 * @internal
 */
export const getRainOcclusionDebugState = () => {
  const rt = runtime;
  if (!rt) return null;
  return {
    isEnabled: rt.isEnabled,
    hasConsumer: rt.map?.hasConsumer ?? false,
    renders: rt.renders,
    opts: rt.opts,
    centre: rt.render.hasRendered
      ? `${rt.render.centreX.toFixed(1)}, ${rt.render.centreY.toFixed(1)}, ${rt.render.centreZ.toFixed(1)}`
      : '-',
  };
};

/**
 * Sets how many frames pass between renders (the debug tab's; the feature's `updateFrames`).
 * @internal
 */
export const setRainOcclusionUpdateFrames = (frames: number) => {
  const rt = runtime;
  if (!rt || !Number.isInteger(frames) || frames < 0) return;
  rt.opts = { ...rt.opts, updateFrames: frames };
};

/**
 * Sets (or with null, removes) the hooks every render calls: the debug tab's stats set them when
 * its module loads (debug env). Without hooks, a render reads no wall clock.
 * @internal
 */
export const _setRainOcclusionRenderHooks = (hooks: RainOcclusionRenderHooks | null) => {
  if (runtime) runtime.hooks = hooks;
};

/**
 * The map's part of the scenes' life: a scene's exit drops the map (open sky until the next
 * scene's first render), and the next scene's world clear makes and clears the target before its
 * scene code can build a material that samples it.
 * @internal
 */
export const rainOcclusionSceneHooks: SceneHooks = {
  exit: () => {
    const rt = runtime;
    if (!rt) return;
    rt.render.hasRendered = false;
    rt.render.isRequested = true;
    writeStrength(rt);
  },
  worldCleared: () => {
    const rt = runtime;
    const renderer = getRenderer() as THREE.Renderer | undefined;
    if (rt && renderer?.hasInitialized()) prepareMap(rt, renderer);
  },
};

/**
 * Disposes the map (a mounted engine's unmount).
 * @internal
 */
export const stopRainOcclusion = () => {
  const map = runtime?.map;
  if (map) {
    map.target.dispose();
    map.material.dispose();
  }
  runtime = null;
};

/**
 * Creates the running state and registers `rainOcclusionSystem` (the `rainOcclusion()` feature's
 * install).
 * @internal
 */
export const installRainOcclusion = (ctx: FeatureContext, opts: ResolvedRainOcclusionOpts) => {
  runtime = {
    opts,
    render: createRainMapRenderState(),
    isEnabled: true,
    renders: 0,
    map: null,
    hooks: null,
  };
  ctx.registerPlugin((world) => {
    // MAIN, order 1 with surfaceConditionsSystem, after it by install order
    world.addSystem(ECSSystemStage.MAIN, 'rainOcclusionSystem', rainOcclusionSystem, 1);
  });
};
