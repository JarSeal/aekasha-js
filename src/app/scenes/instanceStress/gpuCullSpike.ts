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
  fract,
  instanceIndex,
  length,
  mat3,
  mat4,
  max,
  normalLocal,
  positionLocal,
  screenCoordinate,
  select,
  storage,
  uint,
  uniform,
  varying,
  vec2,
  vec4,
} from 'three/tsl';

// p354 Phase 0's hand-written GPU path (a spike, not engine code): every instance's matrix in one
// storage buffer, a compute pass that frustum-culls each and picks its level from its screen size,
// and appends its index to that level's visible list with an atomic add on the level's indirect
// draw args. Each level is one plain Mesh drawn with `drawIndexedIndirect`: its vertex stage reads
// the instance's matrix through the visible list. No entity, no per-instance CPU work per frame.
//
// Cull slots (Phase 0 part 1): the cull runs once per camera that renders the forest, through
// three's `renderer.drawingPipeline` (`createGpuCullPipeline`): slot 0 for the view camera, slot 1
// for the sun's shadow camera. Each slot has its own args and visible lists and its own level
// meshes, since three renders the shadow map nested inside the main render (from the first
// object that needs it): with shared lists, the shadow's cull would overwrite the view's before
// the view's draws ran.
//
// Hysteresis and cross-fades (Phase 0 part 2), the CPU path's rules (`features/lod/CLAUDE.md`):
// every instance has a state word (its level and the level it fades out of) and a fade progress.
// The view slot's cull selects every instance's level, in view or not (a pool instance has no
// frustum culling on the CPU path either), with the hysteresis, starts a fade on a change (a
// change mid-fade ends the running one; the first selection never fades), advances the fade by
// the frame's step, then appends the instance in view: its level's copy at fade `t`, the
// outgoing level's at `t - 1`. Each visible list entry carries its fade, which the level
// material's mask dithers with (the engine's `lodDither` noise). The shadow slot reads the state
// the view slot wrote this frame (its dispatch runs first, inside the main render) and appends
// the casting levels' copies the same way, so shadows dither with the same split.
//
// The pools' own materials and a draw per (level, group) (Phase 0 part 3): a level geometry's
// groups (the tree's trunk and foliage) each draw with their own indirect args (the group's
// `firstIndex` and `indexCount`), since a geometry has one indirect offset. The cull counts into
// group 0's args and a finalize pass copies the count into the level's other groups. Each source
// material (the pool's, classic or node) gets one node variant whose `positionNode` (the fetch
// through the visible list) and `maskNode` (the entry's fade) every mesh shares: the list a mesh
// reads is a per-object uniform (`onObjectUpdate`, as LodFade.ts's object fade), so the meshes of
// every level and slot share one build per material (`sharedBuilds: false` gives each mesh its
// own variant, to count the difference). WebGPU only.

/** uints per draw in the args buffer: drawIndexedIndirect's five, padded to 32 bytes */
const ARGS_STRIDE = 8;
/** The args' instance count, the field the cull appends with (group 0's) */
const ARGS_INSTANCE_COUNT = 1;
/** In a state word's level fields: culled (a level past the last) */
const LEVEL_CULLED = 0xff;
/** In a state word's level fields: none (the current level: not selected yet; the outgoing one:
 * no fade running) */
const LEVEL_NONE = 0xfe;
/** A state word: the current level in bits 0-7, the outgoing one in bits 8-15 */
const STATE_INITIAL = LEVEL_NONE | (LEVEL_NONE << 8);

/** The cull slots: the view camera's and the sun shadow camera's */
export const GPU_CULL_SLOT = { VIEW: 0, SHADOW: 1 } as const;

export type GpuCullLevel = {
  geometry: THREE.BufferGeometry;
  /** Smallest screen size the level is used at, descending from level 0 */
  screenSize: number;
  /** Draws into the shadow slot */
  castShadow: boolean;
};

