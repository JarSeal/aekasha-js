import * as THREE from 'three/webgpu';
import {
  ComponentType,
  ECSSystemStage,
  createMaterial,
  createMeshEntity,
  createSeededRandom,
  getEntityIdByAppId,
  getGeometry,
  getRootScene,
  incGeometryRef,
  incMaterialRef,
  llog,
  lwarn,
  mergeGeometryParts,
  registerOnAllSceneExits,
  saveBufferGeometry,
} from 'aekasha';
import type { ECSWorld, MergePart } from 'aekasha';
import { createRuins, getRuinGeometries, getRuinMaterial, layoutRuins } from './largeWorldRuins';
import type { RuinMaterials, RuinPiece, RuinPieceKind, RuinSite } from './largeWorldRuins';

// p376 Phase 0 step 3 (docs/plans/p376_hlod-merged-cluster-proxies.md §3): `?hlodField=<sites>`
// adds that many ruin sites (`largeWorldRuins.ts`' kit) in a ring 200 m-1 km from the origin,
// past the 200 m terrain, on a flat ground of their own at y = 0: the kit-terrain far field p370
// §10 makes HLOD for. The overview camera's far plane goes to 3 km so the ring isn't clipped. The
// same field on every load (seeded).
//
// p377 Phase 0 (docs/plans/_DONE_p377_hlod-streaming-cell-proxies.md) draws the same pieces
// three ways:
// - `?hlodFieldCell=<m>`: the cell size (default 32), `AUTO`'s for `members`, the proxies' and
//   the instanced meshes' cells for the others (x/z, `Math.floor(coord / size)`, as `AUTO`'s).
// - `?hlodFieldAs=members` (default): every piece a mesh entity, merged `AUTO` (p376's field).
// - `?hlodFieldAs=proxy` (way 3): a cell's pieces of one material merged into one mesh entity
//   (`mergeGeometryParts`, registered as `hlodField:proxy:<cell size>:<material>:<cx>,<cz>`),
//   centred on its pieces' bounds as a group's mesh is; no member entities. What a group build of
//   the cell draws
//   (the same parts, matrices and material; `AUTO`'s vertex cap doesn't split any cell here, which
//   it checks), made directly rather than built and copied: a far layer loads a cell's proxy with
//   no members, so none is made.
// - `?hlodFieldAs=instanced` (today's far layer): a cell's pieces of one geometry and material as
//   one `InstancedMesh` entity, as streaming's `createFarGroupEntity` draws a cell's JSON far
//   entries (p353 D7): the kit's four geometries in three materials make four a cell.
// The probe (`src/app/shared/_dbg__hlodSpike.ts`) finds what the field draws through
// `window.__aekHlodField` (`HlodFieldInfo`), set on every load (undefined without a field).
//
// p378 Phase 0 (docs/plans/p378_baked-members-out-of-the-scene-graph.md) adds
// `?hlodFieldMembers=graph|detached|frozen` (default `graph`, today's), with or without a field:
// once every merge member of the world is built (the scene step's builds), each built baked
// member (`TAG_MERGED`, `partIndex >= 0`: the field's and largeWorld's own) is taken out of the
// scene graph (`detached`, `removeFromParent`; only one directly under the root scene with no
// children, D2's rule) or keeps its place with `matrixAutoUpdate` and `matrixWorldAutoUpdate` off
// (`frozen`), its world matrix composed first. The scene's exit puts them back. The bench waits for
// `window.__aekHlodMembers.applied` (`HlodMembersInfo`) before it measures.

const RING = { inner: 200, outer: 1000 };
const FIELD_SEED = 3760;
const DEFAULT_CELL_SIZE = 32;
const GROUND_SIZE = 2 * (RING.outer + 200);
const CAMERA_FAR = 3000;
/** `AUTO`'s default cap (`DEFAULT_AUTO_MAX_VERTICES`, merging's): a cell past it would be two
 * groups under `members`, so its proxy isn't the group's. */
const AUTO_MAX_VERTICES = 262_144;

/** How the field's pieces are drawn. */
export type HlodFieldAs = 'members' | 'proxy' | 'instanced';
const FIELD_AS: readonly HlodFieldAs[] = ['members', 'proxy', 'instanced'];

/** What the field made, for the probe (`window.__aekHlodField`). */
export type HlodFieldInfo = {
  sites: number;
  cellSize: number;
  as: HlodFieldAs;
  pieces: number;
  /** `members`: the pieces' entities (their groups are the field's groups) */
  memberIds: number[];
  /** `proxy` and `instanced`: the meshes' entities */
  objectIds: number[];
  /** `proxy` and `instanced`: the cells with pieces */
  cells: number;
  /** The field's creation on the main thread (ms): the pieces' entities, or the merges and meshes */
  createMs: number;
};

