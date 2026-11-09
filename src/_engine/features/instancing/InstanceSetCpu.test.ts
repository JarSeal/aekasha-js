import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// p354 Phase 4 step 3: the CPU backend (D9) against a loop of `utils/LodRules.ts` written here,
// frame by frame along a scripted camera path: each level mesh holds exactly the instances the
// rules put at its level (an instance in one mesh, two while it cross-fades, none culled), each
// copy with its fade and its whole matrix, through every swap-remove. The main loop's frame and
// the LOD frame inputs are the test's; the world is a stub that hands over the system the backend
// adds, which each frame runs.

const env = vi.hoisted(() => ({
  frame: 0,
  inputs: { frame: -1 } as Record<string, unknown>,
  warnings: [] as string[],
}));

vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getMainLoopFrame: () => env.frame,
}));
vi.mock(import('../../kernel/ecs/LodTargets'), async (importOriginal) => ({
  ...(await importOriginal()),
  getLodFrameInputs: () => env.inputs as never,
}));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: (...data: unknown[]) => {
    env.warnings.push(String(data[0]));
  },
}));

import type { ECSWorld } from '../../kernel/ecs/ECS';
import { getLodFadeAttribute, LOD_FADE_OPAQUE } from '../../kernel/render/LodFade';
import {
  DEFAULT_LOD_HYSTERESIS,
  LOD_LEVEL_CULLED,
  LOD_LEVEL_NONE,
  selectLodTarget,
  stepLodInstanceState,
  type LodInstanceState,
} from '../../utils/LodRules';
import { createCpuInstanceSetBackend } from './InstanceSetCpu';
import type { InstanceSetBackendParams } from './InstanceSetTypes';

/** A world that keeps the systems added to it, to run them as a frame's stage would. */
const createStubWorld = () => {
  const systems = new Map<string, (world: ECSWorld) => void>();
  const world = {
    addSystem: (_stage: string, id: string, fn: (w: ECSWorld) => void) => {
      if (!systems.has(id)) systems.set(id, fn);
    },
    removeSystem: (id: string) => systems.delete(id),
  } as unknown as ECSWorld;
  const runSystems = () => {
    for (const fn of systems.values()) fn(world);
  };
  return { world, systems, runSystems };
};

/** Level 0's box: its conservative radius is the measure's (√3 / 2 at scale 1). */
const RADIUS = Math.sqrt(3) / 2;
const SCREEN_SIZES = [0.2, 0.05, 0];
const CULL_SCREEN_SIZE = 0.01;
const FADE_SECONDS = 0.25;
const DT = 1 / 60;
const SPACING = 5;

const createLevels = () => [
  {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshBasicNodeMaterial(),
    screenSize: SCREEN_SIZES[0],
  },
  {
    // Larger than level 0: the bounds take the largest level's radius
    geometry: new THREE.BoxGeometry(2, 2, 2),
    material: new THREE.MeshBasicNodeMaterial(),
    screenSize: SCREEN_SIZES[1],
  },
  {
    geometry: new THREE.BoxGeometry(1, 1, 1),
    material: new THREE.MeshBasicNodeMaterial(),
    screenSize: SCREEN_SIZES[2],
    castShadow: false,
  },
];

/** `count` instances along +x, `SPACING` apart (each one's x tells it apart), scales 0.8-1.2,
 * turned about +y. */
const createMatrices = (count: number) => {
  const matrices = new Float32Array(count * 16);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const scale = 0.8 + ((i * 7) % 5) * 0.1;
    m.compose(
      new THREE.Vector3(i * SPACING, 0, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.3),
      new THREE.Vector3(scale, scale, scale)
    ).toArray(matrices, i * 16);
  }
  return matrices;
};

const createSet = (
  world: ECSWorld,
  count: number,
  lod: InstanceSetBackendParams['lod'] = {
    cullScreenSize: CULL_SCREEN_SIZE,
    fadeSeconds: FADE_SECONDS,
  }
) => {
  const object = new THREE.Group();
  const backend = createCpuInstanceSetBackend({
    world,
    object,
    levels: createLevels(),
    lod,
    maxInstances: count,
    maxVisible: count,
    maxSlots: 8,
    receiveShadow: true,
    label: 'test',
  });
  const matrices = createMatrices(count);
  backend.addInstances(0, matrices, count);
  backend.setExtent(count);
  return { backend, object, matrices };
};

