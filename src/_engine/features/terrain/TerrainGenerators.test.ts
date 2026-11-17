import { afterEach, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  getTerrainGenerator,
  getTerrainGeneratorIds,
  registerTerrainGenerator,
  unregisterTerrainGenerator,
  type TerrainGenerator,
} from './TerrainGenerators';
import { terrainState } from './TerrainState';

const flat: TerrainGenerator = () => ({ geometry: new THREE.BufferGeometry() });

afterEach(() => {
  for (const id of getTerrainGeneratorIds()) unregisterTerrainGenerator(id);
  terrainState.isInstalled = false;
});

describe('the terrain generator registry', () => {
  test('throws naming terrain() when the feature isn’t installed', () => {
    expect(() => registerTerrainGenerator('flat', flat)).toThrow(
      /terrain\(\) from 'aekasha\/terrain'/
    );
    expect(getTerrainGenerator('flat')).toBeUndefined();
  });

  test('registers by id, refuses an id twice, and unregisters', () => {
    terrainState.isInstalled = true;
    registerTerrainGenerator('flat', flat);
    expect(getTerrainGenerator('flat')).toBe(flat);
    expect(() => registerTerrainGenerator('flat', flat)).toThrow(/has the id "flat" already/);
    registerTerrainGenerator('hills', flat);
    expect(getTerrainGeneratorIds()).toEqual(['flat', 'hills']);
    expect(unregisterTerrainGenerator('flat')).toBe(true);
    expect(unregisterTerrainGenerator('flat')).toBe(false);
    expect(getTerrainGenerator('flat')).toBeUndefined();
  });
});
