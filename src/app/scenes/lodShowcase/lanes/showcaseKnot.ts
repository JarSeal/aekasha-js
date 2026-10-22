import * as THREE from 'three/webgpu';
import { createMaterial, getGeometry, saveBufferGeometry } from 'aekasha';
import { generateLodChain, getLodChain } from 'aekasha/lod';
import type { LodChainOptions } from 'aekasha/lod';

/**
 * The heavy procedural mesh the generated chain and knot impostor lanes share: 256 × 32 segments,
 * 16,384 triangles.
 */
export const SHOWCASE_KNOT_GEO_ID = 'lodShowcaseKnot';

/** Its chain: down to 6 % of the triangles (982). Each level's error is about three times the
 * last one's, so their switch distances spread the same way: four levels fit in a lane (18-290 m
 * from the start camera), a fifth at 2 % (error 0.039) would not. */
const SHOWCASE_KNOT_CHAIN: LodChainOptions = { ratios: [0.5, 0.2, 0.06] };

/** The knot's material, which both knot lanes share. */
export const getShowcaseKnotMaterial = () =>
  createMaterial({
    id: 'lodShowcaseKnotMat',
    type: 'STANDARD',
    params: { color: '#5f8fb4', roughness: 0.35, metalness: 0.3 },
  });

/**
 * The torus knot, built and registered on the first call of a visit (the next lane's call gets the
 * registered one), and its LOD chain: the one generated already, or else one generated now (in the
 * assets worker).
 */
export const getShowcaseKnot = () => {
  const geometry =
    getGeometry(SHOWCASE_KNOT_GEO_ID) ??
    saveBufferGeometry(new THREE.TorusKnotGeometry(1.2, 0.38, 256, 32), {
      id: SHOWCASE_KNOT_GEO_ID,
      debugData: { name: 'LOD showcase torus knot', description: '256 × 32 segments.' },
    });
  geometry.computeBoundingBox();
  const generated = getLodChain(SHOWCASE_KNOT_GEO_ID);
  // generateLodChain replaces an existing chain (a pending one it returns)
  const chain = generated
    ? Promise.resolve(generated)
    : generateLodChain(SHOWCASE_KNOT_GEO_ID, SHOWCASE_KNOT_CHAIN);
  return { geometry, chain };
};