/** The frame inputs `lod()` would write: the camera at `x` on the line, 2 m to its side. */
const setInputs = (frame: number, cameraX: number, extra: Record<string, unknown> = {}) => {
  env.frame = frame;
  env.inputs = {
    frame,
    hasCamera: true,
    cameraPosition: new THREE.Vector3(cameraX, 0, 2),
    k: 1,
    isOrtho: false,
    bias: 1,
    fadeSeconds: 0.5,
    fadeStep: DT,
    isFrozen: false,
    forceLevel: -1,
    ...extra,
  };
};

// --- The reference: the rules on each instance, as `lod()`'s systems apply them ---

type Reference = LodInstanceState[];

const createReference = (count: number): Reference =>
  Array.from({ length: count }, () => ({
    level: LOD_LEVEL_NONE,
    outgoing: LOD_LEVEL_NONE,
    progress: 1,
  }));

type ReferenceStep = {
  mode: 'SELECT' | 'FORCE' | 'ADVANCE';
  forced?: number;
  fadeSeconds?: number;
};

/** The instances of removed ranges: no state, no copies. */
const NONE_REMOVED: ReadonlySet<number> = new Set();

const stepReference = (
  reference: Reference,
  matrices: Float32Array,
  step: ReferenceStep,
  removed = NONE_REMOVED
) => {
  const inputs = env.inputs as { cameraPosition: THREE.Vector3; k: number; fadeStep: number };
  const levels = SCREEN_SIZES.map((screenSize) => ({ screenSize }));
  reference.forEach((state, i) => {
    if (removed.has(i)) return;
    let target = state.level;
    if (step.mode === 'SELECT') {
      const m = i * 16;
      const scale = Math.hypot(matrices[m], matrices[m + 1], matrices[m + 2]);
      // The backend keeps its records in a Float32Array: so does the reference
      const radius = Math.fround(scale * RADIUS);
      const position = new THREE.Vector3(matrices[m + 12], matrices[m + 13], matrices[m + 14]);
      const distance = position.distanceTo(inputs.cameraPosition);
      const s = distance > 0 ? (radius * inputs.k) / distance : Infinity;
      target = selectLodTarget(levels, s, state.level, CULL_SCREEN_SIZE, DEFAULT_LOD_HYSTERESIS);
    } else if (step.mode === 'FORCE') {
      target = step.forced!;
    }
    stepLodInstanceState(state, target, step.fadeSeconds ?? FADE_SECONDS, inputs.fadeStep);
  });
};

// --- Reading the level meshes back ---

const getMeshes = (object: THREE.Group) => object.children as THREE.InstancedMesh[];

/** Each level mesh's copies in slot order: the instance (by its x), its fade and scale. */
const readMeshes = (object: THREE.Group) =>
  getMeshes(object).map((mesh) => {
    const fades = getLodFadeAttribute(mesh)!;
    const e = mesh.instanceMatrix.array;
    return Array.from({ length: mesh.count }, (_, slot) => ({
      instance: Math.round(e[slot * 16 + 12] / SPACING),
      fade: fades.getX(slot),
      scale: Math.hypot(e[slot * 16], e[slot * 16 + 1], e[slot * 16 + 2]),
    }));
  });

/** Each level mesh holds the reference's instances at its level, each copy once, with its fade
 * (the incoming at `t`, the outgoing at `t - 1`, opaque when none runs) and its whole matrix. */
