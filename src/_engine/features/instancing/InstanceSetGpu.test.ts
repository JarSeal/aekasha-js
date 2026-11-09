import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { float, vec3 } from 'three/tsl';

// p354 Phase 3: the GPU backend's slots and dispatches (D5-D7), without a GPU. three's own
// `StandardDrawingPipeline.project` drives the engine's pipeline on a stub renderer, whose
// `compute` records each dispatch's mode and slot from the passes' uniforms (a stand-in for
// `createInstanceSetPasses`: Node can't run TSL). The main loop's frame and the LOD frame inputs
// are the test's.

type Dispatch = {
  mode: number;
  slotLevel: number;
  levelMask: number;
  extent: number;
  camera: THREE.Camera | null;
};
const env = vi.hoisted(() => ({
  frame: 0,
  inputs: { frame: -1 } as Record<string, unknown>,
  dispatches: [] as Dispatch[],
  /** The render being projected's camera, for the dispatch records */
  camera: null as unknown,
  renderer: null as unknown,
}));

vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRenderer: () => env.renderer as THREE.WebGPURenderer,
}));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainLoopFrame: () => env.frame,
}));
vi.mock(import('../../kernel/ecs/LodTargets'), async (importOriginal) => ({
  ...(await importOriginal()),
  getLodFrameInputs: () => env.inputs as never,
}));
// The stand-in uniforms are made per set: hand the latest set's to the stub's compute
vi.mock(import('./InstanceSetNodes'), async (importOriginal) => {
  const original = await importOriginal();
  const value = (v: unknown) => ({ value: v });
  return {
    ...original,
    createInstanceSetPasses: () => {
      const uniforms = {
        extent: value(0),
        slotLevel: value(0),
        levelMask: value(0),
        mode: value(0),
        forceLevel: value(0),
        isFaded: value(0),
        fadeDelta: value(1),
        cameraPosition: value(new THREE.Vector3()),
        k: value(1),
        isOrtho: value(0),
        planes: Array.from({ length: 6 }, () => value(new THREE.Vector4())),
      };
      (env.renderer as { setUniforms: (u: unknown) => void }).setUniforms(uniforms);
      return {
        uniforms,
        reset: { dispose: () => {} },
        cull: { count: 0, dispose: () => {} },
        finalize: { dispose: () => {} },
      };
    },
    createInstanceSetFetch: () => ({ position: vec3(0), fade: float(1) }),
  } as unknown as typeof original;
});

import type { ECSWorld } from '../../kernel/ecs/ECS';
import { createGpuInstanceSetBackend } from './InstanceSetGpu';
import { SELECT_MODE, STATE_INITIAL, STATE_REMOVED } from './InstanceSetNodes';
import type { InstanceSetBackendParams } from './InstanceSetTypes';

type StubUniforms = Record<'mode' | 'slotLevel' | 'levelMask' | 'extent', { value: number }>;

/** The stub renderer: three's standard pipeline, the material library, a recording compute. */
const createRenderer = () => {
  let uniforms: StubUniforms | null = null;
  const renderer = {
    drawingPipeline: new THREE.StandardDrawingPipeline(),
    sortObjects: false,
    library: { fromMaterial: (m: THREE.Material) => m },
    compute: () => {
      env.dispatches.push({
        mode: uniforms!.mode.value,
        slotLevel: uniforms!.slotLevel.value,
        levelMask: uniforms!.levelMask.value,
        extent: uniforms!.extent.value,
        camera: env.camera as THREE.Camera,
      });
    },
    setUniforms: (u: StubUniforms) => (uniforms = u),
  };
  return renderer;
};

/** A render as three's `_renderScene` calls the pipeline; the objects it lists. */
const render = (scene: THREE.Object3D, camera: THREE.Camera) => {
  const renderer = env.renderer as ReturnType<typeof createRenderer>;
  const pipeline = renderer.drawingPipeline;
  // three sets it through its own setter, which the stub doesn't have
  pipeline.renderer = renderer as unknown as THREE.Renderer;
  const listed: THREE.Object3D[] = [];
  const list = {
    begin: () => {},
    finish: () => {},
    push: (object: THREE.Object3D) => listed.push(object),
    pushLight: () => {},
  };
  env.camera = camera;
  pipeline.begin(camera, {});
  pipeline.beginRenderList(list);
  pipeline.project(scene, camera, 0, list, null as never);
  pipeline.finishRenderList(list);
  return listed;
};

const createCamera = () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  return camera;
};

const material = new THREE.MeshBasicNodeMaterial();
const LEVELS = 2;