export type GpuCullForestOptions = {
  /** Every instance's world matrix, 16 floats each (column-major, as three's `elements`) */
  matrices: Float32Array;
  levels: GpuCullLevel[];
  /** Below this screen size an instance isn't drawn */
  cullScreenSize: number;
  /** The CPU path's `LodDef.hysteresis`: a coarser level (and the cull) only below its screen
   * size × (1 - hysteresis) */
  hysteresis: number;
  /** A level change's cross-fade, in seconds; 0 switches at once */
  fadeSeconds: number;
  /** The levels' materials, by their geometry groups' `materialIndex` (a pool's level
   * materials): each gets one node variant, drawn by every level and slot */
  materials: THREE.Material[];
  /** The node version of a classic material (`renderer.library.fromMaterial`) */
  toNodeMaterial: (material: THREE.Material) => THREE.NodeMaterial;
  /** One variant per source material, shared by every mesh (the default); false: one per mesh */
  sharedBuilds?: boolean;
  /** Builds the shadow slot (a second cull and the casting levels' shadow meshes) */
  shadow: boolean;
};

/** Instances per level drawn (the fading ones in both levels), culled, and fading: the CPU
 * path's pool counts, from a readback of the state */
export type GpuCullStateCounts = { levels: number[]; culled: number; fading: number };

/** The GPU-culled forest: its level meshes (add them to the scene), the per-slot dispatch, the
 * debug readbacks, and the disposal. */
export type GpuCullForest = {
  meshes: THREE.Mesh[];
  slotCount: number;
  /** Sets the LOD camera (the view camera: its position and its projection's scale) for the
   * next dispatches */
  setLodCamera: (camera: THREE.PerspectiveCamera) => void;
  /** Sets the next view dispatch's frame time (s): the fades' step */
  setFrameDelta: (seconds: number) => void;
  /** Dispatches the reset and the cull of `slot` against `camera`'s frustum */
  dispatch: (renderer: THREE.Renderer, slot: number, camera: THREE.Camera) => void;
  /** The last dispatch's visible instances per slot and level (a GPU readback: debug only) */
  readCountsAsync: (renderer: THREE.WebGPURenderer) => Promise<number[][]>;
  /** Every instance's state, counted (a GPU readback of the whole state: debug only) */
  readStateAsync: (renderer: THREE.WebGPURenderer) => Promise<GpuCullStateCounts>;
  dispose: () => void;
};

const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();

/** The slot a level mesh draws in, on its `userData` */
const SLOT_KEY = 'gpuCullSlot';
/** The first entry of the visible list a level mesh draws, on its `userData` */
const LIST_BASE_KEY = 'gpuCullListBase';
/** A node variant's keys not copied from its source: its identity and its listeners */
const VARIANT_SKIPPED_KEYS = new Set(['uuid', 'id', '_listeners', 'version', 'userData']);

/** The engine's dither (`kernel/render/LodFade.ts`, not public): interleaved gradient noise on
 * the pixel, and whether a pixel shows at a signed fade (`t` in, `t - 1` out) */
const ditherShows = (fade: THREE.Node<'float'>) => {
  const p = screenCoordinate as unknown as THREE.Node<'vec2'>;
  const noise = fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
  return select(fade.greaterThanEqual(0), noise, noise.oneMinus()).lessThanEqual(fade.abs());
};

