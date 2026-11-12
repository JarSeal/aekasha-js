import * as THREE from 'three/webgpu';
import { ComponentType, getRootScene, removeMeshLod, setMeshLod } from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { getLodBias } from 'aekasha/lod';
import { rebuildMergeGroup } from 'aekasha/merging';
import { getConservativeGeometryRadius } from 'aekasha/spatial';
import { getSkyLightIds } from 'aekasha/skybox';
import { createProjectionTimer, createSystemTimer, installWalkOnce } from './_dbg__hlodSpikeSplit';

// p377 Phase 0's probe additions (docs/plans/_DONE_p377_hlod-streaming-cell-proxies.md,
// "What the spike adds"), on `window.__aekHlod` next to p376's (`_dbg__hlodSpike.ts`), for
// largeWorld's far field (`?hlodField`, `src/app/scenes/largeWorld/_dbg__largeWorldHlodField.ts`,
// which says what it drew in `window.__aekHlodField`). The field's objects are its groups (`members`: the groups its
// pieces are in), its proxy meshes (`proxy`) or its instanced meshes (`instanced`).
//
// - `screenSizes()`: the objects' screen sizes from the camera now, as the LOD selection measures
//   them (`LodMeasure.ts`: level 0's conservative radius times the largest scale, × k / distance,
//   k = zoom / tan(fov / 2) × the global bias; an `InstancedMesh` by its bounds over every
//   instance, which `LodBounds.ts` measures the same way up to the sphere's fit), as quantiles.
// - `setCull(size)`: every field object gets `{ levels: [{ screenSize: 0 }], cullScreenSize: size,
//   fadeSeconds: 0, hysteresis: 0 }` (no hysteresis, so the share culled is the share below the
//   size); 0 removes it. The LOD pins level 0's geometry at its add (p376 §1): a rebuild under it
//   comes back stale, so `rebuildAsync` refuses a culled field.
// - `cpuSplit(frames)`: `measure`'s figures with the CPU frame's parts: the render submit, the
//   root scene's `updateMatrixWorld` timed on its own inside it (three's walk over every object,
//   hidden members included; summed per frame, with its calls: one per render call), the systems
//   (the rest), and the scene graph's objects, the hidden ones apart. p378 Phase 0
//   (docs/plans/_DONE_p378_baked-members-out-of-the-scene-graph.md) adds each system's time
//   (`systems`, `systemsTimedMs` their sum outside `LATE_MAIN`), the projection walks per render
//   kind (`projection`, `projectMs` their sum) and walk-once's skipped calls
//   (`_dbg__hlodSpikeSplit.ts`).
// - `fieldDraws()`: the field's objects drawn in the main camera's frustum (the scene pass and the
//   AO pre-pass both draw them) and in each shadow-casting sky sun's (the casters), as three culls
//   them (visible, then the object's bounding sphere), from the last render's matrices.
// - `rebuildAsync(n)`: `n` field groups (evenly spread by id) rebuilt one at a time, each its
//   build's cost: the CPU frame that applies it (its geometry swapped) over the median frame
//   before, and the wall time from the request (a build over `WORKER_BUILD_VERTICES` runs on the
//   assets worker meanwhile).

/** What the field module records (`HlodFieldInfo`, `_dbg__largeWorldHlodField.ts`; app scene
 * code that a shared module can't import). */
type FieldInfo = {
  sites: number;
  cellSize: number;
  as: 'members' | 'proxy' | 'instanced';
  pieces: number;
  memberIds: number[];
  objectIds: number[];
  cells: number;
  createMs: number;
};

/** One frame's figures, as the probe's frame systems measure them. */
export type SpikeFrame = { cpuMs: number; renderMs: number; drawCalls: number; triangles: number };

/** What `createDrawsApi` needs of the probe's frame API. */
export type SpikeFrameHooks = {
  /** Calls `listener` at each frame's end (`LATE_MAIN`) with its figures; returns the remover. */
  onFrame: (listener: (frame: SpikeFrame) => void) => () => void;
  /** The active camera's object. */
  getActiveCamera: () => THREE.Camera | undefined;
};

/** `merging()`'s `WORKER_BUILD_VERTICES` (`@internal`): a build over it runs on the assets worker. */
const WORKER_BUILD_VERTICES = 65_536;
const REBUILD_TIMEOUT_FRAMES = 600;
const BASELINE_FRAMES = 60;
/** Frames between two rebuilds, so one's upload doesn't land in the next one's frame. */
const REBUILD_GAP_FRAMES = 10;
const QUANTILES = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 1];

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : NaN;
};