/** A set of two levels: the first casts shadows (unless `noneCast`), the second doesn't. */
const createSet = (opts: { maxSlots?: number; noneCast?: boolean } = {}) => {
  const object = new THREE.Group();
  const params: InstanceSetBackendParams = {
    // The GPU backend reads no world
    world: {} as ECSWorld,
    object,
    levels: [
      {
        geometry: new THREE.BoxGeometry(),
        material,
        screenSize: 0.1,
        castShadow: !opts.noneCast,
      },
      { geometry: new THREE.BoxGeometry(), material, screenSize: 0, castShadow: false },
    ],
    lod: {},
    maxInstances: 16,
    maxVisible: 16,
    maxSlots: opts.maxSlots ?? 8,
    receiveShadow: true,
    label: 'test',
  };
  // The passes' stand-in hands this set's uniforms to the stub's compute
  const backend = createGpuInstanceSetBackend(params);
  backends.push(backend);
  const scene = new THREE.Scene();
  scene.add(object);
  backend.addInstances(0, new Float32Array(new THREE.Matrix4().elements), 1);
  backend.setExtent(1);
  return { backend, object, scene };
};

/** Every backend a test made, disposed after it (once: the front guards a backend's dispose), so
 * a failed test leaves no set, and no hook on its stub renderer, behind. */
const backends: { dispose: () => void }[] = [];

beforeEach(() => {
  env.frame = 0;
  env.inputs = { frame: -1 };
  env.dispatches = [];
  env.renderer = createRenderer();
});

afterEach(() => {
  for (const backend of backends.splice(0)) backend.dispose();
});

/** The slot index a listed draw belongs to, from its name (`… slot <n> level …`). */
const slotOf = (object: THREE.Object3D) => Number(/slot (\d+)/.exec(object.name)?.[1]);

describe('the GPU backend: a slot per camera (p354 D6)', () => {
  test("a camera's first render takes a slot, and that render draws it and dispatches into it", () => {
    const { scene, backend } = createSet();
    const camera = createCamera();
    const listed = render(scene, camera);
    // A draw per level (one group each), the probe never listed
    expect(listed).toHaveLength(LEVELS);
    expect(listed.every((o) => slotOf(o) === 0)).toBe(true);
    expect(env.dispatches).toHaveLength(1);
    expect(env.dispatches[0].slotLevel).toBe(0);
    expect(backend.debugBuffers!.getSlots().map((s) => s.camera)).toEqual([camera]);
  });

  test('each camera draws only its own slot, and dispatches into it', () => {
    const { scene, backend } = createSet();
    const a = createCamera();
    const b = createCamera();
    render(scene, a);
    const listedB = render(scene, b);
    expect(listedB.map(slotOf)).toEqual([1, 1]);
    const listedA = render(scene, a);
    expect(listedA.map(slotOf)).toEqual([0, 0]);
    expect(env.dispatches.map((d) => d.slotLevel)).toEqual([0, LEVELS, 0]);
    // The readback's count per slot: one per render that reached the set
    expect(backend.debugBuffers!.getSlots().map((slot) => slot.dispatches)).toEqual([2, 1]);
  });

  test("a render that doesn't reach the set takes no slot and dispatches nothing", () => {
    const { scene, backend } = createSet();
    const camera = createCamera();
    expect(render(new THREE.Scene(), camera)).toEqual([]);
    // Hidden: three doesn't project its children
    scene.children[0].visible = false;
    expect(render(scene, camera)).toEqual([]);
    expect(env.dispatches).toEqual([]);
    expect(backend.debugBuffers!.getSlots()).toEqual([]);
  });

  /** three's shadow pass: the scene's material overridden by a shadow pass material. */
  const setShadowPass = (scene: THREE.Scene) => {
    const shadowPass = new THREE.MeshBasicNodeMaterial() as THREE.Material & {
      isShadowPassMaterial?: boolean;
    };
    shadowPass.isShadowPassMaterial = true;
    scene.overrideMaterial = shadowPass;
  };

  test("a shadow render's slot draws and appends the casting levels only", () => {
    const { scene, backend } = createSet();
    const view = createCamera();
    const sun = createCamera();
    render(scene, view);
    setShadowPass(scene);
    const listed = render(scene, sun);
    // Level 1 casts nothing: its draw isn't listed (VSM would draw a receiver into the map)
    expect(listed.map((o) => o.name)).toEqual(['test slot 1 level 0 group 0']);
    expect(listed[0].castShadow).toBe(true);
    scene.overrideMaterial = null;
    expect(render(scene, view)).toHaveLength(LEVELS);
    expect(env.dispatches.map((d) => d.levelMask)).toEqual([0xffffffff, 0b01, 0xffffffff]);
    expect(backend.debugBuffers!.getSlots().map((slot) => slot.camera)).toEqual([view, sun]);
  });

  test('a shadow render of a set that casts nothing takes no slot', () => {
    const { scene, backend } = createSet({ noneCast: true });
    setShadowPass(scene);
    expect(render(scene, createCamera())).toEqual([]);
    expect(env.dispatches).toEqual([]);
    expect(backend.debugBuffers!.getSlots()).toEqual([]);
  });

  test('past maxSlots a camera draws nothing, until a slot unused for 120 frames frees', () => {
    const { scene, backend } = createSet({ maxSlots: 2 });
    const [a, b, c] = [createCamera(), createCamera(), createCamera()];
    render(scene, a);
    render(scene, b);
    expect(render(scene, c)).toEqual([]);
    expect(env.dispatches).toHaveLength(2);

    // `a` keeps its slot by rendering; `b` goes unused
    env.frame = 120;
    render(scene, a);
    expect(render(scene, c)).toEqual([]);
    env.frame = 121;
    render(scene, a);
    expect(render(scene, c).map(slotOf)).toEqual([1, 1]);
    expect(backend.debugBuffers!.getSlots().map((s) => s.camera)).toEqual([a, c]);
    // `b` comes back to no slot
    expect(render(scene, b)).toEqual([]);
  });

  test('dispose detaches every draw and stops the dispatches', () => {
    const { scene, backend, object } = createSet();
    render(scene, createCamera());
    backends.splice(backends.indexOf(backend), 1);
    backend.dispose();
    expect(object.children).toEqual([]);
    expect(render(scene, createCamera())).toEqual([]);
    expect(env.dispatches).toHaveLength(1);
  });
});

