import * as THREE from 'three/webgpu';
import { getConservativeGeometryRadius } from '../../kernel/assets/Geometry';
import { getLodFrameInputs } from '../../kernel/ecs/LodTargets';
import { getMainLoopFrame } from '../../kernel/loop/MainLoop';
import {
  addDrawingPipelineHook,
  type DrawingPipelineHook,
} from '../../kernel/render/DrawingPipeline';
import { enableLodDither, setObjectLodFadeNode } from '../../kernel/render/LodFade';
import { getRenderer } from '../../kernel/render/Renderer';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { lwarn } from '../../utils/Logger';
import { DEFAULT_LOD_HYSTERESIS, getLodFadeDelta } from '../../utils/LodRules';
import type { InstancedLodPoolLevel } from './InstancedMeshPool';
import {
  ALL_LEVELS,
  ARGS_STRIDE,
  createInstanceSetFetch,
  createInstanceSetPasses,
  LIST_BASE_KEY,
  SELECT_MODE,
  STATE_INITIAL,
  STATE_REMOVED,
  type InstanceSetBuffers,
} from './InstanceSetNodes';
import type { CreateInstanceSetBackend, InstanceSetDebugSlot } from './InstanceSetTypes';

// An instance set's GPU backend (docs/plans/p354_gpu-driven-culling.md D4-D8): the front's
// `import()` (InstanceSet.ts), so only a WebGPU device downloads it, with the kernel's drawing
// pipeline seam (DrawingPipeline.ts) it alone imports.
//
// - The buffers (D4): the instances' affine matrices and cull records (with their CPU copies, which
//   writeInstances fills; the ranges written upload at the next dispatch, a write touching the
//   last one merged into it), their state words, and per slot the budgeted visible lists, the
//   per-level counters and the draws' indirect args. The passes and the vertex fetch are
//   InstanceSetNodes.ts. The state is the GPU's (the cull writes it), but an added range
//   starts it (STATE_INITIAL) and a removed one stops it (STATE_REMOVED: the cull skips it) by
//   uploading that range from the CPU array. Only once the buffer exists: three creates it from the
//   whole array and keeps the update ranges added before, which the next upload would then write
//   again over the GPU's state (`Attributes.update` doesn't clear them on create).
// - The slots (D6): every camera whose render reaches the set gets one, on its first such render,
//   up to `maxSlots`, released after SLOT_RELEASE_FRAMES frames unused. A slot is its draws and its
//   part of the lists, counters and args, which are sized for every slot when the set is created:
//   growing them would move a buffer an outer render's draws still read (the view's, while a nested
//   shadow render takes a slot). The set's group holds a probe: a mesh the hook always culls, whose
//   `isCulled` call picks the render's slot. three projects an object's children after the object
//   itself, so the slot's draws, a group under the probe, are projected in the same render even on
//   the camera's first one. A shadow render's slot (three's shadow pass: its scene's
//   `overrideMaterial` is a shadow pass material) draws the casting levels only: its dispatch
//   appends no other level (`levelMask`), and the hook culls the other levels' draws, which VSM
//   would draw into the shadow map whatever their `castShadow` (a receiving object).
// - The draws (D8): per slot, a plain Mesh per (level, geometry group) drawing with
//   `drawIndexedIndirect` from its own args. Each source material gets one node variant (its
//   values copied) whose `positionNode` is the shared fetch through the visible lists; the list a
//   mesh reads is a per-object uniform, so every draw of a material, in every slot, shares its
//   build. The sources get the LOD dither (`enableLodDither`, as a pool's level materials), which
//   the variants copy with the rest of their mask, and each draw's dither reads the drawn copy's
//   fade from its list entry (`setObjectLodFadeNode`, kernel/render/LodFade.ts: keyed on the
//   draw, so the shadow pass, which builds it with its own material, reads it too).
// - The dispatch (D5): one drawing pipeline hook for every GPU set. `isCulled` keeps each slot's
//   draws to its camera's renders and notes the sets the render reached; `finishRenderList`,
//   after the projection and before any draw, runs their passes into the render's slot against its
//   camera. A render that never reaches a set (another scene, a hidden set) costs it nothing.
// - Once a frame (D7): the frame's first dispatch moves the state from the LOD frame inputs
//   (kernel/ecs/LodTargets.ts, written by `lod()`): it selects (or forces, or with `freeze` keeps)
//   the levels and advances the cross-fades by the inputs' step; a later one in the frame (another
//   slot, or the same camera's next render) only reads it. Without `lod()` the inputs are never
//   written: every instance draws level 0, unfaded.

