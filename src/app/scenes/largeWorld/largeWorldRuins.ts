import type * as THREE from 'three/webgpu';
import { createGeometry, createMeshEntity, createSeededRandom } from 'aekasha';
import type { ECSWorld, MeshProps } from 'aekasha';

/** The materials the ruins share with largeWorld's static props, so the props near a site merge
 * with it. */
export interface RuinMaterials {
  /** The floor tiles' */
  platform: THREE.Material;
  /** The walls' and pillars' */
  wall: THREE.Material;
  /** The rubble's */
  rock: THREE.Material;
}

/** A ruin site: a floor of `cols` × `rows` 2 m tiles at (`x`, `z`), turned `angle` about y. */
export interface RuinSite {
  x: number;
  z: number;
  cols: number;
  rows: number;
  angle: number;
}

/**
 * The sites, each inside one of the scene's 50 m `AUTO` cells (rubble included), so each site is
 * one group per material. The props in a site's cell join its groups (`largeWorldWall1`,
 * `largeWorldPlatform1`, both rocks).
 */
const RUIN_SITES: RuinSite[] = [
  { x: -60, z: -65, cols: 6, rows: 4, angle: 0.3 },
  { x: 15, z: -62, cols: 5, rows: 4, angle: -0.2 },
  { x: 60, z: -38, cols: 7, rows: 4, angle: 0.9 },
  { x: -70, z: 20, cols: 5, rows: 5, angle: 0.1 },
  { x: -30, z: 62, cols: 6, rows: 3, angle: -0.5 },
  { x: 35, z: 40, cols: 6, rows: 4, angle: 0.4 },
  { x: 70, z: 70, cols: 4, rows: 4, angle: 0 },
  { x: -38, z: -35, cols: 5, rows: 4, angle: -0.8 },
];

const RUBBLE_PER_SITE = 12;
/** The share of each kind of piece left out, as fallen. */
const MISSING = { floor: 0.15, wall: 0.3, pillar: 0.2 };

/** Where `createRuins` builds, when not the scene's own eight sites. */
export interface RuinsOptions {
  /** The sites. Default: the scene's eight, on the terrain */
  sites?: RuinSite[];
  /** The seed of the pieces left out, their heights and the rubble. Default 7 */
  seed?: number;
  /** Every piece's `merge`. Default `'AUTO'` (the scene's 50 m cells) */
  merge?: MeshProps['merge'];
}

/** A ruin piece's kind: its geometry, and with it its material. */
export type RuinPieceKind = 'floor' | 'wall' | 'pillar' | 'rubble';

/** A ruin piece as `layoutRuins` places it: its kind, its site and its pose in the world. */
export interface RuinPiece {
  kind: RuinPieceKind;
  /** Its site's index in the sites */
  site: number;
  position: { x: number; y: number; z: number };
  /** Euler angles (radians) */
  rotation: { x?: number; y?: number; z?: number };
  scale?: { x: number; y: number; z: number };
}

/** The kit's four geometries (registered on the first call, then the registered ones). */
export const getRuinGeometries = () => ({
  floor: createGeometry({
    id: 'largeWorldRuinFloorGeo',
    type: 'BOX',
    params: { width: 2, height: 0.3, depth: 2 },
  }),
  // 1 m high, scaled to each wall's and pillar's height
  wall: createGeometry({
    id: 'largeWorldRuinWallGeo',
    type: 'BOX',
    params: { width: 2, height: 1, depth: 0.5 },
  }),
  pillar: createGeometry({
    id: 'largeWorldRuinPillarGeo',
    type: 'CYLINDER',
    params: { radiusTop: 0.3, radiusBottom: 0.38, height: 1, radialSegments: 8 },
  }),
  rubble: createGeometry({
    id: 'largeWorldRuinRubbleGeo',
    type: 'SPHERE',
    params: { radius: 0.4, widthSegments: 5, heightSegments: 4 },
  }),
});

/** A piece kind's material: the floor tiles the platform's, the rubble the rock's, the rest the
 * wall's. */
export const getRuinMaterial = (kind: RuinPieceKind, materials: RuinMaterials) =>
  kind === 'floor' ? materials.platform : kind === 'rubble' ? materials.rock : materials.wall;

/**
 * Where the ruins' pieces go, without making them: every site's floor tiles, broken walls,
 * pillars and rubble, the same on every call with the same sites and seed (a seeded random).
 * `heightAt` is the ground's height under a point.
 */
