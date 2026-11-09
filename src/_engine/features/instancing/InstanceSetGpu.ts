import * as THREE from 'three/webgpu';
import { getConservativeGeometryRadius } from '../../kernel/assets/Geometry';
import { getMainCamera } from '../../kernel/camera/Camera';
import { getLodFrameInputs } from '../../kernel/ecs/LodTargets';
import { getMainLoopFrame } from '../../kernel/loop/MainLoop';
import {
  addDrawingPipelineHook,
  type DrawingPipelineHook,
} from '../../kernel/render/DrawingPipeline';
import { getRenderer } from '../../kernel/render/Renderer';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lwarn } from '../../utils/Logger';
import { DEFAULT_LOD_HYSTERESIS } from '../../utils/LodRules';
import type { InstancedLodPoolLevel } from './InstancedMeshPool';
import {
  ARGS_STRIDE,
  createInstanceSetFetch,
  createInstanceSetPasses,
  LIST_BASE_KEY,
  SELECT_MODE,
  STATE_INITIAL,
  type InstanceSetBuffers,
} from './InstanceSetNodes';
import type { CreateInstanceSetBackend } from './InstanceSetTypes';

// An instance set's GPU backend (docs/plans/p354_gpu-driven-culling.md D4-D8): the front's
// `import()` (InstanceSet.ts), so only a WebGPU device downloads it, with the kernel's drawing
// pipeline seam (DrawingPipeline.ts) it alone imports.
//
// - The buffers (D4): the instances' affine matrices and cull records (with their CPU copies, which
//   writeInstances fills and uploads by range), their state words, the budgeted visible lists, the
//   per-level counters and the draws' indirect args. The passes and the vertex fetch are
//   InstanceSetNodes.ts.
// - The draws (D8): a plain Mesh per (level, geometry group) drawing with `drawIndexedIndirect`
//   from its own args. Each source material gets one node variant (its values copied) whose
//   `positionNode` is the shared fetch through the visible list; the list a mesh reads is a
//   per-object uniform, so every draw of a material shares its build.
// - The dispatch (D5): one drawing pipeline hook for every GPU set. `isCulled` keeps a set's
//   draws to the main camera's renders (p354 Phase 3 gives every camera a slot) and notes the
//   sets the render reached; `finishRenderList`, after the projection and before any draw, runs
//   their passes against that render's camera. A render that never reaches a set (another scene,
//   another camera) costs it nothing.
// - Once a frame (D7): the frame's first dispatch selects (or forces) the levels from the LOD
//   frame inputs (kernel/ecs/LodTargets.ts, written by `lod()`); a later one in the frame only
//   reads them. Without `lod()` the inputs are never written: every instance draws level 0.

/** Variant keys not copied from the source material: its identity and listeners. */
const VARIANT_SKIPPED_KEYS = new Set(['uuid', 'id', '_listeners', 'version', 'userData', 'name']);

/** A level's draw: a geometry group, or the whole geometry. */
type LevelDraw = { start: number; count: number; material: THREE.Material };

/** A set's dispatch, what the pipeline hook calls. */
type GpuInstanceSet = {
  label: string;
  dispatch: (renderer: THREE.Renderer, camera: THREE.Camera) => void;
  /** The render it was last reached in (the hook's counter). */
  reachedRender: number;
};

// --- THE PIPELINE HOOK, shared by every GPU set ---

const setsByMesh = new WeakMap<THREE.Object3D, GpuInstanceSet>();
let liveSetCount = 0;
let removeHook: (() => void) | null = null;
/** The sets the render being projected reached, dispatched at its finishRenderList. */
const reachedSets: GpuInstanceSet[] = [];
let renderCounter = 0;
let isMainRender = false;

const pipelineHook: DrawingPipelineHook = {
  begin: (camera) => {
    renderCounter++;
    reachedSets.length = 0;
    isMainRender = camera === getMainCamera();
  },
  isCulled: (object) => {
    const set = setsByMesh.get(object);
    if (!set) return undefined;
    // Only the main camera draws a set until it has a slot per camera (p354 Phase 3)
    if (!isMainRender) return true;
    if (set.reachedRender !== renderCounter) {
      set.reachedRender = renderCounter;
      reachedSets.push(set);
    }
    return false;
  },
  finishRenderList: (camera, renderer) => {
    for (let i = 0; i < reachedSets.length; i++) reachedSets[i].dispatch(renderer, camera);
    reachedSets.length = 0;
  },
};

const addLiveSet = (renderer: THREE.Renderer) => {
  liveSetCount++;
  removeHook ??= addDrawingPipelineHook(renderer, pipelineHook);
};

const removeLiveSet = () => {
  liveSetCount--;
  if (liveSetCount > 0 || !removeHook) return;
  removeHook();
  removeHook = null;
  reachedSets.length = 0;
};

// --- THE DRAWS ---

