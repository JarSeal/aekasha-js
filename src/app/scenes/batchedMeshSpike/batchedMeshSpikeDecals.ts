import * as THREE from 'three/webgpu';
import {
  ComponentType,
  ECSSystemStage,
  createMaterial,
  createMeshEntity,
  createSeededRandom,
  decGeometryRef,
  incGeometryRef,
  saveBufferGeometry,
  saveMaterial,
} from 'aekasha';
import type { ECSWorld } from 'aekasha';
import {
  addToMergeGroup,
  createMergeGroup,
  setMergeMemberColor,
  updateMergeMember,
} from 'aekasha/merging';
import type { MergeTransparentOrder } from 'aekasha/merging';
import { generateTerrain } from 'aekasha/toolkit/geometry';

// p375 Phase 3 S5's decal stand-in (docs/plans/_DONE_p375_batched-mesh-batches.md; p309 D4's runtime
// pools, before p309 exists): `?bmsDecals=blend|cutout` replaces the spike's field with a
// heightfield ground (the toolkit's `generateTerrain`, its `getHeightAt` standing in for p306's
// block grid) and a FIFO pool of decals, each a k × k grid patch conformed to the ground around
// its centre (its entity's place), spawned along a seeded walk: footprints left and right of it
// and wider splats, overlapping. The pool's oldest quarter fades out by its place in the FIFO
// (opacity), each decal has a seeded tint.
// - SEPARATE: a mesh entity per decal, each with its own clone of the material (three has no
//   per-mesh opacity otherwise) and a `renderOrder` rising per spawn (`JOIN`'s order: the newest
//   on top);
// - ENGINE: the decals in one explicit `BATCHED` merge group (`geometryReserve` for the largest
//   patch, `transparentOrder` from `?bmsDecalOrder`), tint and fade by `setMergeMemberColor`.
// `?bmsDecalSpawn=rewrite` (default; the pool p309 would use) keeps the pool's entities and gives
// the oldest the next decal: ENGINE writes its patch into its geometry and `updateMergeMember`
// rewrites its slot (and puts it last in the join order); SEPARATE gives its mesh a new geometry
// and disposes the old (a GPU buffer is sized to its geometry). `entity` deletes the oldest
// decal's entity and creates one (ENGINE: its slot freed, the new patch reusing it by fit). The
// load spawns the pool full; the first frame (once the engine's batch is built) spawns half a pool
// more, so the FIFO has wrapped and the fades are in their steady pattern: with
// `?bmsDecalRate=0` the picture is the same on every load (the scene runner's and the bench's
// pixel diffs). The spawner is a MAIN system ahead of the kernel's Object3D sync, so a respawned
// decal's pose and patch are drawn in the same frame.

const DECAL_GROUP_ID = 'bmsDecals';
const SPAWNER_ID = 'bmsDecalSpawner';
/** Before the kernel's MAIN systems (object3DSyncSystem: 0), after the probe's frame start */
const SPAWNER_ORDER = 1e8;
/** The ground: its size, cells and noise */
const GROUND_SIZE = 64;
const GROUND_SEGMENTS = 128;
/** The walk's reach from the centre, metres */
const WALK_REACH = 24;
/** A patch's lift along the ground's normal, metres */
const LIFT = 0.02;
/** A patch's cells along a side at most: (MAX_K + 1)² vertices, MAX_K² × 6 indices */
const MAX_K = 8;
/** Decals drawn after the ground (p309's band) */
const DECAL_RENDER_ORDER = 10;
/** The share of the pool (its oldest) that fades out */
const FADE_SHARE = 0.25;
/** Spawns a frame at most (a stalled frame doesn't burst) */
const MAX_SPAWNS_PER_FRAME = 8;
const TINTS = ['#6b4f3a', '#3f3a34', '#8a7456', '#4f5b3a', '#7a3f2c'];

export type BmsDecalMode = 'NONE' | 'BLEND' | 'CUTOUT';
export type BmsDecalSpawn = 'REWRITE' | 'ENTITY';

/** The decals' settings, from the URL at every load */
export const bmsDecalSettings = {
  mode: 'NONE' as BmsDecalMode,
  pool: 128,
  /** Spawns a second after the load's (app loop time); 0: none */
  rate: 30,
  order: 'JOIN' as MergeTransparentOrder,
  spawn: 'REWRITE' as BmsDecalSpawn,
};

const pick = <T extends string>(value: string | null, options: readonly T[]) =>
  options.find((option) => option === value?.toUpperCase());