export const layoutRuins = (
  heightAt: (x: number, z: number) => number,
  options: Pick<RuinsOptions, 'sites' | 'seed'> = {}
) => {
  const pieces: RuinPiece[] = [];
  const random = createSeededRandom(options.seed ?? 7);
  const between = (min: number, max: number) => min + random() * (max - min);

  (options.sites ?? RUIN_SITES).forEach((site, siteIndex) => {
    const cos = Math.cos(site.angle);
    const sin = Math.sin(site.angle);
    /** A piece at the site's local (`lx`, `lz`), its `y` above the terrain there. */
    const place = (
      kind: RuinPieceKind,
      lx: number,
      lz: number,
      y: number,
      opts: { turn?: number; scale?: { x: number; y: number; z: number }; tumble?: boolean } = {}
    ) => {
      const x = site.x + lx * cos + lz * sin;
      const z = site.z - lx * sin + lz * cos;
      const rotation = opts.tumble
        ? { x: random() * Math.PI, y: random() * Math.PI, z: random() * Math.PI }
        : { y: site.angle + (opts.turn ?? 0) };
      pieces.push({
        kind,
        site: siteIndex,
        position: { x, y: heightAt(x, z) + y, z },
        rotation,
        scale: opts.scale,
      });
    };

    // The floor: its tiles' tops 0.25 m above the terrain under each
    for (let i = 0; i < site.cols; i++) {
      for (let j = 0; j < site.rows; j++) {
        if (random() < MISSING.floor) continue;
        place('floor', -site.cols + 1 + 2 * i, -site.rows + 1 + 2 * j, 0.1 + between(-0.05, 0.05));
      }
    }
    // The walls round its edge, broken to 0.6-3 m, their feet 0.2 m in the ground
    const wall = (lx: number, lz: number, turn: number) => {
      if (random() < MISSING.wall) return;
      const height = between(0.6, 3);
      place('wall', lx, lz, height / 2 - 0.2, { turn, scale: { x: 1, y: height, z: 1 } });
    };
    const edgeX = site.cols + 0.25;
    const edgeZ = site.rows + 0.25;
    for (let i = 0; i < site.cols; i++) {
      wall(-site.cols + 1 + 2 * i, -edgeZ, 0);
      wall(-site.cols + 1 + 2 * i, edgeZ, 0);
    }
    for (let j = 0; j < site.rows; j++) {
      wall(-edgeX, -site.rows + 1 + 2 * j, Math.PI / 2);
      wall(edgeX, -site.rows + 1 + 2 * j, Math.PI / 2);
    }
    // The pillars: one at each corner, and two rows every 4 m inside on a site 4 tiles deep
    const pillar = (lx: number, lz: number) => {
      if (random() < MISSING.pillar) return;
      const height = between(1.2, 4);
      place('pillar', lx, lz, height / 2 - 0.2, { scale: { x: 1, y: height, z: 1 } });
    };
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      pillar(sx * edgeX, sz * edgeZ);
    }
    if (site.rows >= 4) {
      for (let lx = -site.cols + 2; lx < site.cols; lx += 4) {
        pillar(lx, -site.rows / 2);
        pillar(lx, site.rows / 2);
      }
    }
    // The rubble, scattered over the site and a metre past its walls
    for (let n = 0; n < RUBBLE_PER_SITE; n++) {
      const scale = between(0.6, 1.6);
      place(
        'rubble',
        between(-site.cols - 1, site.cols + 1),
        between(-site.rows - 1, site.rows + 1),
        0.1 * scale,
        { scale: { x: scale, y: scale, z: scale }, tumble: true }
      );
    }
  });
  return pieces;
};

/**
 * A modular ruins kit: 8 sites of floor tiles, broken walls, pillars and rubble on the terrain,
 * about 400 static pieces from four geometries in the props' three materials, all drawn merged
 * (`merge: 'AUTO'`): about 24 groups, one per site and material. The same ruins on every load
 * (a seeded random, `layoutRuins`). `heightAt` is the ground's height under a point; `options`
 * builds other sites (p376's far field, `_dbg__largeWorldHlodField.ts`). Returns the pieces'
 * entity ids.
 */
export const createRuins = (
  world: ECSWorld,
  heightAt: (x: number, z: number) => number,
  materials: RuinMaterials,
  options: RuinsOptions = {}
) => {
  const geometries = getRuinGeometries();
  const merge = options.merge ?? 'AUTO';
  return layoutRuins(heightAt, options).map(({ kind, site, position, rotation, scale }) =>
    createMeshEntity(
      {
        geo: geometries[kind],
        mat: getRuinMaterial(kind, materials),
        castShadow: true,
        receiveShadow: true,
        position,
        rotation,
        scale,
        merge,
      },
      { debugData: { name: `Large world ruin ${site} ${kind}` }, world }
    )
  );
};