export const createGpuCullForest = (opts: GpuCullForestOptions): GpuCullForest => {
  const { matrices, levels, cullScreenSize } = opts;
  const count = matrices.length / 16;
  const levelCount = levels.length;
  const last = levelCount - 1;
  const slotCount = opts.shadow ? 2 : 1;
  const isFading = opts.fadeSeconds > 0;
  const keep = 1 - opts.hysteresis;
  /** A (slot, level) pair's index into the visible lists */
  const listIndex = (slot: number, level: number) => slot * levelCount + level;
  /** Every level's draw groups: its geometry's groups, or the whole index */
  const levelGroups = levels.map(({ geometry }) =>
    geometry.groups.length > 0
      ? geometry.groups.map(({ start, count: indexCount, materialIndex }) => ({
          start,
          indexCount,
          materialIndex: materialIndex ?? 0,
        }))
      : [{ start: 0, indexCount: geometry.index!.count, materialIndex: 0 }]
  );
  /** Args entries per list: the most groups a level has */
  const groupCount = Math.max(...levelGroups.map((groups) => groups.length));
  /** A (list, group)'s draw in the args */
  const drawIndex = (list: number, group: number) => list * groupCount + group;
  /** The levels that cast, a bit each */
  const casterMask = levels.reduce((mask, l, i) => (l.castShadow ? mask | (1 << i) : mask), 0);

  // The frustum test's sphere: level 0's bounding sphere
  const level0 = levels[0].geometry;
  if (!level0.boundingSphere) level0.computeBoundingSphere();
  const localSphere = level0.boundingSphere!;
  // The LOD's, as the CPU path measures a pool instance: from the instance's origin, with level
  // 0's conservative radius (`getConservativeGeometryRadius`: the sphere's centre's distance
  // from the origin plus its radius)
  const lodLocalRadius = localSphere.center.length() + localSphere.radius;

  // The matrices as 4 vec4 columns per instance
  const matrixAttribute = new THREE.StorageBufferAttribute(matrices, 4);
  const columns = storage(matrixAttribute, 'vec4', count * 4).toReadOnly();
  // Every instance's state word and fade progress
  const stateAttribute = new THREE.StorageBufferAttribute(
    new Uint32Array(count).fill(STATE_INITIAL),
    1
  );
  const state = storage(stateAttribute, 'uint', count);
  const progressAttribute = new THREE.StorageBufferAttribute(new Float32Array(count), 1);
  const progress = storage(progressAttribute, 'float', count);
  // Each (slot, level)'s visible list: list L's at [L × count, (L + 1) × count), each entry's
  // instance and its fade
  const listCount = slotCount * levelCount;
  const visibleAttribute = new THREE.StorageBufferAttribute(new Uint32Array(count * listCount), 1);
  const visible = storage(visibleAttribute, 'uint', count * listCount);
  const fadeAttribute = new THREE.StorageBufferAttribute(new Float32Array(count * listCount), 1);
  const visibleFade = storage(fadeAttribute, 'float', count * listCount);
  // The draw args: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance] per
  // (list, group); group 0's instance count is the list's counter
  const args = new Uint32Array(listCount * groupCount * ARGS_STRIDE);
  for (let slot = 0; slot < slotCount; slot++) {
    levelGroups.forEach((groups, i) => {
      groups.forEach(({ start, indexCount }, g) => {
        const at = drawIndex(listIndex(slot, i), g) * ARGS_STRIDE;
        args[at] = indexCount;
        args[at + 2] = start;
      });
    });
  }
  const argsAttribute = new THREE.IndirectStorageBufferAttribute(args, 1);
  const argsAtomic = storage(argsAttribute, 'uint', args.length).toAtomic();

  /** The LOD camera's position and screen scale: k = 1 / tan(fov / 2) × zoom */
  const lodCameraPosition = uniform(new THREE.Vector3());
  const screenK = uniform(1);
  /** The fades' step this frame: the frame time over `fadeSeconds` */
  const fadeStep = uniform(0);

  /** Appends the instance to list `list` (a uint node: slot × levels + level) at `fade` */
  const append = (list: THREE.Node<'uint'>, fade: THREE.Node<'float'>) => {
    const slotIndex = atomicAdd(
      argsAtomic.element(list.mul(groupCount * ARGS_STRIDE).add(ARGS_INSTANCE_COUNT)),
      uint(1)
    ).toVar();
    const at = list.mul(count).add(slotIndex).toVar();
    visible.element(at).assign(instanceIndex);
    visibleFade.element(at).assign(fade);
  };

  const createSlotNodes = (slot: number) => {
    const planes = Array.from({ length: 6 }, () => uniform(new THREE.Vector4()));
    const reset = Fn(() => {
      atomicStore(
        argsAtomic.element(
          instanceIndex
            .add(listIndex(slot, 0))
            .mul(groupCount * ARGS_STRIDE)
            .add(ARGS_INSTANCE_COUNT)
        ),
        uint(0)
      );
    })().compute(levelCount);
    // Each level's count into its other groups' args, after the cull
    const others = groupCount - 1;
    const finalize =
      others > 0
        ? Fn(() => {
            const list = instanceIndex.div(others).add(listIndex(slot, 0)).toVar();
            const group = instanceIndex.mod(others).add(1);
            const counted = atomicLoad(
              argsAtomic.element(list.mul(groupCount * ARGS_STRIDE).add(ARGS_INSTANCE_COUNT))
            );
            atomicStore(
              argsAtomic.element(
                list.mul(groupCount).add(group).mul(ARGS_STRIDE).add(ARGS_INSTANCE_COUNT)
              ),
              counted
            );
          })().compute(levelCount * others)
        : null;

    const cull = Fn(() => {
      If(instanceIndex.greaterThanEqual(uint(count)), () => {
        Return();
      });
      const base = instanceIndex.mul(4);
      const c0 = columns.element(base);
      const c1 = columns.element(base.add(1));
      const c2 = columns.element(base.add(2));
      const c3 = columns.element(base.add(3));
      // The largest axis scale (the CPU path's: the entity's largest scale)
      const scale = max(max(length(c0.xyz), length(c1.xyz)), length(c2.xyz)).toVar();

      const word = state.element(instanceIndex);
      const current = word.bitAnd(0xff).toVar();
      const outgoing = word.shiftRight(8).bitAnd(0xff).toVar();
      const t = progress.element(instanceIndex).toVar();

      if (slot === GPU_CULL_SLOT.VIEW) {
        // The selection, every instance (`selectLevel` and the cull test of LodSystem.ts)
        const s = scale
          .mul(lodLocalRadius)
          .mul(screenK)
          .div(max(distance(c3.xyz, lodCameraPosition), 0.000001));
        const isCulled = current.equal(LEVEL_CULLED);
        // A coarser level than this one takes the hysteresis: coming back from culled, it comes
        // from beyond the last level; the first selection takes none
        const from = select(
          isCulled,
          uint(last),
          select(current.equal(LEVEL_NONE), uint(levelCount), current)
        ).toVar();
        const cullAt = select(isCulled, float(cullScreenSize), float(cullScreenSize * keep));
        const target = uint(LEVEL_CULLED).toVar();
        If(s.greaterThanEqual(cullAt), () => {
          target.assign(uint(last));
          for (let i = last - 1; i >= 0; i--) {
            const at = select(
              uint(i).greaterThanEqual(from),
              float(levels[i].screenSize * keep),
              float(levels[i].screenSize)
            );
            If(s.greaterThanEqual(at), () => {
              target.assign(uint(i));
            });
          }
        });
        // Written back only when it changed or fades: most instances only read
        const isDirty = outgoing.notEqual(LEVEL_NONE).toVar();
        If(current.equal(LEVEL_NONE), () => {
          // The first selection: no fade
          current.assign(target);
          isDirty.assign(true);
        }).ElseIf(target.notEqual(current), () => {
          // A change ends a running fade and starts its own
          outgoing.assign(isFading ? current : uint(LEVEL_NONE));
          current.assign(target);
          t.assign(0);
          isDirty.assign(true);
        });
        If(outgoing.notEqual(LEVEL_NONE), () => {
          t.addAssign(fadeStep);
          If(t.greaterThanEqual(1), () => {
            outgoing.assign(LEVEL_NONE);
            t.assign(1);
          });
        });
        If(isDirty, () => {
          state.element(instanceIndex).assign(current.bitOr(outgoing.shiftLeft(8)));
          progress.element(instanceIndex).assign(t);
        });
      }

      // The frustum test: level 0's bounding sphere
      const local = localSphere.center;
      const center = c0.xyz
        .mul(local.x)
        .add(c1.xyz.mul(local.y))
        .add(c2.xyz.mul(local.z))
        .add(c3.xyz)
        .toVar();
      const radius = scale.mul(localSphere.radius).toVar();
      for (let p = 0; p < 6; p++) {
        const plane = planes[p];
        If(dot(plane.xyz, center).add(plane.w).lessThan(radius.negate()), () => {
          Return();
        });
      }

      /** Whether a level (a uint node) draws in this slot */
      const isDrawn = (level: THREE.Node<'uint'>) =>
        slot === GPU_CULL_SLOT.SHADOW
          ? level.lessThan(levelCount).and(uint(casterMask).shiftRight(level).bitAnd(1).equal(1))
          : level.lessThan(levelCount);
      const isOutgoing = outgoing.lessThan(levelCount);
      If(isDrawn(current), () => {
        append(current.add(listIndex(slot, 0)), select(outgoing.equal(LEVEL_NONE), float(1), t));
      });
      If(isOutgoing.and(isDrawn(outgoing)), () => {
        append(outgoing.add(listIndex(slot, 0)), t.sub(1));
      });
    })().compute(count);

    return { planes, nodes: finalize ? [reset, cull, finalize] : [reset, cull] };
  };
  const slots = Array.from({ length: slotCount }, (_, slot) => createSlotNodes(slot));

  // The vertex fetch and the fade, shared by every level mesh: the list a mesh reads is its own
  // uniform, written before each of its draws, so the meshes share their material's build
  const listBase = uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData[LIST_BASE_KEY] as number | undefined) ?? 0
  );
  const entry = listBase.add(instanceIndex);
  // The shadow pass's material takes the `positionNode` over (three's override material)
  const positionNode = Fn(() => {
    const instance = visible.element(entry).mul(4);
    const matrix = mat4(
      columns.element(instance),
      columns.element(instance.add(1)),
      columns.element(instance.add(2)),
      columns.element(instance.add(3))
    );
    // Uniform scale: the rotation part turns the normal (normalized where it's used)
    normalLocal.assign(mat3(matrix).mul(normalLocal));
    return matrix.mul(vec4(positionLocal, 1)).xyz;
  })();
  // The entry's fade, from the vertex stage; the shadow pass reads `maskNode` too. It replaces
  // the source's mask (a pool material's LOD dither, which reads an InstancedMesh's fade)
  const maskNode = isFading ? ditherShows(varying(visibleFade.element(entry))) : null;

  const variants = new Map<THREE.Material, THREE.NodeMaterial>();
  const createVariant = (source: THREE.Material) => {
    const node = opts.toNodeMaterial(source);
    const variant = new (node.constructor as new () => THREE.NodeMaterial)();
    for (const key of Object.keys(node)) {
      if (VARIANT_SKIPPED_KEYS.has(key)) continue;
      (variant as unknown as Record<string, unknown>)[key] = (
        node as unknown as Record<string, unknown>
      )[key];
    }
    variant.name = `${source.name || source.type} (GPU cull)`;
    variant.positionNode = positionNode;
    variant.maskNode = maskNode;
    variant.needsUpdate = true;
    return variant;
  };
  const getVariant = (source: THREE.Material) => {
    if (opts.sharedBuilds === false) return createVariant(source);
    let variant = variants.get(source);
    if (!variant) {
      variant = createVariant(source);
      variants.set(source, variant);
    }
    return variant;
  };

  const createGroupMesh = (slot: number, level: number, group: number) => {
    const list = listIndex(slot, level);
    const source = levels[level].geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(source.index);
    for (const name of Object.keys(source.attributes)) {
      geometry.setAttribute(name, source.getAttribute(name));
    }
    geometry.setIndirect(argsAttribute, drawIndex(list, group) * ARGS_STRIDE * 4);
    const { materialIndex } = levelGroups[level][group];
    const material = getVariant(opts.materials[materialIndex] ?? opts.materials[0]);

    const mesh = new THREE.Mesh(geometry, material);
    // The cull is the culling: three sees one object at the origin
    mesh.frustumCulled = false;
    // VSM draws a receiver into the shadow map whatever its `castShadow`: the pipeline's
    // `isCulled` keeps each mesh to its slot's camera, these flags only pass three's checks
    mesh.castShadow = slot === GPU_CULL_SLOT.SHADOW;
    mesh.receiveShadow = slot === GPU_CULL_SLOT.VIEW;
    mesh.userData[SLOT_KEY] = slot;
    mesh.userData[LIST_BASE_KEY] = list * count;
    mesh.name = `gpuCullSlot${slot}Level${level}Group${group}`;
    return mesh;
  };
  const meshes: THREE.Mesh[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    levels.forEach((level, i) => {
      if (slot === GPU_CULL_SLOT.SHADOW && !level.castShadow) return;
      levelGroups[i].forEach((_, g) => meshes.push(createGroupMesh(slot, i, g)));
    });
  }

  const setLodCamera: GpuCullForest['setLodCamera'] = (camera) => {
    camera.getWorldPosition(lodCameraPosition.value);
    screenK.value = camera.zoom / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  };

  const setFrameDelta: GpuCullForest['setFrameDelta'] = (seconds) => {
    fadeStep.value = isFading ? seconds / opts.fadeSeconds : 1;
  };

  const dispatch: GpuCullForest['dispatch'] = (renderer, slot, camera) => {
    // three's render updated the camera's world matrix and its inverse before `begin`
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen, camera.coordinateSystem);
    const { planes, nodes } = slots[slot];
    for (let p = 0; p < 6; p++) {
      const { normal, constant } = _frustum.planes[p];
      planes[p].value.set(normal.x, normal.y, normal.z, constant);
    }
    void renderer.compute(nodes);
  };

  const readCountsAsync: GpuCullForest['readCountsAsync'] = async (renderer) => {
    const buffer = await renderer.getArrayBufferAsync(argsAttribute);
    const values = new Uint32Array(buffer);
    return slots.map((_, slot) =>
      levels.map(
        (__, i) => values[drawIndex(listIndex(slot, i), 0) * ARGS_STRIDE + ARGS_INSTANCE_COUNT]
      )
    );
  };

  const readStateAsync: GpuCullForest['readStateAsync'] = async (renderer) => {
    const words = new Uint32Array(await renderer.getArrayBufferAsync(stateAttribute));
    const counts: GpuCullStateCounts = { levels: levels.map(() => 0), culled: 0, fading: 0 };
    for (const word of words) {
      const current = word & 0xff;
      const outgoing = (word >> 8) & 0xff;
      if (current < levelCount) counts.levels[current]++;
      else if (current === LEVEL_CULLED) counts.culled++;
      if (outgoing === LEVEL_NONE) continue;
      counts.fading++;
      if (outgoing < levelCount) counts.levels[outgoing]++;
    }
    return counts;
  };

  const dispose = () => {
    // The variants, not their sources (the pool's materials, the scene's assets)
    const materials = new Set<THREE.Material>();
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      materials.add(mesh.material as THREE.Material);
    }
    for (const material of materials) material.dispose();
    for (const { nodes } of slots) for (const node of nodes) node.dispose();
  };

  return {
    meshes,
    slotCount,
    setLodCamera,
    setFrameDelta,
    dispatch,
    readCountsAsync,
    readStateAsync,
    dispose,
  };
};

