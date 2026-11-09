import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  atomicAdd,
  atomicLoad,
  atomicStore,
  distance,
  dot,
  float,
  instanceIndex,
  max,
  normalLocal,
  positionLocal,
  select,
  storage,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';

// An instance set's TSL (docs/plans/p354_gpu-driven-culling.md D4, D7, D8): the compute passes and
// the vertex fetch, over the GPU backend's buffers (InstanceSetGpu.ts). Its own module so the
// backend's bookkeeping and the shader code read apart; only the GPU backend imports it.
//
// Each dispatch runs three passes: the reset zeroes the per-level counters; the cull, one thread
// per instance, first moves the instance's state (the selection, `utils/LodRules.ts`'
// `selectLodTarget` ported line by line: its tests are this port's reference), then tests its
// sphere against the camera's frustum and appends it to its level's visible list; the finalize
// writes each level's count, capped at the list's budget, into each of its draws' indirect args.
//
// The state word: the level in bits 0-7 and the outgoing one (a cross-fade, p354 Phase 2; none
// for now) in bits 8-15, with LEVEL_NONE (not selected yet / no fade) and LEVEL_CULLED. A visible
// list entry: the instance in bits 0-23, its fade in bits 24-31 (Phase 2; 0 for now).

/** uints per draw in the args: drawIndexedIndirect's five (drawIndirect's four), padded to 32 B. */
export const ARGS_STRIDE = 8;
/** The args' instance count, what the finalize writes. */
export const ARGS_INSTANCE_COUNT = 1;
/** A state word's level field: none (not selected yet; the outgoing one: no fade running). */
export const LEVEL_NONE = 0xfe;
/** A state word's level field: culled (beyond the last level). */
export const LEVEL_CULLED = 0xff;
/** A new instance's state word: not selected, no fade. */
export const STATE_INITIAL = LEVEL_NONE | (LEVEL_NONE << 8);
/** A visible list entry's instance bits. */
const ENTRY_INSTANCE_MASK = 0xffffff;

/** What the cull does with the instances' state before the frustum test. */
export const SELECT_MODE = {
  /** Reads it: a later dispatch in the frame, `freeze`, or a frame the selection didn't run. */
  HOLD: 0,
  /** The frame's selection, against the frame inputs' camera terms. */
  SELECT: 1,
  /** Every instance at `forceLevel`, none culled (the debug option, or level 0 without `lod()`). */
  FORCE: 2,
} as const;

/** The GPU buffers a set's passes and draws read: see InstanceSetGpu.ts. */
export type InstanceSetBuffers = {
  /** The instances' affine matrices: three `vec4` rows each. */
  rows: THREE.StorageBufferAttribute;
  /** Per instance: its origin and its scale × level 0's conservative radius. */
  records: THREE.StorageBufferAttribute;
  /** Per instance: its state word. */
  state: THREE.StorageBufferAttribute;
  /** Per level: `maxVisible` entries. */
  lists: THREE.StorageBufferAttribute;
  /** Per level: the instances the cull appended (past `maxVisible` too). */
  counters: THREE.StorageBufferAttribute;
  /** Per (level, group): a draw's indirect args. */
  args: THREE.IndirectStorageBufferAttribute;
};

/** The selection's settings, the set's `LodDef` resolved. */
export type InstanceSetSelection = {
  /** Each level's `screenSize`, level 0 first. */
  screenSizes: readonly number[];
  /** 0 for none. */
  cullScreenSize: number;
  hysteresis: number;
};

/** What `createInstanceSetPasses` builds a set's passes from. */
export type InstanceSetPassesOptions = {
  buffers: InstanceSetBuffers;
  maxInstances: number;
  maxVisible: number;
  selection: InstanceSetSelection;
  /** Args entries per level: the most draws (groups) a level has. */
  groupCount: number;
  /** The frustum sphere's radius over the record's (the largest level's conservative radius over
   * level 0's, so a coarser level that pokes out isn't culled). */
  frustumRadiusScale: number;
};