const getFieldInfo = () => {
  const info = (window as Window & { __aekHlodField?: FieldInfo }).__aekHlodField;
  if (!info) throw new Error('No HLOD field: load largeWorld with ?hlodField=<sites>.');
  return info;
};

type FieldObject = { entityId: number; mesh: THREE.Mesh; groupId?: string };

/** The field's drawn objects: its groups (built ones), or its proxy or instanced meshes. */
const getFieldObjects = (world: ECSWorld): FieldObject[] => {
  const info = getFieldInfo();
  const meshOf = (entityId: number) => {
    const value = world.getComponent(entityId, ComponentType.OBJECT3D)?.value as
      | THREE.Mesh
      | undefined;
    return value?.isMesh ? value : undefined;
  };
  if (info.as !== 'members') {
    return info.objectIds.flatMap((entityId) => {
      const mesh = meshOf(entityId);
      return mesh ? [{ entityId, mesh }] : [];
    });
  }
  const groups = new Set<number>();
  for (const id of info.memberIds) {
    const member = world.getComponent(id, ComponentType.MERGE_MEMBER);
    if (member) groups.add(member.groupEntityId);
  }
  const objects: FieldObject[] = [];
  for (const entityId of groups) {
    const mesh = meshOf(entityId);
    const group = world.getComponent(entityId, ComponentType.MERGE_GROUP);
    if (mesh && group) objects.push({ entityId, mesh, groupId: group.id });
  }
  return objects.sort((a, b) => (a.groupId! < b.groupId! ? -1 : a.groupId! > b.groupId! ? 1 : 0));
};

/** An object's world bounding sphere, as three culls it (an `InstancedMesh` by its own sphere
 * over every instance). */
const getCullSphere = (mesh: THREE.Mesh, out: THREE.Sphere) => {
  const instanced = mesh as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    if (!instanced.boundingSphere) instanced.computeBoundingSphere();
    return out.copy(instanced.boundingSphere!).applyMatrix4(mesh.matrixWorld);
  }
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  return out.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
};

/** The triangles an object draws: its index (or vertices) over 3, times its instances. */
const getTriangles = (mesh: THREE.Mesh) => {
  const { geometry } = mesh;
  const triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  const instanced = mesh as THREE.InstancedMesh;
  return instanced.isInstancedMesh ? triangles * instanced.count : triangles;
};

