// The terrain gallery's Structures row (p305 Phase 7, D8): structure materials
// (`createStructureMaterial`: the terrain material, triplanar, dual-scale anti-tiling, a 12 m macro)
// on pieces made in code, in front of the Colour map row. A wall of two 8 m segments in `WORLD`
// space (static: the concrete runs on across the joint), a bunker's passage piece turned 25° in
// `OBJECT` space (the texture follows the piece), both worn by their vertex colour (`RGBA`: clean
// `concrete01`, stained `concrete02`, grime `mud01` at the foot, damage `rocks02`, the weights
// painted in code); and two pillars turning and rising, `concrete02` in `OBJECT` space beside
// `WORLD` (the texture sticks to one and slides over the other). The pillars are a unit box scaled
// into shape, so the object space's scale is checked too. They move on the scene's looper, which
// the tab pauses. `decalsStructure`'s leaks (p310) run down the wall's front and the bunker's
// (`decalsStructure_blend`, the Decals stage's quads).
import * as THREE from 'three/webgpu';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import {
  createMeshEntity,
  createSceneMainLooper,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  getMeshByAppId,
  remapUVsToAtlasCell,
  saveBufferGeometry,
  setMeshMaterial,
} from 'aekasha';
import {
  createStructureMaterial,
  type TerrainLayer,
  type TerrainMaterialConfig,
} from 'aekasha/toolkit/terrain';
import { COLOR_MAP_ROW_BOUNDS } from './colorMapRow';
import { BLOCK_GAP, NO_SHADOWS, type GalleryDebugView } from './galleryBlocks';
import { DECAL_RENDER_ORDER, getDecalCellSize, getDecalQuadGeometry } from './decalsStage';

/** The spaces a structure material samples in */
type TerrainSpace = NonNullable<TerrainMaterialConfig['space']>;

/** The row's pieces */
export const STRUCTURES_KEYS = ['WALL', 'BUNKER', 'MOVING_OBJECT', 'MOVING_WORLD'] as const;
/** One of {@link STRUCTURES_KEYS} */
export type StructuresKey = (typeof STRUCTURES_KEYS)[number];

/** A piece of the row: what it shows and where it stands (its centre on the ground) */
export type StructuresPiece = {
  key: StructuresKey;
  title: string;
  description: string;
  space: TerrainSpace;
  x: number;
  z: number;
};

const DESCRIPTIONS: Record<StructuresKey, [string, string]> = {
  WALL: [
    'Wall, world space',
    'Two 8 m segments, worn by their vertex colour (RGBA, 4 layers): the concrete runs on across the joint',
  ],
  BUNKER: [
    'Bunker, object space',
    'A passage piece turned 25°, worn by its vertex colour: the texture follows the piece',
  ],
  MOVING_OBJECT: [
    'Moving, object space',
    'concrete02 on a turning, rising pillar (a scaled unit box): the texture sticks to it',
  ],
  MOVING_WORLD: [
    'Moving, world space',
    'The same pillar in world space: the texture slides over it',
  ],
};

const SPACES: Record<StructuresKey, TerrainSpace> = {
  WALL: 'WORLD',
  BUNKER: 'OBJECT',
  MOVING_OBJECT: 'OBJECT',
  MOVING_WORLD: 'WORLD',
};

/** The gallery's ground top (`terrainGallery.ts`' `GROUND_Y`) */
const GROUND_TOP_Y = -0.6;

/** The wall's segments: 8 m long, 4 m high, 0.6 m thick, 0.25 m between vertices */
const WALL = { length: 8, height: 4, thickness: 0.6, segments: [32, 16, 2] as const };
/** How far a piece's foot sinks below the ground's top, metres */
const SINK = 0.1;
/**
 * The bunker's profile (x across, y up, metres): 8 m wide at the foot, its sides sloping in to a
 * 5.2 m roof 3 m up, a 1.8 × 2.2 m doorway through it; extruded 6 m deep
 */