describe('the GPU backend: the state moves once a frame (p354 D7)', () => {
  const lodInputs = (frame: number) => ({
    frame,
    hasCamera: true,
    cameraPosition: new THREE.Vector3(),
    k: 1,
    isOrtho: false,
    bias: 1,
    fadeSeconds: 0.25,
    fadeStep: 1 / 60,
    isFrozen: false,
    forceLevel: -1,
  });

  test('two renders of one camera in a frame select once; every later dispatch holds', () => {
    const { scene } = createSet();
    const camera = createCamera();
    const other = createCamera();
    env.frame = 1;
    env.inputs = lodInputs(1);
    render(scene, camera);
    render(scene, camera);
    render(scene, other);
    env.frame = 2;
    env.inputs = lodInputs(2);
    render(scene, other);
    render(scene, camera);
    expect(env.dispatches.map((d) => d.mode)).toEqual([
      SELECT_MODE.SELECT,
      SELECT_MODE.HOLD,
      SELECT_MODE.HOLD,
      SELECT_MODE.SELECT,
      SELECT_MODE.HOLD,
    ]);
  });

  test("a dispatch before the frame's inputs holds, and the frame's next one selects", () => {
    const { scene } = createSet();
    const camera = createCamera();
    // A compile at the scene's load, before the first frame: nothing written yet
    env.frame = 0;
    render(scene, camera);
    // The next frame: one dispatch before lod() wrote, then the view's after
    env.frame = 1;
    env.inputs = lodInputs(0);
    render(scene, camera);
    env.inputs = lodInputs(1);
    render(scene, camera);
    // The app loop paused: the inputs stay the last frame's
    env.frame = 2;
    render(scene, camera);
    expect(env.dispatches.map((d) => d.mode)).toEqual([
      SELECT_MODE.HOLD,
      SELECT_MODE.HOLD,
      SELECT_MODE.SELECT,
      SELECT_MODE.HOLD,
    ]);
  });

  test('no inputs a whole frame after the first dispatch: no lod(), level 0 forced', () => {
    const { scene } = createSet();
    const camera = createCamera();
    env.frame = 3;
    render(scene, camera);
    env.frame = 4;
    render(scene, camera);
    render(scene, camera);
    expect(env.dispatches.map((d) => d.mode)).toEqual([
      SELECT_MODE.HOLD,
      SELECT_MODE.FORCE,
      SELECT_MODE.HOLD,
    ]);
  });
});

describe('the GPU backend: removed ranges (p354 Phase 5 step 1)', () => {
  const identities = (count: number) => {
    const matrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) new THREE.Matrix4().toArray(matrices, i * 16);
    return matrices;
  };

  test('an added range starts its state words and a removed one stops them, uploaded once the buffer exists', () => {
    const { scene, backend } = createSet();
    const state = backend.debugBuffers!.state;
    const words = state.array as Uint32Array;
    backend.addInstances(1, identities(3), 3);
    backend.setExtent(4);
    backend.removeInstances(1, 2);
    expect(Array.from(words.subarray(0, 4))).toEqual([
      STATE_INITIAL,
      STATE_REMOVED,
      STATE_REMOVED,
      STATE_INITIAL,
    ]);
    // Before the first dispatch the buffer's creation uploads the array: an update range now
    // would be written again at the next upload, over the GPU's own state
    expect(state.updateRanges).toEqual([]);
    expect(state.version).toBe(0);

    render(scene, createCamera());
    backend.addInstances(1, identities(2), 2);
    backend.removeInstances(3, 1);
    expect(Array.from(words.subarray(0, 4))).toEqual([
      STATE_INITIAL,
      STATE_INITIAL,
      STATE_INITIAL,
      STATE_REMOVED,
    ]);
    // Only the changed ranges, never the whole buffer
    expect(state.updateRanges).toEqual([
      { start: 1, count: 2 },
      { start: 3, count: 1 },
    ]);
    expect(state.version).toBe(2);
  });

  test("with no live instance it still dispatches, so the slot's draws draw none", () => {
    const { scene, backend } = createSet();
    const camera = createCamera();
    render(scene, camera);
    backend.removeInstances(0, 1);
    backend.setExtent(0);
    render(scene, camera);
    expect(env.dispatches.map((d) => d.extent)).toEqual([1, 0]);
  });
});