/** The passes' per-dispatch inputs, written by the backend before each dispatch. */
export type InstanceSetPassUniforms = {
  /** The instances to visit: the highest added + 1. */
  extent: THREE.UniformNode<'uint', number>;
  /** A `SELECT_MODE`. */
  mode: THREE.UniformNode<'uint', number>;
  /** The level `FORCE` puts every instance at (clamped to the last). */
  forceLevel: THREE.UniformNode<'uint', number>;
  /** The selection camera's position (the frame inputs'). */
  cameraPosition: THREE.UniformNode<'vec3', THREE.Vector3>;
  /** Screen size = record radius × k / distance (× k orthographic): both biases included. */
  k: THREE.UniformNode<'float', number>;
  /** 1 for an orthographic selection camera. */
  isOrtho: THREE.UniformNode<'uint', number>;
  /** The render camera's frustum planes: normal and constant. */
  planes: THREE.UniformNode<'vec4', THREE.Vector4>[];
};

/**
 * Builds a set's compute passes: the reset, the cull and the finalize, dispatched in that order.
 * @internal
 */
export const createInstanceSetPasses = (opts: InstanceSetPassesOptions) => {
  const { buffers, maxInstances, maxVisible, selection, groupCount } = opts;
  const { screenSizes, cullScreenSize, hysteresis } = selection;
  const levelCount = screenSizes.length;
  const last = levelCount - 1;
  const keep = 1 - hysteresis;

  const records = storage(buffers.records, 'vec4', maxInstances).toReadOnly();
  const state = storage(buffers.state, 'uint', maxInstances);
  const lists = storage(buffers.lists, 'uint', levelCount * maxVisible);
  const counters = storage(buffers.counters, 'uint', levelCount).toAtomic();
  const args = storage(buffers.args, 'uint', buffers.args.array.length);

  const uniforms: InstanceSetPassUniforms = {
    extent: uniform(0, 'uint'),
    mode: uniform(SELECT_MODE.HOLD, 'uint'),
    forceLevel: uniform(0, 'uint'),
    cameraPosition: uniform(new THREE.Vector3()),
    k: uniform(1),
    isOrtho: uniform(0, 'uint'),
    planes: Array.from({ length: 6 }, () => uniform(new THREE.Vector4())),
  };

  /** `selectLodTarget` (utils/LodRules.ts): the level for screen size `s` coming from `current`,
   * or LEVEL_CULLED. A coarser level than `from` takes the hysteresis: coming back from culled it
   * comes from beyond the last level, and a first selection (LEVEL_NONE) takes none. */
  const selectTarget = (s: THREE.Node<'float'>, current: THREE.Node<'uint'>) => {
    const isCulled = current.equal(LEVEL_CULLED);
    const from = select(
      isCulled,
      uint(last),
      select(current.equal(LEVEL_NONE), uint(levelCount), current)
    ).toVar();
    const cullAt = select(isCulled, float(cullScreenSize), float(cullScreenSize * keep));
    const target = uint(LEVEL_CULLED).toVar();
    If(s.greaterThanEqual(cullAt), () => {
      target.assign(uint(last));
      // The finest level whose threshold `s` reaches: its screenSize, or below `from` its band's
      for (let i = last - 1; i >= 0; i--) {
        const at = select(
          uint(i).greaterThanEqual(from),
          float(screenSizes[i] * keep),
          float(screenSizes[i])
        );
        If(s.greaterThanEqual(at), () => {
          target.assign(uint(i));
        });
      }
    });
    return target;
  };

  const reset = Fn(() => {
    atomicStore(counters.element(instanceIndex), uint(0));
  })().compute(levelCount);

  const cull = Fn(() => {
    If(instanceIndex.greaterThanEqual(uniforms.extent), () => {
      Return();
    });
    const record = records.element(instanceIndex).toVar();
    const current = state.element(instanceIndex).bitAnd(0xff).toVar();

    // The state: written only when it changes, so most instances only read
    If(uniforms.mode.equal(SELECT_MODE.SELECT), () => {
      const toCamera = max(distance(record.xyz, uniforms.cameraPosition), float(1e-6));
      const size = record.w.mul(uniforms.k);
      const s = select(uniforms.isOrtho.equal(1), size, size.div(toCamera));
      const target = selectTarget(s, current);
      If(target.notEqual(current), () => {
        state.element(instanceIndex).assign(target.bitOr(uint(LEVEL_NONE << 8)));
        current.assign(target);
      });
    }).ElseIf(uniforms.mode.equal(SELECT_MODE.FORCE), () => {
      If(uniforms.forceLevel.notEqual(current), () => {
        state.element(instanceIndex).assign(uniforms.forceLevel.bitOr(uint(LEVEL_NONE << 8)));
        current.assign(uniforms.forceLevel);
      });
    });
    // Not selected yet, or culled: not drawn
    If(current.greaterThanEqual(uint(levelCount)), () => {
      Return();
    });

    // The frustum test: the record's sphere, grown to the largest level's
    const radius = record.w.mul(opts.frustumRadiusScale).negate().toVar();
    for (const plane of uniforms.planes) {
      If(dot(plane.xyz, record.xyz).add(plane.w).lessThan(radius), () => {
        Return();
      });
    }

    // Appended within the budget; past it only counted (the debug readback's overflow)
    const slot = atomicAdd(counters.element(current), uint(1)).toVar();
    If(slot.lessThan(uint(maxVisible)), () => {
      lists.element(current.mul(maxVisible).add(slot)).assign(instanceIndex);
    });
  })().compute(maxInstances);

  const finalize = Fn(() => {
    const level = instanceIndex.div(groupCount);
    const group = instanceIndex.mod(groupCount);
    const counted = atomicLoad(counters.element(level)).toVar();
    const drawn = select(counted.lessThan(uint(maxVisible)), counted, uint(maxVisible));
    args
      .element(level.mul(groupCount).add(group).mul(ARGS_STRIDE).add(ARGS_INSTANCE_COUNT))
      .assign(drawn);
  })().compute(levelCount * groupCount);

  return { uniforms, reset, cull, finalize };
};