const BUNKER_PROFILE: [number, number][] = [
  [-4, 0],
  [-0.9, 0],
  [-0.9, 2.2],
  [0.9, 2.2],
  [0.9, 0],
  [4, 0],
  [3.4, 2.4],
  [2.6, 3],
  [-2.6, 3],
  [-3.4, 2.4],
];
const BUNKER_DEPTH = 6;
const BUNKER_TURN = THREE.MathUtils.degToRad(25);
/** The tessellation's longest edge: the wear's vertex spacing on the bunker, metres */
const BUNKER_EDGE = 0.35;
/** The pillars: a unit box scaled into a 1.4 × 4 × 1.4 m pillar */
const PILLAR_SCALE = { x: 1.4, y: 4, z: 1.4 };
/** Their motion: a turn a 16 s, a 1.2 m rise and fall every 6 s about their rest height */
const PILLAR_TURN_SPEED = (2 * Math.PI) / 16;
const PILLAR_RISE = { amplitude: 0.6, period: 6 };
const PILLAR_REST_Y = GROUND_TOP_Y + PILLAR_SCALE.y / 2 + PILLAR_RISE.amplitude + 0.2;

const WALL_GEOMETRY_ID = 'terrainGalleryStructuresWall';
const BUNKER_GEOMETRY_ID = 'terrainGalleryStructuresBunker';
const PILLAR_GEOMETRY_ID = 'terrainGalleryStructuresPillar';

/** The worn pieces' layers: clean, stained, grime at the foot, damage (R, G, B weigh 1-3) */
const WEAR_LAYERS: TerrainLayer[] = [
  { set: 'concrete01' },
  { set: 'concrete02' },
  { set: 'mud01' },
  { set: 'rocks02' },
];
const MOVING_SET = 'concrete02';

/** Where the row stands: in front of the Colour map row (+z) */
const ROW_NEAR_Z = COLOR_MAP_ROW_BOUNDS.maxZ + 2 * BLOCK_GAP;
const ROW_DEPTH = 16;
const ROW_Z = ROW_NEAR_Z + ROW_DEPTH / 2;
const PIECE_X: Record<StructuresKey, number> = {
  WALL: -24,
  BUNKER: 0,
  MOVING_OBJECT: 18,
  MOVING_WORLD: 26,
};

/** The four pieces, left to right */
export const STRUCTURES_PIECES: readonly StructuresPiece[] = STRUCTURES_KEYS.map((key) => ({
  key,
  title: DESCRIPTIONS[key][0],
  description: DESCRIPTIONS[key][1],
  space: SPACES[key],
  x: PIECE_X[key],
  z: ROW_Z,
}));

/** The row's extent on the ground, for the gallery's ground */
export const STRUCTURES_ROW_BOUNDS = {
  minX: PIECE_X.WALL - WALL.length - BLOCK_GAP,
  maxX: PIECE_X.MOVING_WORLD + BLOCK_GAP,
  minZ: ROW_NEAR_Z,
  maxZ: ROW_NEAR_Z + ROW_DEPTH,
};

/** The row's state: the view its materials show, whether the pillars move */
const rowState = { debugView: 'NONE' as GalleryDebugView, isMoving: true };

/** A piece's mesh entities' app ids: the wall's two segments, the others' one */
export const getStructuresAppIds = (key: StructuresKey) =>
  key === 'WALL'
    ? [`terrainGallery_structures_${key}_0`, `terrainGallery_structures_${key}_1`]
    : [`terrainGallery_structures_${key}`];

/**
 * The leak decals (p310 §2.1 row I): `decalsStructure`'s three leaks under the wall's top, across
 * its joint, and two beside the bunker's doorway under its roof, smaller (the front narrows to
 * the roof). Each its cell, its centre on the piece's front face (the wall's x, the bunker's own x
 * before its turn) and metres from the piece's foot, and its width (none: the cell's)
 */