const expectMeshes = (
  object: THREE.Group,
  reference: Reference,
  matrices: Float32Array,
  at: string,
  removed = NONE_REMOVED
) => {
  readMeshes(object).forEach((copies, level) => {
    const expected: { instance: number; fade: number }[] = [];
    reference.forEach((state, i) => {
      if (removed.has(i)) return;
      const isFading = state.outgoing !== LOD_LEVEL_NONE;
      if (state.level === level) {
        expected.push({ instance: i, fade: isFading ? state.progress : LOD_FADE_OPAQUE });
      } else if (state.outgoing === level) {
        expected.push({ instance: i, fade: state.progress - 1 });
      }
    });
    const sorted = [...copies].sort((a, b) => a.instance - b.instance);
    expect(
      sorted.map((c) => c.instance),
      `${at}: level ${level}'s instances`
    ).toEqual(expected.map((c) => c.instance));
    sorted.forEach((copy, n) => {
      expect(Math.abs(copy.fade - expected[n].fade), `${at}: ${copy.instance}'s fade`).toBeLessThan(
        1e-6
      );
      const m = copy.instance * 16;
      const scale = Math.hypot(matrices[m], matrices[m + 1], matrices[m + 2]);
      expect(Math.abs(copy.scale - scale), `${at}: ${copy.instance}'s matrix`).toBeLessThan(1e-6);
    });
  });
};

/** The camera's x at a frame of the path: out along the line and back, with a fast wobble that
 * turns instances near a threshold back mid-fade. */
const cameraXAt = (frame: number) => 60 + 70 * Math.sin(frame * 0.02) + 6 * Math.sin(frame * 0.7);

beforeEach(() => {
  env.frame = 0;
  // The kernel's inputs before lod() ever wrote them (and for good without it)
  setInputs(0, 0, { frame: -1, hasCamera: false, fadeStep: 0, fadeSeconds: 0 });
  env.warnings = [];
});

describe('the CPU backend: the rules (p354 D3, D9)', () => {
  test('each level mesh holds the rules’ instances, frame by frame along a camera path', () => {
    const { world, runSystems } = createStubWorld();
    const count = 40;
    const { object, matrices, backend } = createSet(world, count);
    const reference = createReference(count);
    let fadesSeen = 0;
    let changesMidFade = 0;
    for (let frame = 1; frame <= 600; frame++) {
      setInputs(frame, cameraXAt(frame));
      const before = reference.map((s) => ({ ...s }));
      stepReference(reference, matrices, { mode: 'SELECT' });
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
      reference.forEach((state, i) => {
        if (state.outgoing !== LOD_LEVEL_NONE) fadesSeen++;
        // A change while the last frame's fade still ran
        if (before[i].outgoing !== LOD_LEVEL_NONE && state.level !== before[i].level) {
          changesMidFade++;
        }
      });
    }
    // The path did what it's for: fades, fades to and from culled, changes mid-fade
    expect(fadesSeen).toBeGreaterThan(100);
    expect(changesMidFade).toBeGreaterThan(0);
    expect(reference.some((s) => s.level === LOD_LEVEL_CULLED)).toBe(true);
    // The backend's own state is the rules' too
    const { levels, outgoing } = backend.debugCpu!;
    expect(Array.from(levels)).toEqual(reference.map((s) => s.level));
    expect(Array.from(outgoing)).toEqual(reference.map((s) => s.outgoing));
  });

  test('without fades every instance is in exactly one level mesh, or none culled', () => {
    const { world, runSystems } = createStubWorld();
    const count = 40;
    const { object, matrices } = createSet(world, count, {
      cullScreenSize: CULL_SCREEN_SIZE,
      fadeSeconds: 0,
    });
    const reference = createReference(count);
    for (let frame = 1; frame <= 300; frame++) {
      setInputs(frame, cameraXAt(frame));
      stepReference(reference, matrices, { mode: 'SELECT', fadeSeconds: 0 });
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
      const copies = readMeshes(object).flat();
      const culled = reference.filter((s) => s.level === LOD_LEVEL_CULLED).length;
      expect(copies.length).toBe(count - culled);
    }
  });

  test('the first selection never fades, and the global fade seconds apply without its own', () => {
    const { world, runSystems } = createStubWorld();
    const { object, matrices } = createSet(world, 10, { cullScreenSize: CULL_SCREEN_SIZE });
    const reference = createReference(10);
    setInputs(1, 0);
    stepReference(reference, matrices, { mode: 'SELECT', fadeSeconds: 0.5 });
    runSystems();
    expect(reference.every((s) => s.outgoing === LOD_LEVEL_NONE)).toBe(true);
    expectMeshes(object, reference, matrices, 'frame 1');
    // The inputs' 0.5 s: a fade lasts 30 frames
    for (let frame = 2; frame <= 40; frame++) {
      setInputs(frame, 20);
      stepReference(reference, matrices, { mode: 'SELECT', fadeSeconds: 0.5 });
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
    }
  });
});

