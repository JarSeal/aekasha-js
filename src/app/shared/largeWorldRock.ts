import type * as THREE from 'three/webgpu';
import { createMaterial, getGeometry, saveBufferGeometry } from 'aekasha';
import { generateOctahedralImpostor } from 'aekasha/lod';
import { generateAsteroid } from 'aekasha/toolkit/geometry';

/**
 * The large world's rock, shared by `largeWorld` (its rock pool) and the LOD showcase's rock lane.
 * Its octahedral impostor is exported (`src/app/impostors/largeWorldRockImpostor.impostor.json`,
 * listed by both scenes), and the export records a fingerprint of its source: the rock's geometry,
 * material and impostor options. A scene that builds the rock otherwise still gets the export, and
 * the debug env warns that it's stale. So both scenes build it here; a change here re-exports it
 * (the LOD tab's Impostors).
 */
export const LARGE_WORLD_ROCK_IMPOSTOR_ID = 'largeWorldRockImpostor';

/** The asteroid's options: a squashed rock, the same one on every load. */
const ROCK_SHAPE: { seed: number; shape: [number, number, number] } = {
  seed: 11,
  shape: [1.25, 0.75, 1],
};

/**
 * The rock's geometry registered under `id` (the scene's asset release disposes it), generated
 * unless the id is registered already.
 * @param detail the icosphere detail (default the generator's, 4): a lower one for a far level
 */
export const saveLargeWorldRockGeometry = (id: string, detail?: number) =>
  getGeometry(id) ??
  saveBufferGeometry(generateAsteroid({ ...ROCK_SHAPE, detail }).geometry, { id });

/** The rock's flat-shaded material, registered under `id`. */
export const createLargeWorldRockMaterial = (id: string) =>
  createMaterial({ id, type: 'PHONG', params: { color: '#8f8a80', flatShading: true } });

/**
 * The rock's octahedral impostor: the export's id builds it from the export, another id bakes it
 * at load. Hemi: the rocks turn about y only and sit in the ground, so nothing sees them from
 * below, and the frames cover the upper hemisphere at twice the density.
 */
export const generateLargeWorldRockImpostor = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  id = LARGE_WORLD_ROCK_IMPOSTOR_ID
) => generateOctahedralImpostor(geometry, material, { id, hemi: true });