const LEAKS: readonly {
  piece: 'WALL' | 'BUNKER';
  cell: string;
  x: number;
  y: number;
  size?: number;
}[] = [
  { piece: 'WALL', cell: 'leak01', x: -27, y: 2.95 },
  { piece: 'WALL', cell: 'leak02', x: -23.5, y: 2.95 },
  { piece: 'WALL', cell: 'leak03', x: -18.5, y: 2.95 },
  { piece: 'BUNKER', cell: 'leak02', x: 1.75, y: 2.2, size: 1.5 },
  { piece: 'BUNKER', cell: 'leak03', x: -1.75, y: 2.2, size: 1.5 },
];
const LEAK_ATLAS_ID = 'decalsStructure';
const LEAK_MATERIAL_ID = 'decalsStructure_blend';

/** The leak decals' mesh entities' app ids */
export const getStructuresLeakAppIds = () =>
  LEAKS.map(({ piece, cell }, i) => `terrainGallery_structures_leak_${piece}_${cell}_${i}`);

/** Whether the pillars move (the tab's switch) */
export const isStructuresMoving = () => rowState.isMoving;
/** Starts or stops the pillars where they are */
export const setStructuresMoving = (isMoving: boolean) => {
  rowState.isMoving = isMoving;
};

/**
 * A piece's material: the worn pieces' four layers or the pillars' one, in the piece's space, one
 * per space and debug view (the code route's)
 */
const getPieceMaterial = (key: StructuresKey) => {
  const isWorn = key === 'WALL' || key === 'BUNKER';
  const space = SPACES[key];
  const { debugView } = rowState;
  const view = debugView === 'NONE' ? '' : `_${debugView}`;
  const id = `terrainGalleryStructures_${isWorn ? 'worn' : 'plain'}_${space}${view}`;
  const opts = { id, space, ...(debugView === 'NONE' ? {} : { debugView }) };
  if (!isWorn) return createStructureMaterial(MOVING_SET, opts);
  return createStructureMaterial(WEAR_LAYERS, {
    ...opts,
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } },
  });
};

/**
 * Shows the debug view on the pieces: each swaps to its view's material (made the first time). The
 * views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setStructuresDebugView = (view: GalleryDebugView) => {
  rowState.debugView = view;
  for (const { key } of STRUCTURES_PIECES) {
    const material = getPieceMaterial(key);
    for (const appId of getStructuresAppIds(key)) {
      const mesh = getMeshByAppId(appId);
      if (mesh) setMeshMaterial(mesh, material);
    }
  }
};

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Where a piece took hits: the centre (the piece's own metres, its foot at y 0) and the radius */
type Impact = { x: number; y: number; z: number; radius: number };

/**
 * The wear's weights at a point of a piece (its own metres, the foot at y 0, `top` its height;
 * `wall` 1 on a vertical face, 0 on a flat one): concrete02 in rain streaks down the walls from the
 * top and in broad stains, mud01 as grime along the foot, rocks02 where the walls' top edge chipped
 * and around the impacts; scaled to sum to 1 at most (A, a fifth layer's, stays 0)
 */
const paintWear = (
  [x, y, z]: [number, number, number],
  wall: number,
  top: number,
  impacts: Impact[]
) => {
  const along = x + z;
  const streaks =
    smoothstep(0.55, 0.9, Math.sin(1.7 * along + 2.1 * Math.sin(0.6 * along))) *
    smoothstep(top - 3.5, top - 0.3, y) *
    wall;
  const stains = smoothstep(
    0.25,
    0.75,
    Math.sin(0.45 * x + 0.8) * Math.sin(0.5 * z + 0.9 * y + 0.3)
  );
  const grime = 1 - smoothstep(0.1, 0.8 + 0.35 * Math.sin(2.3 * along + 0.5), y);
  const chipped =
    smoothstep(top - 0.45, top - 0.1, y) * smoothstep(0.2, 0.7, Math.sin(1.9 * along + 1.4)) * wall;
  const hit = impacts.reduce(
    (most, c) =>
      Math.max(
        most,
        1 - smoothstep(c.radius - 0.25, c.radius + 0.25, Math.hypot(x - c.x, y - c.y, z - c.z))
      ),
    0
  );
  const masks = [Math.max(streaks, 0.7 * stains), grime, Math.max(chipped, hit)];
  const sum = masks[0] + masks[1] + masks[2];
  const scale = sum > 1 ? 1 / sum : 1;
  return [masks[0] * scale, masks[1] * scale, masks[2] * scale, 0];
};

