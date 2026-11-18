// Leaf litter cards (p308 D5): a small quad lying flat, folded along its midrib so its edges curl
// up (a fallen leaf's, and less of it flat against the ground), its UV 0..1 over it with V along
// the midrib: the `leafLitter` material maps an atlas cell onto it. 4 triangles.
import * as THREE from 'three/webgpu';
import { getGeometry, saveBufferGeometry } from 'aekasha';

/** {@link generateLeafCard}'s options; each has a default. */
export interface LeafCardOptions {
  /** The card's side, metres (default 0.14). */
  size?: number;
  /** How far the edges curl up, a share of the side, ≥ 0 (default 0.12). */
  curl?: number;
}

/** The id {@link saveLeafCardGeometry} registers the default card under. */
export const LEAF_CARD_GEOMETRY_ID = 'leafCard';

/**
 * Builds a leaf litter card (p308 D5): a square `size` across lying in the XZ plane, folded along
 * its midrib (the z axis through its centre) so its left and right edges stand `curl` × `size`
 * over it; its origin is the midrib's centre, on the ground. UV 0..1 over the square, U along +x
 * and V along −z (the midrib: a leaf's tip at V 1), smooth normals. Pair it with the toolkit's
 * `leafLitter` material, which maps an atlas cell onto it per instance.
 * @example
 * ```ts
 * import { createMeshEntity, saveBufferGeometry } from 'aekasha';
 * import { generateLeafCard } from 'aekasha/toolkit/geometry';
 *
 * // A bigger, flatter card than the default
 * const card = generateLeafCard({ size: 0.2, curl: 0.05 });
 * createMeshEntity({ geo: saveBufferGeometry(card, { id: 'bigLeaf' }), mat: 'leafLitter' });
 * ```
 */
export const generateLeafCard = (opts: LeafCardOptions = {}): THREE.BufferGeometry => {
  const { size = 0.14, curl = 0.12 } = opts;
  const half = size / 2;
  const lift = Math.max(0, curl) * size;
  // Three columns (left edge, midrib, right edge) × two rows (the tip at −z, the stem at +z)
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [z, v] of [
    [-half, 1],
    [half, 0],
  ]) {
    for (const [x, y, u] of [
      [-half, lift, 0],
      [0, 0, 0.5],
      [half, lift, 1],
    ]) {
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Counter-clockwise from above: the tip row 0-2, the stem row 3-5
  geometry.setIndex([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Registers the default leaf card ({@link generateLeafCard} with no options) for the scene loading
 * (or current) as `leafCard` ({@link LEAF_CARD_GEOMETRY_ID}), so a `*.scatter.json`'s items can
 * name it; one registered already is kept. Call it in the scene's code before its scatters spawn.
 * @returns the id
 * @example
 * ```ts
 * import { spawnTerrainBlock } from 'aekasha/terrain';
 * import { saveLeafCardGeometry } from 'aekasha/toolkit/geometry';
 *
 * // A scene file: the card its block's leaf litter scatter names, then the block
 * export const scene = async () => {
 *   saveLeafCardGeometry();
 *   await spawnTerrainBlock('forestFloor');
 * };
 * ```
 */
export const saveLeafCardGeometry = () => {
  if (!getGeometry(LEAF_CARD_GEOMETRY_ID)) {
    saveBufferGeometry(generateLeafCard(), {
      id: LEAF_CARD_GEOMETRY_ID,
      debugData: { name: 'Leaf card', description: 'generateLeafCard: 14 cm, its edges curled.' },
    });
  }
  return LEAF_CARD_GEOMETRY_ID;
};