/** What happens to the built baked members' own meshes (p378 Phase 0). */
export type HlodFieldMembers = 'graph' | 'detached' | 'frozen';
const FIELD_MEMBERS: readonly HlodFieldMembers[] = ['graph', 'detached', 'frozen'];

/** The members mode's outcome, for the bench (`window.__aekHlodMembers`). */
export type HlodMembersInfo = {
  mode: HlodFieldMembers;
  /** null until applied; then the members taken out or frozen */
  applied: number | null;
  /** Built baked members left as they were: not directly under the root scene, or with children */
  skipped: number;
  /** Frames waited for the builds */
  frames: number;
};

type FieldWindow = Window & { __aekHlodField?: HlodFieldInfo; __aekHlodMembers?: HlodMembersInfo };

const MEMBERS_SYSTEM_ID = 'hlodField:members';
/** Frames to wait for every member's build before applying to the built ones (warned) */
const MEMBERS_TIMEOUT_FRAMES = 600;

/**
 * Whether the scene step's builds are done: the world has members (they join at the step, after
 * the scene code), each built (a baked part or a batched instance) and no longer held by the load
 * (the step lets go of its holds after its builds).
 */
const areMembersBuilt = (world: ECSWorld) => {
  const members = world.getStorage(ComponentType.MERGE_MEMBER);
  if (members.size === 0) return false;
  for (const [entityId, member] of members) {
    if (member.partIndex < 0 && member.instanceId < 0) return false;
    if (world.hasComponent(entityId, ComponentType.TAG_DRAW_HELD)) return false;
  }
  return true;
};

/**
 * `?hlodFieldMembers`: once the world's members are built, `detached` takes each built baked
 * member's mesh out of the scene graph and `frozen` turns its matrix updates off; the scene's exit
 * undoes it (before the entities are deleted). `graph` does nothing.
 */
const setUpMembersMode = (world: ECSWorld, mode: HlodFieldMembers) => {
  const fieldWindow = window as FieldWindow;
  const info: HlodMembersInfo = { mode, applied: null, skipped: 0, frames: 0 };
  fieldWindow.__aekHlodMembers = info;
  if (mode === 'graph') {
    info.applied = 0;
    return;
  }
  const rootScene = getRootScene();
  if (!rootScene) throw new Error('The members mode needs the root scene.');
  const changed: THREE.Object3D[] = [];

  const apply = () => {
    for (const [entityId, member] of world.getStorage(ComponentType.MERGE_MEMBER)) {
      if (member.partIndex < 0 || !world.hasComponent(entityId, ComponentType.TAG_MERGED)) continue;
      const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
      if (!object) continue;
      if (object.parent !== rootScene || object.children.length > 0) {
        info.skipped++;
        continue;
      }
      // Its world matrix as the walk would leave it, then nothing composes it again
      object.updateWorldMatrix(true, false);
      if (mode === 'detached') object.removeFromParent();
      else {
        object.matrixAutoUpdate = false;
        object.matrixWorldAutoUpdate = false;
      }
      changed.push(object);
    }
    info.applied = changed.length;
    llog(
      `[HLOD spike] Members ${mode}: ${changed.length} baked members${info.skipped ? ` (${info.skipped} skipped: another parent or children)` : ''}, after ${info.frames} frame(s).`
    );
  };

  world.addSystem(
    ECSSystemStage.MAIN,
    MEMBERS_SYSTEM_ID,
    () => {
      info.frames++;
      const built = areMembersBuilt(world);
      if (!built && info.frames < MEMBERS_TIMEOUT_FRAMES) return;
      if (!built) {
        lwarn(
          `[HLOD spike] Not every merge member was built after ${MEMBERS_TIMEOUT_FRAMES} frames: the members mode applies to the built ones.`
        );
      }
      world.removeSystem(MEMBERS_SYSTEM_ID);
      apply();
    },
    1e9
  );

  registerOnAllSceneExits(MEMBERS_SYSTEM_ID, () => {
    world.removeSystem(MEMBERS_SYSTEM_ID);
    for (const object of changed) {
      if (mode === 'detached') {
        if (!object.parent) rootScene.add(object);
      } else {
        object.matrixAutoUpdate = true;
        object.matrixWorldAutoUpdate = true;
      }
    }
    // A later scene's exit finds nothing to undo
    changed.length = 0;
  });
};