/**
 * Writes a geometry's vertex colour (`COLOR_0`, RGBA, linear): the wear's weights at each vertex
 * (its foot at y 0, `top` its height)
 */
const paintGeometry = (geometry: THREE.BufferGeometry, top: number, impacts: Impact[]) => {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    const point: [number, number, number] = [
      positions.getX(i),
      positions.getY(i),
      positions.getZ(i),
    ];
    const wall = 1 - smoothstep(0.35, 0.75, Math.abs(normals.getY(i)));
    colors.set(paintWear(point, wall, top, impacts), i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geometry;
};

/** A registered geometry by id, built only when it isn't registered yet */
const getOrBuildGeometry = (id: string, build: () => THREE.BufferGeometry) =>
  getGeometry(id) ?? saveBufferGeometry(build(), { id });

/** A wall segment: a box with its foot at y 0, worn, two impacts on its front */
const buildWallGeometry = () => {
  const { length, height, thickness, segments } = WALL;
  const geometry = new THREE.BoxGeometry(length, height, thickness, ...segments);
  geometry.translate(0, height / 2, 0);
  return paintGeometry(geometry, height, [
    { x: -1.8, y: 2.3, z: thickness / 2, radius: 0.5 },
    { x: 2.6, y: 1.2, z: thickness / 2, radius: 0.35 },
  ]);
};

/**
 * The bunker piece: its profile extruded `BUNKER_DEPTH` along z (centred), tessellated to
 * `BUNKER_EDGE` (the extrusion's faces are a few long triangles, the wear needs vertices), worn,
 * the doorway's edges hit
 */
const buildBunkerGeometry = () => {
  const shape = new THREE.Shape(BUNKER_PROFILE.map(([x, y]) => new THREE.Vector2(x, y)));
  const extruded = new THREE.ExtrudeGeometry(shape, { depth: BUNKER_DEPTH, bevelEnabled: false });
  extruded.translate(0, 0, -BUNKER_DEPTH / 2);
  const geometry = new TessellateModifier(BUNKER_EDGE, 12).modify(extruded);
  extruded.dispose();
  geometry.computeVertexNormals();
  const front = BUNKER_DEPTH / 2;
  return paintGeometry(geometry, 3, [
    { x: -0.9, y: 1.9, z: front, radius: 0.45 },
    { x: 0.9, y: 0.6, z: front, radius: 0.35 },
    { x: 2.9, y: 2.2, z: -front, radius: 0.6 },
  ]);
};

/** The pillars' unit box, 0.25 m a segment at their scale */
const buildPillarGeometry = () => new THREE.BoxGeometry(1, 1, 1, 6, 16, 6);

/** A pillar's pose at a time: turned about y, risen by the sine of its period */
const getPillarPose = (seconds: number, out: { pos: THREE.Vector3; rot: THREE.Quaternion }) => {
  const rise = Math.sin((2 * Math.PI * seconds) / PILLAR_RISE.period) * PILLAR_RISE.amplitude;
  out.pos.y = PILLAR_REST_Y + rise;
  out.rot.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, PILLAR_TURN_SPEED * seconds);
  return out;
};

/** The moving pillars, left to right */
const PILLAR_KEYS = ['MOVING_OBJECT', 'MOVING_WORLD'] as const;

/**
 * Moves the pillars on the scene's looper (gone with the scene): their time runs while the row
 * moves, both at the same pose
 */
const startPillars = (sceneId: string) => {
  const world = getECSWorld();
  const pillars = PILLAR_KEYS.map((key) => ({
    id: getEntityIdByAppId(getStructuresAppIds(key)[0], world),
    x: PIECE_X[key],
  }));
  const pose = { pos: new THREE.Vector3(), rot: new THREE.Quaternion() };
  let seconds = 0;
  createSceneMainLooper((delta) => {
    if (!rowState.isMoving) return;
    seconds += delta;
    getPillarPose(seconds, pose);
    for (const { id, x } of pillars) {
      if (id === undefined) continue;
      pose.pos.set(x, pose.pos.y, ROW_Z);
      world.setTransform(id, pose);
    }
  }, sceneId);
};