export type GpuCullPipelineOptions = {
  forest: GpuCullForest;
  /** The view camera: slot 0's frustum and the LOD camera of every slot */
  getViewCamera: () => THREE.PerspectiveCamera | null;
  /** The sun's shadow camera: slot 1's frustum (when the forest has the slot) */
  getShadowCamera: () => THREE.Camera | null;
  /** Called with each dispatch's CPU time (ms), slot 0's first in a frame */
  onDispatch?: (slot: number, ms: number) => void;
};

/**
 * three's drawing pipeline with the forest's cull per camera: `begin` dispatches the cull of the
 * camera's slot (the view camera's, the sun shadow camera's), `isCulled` keeps each level mesh to
 * its slot's camera. A camera with no slot (an env bake, a viewport) draws none of the forest.
 * Everything else is three's standard pipeline.
 */
export const createGpuCullPipeline = (opts: GpuCullPipelineOptions) => {
  const { forest, getViewCamera, getShadowCamera, onDispatch } = opts;

  class GpuCullDrawingPipeline extends THREE.StandardDrawingPipeline {
    /** The slot of the camera being projected, -1 for none */
    private slot = -1;

    override begin(
      camera: THREE.Camera,
      renderContext: Parameters<THREE.StandardDrawingPipeline['begin']>[1]
    ) {
      super.begin(camera, renderContext);
      const view = getViewCamera();
      this.slot =
        camera === view
          ? GPU_CULL_SLOT.VIEW
          : forest.slotCount > GPU_CULL_SLOT.SHADOW && camera === getShadowCamera()
            ? GPU_CULL_SLOT.SHADOW
            : -1;
      if (this.slot < 0 || !this.renderer || !view) return;
      const start = performance.now();
      if (this.slot === GPU_CULL_SLOT.VIEW) forest.setLodCamera(view);
      forest.dispatch(this.renderer, this.slot, camera);
      onDispatch?.(this.slot, performance.now() - start);
    }

    override isCulled(object: THREE.Object3D, camera: THREE.Camera) {
      const slot = object.userData[SLOT_KEY] as number | undefined;
      if (slot !== undefined) return slot !== this.slot;
      return super.isCulled(object, camera);
    }
  }

  return new GpuCullDrawingPipeline();
};