/** `count` sites spread evenly over the ring's area, each 4-7 × 3-5 tiles, turned at random. */
const createFieldSites = (count: number): RuinSite[] => {
  const random = createSeededRandom(FIELD_SEED);
  const inner2 = RING.inner * RING.inner;
  const outer2 = RING.outer * RING.outer;
  return Array.from({ length: count }, () => {
    const radius = Math.sqrt(inner2 + random() * (outer2 - inner2));
    const theta = random() * Math.PI * 2;
    return {
      x: Math.cos(theta) * radius,
      z: Math.sin(theta) * radius,
      cols: 4 + Math.floor(random() * 4),
      rows: 3 + Math.floor(random() * 3),
      angle: random() * Math.PI,
    };
  });
};

const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();

/** A piece's world matrix, as its mesh entity's would be. */
const getPieceMatrix = (piece: RuinPiece, target = new THREE.Matrix4()) => {
  const { position: p, rotation: r, scale: s } = piece;
  _position.set(p.x, p.y, p.z);
  _quaternion.setFromEuler(_euler.set(r.x ?? 0, r.y ?? 0, r.z ?? 0));
  _scale.set(s?.x ?? 1, s?.y ?? 1, s?.z ?? 1);
  return target.compose(_position, _quaternion, _scale);
};

/** The pieces by cell (`cx,cz`) and then by `key(piece)`, in creation order. */
const bucketByCell = (pieces: RuinPiece[], cellSize: number, key: (piece: RuinPiece) => string) => {
  const cells = new Map<string, Map<string, RuinPiece[]>>();
  for (const piece of pieces) {
    const cell = `${Math.floor(piece.position.x / cellSize)},${Math.floor(piece.position.z / cellSize)}`;
    const byKey = cells.get(cell) ?? new Map<string, RuinPiece[]>();
    cells.set(cell, byKey);
    const list = byKey.get(key(piece)) ?? [];
    byKey.set(key(piece), list);
    list.push(piece);
  }
  return cells;
};

/** `proxy`: a cell's pieces of one material as one merged mesh entity, centred on their bounds. */
const createProxies = (
  world: ECSWorld,
  pieces: RuinPiece[],
  cellSize: number,
  materials: RuinMaterials
) => {
  const geometries = getRuinGeometries();
  const materialKey = (piece: RuinPiece) =>
    piece.kind === 'floor' ? 'platform' : piece.kind === 'rubble' ? 'rock' : 'wall';
  const cells = bucketByCell(pieces, cellSize, materialKey);
  const ids: number[] = [];
  const bounds = new THREE.Box3();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  for (const [cell, byMaterial] of cells) {
    for (const [material, list] of byMaterial) {
      const matrices = list.map((piece) => getPieceMatrix(piece));
      bounds.makeEmpty();
      let vertices = 0;
      list.forEach((piece, i) => {
        const geometry = geometries[piece.kind];
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        bounds.union(box.copy(geometry.boundingBox!).applyMatrix4(matrices[i]));
        vertices += geometry.getAttribute('position').count;
      });
      if (vertices > AUTO_MAX_VERTICES) {
        lwarn(
          `[HLOD spike] Cell ${cell}'s ${material} proxy has ${vertices} vertices, past AUTO's cap: members would draw it as more than one group.`
        );
      }
      bounds.getCenter(centre);
      const toProxy = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
      const parts: MergePart[] = list.map((piece, i) => ({
        geo: geometries[piece.kind],
        matrix: matrices[i].premultiply(toProxy),
      }));
      // A reload of the scene in the same page finds it registered (the same pieces)
      const id = `hlodField:proxy:${cellSize}:${material}:${cell}`;
      if (!getGeometry(id)) saveBufferGeometry(mergeGeometryParts(parts), { id });
      ids.push(
        createMeshEntity(
          {
            geo: id,
            mat: getRuinMaterial(list[0].kind, materials),
            castShadow: true,
            receiveShadow: true,
            position: { x: centre.x, y: centre.y, z: centre.z },
          },
          { debugData: { name: `HLOD field proxy ${material} ${cell}` }, world }
        )
      );
    }
  }
  return { ids, cells: cells.size };
};

/** `instanced`: a cell's pieces of one geometry (so one material) as one `InstancedMesh` entity,
 * made as `createFarGroupEntity` makes a far group's. */