/** Reads `?bmsDecals`, `?bmsDecalPool`, `?bmsDecalRate`, `?bmsDecalOrder` and `?bmsDecalSpawn` */
export const readBmsDecalSettings = (params: URLSearchParams) => {
  const s = bmsDecalSettings;
  s.mode = pick(params.get('bmsDecals'), ['BLEND', 'CUTOUT'] as const) ?? 'NONE';
  const pool = Number(params.get('bmsDecalPool'));
  s.pool = pool > 0 ? Math.min(Math.round(pool), 4096) : 128;
  const rate = params.get('bmsDecalRate');
  s.rate = rate !== null && Number(rate) >= 0 ? Number(rate) : 30;
  s.order = pick(params.get('bmsDecalOrder'), ['JOIN', 'DEPTH'] as const) ?? 'JOIN';
  s.spawn = pick(params.get('bmsDecalSpawn'), ['REWRITE', 'ENTITY'] as const) ?? 'REWRITE';
};

/** A pool place: its decal's entity, geometry and (SEPARATE) material, and what was written */
type DecalSlot = {
  entityId: number;
  geometry: THREE.BufferGeometry;
  geometryId: string;
  material: THREE.Material & { color: THREE.Color; opacity: number };
  opacity: number;
};

/** What the load built, for the debug module */
export const bmsDecalState = {
  slots: [] as DecalSlot[],
  /** The pool place the next spawn takes (its oldest once the pool is full) */
  next: 0,
  spawned: 0,
  /** The spawner's last frame: its time (ms) and spawns */
  frameMs: 0,
  frameSpawns: 0,
  /** Whether the first frame's half pool was spawned */
  isWarm: false,
  /** Spawns `count` decals now: the patch builds' time and the whole's (ms) */
  spawnNow: null as ((count: number) => { ms: number; patchMs: number }) | null,
};

/** An entity of the engine's decal group (the pool's first place), else undefined */
export const getBmsDecalEntity = () => bmsDecalState.slots[0]?.entityId;

type Ground = ReturnType<typeof generateTerrain>;
type DecalSpec = { x: number; z: number; yaw: number; size: number; k: number; tint: string };