/** p377's probe functions, spread into `window.__aekHlod`. */
export const createDrawsApi = (world: ECSWorld, hooks: SpikeFrameHooks) => {
  // p378 D5: `?hlodFieldWalk=once`, for the scene's life
  const walkOnce = installWalkOnce(world);
  const sphere = new THREE.Sphere();
  const frustum = new THREE.Frustum();
  const viewProjection = new THREE.Matrix4();
  const cameraPosition = new THREE.Vector3();

  /** The objects' and their triangles inside a camera's frustum, as three draws them. */
  const countInFrustum = (objects: FieldObject[], camera: THREE.Camera, castersOnly: boolean) => {
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem);
    let count = 0;
    let triangles = 0;
    for (const { mesh } of objects) {
      if (!mesh.visible || (castersOnly && !mesh.castShadow)) continue;
      if (mesh.frustumCulled && !frustum.intersectsSphere(getCullSphere(mesh, sphere))) continue;
      count++;
      triangles += getTriangles(mesh);
    }
    return { objects: count, triangles };
  };

  /** Each field object's screen size from the active camera now, as the LOD selection measures. */
  const measureScreenSizes = (objects: FieldObject[]) => {
    const camera = hooks.getActiveCamera() as THREE.PerspectiveCamera | undefined;
    if (!camera?.isPerspectiveCamera) throw new Error('No active perspective camera.');
    camera.updateWorldMatrix(true, false);
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    const k = (camera.zoom / Math.tan(THREE.MathUtils.DEG2RAD * camera.fov * 0.5)) * getLodBias();
    return objects.map(({ mesh }) => {
      let radius: number;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        getCullSphere(mesh, sphere);
        radius = sphere.radius;
      } else {
        // A mesh directly under the root scene: its position is its world one (`measureEntity`)
        sphere.center.copy(mesh.position);
        const { x, y, z } = mesh.scale;
        radius =
          getConservativeGeometryRadius(mesh.geometry) *
          Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      }
      const distance = sphere.center.distanceTo(cameraPosition);
      return distance > 0 ? (radius * k) / distance : Infinity;
    });
  };

  /** The next `frames` frames' figures, each with `extra`'s fields, then `extra`'s cleanup. */
  const collectFrames = <T extends object>(
    frames: number,
    extra: () => T
  ): Promise<(SpikeFrame & T)[]> =>
    new Promise((resolve) => {
      const list: (SpikeFrame & T)[] = [];
      const remove = hooks.onFrame((frame) => {
        list.push({ ...frame, ...extra() });
        if (list.length >= Math.max(1, frames)) {
          remove();
          resolve(list);
        }
      });
    });

  return {
    /** The field: what the field module made, and its drawn objects now. */
    field: () => {
      const info = getFieldInfo();
      const objects = getFieldObjects(world);
      return {
        ...info,
        memberIds: info.memberIds.length,
        objectIds: info.objectIds.length,
        objects: objects.length,
        triangles: objects.reduce((sum, { mesh }) => sum + getTriangles(mesh), 0),
      };
    },
    /** The field objects' screen sizes from the active camera now: quantiles, and the sizes that
     * would cull about a quarter, a half and three quarters of them. */
    screenSizes: () => {
      const sizes = measureScreenSizes(getFieldObjects(world));
      return {
        objects: sizes.length,
        quantiles: QUANTILES.map((q) => ({ q, size: quantile(sizes, q) })),
        cullFor: {
          quarter: quantile(sizes, 0.25),
          half: quantile(sizes, 0.5),
          threeQuarters: quantile(sizes, 0.75),
        },
      };
    },
    /** Every field object culled below `size` (no fade, no hysteresis); 0 removes the culls.
     * Returns how many objects got (or lost) one. */
    setCull: (size: number) => {
      const objects = getFieldObjects(world);
      for (const { entityId } of objects) {
        if (size > 0) {
          void setMeshLod(
            entityId,
            { levels: [{ screenSize: 0 }], cullScreenSize: size, fadeSeconds: 0, hysteresis: 0 },
            world
          );
        } else {
          removeMeshLod(entityId, world);
        }
      }
      return objects.length;
    },
    /** The field's objects drawn per pass now (the last render's matrices), and the LOD culled. */
    fieldDraws: () => {
      const objects = getFieldObjects(world);
      const camera = hooks.getActiveCamera();
      const shadows: { objects: number; triangles: number }[] = [];
      for (const id of getSkyLightIds().suns) {
        if (id === null) continue;
        const light = world.getComponent(id, ComponentType.OBJECT3D)?.value as
          | THREE.DirectionalLight
          | undefined;
        if (light?.castShadow && light.shadow?.camera) {
          shadows.push(countInFrustum(objects, light.shadow.camera, true));
        }
      }
      const main = camera ? countInFrustum(objects, camera, false) : null;
      const lodCulled = objects.filter(({ entityId }) =>
        world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED)
      ).length;
      const shadowObjects = shadows.reduce((sum, s) => sum + s.objects, 0);
      return {
        objects: objects.length,
        visible: objects.filter(({ mesh }) => mesh.visible).length,
        lodCulled,
        main,
        shadows,
        /** The scene pass and the AO pre-pass each draw the main camera's, the shadow its own */
        draws: main ? 2 * main.objects + shadowObjects : NaN,
      };
    },
    /**
     * The next `frames` frames' CPU split: the frame, the render submit, the root scene's matrix
     * walk inside it and the systems (the frame less the submit), medians and 90th percentiles,
     * with the renderer's draws and triangles, and the scene graph's objects.
     */
    cpuSplitAsync: async (frames: number) => {
      const root = getRootScene();
      if (!root) throw new Error('No root scene.');
      let walkMs = 0;
      let walkCalls = 0;
      const hadOwn = Object.prototype.hasOwnProperty.call(root, 'updateMatrixWorld');
      const original = root.updateMatrixWorld;
      root.updateMatrixWorld = function (this: THREE.Scene, force?: boolean) {
        const startedAt = performance.now();
        original.call(this, force);
        walkMs += performance.now() - startedAt;
        walkCalls++;
      };
      // p378: each system and the projection walks, per frame
      const systemTimer = createSystemTimer(world);
      const projectionTimer = createProjectionTimer(hooks.getActiveCamera);
      walkOnce?.takeSkipped();
      const startedAt = performance.now();
      let list: (SpikeFrame & {
        walkMs: number;
        walkCalls: number;
        walkSkipped: number;
        systemsTimedMs: number;
        projectMs: number;
      })[];
      try {
        list = await collectFrames(frames, () => {
          const split = {
            walkMs,
            walkCalls,
            walkSkipped: walkOnce?.takeSkipped() ?? 0,
            systemsTimedMs: systemTimer.takeFrame(),
            projectMs: projectionTimer.takeFrame(),
          };
          walkMs = 0;
          walkCalls = 0;
          return split;
        });
      } finally {
        if (hadOwn) root.updateMatrixWorld = original;
        else delete (root as Partial<THREE.Scene>).updateMatrixWorld;
        systemTimer.restore();
        projectionTimer.restore();
      }
      let objects = 0;
      let hidden = 0;
      let meshes = 0;
      let hiddenMeshes = 0;
      root.traverse((object) => {
        objects++;
        const isMesh = (object as THREE.Mesh).isMesh === true;
        if (isMesh) meshes++;
        if (!object.visible) {
          hidden++;
          if (isMesh) hiddenMeshes++;
        }
      });
      const result: Record<string, number> = {
        frames: list.length,
        seconds: (performance.now() - startedAt) / 1000,
        objects,
        hidden,
        meshes,
        hiddenMeshes,
      };
      const series: Record<string, number[]> = {
        cpuMs: list.map((f) => f.cpuMs),
        renderMs: list.map((f) => f.renderMs),
        systemsMs: list.map((f) => f.cpuMs - f.renderMs),
        walkMs: list.map((f) => f.walkMs),
        walkCalls: list.map((f) => f.walkCalls),
        walkSkipped: list.map((f) => f.walkSkipped),
        systemsTimedMs: list.map((f) => f.systemsTimedMs),
        projectMs: list.map((f) => f.projectMs),
        drawCalls: list.map((f) => f.drawCalls),
        triangles: list.map((f) => f.triangles),
      };
      for (const [key, values] of Object.entries(series)) {
        result[key] = quantile(values, 0.5);
        result[`${key}P90`] = quantile(values, 0.9);
      }
      // Each system's median and mean per frame (the mean holds what the 5 µs clock rounds off)
      const systems: Record<string, { ms: number; meanMs: number }> = {};
      for (const { id, values } of systemTimer.series()) {
        systems[id] = {
          ms: quantile(values, 0.5),
          meanMs: values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length),
        };
      }
      const projection = Object.fromEntries(
        Object.entries(projectionTimer.series()).map(([kind, s]) => [
          kind,
          { ms: quantile(s.ms, 0.5), msP90: quantile(s.ms, 0.9), calls: quantile(s.calls, 0.5) },
        ])
      );
      return { ...result, systems, projection };
    },
    /**
     * `n` field groups (evenly spread by id) rebuilt one at a time: each one's frame that applied
     * it over the median frame before, and its wall time from the request. `members` only, and not
     * while the field is culled (the LOD's level 0 would stay the old geometry).
     */
    rebuildAsync: async (n: number) => {
      if (getFieldInfo().as !== 'members')
        throw new Error('rebuildAsync needs ?hlodFieldAs=members.');
      const objects = getFieldObjects(world);
      if (objects.some(({ entityId }) => world.hasComponent(entityId, ComponentType.LOD))) {
        throw new Error('The field is culled (setCull): setCull(0) first.');
      }
      const picked = Array.from(
        { length: Math.min(n, objects.length) },
        (_, i) => objects[Math.floor((i * objects.length) / Math.min(n, objects.length))]
      );
      const baseline = await collectFrames(BASELINE_FRAMES, () => ({}));
      const baselineCpuMs = quantile(
        baseline.map((f) => f.cpuMs),
        0.5
      );
      const baselineRenderMs = quantile(
        baseline.map((f) => f.renderMs),
        0.5
      );
      const builds = [];
      for (const { entityId, mesh, groupId } of picked) {
        const group = world.getComponent(entityId, ComponentType.MERGE_GROUP)!;
        const previous = mesh.geometry;
        const vertices = previous.getAttribute('position').count;
        const requestedAt = performance.now();
        const applied = await new Promise<{ frame: SpikeFrame; frames: number } | null>(
          (resolve) => {
            let frames = 0;
            const remove = hooks.onFrame((frame) => {
              frames++;
              if (mesh.geometry !== previous || frames >= REBUILD_TIMEOUT_FRAMES) {
                remove();
                resolve(mesh.geometry !== previous ? { frame: { ...frame }, frames } : null);
              }
            });
            rebuildMergeGroup(groupId!, world);
          }
        );
        builds.push({
          id: groupId!,
          members: group.members.length,
          vertices,
          onWorker: vertices > WORKER_BUILD_VERTICES,
          applied: applied !== null,
          frames: applied?.frames ?? NaN,
          wallMs: performance.now() - requestedAt,
          cpuMs: applied?.frame.cpuMs ?? NaN,
          renderMs: applied?.frame.renderMs ?? NaN,
          overMs: (applied?.frame.cpuMs ?? NaN) - baselineCpuMs,
        });
        await collectFrames(REBUILD_GAP_FRAMES, () => ({}));
      }
      const over = builds.map((b) => b.overMs);
      return {
        groups: objects.length,
        baselineCpuMs,
        baselineRenderMs,
        overMs: { median: quantile(over, 0.5), max: Math.max(...over) },
        builds,
      };
    },
  };
};