const createInstancedCells = (
  world: ECSWorld,
  pieces: RuinPiece[],
  cellSize: number,
  materials: RuinMaterials
) => {
  const geometries = getRuinGeometries();
  const cells = bucketByCell(pieces, cellSize, (piece) => piece.kind);
  const rootScene = getRootScene();
  if (!rootScene) throw new Error('The HLOD field needs the root scene.');
  const ids: number[] = [];
  const matrix = new THREE.Matrix4();
  for (const [cell, byKind] of cells) {
    for (const [kind, list] of byKind) {
      const geometry = geometries[kind as RuinPieceKind];
      const material = getRuinMaterial(kind as RuinPieceKind, materials);
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((piece, i) => mesh.setMatrixAt(i, getPieceMatrix(piece, matrix)));
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `HLOD field ${kind} ${cell}`;
      // The mesh tag's delete hook releases both
      if (geometry.userData.id) incGeometryRef(geometry.userData.id as string);
      if (material.userData.id) incMaterialRef(material.userData.id as string);
      const entityId = world.createEntity();
      mesh.userData.entityId = entityId;
      world.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
      world.addComponent(entityId, ComponentType.TAG_IS_MESH, true);
      rootScene.add(mesh);
      ids.push(entityId);
    }
  }
  return { ids, cells: cells.size };
};

/** The field's URL settings: its sites (0 for none), its cell size and how it's drawn. */
const readFieldParams = () => {
  const params = new URLSearchParams(window.location.search);
  const sites = Math.floor(Number(params.get('hlodField')));
  const cell = Number(params.get('hlodFieldCell') ?? DEFAULT_CELL_SIZE);
  const as = (params.get('hlodFieldAs') ?? 'members') as HlodFieldAs;
  const members = (params.get('hlodFieldMembers') ?? 'graph') as HlodFieldMembers;
  if (!(cell > 0) || !FIELD_AS.includes(as) || !FIELD_MEMBERS.includes(members)) {
    throw new Error(
      `[HLOD spike] ?hlodFieldCell must be a size over 0, ?hlodFieldAs one of ${FIELD_AS.join(', ')} and ?hlodFieldMembers one of ${FIELD_MEMBERS.join(', ')} (got ${String(params.get('hlodFieldCell'))}, ${as}, ${members}).`
    );
  }
  return { sites: sites > 0 ? sites : 0, cellSize: cell, as, members };
};

/** With `?hlodField=<sites>`: the far field, its ground and the camera's far plane; else nothing.
 * `?hlodFieldMembers` either way. */
export const createHlodField = (world: ECSWorld, materials: RuinMaterials) => {
  const fieldWindow = window as FieldWindow;
  fieldWindow.__aekHlodField = undefined;
  const { sites: count, cellSize, as, members } = readFieldParams();
  setUpMembersMode(world, members);
  if (count === 0) return;

  // The ground: its top just under the terrain's lowest point (0), so the terrain covers it
  createMeshEntity(
    {
      geo: { type: 'BOX', params: { width: GROUND_SIZE, height: 0.2, depth: GROUND_SIZE } },
      mat: createMaterial({
        id: 'largeWorldHlodFieldGroundMat',
        type: 'PHONG',
        params: { color: '#55784a' },
      }),
      receiveShadow: true,
      position: { x: 0, y: -0.15, z: 0 },
    },
    { appId: 'largeWorldHlodFieldGround', debugData: { name: 'HLOD field ground' }, world }
  );

  const sites = createFieldSites(count);
  const startedAt = performance.now();
  let memberIds: number[] = [];
  let made = { ids: [] as number[], cells: 0 };
  let pieces: number;
  if (as === 'members') {
    memberIds = createRuins(world, () => 0, materials, {
      sites,
      seed: FIELD_SEED,
      merge: { group: 'AUTO', cellSize },
    });
    pieces = memberIds.length;
  } else {
    const layout = layoutRuins(() => 0, { sites, seed: FIELD_SEED });
    pieces = layout.length;
    made =
      as === 'proxy'
        ? createProxies(world, layout, cellSize, materials)
        : createInstancedCells(world, layout, cellSize, materials);
  }
  const createMs = performance.now() - startedAt;

  const cameraId = getEntityIdByAppId('largeWorldOverview', world);
  const camera =
    cameraId === undefined
      ? undefined
      : (world.getComponent(cameraId, ComponentType.OBJECT3D)?.value as
          | THREE.PerspectiveCamera
          | undefined);
  if (camera?.isPerspectiveCamera) {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }
  fieldWindow.__aekHlodField = {
    sites: count,
    cellSize,
    as,
    pieces,
    memberIds,
    objectIds: made.ids,
    cells: made.cells,
    createMs,
  };
  llog(
    `[HLOD spike] Far field: ${count} ruin sites ${RING.inner}-${RING.outer} m out, ${pieces} pieces as ${as} in ${cellSize} m cells${as === 'members' ? ' (AUTO)' : `: ${made.ids.length} meshes in ${made.cells} cells`}, ${createMs.toFixed(0)} ms; camera far ${camera ? CAMERA_FAR : '(no overview camera)'}.`
  );
};