/** The leak decals on the wall's and the bunker's fronts, coplanar with them */
const createLeaks = (footY: number) => {
  const leakAppIds = getStructuresLeakAppIds();
  const turnCos = Math.cos(BUNKER_TURN);
  const turnSin = Math.sin(BUNKER_TURN);
  LEAKS.forEach((leak, i) => {
    const [cellWidth, cellHeight] = getDecalCellSize(LEAK_ATLAS_ID, leak.cell);
    const width = leak.size ?? cellWidth;
    const height = (width / cellWidth) * cellHeight;
    const quad = getDecalQuadGeometry(width, height, 1, true);
    const front = leak.piece === 'WALL' ? WALL.thickness / 2 : BUNKER_DEPTH / 2;
    // The bunker's front turns with it about its foot's centre
    const position =
      leak.piece === 'WALL'
        ? { x: leak.x, y: footY + leak.y, z: ROW_Z + front }
        : {
            x: PIECE_X.BUNKER + leak.x * turnCos + front * turnSin,
            y: footY + leak.y,
            z: ROW_Z - leak.x * turnSin + front * turnCos,
          };
    createMeshEntity(
      {
        geo: remapUVsToAtlasCell(quad, LEAK_ATLAS_ID, leak.cell),
        mat: LEAK_MATERIAL_ID,
        position,
        ...(leak.piece === 'BUNKER' ? { rotation: { y: BUNKER_TURN } } : {}),
        renderOrder: DECAL_RENDER_ORDER,
        ...NO_SHADOWS,
      },
      {
        appId: leakAppIds[i],
        debugData: { name: `Structures: ${leak.cell} on the ${leak.piece.toLowerCase()}` },
      }
    );
  });
};

/**
 * Creates the row (the scene's load): the pieces' geometries (the bunker tessellated and both worn
 * pieces painted the first time), the pieces with their materials, the leak decals, the pillars
 * moving on the scene's looper
 * @param sceneId the gallery's scene id (its looper's)
 */
export const createStructuresRow = (sceneId: string) => {
  rowState.debugView = 'NONE';
  rowState.isMoving = true;
  const wall = getOrBuildGeometry(WALL_GEOMETRY_ID, buildWallGeometry);
  const bunker = getOrBuildGeometry(BUNKER_GEOMETRY_ID, buildBunkerGeometry);
  const pillar = getOrBuildGeometry(PILLAR_GEOMETRY_ID, buildPillarGeometry);
  const footY = GROUND_TOP_Y - SINK;
  const [wall0, wall1] = getStructuresAppIds('WALL');
  const wallMaterial = getPieceMaterial('WALL');
  [wall0, wall1].forEach((appId, i) => {
    createMeshEntity(
      {
        geo: wall,
        mat: wallMaterial,
        position: { x: PIECE_X.WALL + (i - 0.5) * WALL.length, y: footY, z: ROW_Z },
        ...NO_SHADOWS,
      },
      { appId, debugData: { name: `Structures: wall segment ${i + 1}` } }
    );
  });
  createMeshEntity(
    {
      geo: bunker,
      mat: getPieceMaterial('BUNKER'),
      position: { x: PIECE_X.BUNKER, y: footY, z: ROW_Z },
      rotation: { y: BUNKER_TURN },
      ...NO_SHADOWS,
    },
    { appId: getStructuresAppIds('BUNKER')[0], debugData: { name: 'Structures: bunker' } }
  );
  for (const key of PILLAR_KEYS) {
    createMeshEntity(
      {
        geo: pillar,
        mat: getPieceMaterial(key),
        position: { x: PIECE_X[key], y: PILLAR_REST_Y, z: ROW_Z },
        scale: PILLAR_SCALE,
        ...NO_SHADOWS,
      },
      {
        appId: getStructuresAppIds(key)[0],
        debugData: { name: `Structures: ${DESCRIPTIONS[key][0]}` },
      }
    );
  }
  createLeaks(footY);
  startPillars(sceneId);
};
