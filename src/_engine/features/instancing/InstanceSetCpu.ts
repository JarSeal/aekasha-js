import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { getConservativeGeometryRadius } from '../../kernel/assets/Geometry';
import { getLodFrameInputs } from '../../kernel/ecs/LodTargets';
import { getMainLoopFrame } from '../../kernel/loop/MainLoop';
import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import {
  createLodFadeAttribute,
  enableLodDither,
  LOD_FADE_OPAQUE,
} from '../../kernel/render/LodFade';
import { lwarn } from '../../utils/Logger';
import {
  DEFAULT_LOD_HYSTERESIS,
  LOD_LEVEL_NONE,
  selectLodTarget,
  stepLodInstanceState,
  type LodInstanceState,
} from '../../utils/LodRules';
import type { CreateInstanceSetBackend } from './InstanceSetTypes';

// An instance set's CPU backend (docs/plans/p354_gpu-driven-culling.md D9): what a set draws with
// on a renderer without compute (WebGL2). The front's `import()` (InstanceSet.ts), so only such a
// device downloads it. The same set, data and rules as the GPU backend, without the compute:
//
// - An InstancedMesh per level, sized for every instance, with its per-instance `lodFade`
//   (createLodFadeAttribute) and the level's materials (the LOD dither on them, as a pool's). An
//   instance is in its level's mesh, in two while it cross-fades (the outgoing copy at t - 1), in
//   one fading to or from culled, and in none culled or before its first selection: an instanced LOD
//   pool's level meshes without the entities (InstancedMeshPool.ts).
// - Once a frame a system walks the instances' typed arrays with utils/LodRules.ts' selection and
//   fade step (no entities, no storages), and moves only the instances whose copies change: a
//   swap-remove from a level mesh and an append to another, as the pool does. Only the level meshes
//   a change touched upload. It runs in APP_RENDER_SYNC at LOD_SELECTION, added to the set's world
//   with its first CPU set (so after `lod()`'s systems in that tier, which registered at install),
//   on the LOD frame inputs `lodSelectionSystem` just wrote: the GPU backend's modes (select, force,
//   hold the levels, level 0 without `lod()`).
// - No per-instance frustum culling: three culls each level mesh as a whole by its bounds (the
//   union of every instance's sphere at its largest level's radius, grown as instances are
//   written), for every camera, shadows included. So no slots: each level mesh casts by its level's
//   `castShadow`, and VSM draws a non-casting level into its map as a receiver, as the pools do.

/** The CPU sets' system id, in each world with one. */
const SYSTEM_ID = 'instanceSetCpu';

/** Each world's CPU sets' frame steps, run by its system. */
const stepsByWorld = new Map<ECSWorld, Set<() => void>>();

const runInstanceSetCpuSystem = (world: ECSWorld) => {
  const steps = stepsByWorld.get(world);
  if (steps) for (const step of steps) step();
};

const addStep = (world: ECSWorld, step: () => void) => {
  let steps = stepsByWorld.get(world);
  if (!steps) {
    steps = new Set();
    stepsByWorld.set(world, steps);
    // Equal order runs in registration order: after lod()'s selection, apply and fades
    world.addSystem(
      ECSSystemStage.APP_RENDER_SYNC,
      SYSTEM_ID,
      runInstanceSetCpuSystem,
      APP_RENDER_SYNC_ORDER.LOD_SELECTION
    );
  }
  steps.add(step);
};

const removeStep = (world: ECSWorld, step: () => void) => {
  const steps = stepsByWorld.get(world);
  if (!steps?.delete(step) || steps.size > 0) return;
  stepsByWorld.delete(world);
  world.removeSystem(SYSTEM_ID);
};

/** How a frame moves the levels: the GPU backend's modes (InstanceSetNodes.ts' SELECT_MODE). */
const MODE_SELECT = 0;
const MODE_FORCE = 1;
const MODE_ADVANCE = 2;

/** One instance's state while it's stepped (no allocation per instance). */
const _state: LodInstanceState = { level: LOD_LEVEL_NONE, outgoing: LOD_LEVEL_NONE, progress: 1 };
const _point = new THREE.Vector3();