/** The decal texture: a soft blob with speckles in its alpha, the colour light grey (the tint's) */
const createDecalTexture = () => {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const random = createSeededRandom(3091);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const edge = Math.min(1, Math.max(0, (1 - r) / 0.35));
      const speckle = 0.7 + random() * 0.3;
      const i = (y * size + x) * 4;
      const grey = Math.round(220 + random() * 35);
      data[i] = data[i + 1] = data[i + 2] = grey;
      data[i + 3] = Math.round(255 * edge * speckle);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

/** The decal material: `BLEND` (transparent, no depth write) or `CUTOUT` (alpha test), polygon
 * offset against the ground either way (p309 D2) */
const createDecalMaterial = (mode: BmsDecalMode, map: THREE.Texture) =>
  new THREE.MeshStandardNodeMaterial({
    map,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    ...(mode === 'BLEND' ? { transparent: true, depthWrite: false } : { alphaTest: 0.5 }),
  });

/** The seeded walk: each spawn a step along a Lissajous path over the ground; 7 in 10 a footprint
 * beside it (left and right in turn), else a wider splat near it */
const createWalker = () => {
  const random = createSeededRandom(309);
  let s = 0;
  let side = 1;
  return (): DecalSpec => {
    s += 0.45;
    const x = WALK_REACH * Math.sin(0.11 * s);
    const z = WALK_REACH * Math.sin(0.17 * s + 1.3);
    const heading = Math.atan2(0.11 * Math.cos(0.11 * s), 0.17 * Math.cos(0.17 * s + 1.3));
    const isFootprint = random() < 0.7;
    const a = random();
    const b = random();
    const tint = TINTS[Math.floor(random() * TINTS.length)];
    const size = isFootprint ? 0.6 + a * 0.3 : 1.5 + a * 1.5;
    const spacing = size < 1 ? 0.25 : 0.5;
    const k = Math.min(MAX_K, Math.max(2, Math.ceil(size / spacing)));
    if (isFootprint) {
      side = -side;
      return {
        x: x + Math.cos(heading) * 0.35 * side,
        z: z - Math.sin(heading) * 0.35 * side,
        yaw: heading + (b - 0.5) * 0.4,
        size,
        k,
        tint,
      };
    }
    return { x: x + (b - 0.5) * 3, z: z + (a - 0.5) * 3, yaw: b * Math.PI * 2, size, k, tint };
  };
};

/** Writes a decal's patch into `geometry` (new attributes: a patch's size varies), local to its
 * centre on the ground, lifted along the ground's normal; returns the centre's height. */
const writePatch = (geometry: THREE.BufferGeometry, spec: DecalSpec, ground: Ground) => {
  const { x: cx, z: cz, yaw, size, k } = spec;
  const h = ground.getHeightAt;
  const n = k + 1;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const index = new Uint16Array(k * k * 6);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const cy = h(cx, cz);
  const e = 0.25;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ox = (i / k - 0.5) * size;
      const oz = (j / k - 0.5) * size;
      const lx = ox * cos + oz * sin;
      const lz = -ox * sin + oz * cos;
      const x = cx + lx;
      const z = cz + lz;
      let nx = -(h(x + e, z) - h(x - e, z)) / (2 * e);
      let nz = -(h(x, z + e) - h(x, z - e)) / (2 * e);
      const length = Math.sqrt(nx * nx + 1 + nz * nz);
      nx /= length;
      const ny = 1 / length;
      nz /= length;
      const v = j * n + i;
      positions[v * 3] = lx + LIFT * nx;
      positions[v * 3 + 1] = h(x, z) - cy + LIFT * ny;
      positions[v * 3 + 2] = lz + LIFT * nz;
      normals[v * 3] = nx;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = nz;
      uvs[v * 2] = i / k;
      uvs[v * 2 + 1] = j / k;
    }
  }
  let w = 0;
  for (let j = 0; j < k; j++) {
    for (let i = 0; i < k; i++) {
      const a = j * n + i;
      const c = a + n;
      // Facing up (+y), whatever the yaw
      index[w++] = a;
      index[w++] = c;
      index[w++] = a + 1;
      index[w++] = a + 1;
      index[w++] = c;
      index[w++] = c + 1;
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return cy;
};

/** A FIFO place's opacity: 1, then down to 1 / (band + 1) over the oldest `FADE_SHARE` */
const getOpacity = (age: number, pool: number) => {
  const band = Math.max(1, Math.round(pool * FADE_SHARE));
  const fromEnd = pool - age;
  return fromEnd > band ? 1 : fromEnd / (band + 1);
};

/**
 * Builds the decal stand-in: the ground, the pool (spawned full) and the spawner (removed on the
 * scene's exit through `onExit`). `way` is the spike's (SEPARATE or ENGINE).
 */
export const createBmsDecals = (
  world: ECSWorld,
  way: 'SEPARATE' | 'ENGINE',
  onExit: (fn: () => void) => void
) => {
  const { mode, pool, spawn: spawnMode, order } = bmsDecalSettings;
  const isEngine = way === 'ENGINE';
  const state = bmsDecalState;
  state.slots = [];
  state.next = 0;
  state.spawned = 0;
  state.frameMs = 0;
  state.frameSpawns = 0;
  state.isWarm = false;

  const ground = generateTerrain({
    width: GROUND_SIZE,
    depth: GROUND_SIZE,
    widthSegments: GROUND_SEGMENTS,
    depthSegments: GROUND_SEGMENTS,
    maxHeight: 3,
    noiseOctaves: [
      { frequency: 1 / 30, amplitude: 1 },
      { frequency: 1 / 9, amplitude: 0.3 },
    ],
    seed: 309,
  });
  createMeshEntity({
    geo: saveBufferGeometry(ground.geometry, { id: 'bmsGround' }),
    mat: createMaterial({
      id: 'bmsGroundMat',
      type: 'STANDARD',
      params: { color: '#8c9a6a', roughness: 0.95, metalness: 0 },
    }),
  });

  const texture = createDecalTexture();
  onExit(() => texture.dispose());
  const base = saveMaterial(
    createDecalMaterial(mode, texture),
    'bmsDecalMat'
  ) as DecalSlot['material'];
  if (isEngine) {
    createMergeGroup({
      id: DECAL_GROUP_ID,
      mode: 'BATCHED',
      castShadow: false,
      receiveShadow: false,
      geometryReserve: { vertices: (MAX_K + 1) ** 2, indices: MAX_K * MAX_K * 6 },
      transparentOrder: order,
    });
  }

  const nextSpec = createWalker();
  let geometrySeq = 0;
  let patchMs = 0;
  /** A new geometry with the spec's patch, registered; the centre's height */
  const createPatch = (spec: DecalSpec) => {
    const start = performance.now();
    const geometry = new THREE.BufferGeometry();
    const y = writePatch(geometry, spec, ground);
    patchMs += performance.now() - start;
    const geometryId = `bmsDecal${geometrySeq++}`;
    saveBufferGeometry(geometry, { id: geometryId });
    return { geometry, geometryId, y };
  };
  /** A decal's entity at the spec's centre (ENGINE: joining the pool's group at once, so its
   * colour can be set before its build; its `renderOrder` first, which the join checks) */
  const createDecalEntity = (
    spec: DecalSpec,
    patch: { geometry: THREE.BufferGeometry; y: number },
    material: THREE.Material
  ) => {
    const entityId = createMeshEntity({
      geo: patch.geometry,
      mat: material,
      position: { x: spec.x, y: patch.y, z: spec.z },
    });
    setRenderOrder(entityId, DECAL_RENDER_ORDER + (isEngine ? 0 : state.spawned));
    if (isEngine) addToMergeGroup(DECAL_GROUP_ID, [entityId], world);
    return entityId;
  };
  const setRenderOrder = (entityId: number, renderOrder: number) => {
    const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    if (object) object.renderOrder = renderOrder;
  };
  /** The decal's tint and opacity, written on a change */
  const writeLook = (slot: DecalSlot, tint: string | null, opacity: number) => {
    if (tint === null && opacity === slot.opacity) return;
    slot.opacity = opacity;
    if (isEngine) {
      setMergeMemberColor(
        slot.entityId,
        tint === null ? { opacity } : { color: tint, opacity },
        world
      );
    } else {
      if (tint !== null) slot.material.color.set(tint);
      slot.material.opacity = opacity;
    }
  };

  /** One decal: a new pool place until the pool is full, then its oldest place's */
  const spawnOne = () => {
    const spec = nextSpec();
    const place = state.next;
    state.next = (state.next + 1) % pool;
    const old = state.slots[place];
    if (!old) {
      const patch = createPatch(spec);
      const material = isEngine
        ? base
        : (saveMaterial(base.clone(), `bmsDecalMat${place}`) as DecalSlot['material']);
      const slot: DecalSlot = {
        entityId: createDecalEntity(spec, patch, material),
        geometry: patch.geometry,
        geometryId: patch.geometryId,
        material,
        opacity: -1,
      };
      state.slots[place] = slot;
      writeLook(slot, spec.tint, 1);
    } else if (spawnMode === 'ENTITY') {
      // The new decal first: its mesh takes a ref on the material the old one leaves
      const patch = createPatch(spec);
      const entityId = createDecalEntity(spec, patch, old.material);
      world.deleteEntity(old.entityId);
      old.entityId = entityId;
      old.geometry = patch.geometry;
      old.geometryId = patch.geometryId;
      old.opacity = -1;
      writeLook(old, spec.tint, 1);
    } else if (isEngine) {
      const start = performance.now();
      const y = writePatch(old.geometry, spec, ground);
      patchMs += performance.now() - start;
      world.setTransform(old.entityId, { pos: { x: spec.x, y, z: spec.z } });
      updateMergeMember(old.entityId, world);
      writeLook(old, spec.tint, 1);
    } else {
      const patch = createPatch(spec);
      const mesh = world.getComponent(old.entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;
      incGeometryRef(patch.geometryId);
      mesh.geometry = patch.geometry;
      decGeometryRef(old.geometryId);
      old.geometry = patch.geometry;
      old.geometryId = patch.geometryId;
      world.setTransform(old.entityId, { pos: { x: spec.x, y: patch.y, z: spec.z } });
      setRenderOrder(old.entityId, DECAL_RENDER_ORDER + state.spawned);
      writeLook(old, spec.tint, 1);
    }
    state.spawned++;
  };
  /** The fades: each place's opacity by its age in the FIFO (0 the newest) */
  const writeFades = () => {
    const filled = state.slots.length;
    for (let place = 0; place < filled; place++) {
      const age = (state.next - 1 - place + pool) % pool;
      writeLook(state.slots[place], null, filled < pool ? 1 : getOpacity(age, pool));
    }
  };
  const spawnNow = (count: number) => {
    const start = performance.now();
    patchMs = 0;
    for (let i = 0; i < count; i++) spawnOne();
    writeFades();
    return { ms: performance.now() - start, patchMs };
  };
  state.spawnNow = spawnNow;

  // The load's: the pool full
  spawnNow(pool);

  let owed = 0;
  world.addSystem(
    ECSSystemStage.MAIN,
    SPAWNER_ID,
    (_world, dt) => {
      const start = performance.now();
      let spawns = 0;
      if (!state.isWarm) {
        // Half a pool more once the engine's batch holds the pool (its join order then the
        // spawns'), so the FIFO has wrapped
        const first = state.slots[0];
        const member = first && world.getComponent(first.entityId, ComponentType.MERGE_MEMBER);
        if (!isEngine || (member && member.instanceId >= 0)) {
          state.isWarm = true;
          spawns = Math.ceil(pool / 2);
          spawnNow(spawns);
        }
      } else if (bmsDecalSettings.rate > 0) {
        owed = Math.min(owed + dt * bmsDecalSettings.rate, MAX_SPAWNS_PER_FRAME);
        if (owed >= 1) {
          spawns = Math.floor(owed);
          owed -= spawns;
          for (let i = 0; i < spawns; i++) spawnOne();
          writeFades();
        }
      }
      state.frameSpawns = spawns;
      state.frameMs = performance.now() - start;
    },
    SPAWNER_ORDER
  );
  onExit(() => {
    world.removeSystem(SPAWNER_ID);
    state.spawnNow = null;
  });
};