/** Variant keys not copied from the source material: its identity and listeners. */
const VARIANT_SKIPPED_KEYS = new Set(['uuid', 'id', '_listeners', 'version', 'userData', 'name']);
/** The most separate write ranges kept for the next upload: past it they become one range over
 * them all (the instances between uploaded too), so a set no render reaches (hidden) while its
 * instances move keeps no growing list, and scattered writes cost a bounded number of uploads. */
const MAX_PENDING_WRITES = 256;
/** A slot no render reached for this many frames is released (D6). */
const SLOT_RELEASE_FRAMES = 120;

/** A level's draw: a geometry group, or the whole geometry. */
type LevelDraw = { start: number; count: number; material: THREE.Material };

/** A camera's slot in a set: its draws and its part of the lists, counters and args. */
type Slot = {
  index: number;
  /** The camera it's held by; null while free. */
  camera: THREE.Camera | null;
  /** The main loop frame a render last reached it in. */
  lastFrame: number;
  /** Its dispatches since its camera took it (the debug readback's). */
  dispatches: number;
  /** Its draws, made on the index's first use and kept while it's free (detached). */
  group: THREE.Group | null;
};

/** A set as the pipeline hook sees it. */
type GpuInstanceSet = {
  /** The render it was last reached in (the hook's counter). */
  reachedRender: number;
  /** That render's slot: null when it has none (past `maxSlots`; a shadow render of a set with no
   * casting level). */
  slot: Slot | null;
  /** That render is a shadow map's: its slot draws the casting levels only. */
  isShadowRender: boolean;
  /** Finds or takes `camera`'s slot for a render that reached the set (`isShadowRender` set). */
  getSlot: (camera: THREE.Camera) => Slot | null;
  /** Runs the passes into the render's slot. */
  dispatch: (renderer: THREE.Renderer, camera: THREE.Camera) => void;
};

/** A set's object the hook decides: a slot's draw, or the set's probe (no slot). `casts`: the
 * draw's level casts shadows. */
type SetObject = { set: GpuInstanceSet; slot: Slot | null; casts: boolean };

// --- THE PIPELINE HOOK, shared by every GPU set ---

const setObjects = new WeakMap<THREE.Object3D, SetObject>();
let liveSetCount = 0;
let removeHook: (() => void) | null = null;
/** The sets the render being projected reached, dispatched at its finishRenderList. */
const reachedSets: GpuInstanceSet[] = [];
let renderCounter = 0;