/** A level's draws: one per geometry group with a material array, else one for the geometry. */
const getLevelDraws = (level: InstancedLodPoolLevel): LevelDraw[] => {
  const { geometry, material } = level;
  const whole = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  if (!Array.isArray(material)) return [{ start: 0, count: whole, material }];
  if (geometry.groups.length === 0) return [{ start: 0, count: whole, material: material[0] }];
  return geometry.groups
    .filter((group) => material[group.materialIndex ?? 0])
    .map(({ start, count, materialIndex }) => ({
      start,
      count,
      material: material[materialIndex ?? 0],
    }));
};

/** A node variant of `source` drawing through the set's fetch: its values copied (not its
 * identity or listeners, so disposing the variant leaves the source be), its own mask kept. */
const createVariant = (
  renderer: THREE.Renderer,
  source: THREE.Material,
  positionNode: THREE.Node<'vec3'>,
  label: string
) => {
  const node = renderer.library.fromMaterial(source) as THREE.NodeMaterial;
  const variant = new (node.constructor as new () => THREE.NodeMaterial)();
  for (const key of Object.keys(node)) {
    if (VARIANT_SKIPPED_KEYS.has(key)) continue;
    (variant as unknown as Record<string, unknown>)[key] = (
      node as unknown as Record<string, unknown>
    )[key];
  }
  if (IS_DEBUG_ENV && node.positionNode) {
    lwarn(
      `Instance set "${label}": material "${source.name || source.type}" has its own positionNode, which the set's instance fetch replaces.`
    );
  }
  variant.name = `${source.name || source.type} (instance set)`;
  variant.positionNode = positionNode;
  variant.needsUpdate = true;
  return variant;
};

/** A draw's geometry: the level's attributes and index, its own indirect args. */
const createDrawGeometry = (
  source: THREE.BufferGeometry,
  args: THREE.IndirectStorageBufferAttribute,
  argsIndex: number
) => {
  const geometry = new THREE.BufferGeometry();
  if (source.index) geometry.setIndex(source.index);
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  // Read by three's render list sort (the draws sit at the origin)
  if (!source.boundingSphere) source.computeBoundingSphere();
  geometry.boundingSphere = source.boundingSphere!.clone();
  geometry.setIndirect(args, argsIndex * ARGS_STRIDE * 4);
  return geometry;
};

const _projScreen = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

/**
 * Creates a set's GPU backend.
 * @internal
 */
