import { describe, expect, it } from 'vitest';
import {
  getImportLodChains,
  getImportPhysicsSpawn,
  type ImportExtension,
  type ImportLodChainsExtension,
  registerImportExtension,
} from './ImportExtensions';

const lodChains = {} as ImportLodChainsExtension;

describe('import extensions', () => {
  it('finds each member from the extension that adds it, and refuses a second provider', () => {
    expect(getImportPhysicsSpawn()).toBeNull();
    expect(getImportLodChains()).toBeNull();
    const spawnPhysics: ImportExtension['spawnPhysics'] = async () => [];
    registerImportExtension({ id: 'physics', spawnPhysics });
    registerImportExtension({ id: 'lod', lodChains });
    expect(getImportPhysicsSpawn()).toBe(spawnPhysics);
    expect(getImportLodChains()).toBe(lodChains);
    expect(() => registerImportExtension({ id: 'other', lodChains })).toThrow(
      /'other' adds `lodChains`, which 'lod' already adds/
    );
    // The refused one changed nothing
    expect(getImportLodChains()).toBe(lodChains);
  });
});