describe('the CPU backend: removed ranges (p354 Phase 5 step 1)', () => {
  test('a removed range leaves the level meshes, and one added again starts unselected', () => {
    const { world, runSystems } = createStubWorld();
    const count = 40;
    const { object, matrices, backend } = createSet(world, count);
    const reference = createReference(count);
    const removed = new Set<number>();
    const remove = (start: number, n: number) => {
      backend.removeInstances(start, n);
      for (let i = start; i < start + n; i++) removed.add(i);
    };
    const add = (start: number, n: number) => {
      backend.addInstances(start, matrices.subarray(start * 16, (start + n) * 16), n);
      for (let i = start; i < start + n; i++) {
        removed.delete(i);
        reference[i] = { level: LOD_LEVEL_NONE, outgoing: LOD_LEVEL_NONE, progress: 1 };
      }
    };
    let fadingAtRemoval = 0;
    for (let frame = 1; frame <= 600; frame++) {
      setInputs(frame, cameraXAt(frame));
      // Mid-path, while instances fade: a range in the middle and the top one go
      if (frame === 150) {
        for (let i = 8; i < 30; i++) {
          if (reference[i].outgoing !== LOD_LEVEL_NONE) fadingAtRemoval++;
        }
        remove(8, 12);
        remove(20, 10);
        remove(34, 6);
        backend.setExtent(34);
        expectMeshes(object, reference, matrices, 'the removal', removed);
      }
      // Part of a removed range taken again, then the rest and the top
      if (frame === 300) add(8, 5);
      if (frame === 400) {
        add(13, 7);
        add(34, 6);
        backend.setExtent(40);
      }
      stepReference(reference, matrices, { mode: 'SELECT' }, removed);
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`, removed);
      if (frame === 300) {
        // Added: selected on its first frame, unfaded (never a fade from what was there before)
        for (let i = 8; i < 13; i++) expect(reference[i].outgoing).toBe(LOD_LEVEL_NONE);
      }
    }
    // The removal took fading instances out too, swap-removing both their copies
    expect(fadingAtRemoval).toBeGreaterThan(0);
    // The ones still removed are in no mesh, and the backend skips their state
    expect(removed.size).toBe(10);
    const copies = readMeshes(object).flat();
    expect(copies.some((copy) => copy.instance >= 20 && copy.instance < 30)).toBe(false);
  });

  test('a removed instance is skipped past the extent and below it', () => {
    const { world, runSystems } = createStubWorld();
    const { object, backend } = createSet(world, 10);
    setInputs(1, 0);
    runSystems();
    expect(readMeshes(object).flat()).toHaveLength(10);
    backend.removeInstances(0, 10);
    expect(getMeshes(object).map((mesh) => mesh.count)).toEqual([0, 0, 0]);
    // The extent left where it was: the loop still skips every removed one
    for (let frame = 2; frame <= 20; frame++) {
      setInputs(frame, frame * 5);
      runSystems();
    }
    expect(getMeshes(object).map((mesh) => mesh.count)).toEqual([0, 0, 0]);
  });
});

describe('the CPU backend: the frame (p354 D7) and the debug options', () => {
  test('steps once a frame, however often the system runs', () => {
    const { world, runSystems } = createStubWorld();
    const { object, matrices } = createSet(world, 20);
    const reference = createReference(20);
    for (let frame = 1; frame <= 40; frame++) {
      setInputs(frame, frame * 3);
      stepReference(reference, matrices, { mode: 'SELECT' });
      runSystems();
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
    }
  });

  test('holds when the inputs aren’t this frame’s (lod() didn’t select)', () => {
    const { world, runSystems } = createStubWorld();
    const { object } = createSet(world, 20);
    setInputs(1, 0);
    runSystems();
    const settled = readMeshes(object);
    setInputs(2, 80);
    env.frame = 3;
    runSystems();
    expect(readMeshes(object)).toEqual(settled);
  });

  test('freeze holds the levels and runs the fades', () => {
    const { world, runSystems } = createStubWorld();
    const { object, matrices } = createSet(world, 30);
    const reference = createReference(30);
    for (let frame = 1; frame <= 20; frame++) {
      setInputs(frame, frame * 4);
      stepReference(reference, matrices, { mode: 'SELECT' });
      runSystems();
    }
    expect(reference.some((s) => s.outgoing !== LOD_LEVEL_NONE)).toBe(true);
    for (let frame = 21; frame <= 40; frame++) {
      setInputs(frame, 150, { isFrozen: true });
      stepReference(reference, matrices, { mode: 'ADVANCE' });
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
    }
    expect(reference.every((s) => s.outgoing === LOD_LEVEL_NONE)).toBe(true);
  });

  test('a forced level fades every instance to it, culled ones too, and the time scale holds it', () => {
    const { world, runSystems } = createStubWorld();
    const { object, matrices } = createSet(world, 40);
    const reference = createReference(40);
    setInputs(1, 0);
    stepReference(reference, matrices, { mode: 'SELECT' });
    runSystems();
    expect(reference.some((s) => s.level === LOD_LEVEL_CULLED)).toBe(true);
    // The time scale at 0: every fade starts and holds at 0
    for (let frame = 2; frame <= 4; frame++) {
      setInputs(frame, 0, { forceLevel: 1, fadeStep: 0 });
      stepReference(reference, matrices, { mode: 'FORCE', forced: 1 });
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
    }
    expect(reference.every((s) => s.level === 1)).toBe(true);
    // Then it runs out: everything in level 1's mesh alone
    for (let frame = 5; frame <= 25; frame++) {
      setInputs(frame, 0, { forceLevel: 1 });
      stepReference(reference, matrices, { mode: 'FORCE', forced: 1 });
      runSystems();
      expectMeshes(object, reference, matrices, `frame ${frame}`);
    }
    expect(getMeshes(object).map((mesh) => mesh.count)).toEqual([0, 40, 0]);
    // A level past the last is the last
    setInputs(26, 0, { forceLevel: 7 });
    runSystems();
    expect(getMeshes(object)[2].count).toBe(40);
  });

  test('without lod() it draws level 0 unfaded and warns once a whole frame on', () => {
    const { world, runSystems } = createStubWorld();
    const { object } = createSet(world, 10);
    env.frame = 1;
    runSystems();
    // Its first frame: maybe a world that ran before lod()'s wrote the inputs, so it holds
    expect(getMeshes(object).map((mesh) => mesh.count)).toEqual([0, 0, 0]);
    expect(env.warnings).toHaveLength(0);
    env.frame = 2;
    runSystems();
    env.frame = 3;
    runSystems();
    expect(getMeshes(object).map((mesh) => mesh.count)).toEqual([10, 0, 0]);
    for (const copy of readMeshes(object)[0]) expect(copy.fade).toBe(LOD_FADE_OPAQUE);
    expect(env.warnings).toHaveLength(1);
    expect(env.warnings[0]).toMatch(/lod\(\)/);
  });

  test('uploads only the level meshes a frame changed', () => {
    const { world, runSystems } = createStubWorld();
    const { object } = createSet(world, 30);
    for (let frame = 1; frame <= 40; frame++) {
      setInputs(frame, 30);
      runSystems();
    }
    const versions = () =>
      getMeshes(object).map((mesh) => [
        mesh.instanceMatrix.version,
        getLodFadeAttribute(mesh)!.version,
      ]);
    const settled = versions();
    setInputs(41, 30);
    runSystems();
    // A still camera: nothing changes level, nothing uploads
    expect(versions()).toEqual(settled);
  });

  test('a changed level mesh uploads its live part only', () => {
    const { world, runSystems } = createStubWorld();
    const { object } = createSet(world, 30);
    setInputs(1, 0);
    runSystems();
    for (const mesh of getMeshes(object)) {
      const ranges = mesh.instanceMatrix.updateRanges;
      if (mesh.count === 0) {
        expect(ranges).toEqual([]);
        continue;
      }
      expect(ranges).toEqual([{ start: 0, count: mesh.count * 16 }]);
      expect(getLodFadeAttribute(mesh)!.updateRanges).toEqual([{ start: 0, count: mesh.count }]);
    }
  });
});

describe('the CPU backend: the meshes, the bounds and the system', () => {
  test('a level mesh per level, with its castShadow, the set’s receiveShadow and no raycast', () => {
    const { world } = createStubWorld();
    const { object } = createSet(world, 4);
    const meshes = getMeshes(object);
    expect(meshes).toHaveLength(3);
    expect(meshes.map((mesh) => mesh.castShadow)).toEqual([true, true, false]);
    expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);
    const hits: THREE.Intersection[] = [];
    meshes[0].raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
  });

  test('every level mesh’s bounds hold every instance at its largest level’s radius', () => {
    const { world } = createStubWorld();
    const count = 12;
    const { object, matrices } = createSet(world, count);
    // Level 1's box is twice level 0's
    const largest = Math.sqrt(3);
    for (const mesh of getMeshes(object)) {
      for (let i = 0; i < count; i++) {
        const m = i * 16;
        const scale = Math.hypot(matrices[m], matrices[m + 1], matrices[m + 2]);
        const sphere = new THREE.Sphere(
          new THREE.Vector3(matrices[m + 12], matrices[m + 13], matrices[m + 14]),
          scale * largest * 0.999
        );
        expect(mesh.boundingSphere!.containsPoint(sphere.center)).toBe(true);
        expect(
          mesh.boundingSphere!.center.distanceTo(sphere.center) + sphere.radius
        ).toBeLessThanOrEqual(mesh.boundingSphere!.radius + 1e-4);
        expect(mesh.boundingBox!.intersectsSphere(sphere)).toBe(true);
        expect(mesh.boundingBox!.max.x).toBeGreaterThanOrEqual(sphere.center.x + sphere.radius);
      }
    }
  });

  test('instances written again move their drawn copies', () => {
    const { world, runSystems } = createStubWorld();
    const { object, backend } = createSet(world, 10);
    setInputs(1, 0);
    runSystems();
    const moved = createMatrices(10);
    // Instance 3 scaled up, in place
    new THREE.Matrix4()
      .compose(new THREE.Vector3(15, 0, 0), new THREE.Quaternion(), new THREE.Vector3(2, 2, 2))
      .toArray(moved, 3 * 16);
    backend.writeInstances(3, moved.subarray(3 * 16, 4 * 16), 1);
    const copy = readMeshes(object)
      .flat()
      .find((c) => c.instance === 3);
    expect(copy?.scale).toBeCloseTo(2, 5);
  });

  test('one system per world, added with its first set and removed with its last', () => {
    const { world, systems, runSystems } = createStubWorld();
    const first = createSet(world, 5);
    const second = createSet(world, 5);
    expect(systems.size).toBe(1);
    setInputs(1, 0);
    runSystems();
    // Both sets stepped by the one system: every instance drawn
    const copies = (object: THREE.Group) => readMeshes(object).flat().length;
    expect(copies(first.object) + copies(second.object)).toBe(10);
    first.backend.dispose();
    expect(systems.size).toBe(1);
    expect(first.object.children).toHaveLength(0);
    second.backend.dispose();
    expect(systems.size).toBe(0);
    // Another world has a system of its own
    const other = createStubWorld();
    createSet(other.world, 2);
    expect(other.systems.size).toBe(1);
    expect(systems.size).toBe(0);
  });

  test('a disposed set’s meshes fire dispose (their buffers freed), not its levels’ geometries', () => {
    const { world } = createStubWorld();
    const { object, backend } = createSet(world, 5);
    const meshes = getMeshes(object);
    const disposed: string[] = [];
    for (const mesh of meshes) {
      mesh.addEventListener('dispose', () => disposed.push(mesh.name));
      mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
    }
    backend.dispose();
    expect(disposed).toEqual(['test level 0', 'test level 1', 'test level 2']);
  });
});