export const createGpuInstanceSetBackend: CreateInstanceSetBackend = (params) => {
  const renderer = getRenderer();
  if (!renderer) throw new Error('Instance set GPU backend: no renderer.');
  const { levels, maxInstances, maxVisible, lod, label } = params;
  const levelCount = levels.length;
  const lastLevel = levelCount - 1;

  // --- The buffers ---
  const radii = levels.map((level) => getConservativeGeometryRadius(level.geometry));
  const recordRadius = radii[0];
  const frustumRadiusScale = recordRadius > 0 ? Math.max(1, ...radii) / recordRadius : 1;
  const rowsArray = new Float32Array(maxInstances * 12);
  const recordsArray = new Float32Array(maxInstances * 4);
  const levelDraws = levels.map(getLevelDraws);
  const groupCount = Math.max(...levelDraws.map((draws) => draws.length));
  const argsArray = new Uint32Array(levelCount * groupCount * ARGS_STRIDE);
  levelDraws.forEach((draws, level) => {
    draws.forEach(({ start, count }, group) => {
      const at = (level * groupCount + group) * ARGS_STRIDE;
      argsArray[at] = count;
      argsArray[at + 2] = start;
    });
  });
  const buffers: InstanceSetBuffers = {
    rows: new THREE.StorageBufferAttribute(rowsArray, 4),
    records: new THREE.StorageBufferAttribute(recordsArray, 4),
    state: new THREE.StorageBufferAttribute(new Uint32Array(maxInstances).fill(STATE_INITIAL), 1),
    lists: new THREE.StorageBufferAttribute(new Uint32Array(levelCount * maxVisible), 1),
    counters: new THREE.StorageBufferAttribute(new Uint32Array(levelCount), 1),
    args: new THREE.IndirectStorageBufferAttribute(argsArray, 1),
  };

  // --- The passes ---
  const { uniforms, reset, cull, finalize } = createInstanceSetPasses({
    buffers,
    maxInstances,
    maxVisible,
    selection: {
      screenSizes: levels.map((level) => level.screenSize),
      cullScreenSize: lod.cullScreenSize ?? 0,
      hysteresis: lod.hysteresis ?? DEFAULT_LOD_HYSTERESIS,
    },
    groupCount,
    frustumRadiusScale,
  });
  const passes = [reset, cull, finalize];
  const bias = lod.bias ?? 1;
  const hasLevelsToSelect = levelCount > 1 || (lod.cullScreenSize ?? 0) > 0;

  // --- The draws ---
  const positionNode = createInstanceSetFetch(buffers, maxInstances, levelCount * maxVisible);
  const variants = new Map<THREE.Material, THREE.NodeMaterial>();
  const getVariant = (source: THREE.Material) => {
    let variant = variants.get(source);
    if (!variant) {
      variant = createVariant(renderer, source, positionNode, label);
      variants.set(source, variant);
    }
    return variant;
  };
  const meshes: THREE.Mesh[] = [];
  let extent = 0;
  let selectedFrame = -1;
  let hasWarnedNoLod = false;

  const set: GpuInstanceSet = {
    label,
    reachedRender: -1,
    dispatch: (gpu, camera) => {
      if (extent === 0) return;
      // The state moves in the frame's first dispatch only (D7)
      const frame = getMainLoopFrame();
      let mode: number = SELECT_MODE.HOLD;
      if (selectedFrame !== frame) {
        selectedFrame = frame;
        const inputs = getLodFrameInputs();
        if (inputs.frame < 0) {
          // No lod(): level 0, as an instanced LOD pool draws without it
          if (hasLevelsToSelect && !hasWarnedNoLod) {
            hasWarnedNoLod = true;
            lwarn(
              `Instance set "${label}": its levels need the lod() feature in InitEngine's \`features\`; it draws level 0.`
            );
          }
          mode = SELECT_MODE.FORCE;
          uniforms.forceLevel.value = 0;
        } else if (inputs.frame === frame && inputs.forceLevel >= 0) {
          mode = SELECT_MODE.FORCE;
          uniforms.forceLevel.value = Math.min(inputs.forceLevel, lastLevel);
        } else if (inputs.frame === frame && inputs.hasCamera && !inputs.isFrozen) {
          // A frame the selection didn't run (the app loop paused) holds the levels, as lod() does
          mode = SELECT_MODE.SELECT;
          uniforms.cameraPosition.value.copy(inputs.cameraPosition);
          uniforms.k.value = inputs.k * bias;
          uniforms.isOrtho.value = inputs.isOrtho ? 1 : 0;
        }
      }
      uniforms.mode.value = mode;

      // three updated the camera's matrices for this render before its projection
      _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projScreen, camera.coordinateSystem, camera.reversedDepth);
      for (let p = 0; p < 6; p++) {
        const { normal, constant } = _frustum.planes[p];
        uniforms.planes[p].value.set(normal.x, normal.y, normal.z, constant);
      }
      uniforms.extent.value = extent;
      cull.count = extent;
      void gpu.compute(passes);
    },
  };

  levelDraws.forEach((draws, level) => {
    draws.forEach(({ material }, group) => {
      const geometry = createDrawGeometry(
        levels[level].geometry,
        buffers.args,
        level * groupCount + group
      );
      const mesh = new THREE.Mesh(geometry, getVariant(material));
      // The cull is the culling (three sees one object at the origin), and a set has no raycast
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      // Only the main camera draws a set until p354 Phase 3's slots: no shadow pass
      mesh.castShadow = false;
      mesh.receiveShadow = params.receiveShadow;
      mesh.userData[LIST_BASE_KEY] = level * maxVisible;
      mesh.name = `${label} level ${level} group ${group}`;
      setsByMesh.set(mesh, set);
      meshes.push(mesh);
    });
  });
  params.object.add(...meshes);
  addLiveSet(renderer);

  const writeInstances = (start: number, matrices: Float32Array, count: number) => {
    for (let i = 0; i < count; i++) {
      const m = i * 16;
      const row = (start + i) * 12;
      // Column-major in, rows out: row r is (m[r], m[r + 4], m[r + 8], m[r + 12])
      for (let r = 0; r < 3; r++) {
        rowsArray[row + r * 4] = matrices[m + r];
        rowsArray[row + r * 4 + 1] = matrices[m + r + 4];
        rowsArray[row + r * 4 + 2] = matrices[m + r + 8];
        rowsArray[row + r * 4 + 3] = matrices[m + r + 12];
      }
      const record = (start + i) * 4;
      const scale = Math.hypot(matrices[m], matrices[m + 1], matrices[m + 2]);
      recordsArray[record] = matrices[m + 12];
      recordsArray[record + 1] = matrices[m + 13];
      recordsArray[record + 2] = matrices[m + 14];
      recordsArray[record + 3] = scale * recordRadius;
    }
    buffers.rows.addUpdateRange(start * 12, count * 12);
    buffers.rows.needsUpdate = true;
    buffers.records.addUpdateRange(start * 4, count * 4);
    buffers.records.needsUpdate = true;
    extent = Math.max(extent, start + count);
  };

  const dispose = () => {
    removeLiveSet();
    for (const mesh of meshes) {
      mesh.removeFromParent();
      setsByMesh.delete(mesh);
    }
    // The variants (their render objects with them), never the sources. The draws' geometries
    // aren't disposed: three would free the level geometries' shared buffers with them
    for (const variant of variants.values()) variant.dispose();
    for (const pass of passes) pass.dispose();
    for (const buffer of Object.values(buffers)) buffer.dispose();
  };

  return {
    writeInstances,
    dispose,
    debugBuffers: {
      counters: buffers.counters,
      state: buffers.state,
      levelCount,
      maxVisible,
      getExtent: () => extent,
    },
  };
};