const pipelineHook: DrawingPipelineHook = {
  begin: () => {
    renderCounter++;
    reachedSets.length = 0;
  },
  isCulled: (object, camera) => {
    const entry = setObjects.get(object);
    if (!entry) return undefined;
    const { set, slot } = entry;
    if (slot) {
      return (
        set.reachedRender !== renderCounter ||
        set.slot !== slot ||
        (set.isShadowRender && !entry.casts)
      );
    }
    // The probe, projected before the slots' draws (its children): the render's slot
    if (set.reachedRender !== renderCounter) {
      set.reachedRender = renderCounter;
      set.isShadowRender = isInShadowPass(object);
      set.slot = set.getSlot(camera);
      if (set.slot) reachedSets.push(set);
    }
    return true;
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

/** The probe's geometry and material: never drawn (the hook culls it, and an invisible material
 * isn't listed even under another pipeline), so every set shares them, never disposed. */
let probeParts: [THREE.BufferGeometry, THREE.Material] | null = null;

/** Whether `object` is being drawn into a shadow map: three's shadow pass overrides its scene's
 * material with a shadow pass material for the render. */
const isInShadowPass = (object: THREE.Object3D) => {
  let root = object;
  while (root.parent) root = root.parent;
  const override = (root as THREE.Scene).overrideMaterial as
    | (THREE.Material & { isShadowPassMaterial?: boolean })
    | null
    | undefined;
  return override?.isShadowPassMaterial === true;
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
 * identity or listeners, so disposing the variant leaves the source be), its own mask kept, the
 * LOD dither added to the source first (as a pool does to its level materials; each draw gives it
 * the drawn copy's fade, `setObjectLodFadeNode`). */
const createVariant = (
  renderer: THREE.Renderer,
  source: THREE.Material,
  position: THREE.Node<'vec3'>,
  label: string
) => {
  enableLodDither(source);
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
  variant.positionNode = position;
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
  const { levels, maxInstances, maxVisible, maxSlots, lod, label } = params;
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
  const slotDrawCount = levelCount * groupCount;
  const argsArray = new Uint32Array(maxSlots * slotDrawCount * ARGS_STRIDE);
  for (let slot = 0; slot < maxSlots; slot++) {
    levelDraws.forEach((draws, level) => {
      draws.forEach(({ start, count }, group) => {
        const at = (slot * slotDrawCount + level * groupCount + group) * ARGS_STRIDE;
        argsArray[at] = count;
        argsArray[at + 2] = start;
      });
    });
  }
  const listLength = maxSlots * levelCount * maxVisible;
  const stateArray = new Uint32Array(maxInstances).fill(STATE_INITIAL);
  const buffers: InstanceSetBuffers = {
    rows: new THREE.StorageBufferAttribute(rowsArray, 4),
    records: new THREE.StorageBufferAttribute(recordsArray, 4),
    state: new THREE.StorageBufferAttribute(stateArray, 1),
    progress: new THREE.StorageBufferAttribute(new Float32Array(maxInstances).fill(1), 1),
    lists: new THREE.StorageBufferAttribute(new Uint32Array(listLength), 1),
    counters: new THREE.StorageBufferAttribute(new Uint32Array(maxSlots * levelCount), 1),
    args: new THREE.IndirectStorageBufferAttribute(argsArray, 1),
  };

  // --- The passes ---
  const { uniforms, reset, cull, finalize } = createInstanceSetPasses({
    buffers,
    maxInstances,
    maxVisible,
    maxSlots,
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
  /** Whether each level casts shadows (a pool level's default: it does). */
  const casts = levels.map((level) => level.castShadow ?? true);
  /** A shadow render's `levelMask`: the casting levels (levels past 32 always pass the mask; the
   * hook culls their draws). */
  const castMask = casts.reduce(
    (mask, isCast, level) => (isCast && level < 32 ? (mask | (1 << level)) >>> 0 : mask),
    0
  );
  const hasCastingLevel = casts.includes(true);

  // --- The draws ---
  const fetch = createInstanceSetFetch(buffers, maxInstances, listLength);
  const variants = new Map<THREE.Material, THREE.NodeMaterial>();
  const getVariant = (source: THREE.Material) => {
    let variant = variants.get(source);
    if (!variant) {
      variant = createVariant(renderer, source, fetch.position, label);
      variants.set(source, variant);
    }
    return variant;
  };
  probeParts ??= [new THREE.BufferGeometry(), new THREE.MeshBasicNodeMaterial({ visible: false })];
  const probe = new THREE.Mesh(...probeParts);
  probe.name = `${label} cameras`;
  probe.raycast = () => {};
  const slots: Slot[] = Array.from({ length: maxSlots }, (_, index) => ({
    index,
    camera: null,
    lastFrame: -1,
    dispatches: 0,
    group: null,
  }));
  /** Every slot's draws made so far, for the dispose. */
  const meshes: THREE.Mesh[] = [];
  let extent = 0;
  /** The passes ran once: three created their buffers (the state's included) from the arrays. */
  let isDispatched = false;
  /** The instances written since the last upload, as (start, end) pairs: a write touching the
   * last pair merges into it, so writes in order (one instance a call) upload as one range. */
  const pendingWrites: number[] = [];

  /** Uploads the matrices and records written since the last dispatch: before this dispatch's
   * passes read the records and its draws the matrices. Before the first, nothing: three creates
   * the buffers from the whole arrays, and an update range added before would be uploaded again
   * at the next update (`Attributes.update` doesn't clear them on create). */
  const uploadWrites = () => {
    if (pendingWrites.length === 0) return;
    if (isDispatched) {
      const { rows, records } = buffers;
      for (let i = 0; i < pendingWrites.length; i += 2) {
        const start = pendingWrites[i];
        const count = pendingWrites[i + 1] - start;
        rows.addUpdateRange(start * 12, count * 12);
        records.addUpdateRange(start * 4, count * 4);
      }
      rows.needsUpdate = true;
      records.needsUpdate = true;
    }
    pendingWrites.length = 0;
  };
  let selectedFrame = -1;
  /** The main loop frame of the set's first dispatch. */
  let firstFrame = -1;
  let releasedFrame = -1;
  let hasWarnedNoLod = false;
  let hasWarnedSlots = false;

  /** The slot's draws: a mesh per (level, group), drawing from its part of the args and lists. */
  const createSlotDraws = (slot: Slot) => {
    const group = new THREE.Group();
    group.name = `${label} slot ${slot.index}`;
    levelDraws.forEach((draws, level) => {
      draws.forEach(({ material }, drawGroup) => {
        const slotLevel = slot.index * levelCount + level;
        const geometry = createDrawGeometry(
          levels[level].geometry,
          buffers.args,
          slotLevel * groupCount + drawGroup
        );
        const mesh = new THREE.Mesh(geometry, getVariant(material));
        // The cull is the culling (three sees one object at the origin), and a set has no raycast
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
        mesh.castShadow = casts[level];
        mesh.receiveShadow = params.receiveShadow;
        mesh.userData[LIST_BASE_KEY] = slotLevel * maxVisible;
        mesh.name = `${label} slot ${slot.index} level ${level} group ${drawGroup}`;
        // Before its first build: the drawn copy's fade, in the shadow pass too
        setObjectLodFadeNode(mesh, fetch.fade);
        setObjects.set(mesh, { set, slot, casts: casts[level] });
        meshes.push(mesh);
        group.add(mesh);
      });
    });
    return group;
  };

  /** Frees the slots no render reached for SLOT_RELEASE_FRAMES frames: once a frame. */
  const releaseUnusedSlots = (frame: number) => {
    if (releasedFrame === frame) return;
    releasedFrame = frame;
    for (const slot of slots) {
      if (!slot.camera || frame - slot.lastFrame <= SLOT_RELEASE_FRAMES) continue;
      slot.camera = null;
      slot.group?.removeFromParent();
    }
  };

  const set: GpuInstanceSet = {
    reachedRender: -1,
    slot: null,
    isShadowRender: false,
    getSlot: (camera) => {
      // A shadow map of a set that casts nothing: no slot to spend
      if (set.isShadowRender && !hasCastingLevel) return null;
      const frame = getMainLoopFrame();
      releaseUnusedSlots(frame);
      let free: Slot | null = null;
      for (const slot of slots) {
        if (slot.camera === camera) {
          slot.lastFrame = frame;
          return slot;
        }
        if (!slot.camera) free ??= slot;
      }
      if (!free) {
        if (IS_DEBUG_ENV && !hasWarnedSlots) {
          hasWarnedSlots = true;
          lwarn(
            `Instance set "${label}": its ${maxSlots} slots are taken: camera "${camera.name || camera.type}" draws none of it until one frees (unused for ${SLOT_RELEASE_FRAMES} frames). Raise its maxSlots.`
          );
        }
        return null;
      }
      free.camera = camera;
      free.lastFrame = frame;
      free.dispatches = 0;
      free.group ??= createSlotDraws(free);
      probe.add(free.group);
      return free;
    },
    dispatch: (gpu, camera) => {
      const { slot } = set;
      // With no live instance too: the reset and finalize zero the slot's draws
      if (!slot) return;
      slot.dispatches++;
      // The state moves once a frame (D7): in the frame's first dispatch after lod() wrote its
      // inputs. A dispatch before that (a compile at the scene's load, before the first frame) and
      // a frame they aren't written in (the app loop paused: the levels and the fades hold, as
      // lod()'s systems do) only read it. No inputs a whole frame after the set's first dispatch:
      // no lod()
      const frame = getMainLoopFrame();
      if (firstFrame < 0) firstFrame = frame;
      const inputs = getLodFrameInputs();
      const isMoved = selectedFrame === frame;
      let mode: number = SELECT_MODE.HOLD;
      if (!isMoved && inputs.frame === frame) {
        selectedFrame = frame;
        // `freeze` (or no camera) holds the levels only
        const fadeSeconds = lod.fadeSeconds ?? inputs.fadeSeconds;
        uniforms.isFaded.value = fadeSeconds > 0 ? 1 : 0;
        uniforms.fadeDelta.value = getLodFadeDelta(inputs.fadeStep, fadeSeconds);
        if (inputs.forceLevel >= 0) {
          mode = SELECT_MODE.FORCE;
          uniforms.forceLevel.value = Math.min(inputs.forceLevel, lastLevel);
        } else if (inputs.hasCamera && !inputs.isFrozen) {
          mode = SELECT_MODE.SELECT;
          uniforms.cameraPosition.value.copy(inputs.cameraPosition);
          uniforms.k.value = inputs.k * bias;
          uniforms.isOrtho.value = inputs.isOrtho ? 1 : 0;
        } else {
          mode = SELECT_MODE.ADVANCE;
        }
      } else if (!isMoved && inputs.frame < 0 && frame > firstFrame) {
        selectedFrame = frame;
        // Level 0, as an instanced LOD pool draws without lod(), and no fades
        if (hasLevelsToSelect && !hasWarnedNoLod) {
          hasWarnedNoLod = true;
          lwarn(
            `Instance set "${label}": its levels need the lod() feature in InitEngine's \`features\`; it draws level 0.`
          );
        }
        mode = SELECT_MODE.FORCE;
        uniforms.forceLevel.value = 0;
        uniforms.isFaded.value = 0;
        uniforms.fadeDelta.value = 1;
      }
      uniforms.mode.value = mode;
      uniforms.slotLevel.value = slot.index * levelCount;
      uniforms.levelMask.value = set.isShadowRender ? castMask : ALL_LEVELS;

      // three updated the camera's matrices for this render before its projection
      _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projScreen, camera.coordinateSystem, camera.reversedDepth);
      for (let p = 0; p < 6; p++) {
        const { normal, constant } = _frustum.planes[p];
        uniforms.planes[p].value.set(normal.x, normal.y, normal.z, constant);
      }
      uploadWrites();
      uniforms.extent.value = extent;
      cull.count = Math.max(extent, 1);
      void gpu.compute(passes);
      isDispatched = true;
    },
  };

  setObjects.set(probe, { set, slot: null, casts: false });
  params.object.add(probe);
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
    // Uploaded at the next dispatch, merged with the last write when it touches it
    const end = start + count;
    const last = pendingWrites.length - 2;
    if (last >= 0 && start <= pendingWrites[last + 1] && end >= pendingWrites[last]) {
      pendingWrites[last] = Math.min(pendingWrites[last], start);
      pendingWrites[last + 1] = Math.max(pendingWrites[last + 1], end);
    } else if (pendingWrites.length < MAX_PENDING_WRITES * 2) {
      pendingWrites.push(start, end);
    } else {
      // One range over every pending write and this one
      let first = start;
      let past = end;
      for (let i = 0; i < pendingWrites.length; i += 2) {
        first = Math.min(first, pendingWrites[i]);
        past = Math.max(past, pendingWrites[i + 1]);
      }
      pendingWrites.length = 0;
      pendingWrites.push(first, past);
    }
  };

  /** Sets a range's state words (an added range's start, a removed one's stop), uploaded once the
   * buffer exists (before, its creation uploads the array). */
  const setStates = (start: number, count: number, word: number) => {
    stateArray.fill(word, start, start + count);
    if (!isDispatched) return;
    buffers.state.addUpdateRange(start, count);
    buffers.state.needsUpdate = true;
  };

  const debugSlots: InstanceSetDebugSlot[] = [];

  const dispose = () => {
    removeLiveSet();
    probe.removeFromParent();
    for (const slot of slots) slot.group?.removeFromParent();
    for (const mesh of meshes) setObjects.delete(mesh);
    setObjects.delete(probe);
    // The variants (their render objects with them), never the sources. The draws' geometries
    // aren't disposed: three would free the level geometries' shared buffers with them
    for (const variant of variants.values()) variant.dispose();
    for (const pass of passes) pass.dispose();
    for (const buffer of Object.values(buffers)) buffer.dispose();
  };

  return {
    addInstances: (start, matrices, count) => {
      // Not selected, no fade: the progress is read only while a fade runs
      setStates(start, count, STATE_INITIAL);
      writeInstances(start, matrices, count);
    },
    writeInstances,
    removeInstances: (start, count) => setStates(start, count, STATE_REMOVED),
    setExtent: (value) => {
      extent = value;
    },
    dispose,
    debugBuffers: {
      counters: buffers.counters,
      state: buffers.state,
      levelCount,
      maxVisible,
      getSlots: () => {
        debugSlots.length = 0;
        for (const { index, camera, dispatches } of slots) {
          if (camera) debugSlots.push({ index, camera, dispatches });
        }
        return debugSlots;
      },
    },
  };
};