/** A set draw's first visible list entry, on its mesh's `userData`. */
export const LIST_BASE_KEY = 'aekInstanceSetListBase';

/**
 * The vertex fetch every draw of a set shares: the drawn instance's matrix through its visible
 * list (the mesh's own, a per-object uniform read before each draw), as a material's
 * `positionNode`. It turns the normal with the matrix's rotation (uniform scale: normalized where
 * it's used). The meshes then share their material's build, whatever the level and group.
 * @internal
 */
export const createInstanceSetFetch = (
  buffers: InstanceSetBuffers,
  maxInstances: number,
  listLength: number
) => {
  const rows = storage(buffers.rows, 'vec4', maxInstances * 3).toReadOnly();
  const lists = storage(buffers.lists, 'uint', listLength).toReadOnly();
  const listBase = uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData[LIST_BASE_KEY] as number | undefined) ?? 0
  );
  return Fn(() => {
    const entry = lists.element(listBase.add(instanceIndex));
    const row = entry.bitAnd(ENTRY_INSTANCE_MASK).mul(3).toVar();
    const r0 = rows.element(row).toVar();
    const r1 = rows.element(row.add(1)).toVar();
    const r2 = rows.element(row.add(2)).toVar();
    normalLocal.assign(
      vec3(dot(r0.xyz, normalLocal), dot(r1.xyz, normalLocal), dot(r2.xyz, normalLocal))
    );
    const p = vec4(positionLocal, 1);
    return vec3(dot(r0, p), dot(r1, p), dot(r2, p));
  })();
};