/**
 * Creates a set's CPU backend.
 * @internal
 */
export const createCpuInstanceSetBackend: CreateInstanceSetBackend = (params) => {
  const { world, levels, maxInstances, lod, label } = params;
  const levelCount = levels.length;
  const lastLevel = levelCount - 1;
  const screenSizes = levels.map((level) => ({ screenSize: level.screenSize }));
  const cullScreenSize = lod.cullScreenSize ?? 0;
  const hysteresis = lod.hysteresis ?? DEFAULT_LOD_HYSTERESIS;
  const bias = lod.bias ?? 1;
  const hasLevelsToSelect = levelCount > 1 || cullScreenSize > 0;

  // --- Per instance ---
  const radii = levels.map((level) => getConservativeGeometryRadius(level.geometry));
  /** The bounds' radius over the record's: the largest level's over level 0's (the measure's). */
  const boundsRadiusScale = radii[0] > 0 ? Math.max(1, ...radii) / radii[0] : 1;
  /** Column major, 16 floats each: the copies' source. */
  const matrices = new Float32Array(maxInstances * 16);
  /** The origin and scale × level 0's conservative radius: what the selection measures. */
  const records = new Float32Array(maxInstances * 4);
  /** LodRules' state: the level, the outgoing level and the fade's progress (f64, the ECS path's). */
  const levelOf = new Int16Array(maxInstances).fill(LOD_LEVEL_NONE);
  const outgoingOf = new Int16Array(maxInstances).fill(LOD_LEVEL_NONE);
  const progressOf = new Float64Array(maxInstances).fill(1);
  /** The slot of the instance's copy in its level's mesh, and of its outgoing copy; -1: none. */
  const inSlots = new Int32Array(maxInstances).fill(-1);
  const outSlots = new Int32Array(maxInstances).fill(-1);

  // --- Per level ---
  const meshes = levels.map((level, i) => {
    const mesh = new THREE.InstancedMesh(level.geometry, level.material, maxInstances);
    mesh.count = 0;
    mesh.castShadow = level.castShadow ?? true;
    mesh.receiveShadow = params.receiveShadow;
    mesh.name = `${label} level ${i}`;
    // A set has no raycast (as on the GPU backend)
    mesh.raycast = () => {};
    mesh.boundingBox = new THREE.Box3();
    mesh.boundingSphere = new THREE.Sphere();
    createLodFadeAttribute(mesh);
    enableLodDither(level.material);
    params.object.add(mesh);
    return mesh;
  });
  const matrixArrays = meshes.map((mesh) => mesh.instanceMatrix.array as Float32Array);
  const fadeAttributes = meshes.map((mesh) => createLodFadeAttribute(mesh));
  const fadeArrays = fadeAttributes.map((attribute) => attribute.array as Float32Array);
  /** Per level mesh: the instance in each slot (the swap-remove patches the one it moves). */
  const owners = levels.map(() => new Int32Array(maxInstances));
  /** The level meshes a frame changed: their matrices (and counts), their fades. */
  const isMatrixChanged = new Uint8Array(levelCount);
  const isFadeChanged = new Uint8Array(levelCount);
  const bounds = new THREE.Box3();

  let extent = 0;
  let steppedFrame = -1;
  /** The main loop frame of the set's first step (with instances). */
  let firstFrame = -1;
  let hasWarnedNoLod = false;

  /** Appends instance `i`'s copy to `level`'s mesh: its slot. */
  const append = (level: number, i: number) => {
    const mesh = meshes[level];
    const slot = mesh.count;
    const to = matrixArrays[level];
    const at = slot * 16;
    const from = i * 16;
    for (let e = 0; e < 16; e++) to[at + e] = matrices[from + e];
    owners[level][slot] = i;
    mesh.count = slot + 1;
    isMatrixChanged[level] = 1;
    return slot;
  };

  /** Swap-removes `slot` of `level`'s mesh: the last copy moves into it, and its instance's slot
   * (its incoming copy's, or its outgoing one's) follows. An instance has one copy per mesh at
   * most, so the moved one is another instance, whose state still describes its copies. */
  const removeAt = (level: number, slot: number) => {
    const mesh = meshes[level];
    const last = mesh.count - 1;
    if (slot !== last) {
      matrixArrays[level].copyWithin(slot * 16, last * 16, last * 16 + 16);
      fadeArrays[level][slot] = fadeArrays[level][last];
      const moved = owners[level][last];
      owners[level][slot] = moved;
      if (levelOf[moved] === level) inSlots[moved] = slot;
      else outSlots[moved] = slot;
      isFadeChanged[level] = 1;
    }
    mesh.count = last;
    isMatrixChanged[level] = 1;
  };

  /** Moves instance `i`'s copies from its state to `_state`'s (stepped): a copy in a mesh both
   * have stays (a mid-fade change back to the outgoing level reuses its copy), the others are
   * removed, then the new ones appended; then both copies' fades. */
  const applyState = (i: number) => {
    const from = levelOf[i];
    const out = outgoingOf[i];
    const { level, outgoing, progress } = _state;
    const inSlot = from >= 0 ? inSlots[i] : -1;
    const outSlot = out >= 0 ? outSlots[i] : -1;
    let newIn = -1;
    let newOut = -1;
    let isInKept = false;
    let isOutKept = false;
    if (level >= 0 && level === from) {
      newIn = inSlot;
      isInKept = true;
    } else if (level >= 0 && level === out) {
      newIn = outSlot;
      isOutKept = true;
    }
    if (outgoing >= 0 && outgoing === from) {
      newOut = inSlot;
      isInKept = true;
    } else if (outgoing >= 0 && outgoing === out) {
      newOut = outSlot;
      isOutKept = true;
    }
    if (from >= 0 && !isInKept) removeAt(from, inSlot);
    if (out >= 0 && !isOutKept) removeAt(out, outSlot);
    levelOf[i] = level;
    outgoingOf[i] = outgoing;
    progressOf[i] = progress;
    if (level >= 0 && newIn < 0) newIn = append(level, i);
    if (outgoing >= 0 && newOut < 0) newOut = append(outgoing, i);
    inSlots[i] = newIn;
    outSlots[i] = newOut;
    // A fade runs while there's an outgoing level (culled: fading in, with no outgoing copy)
    const isFading = outgoing !== LOD_LEVEL_NONE;
    if (newIn >= 0) {
      fadeArrays[level][newIn] = isFading ? progress : LOD_FADE_OPAQUE;
      isFadeChanged[level] = 1;
    }
    if (newOut >= 0) {
      fadeArrays[outgoing][newOut] = progress - 1;
      isFadeChanged[outgoing] = 1;
    }
  };

  /** The set's frame: once per main loop frame, after lod() wrote the frame's inputs. */
  const step = () => {
    const frame = getMainLoopFrame();
    if (steppedFrame === frame || extent === 0) return;
    if (firstFrame < 0) firstFrame = frame;
    const inputs = getLodFrameInputs();
    let mode = MODE_FORCE;
    let forced = 0;
    let fadeSeconds = 0;
    let fadeStep = 0;
    if (inputs.frame === frame) {
      fadeSeconds = lod.fadeSeconds ?? inputs.fadeSeconds;
      fadeStep = inputs.fadeStep;
      if (inputs.forceLevel >= 0) forced = Math.min(inputs.forceLevel, lastLevel);
      // `freeze` (or no camera) holds the levels only: the fades run
      else mode = inputs.hasCamera && !inputs.isFrozen ? MODE_SELECT : MODE_ADVANCE;
    } else if (inputs.frame < 0 && frame > firstFrame) {
      // No inputs a whole frame after the set's first step (not only a world that ran before
      // lod()'s wrote them): no lod(). Level 0, as an instanced LOD pool draws without it, and no
      // fades. Concluded on the first step, a band of instances would stay a level finer once
      // the selection ran (the hysteresis from level 0: the GPU backend's Phase 3 finding)
      if (hasLevelsToSelect && !hasWarnedNoLod) {
        hasWarnedNoLod = true;
        lwarn(
          `Instance set "${label}": its levels need the lod() feature in InitEngine's \`features\`; it draws level 0.`
        );
      }
    } else {
      // Not this frame's inputs (lod() didn't select this frame, or not yet): the levels and
      // fades hold
      return;
    }
    steppedFrame = frame;

    const k = inputs.k * bias;
    const { x: cx, y: cy, z: cz } = inputs.cameraPosition;
    const { isOrtho } = inputs;
    for (let i = 0; i < extent; i++) {
      const from = levelOf[i];
      let target = from;
      if (mode === MODE_SELECT) {
        const r = i * 4;
        const size = records[r + 3] * k;
        let s = size;
        if (!isOrtho) {
          const dx = records[r] - cx;
          const dy = records[r + 1] - cy;
          const dz = records[r + 2] - cz;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          s = distance > 0 ? size / distance : Infinity;
        }
        target = selectLodTarget(screenSizes, s, from, cullScreenSize, hysteresis);
      } else if (mode === MODE_FORCE) {
        target = forced;
      }
      // Nothing to do: no change, no fade running
      if (target === from && outgoingOf[i] === LOD_LEVEL_NONE) continue;
      _state.level = from;
      _state.outgoing = outgoingOf[i];
      _state.progress = progressOf[i];
      if (stepLodInstanceState(_state, target, fadeSeconds, fadeStep)) applyState(i);
    }

    for (let level = 0; level < levelCount; level++) {
      if (isMatrixChanged[level]) meshes[level].instanceMatrix.needsUpdate = true;
      if (isFadeChanged[level]) fadeAttributes[level].needsUpdate = true;
      isMatrixChanged[level] = 0;
      isFadeChanged[level] = 0;
    }
  };

  /** Rewrites instance `i`'s copy in `level`'s mesh from its matrix. */
  const copyMatrixTo = (level: number, slot: number, i: number) => {
    const to = matrixArrays[level];
    for (let e = 0; e < 16; e++) to[slot * 16 + e] = matrices[i * 16 + e];
    isMatrixChanged[level] = 1;
  };

  const writeInstances = (start: number, written: Float32Array, count: number) => {
    for (let n = 0; n < count; n++) {
      const i = start + n;
      const m = n * 16;
      for (let e = 0; e < 16; e++) matrices[i * 16 + e] = written[m + e];
      const scale = Math.hypot(written[m], written[m + 1], written[m + 2]);
      const r = i * 4;
      records[r] = written[m + 12];
      records[r + 1] = written[m + 13];
      records[r + 2] = written[m + 14];
      records[r + 3] = scale * radii[0];
      // The bounds hold the instance at its largest level, whichever is drawn
      const radius = records[r + 3] * boundsRadiusScale;
      _point.set(records[r], records[r + 1], records[r + 2]);
      bounds.expandByPoint(_point.addScalar(radius));
      bounds.expandByPoint(_point.addScalar(-2 * radius));
      // A copy already drawn takes the new matrix (an instance written again)
      const level = levelOf[i];
      const outgoing = outgoingOf[i];
      if (level >= 0) copyMatrixTo(level, inSlots[i], i);
      if (outgoing >= 0) copyMatrixTo(outgoing, outSlots[i], i);
    }
    extent = Math.max(extent, start + count);
    for (const mesh of meshes) {
      mesh.boundingBox!.copy(bounds);
      bounds.getBoundingSphere(mesh.boundingSphere!);
    }
    for (let level = 0; level < levelCount; level++) {
      if (isMatrixChanged[level]) meshes[level].instanceMatrix.needsUpdate = true;
      isMatrixChanged[level] = 0;
    }
  };

  addStep(world, step);

  const dispose = () => {
    removeStep(world, step);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      // Its instance matrix and fade attribute (three fires `dispose`); not the level's geometry
      // or materials, whose refs the front releases
      mesh.dispose();
    }
  };

  return {
    writeInstances,
    dispose,
    debugCpu: {
      levelCount,
      getExtent: () => extent,
      levels: levelOf,
      outgoing: outgoingOf,
      meshes,
    },
  };
};
