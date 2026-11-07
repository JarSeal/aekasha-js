import { describe, expect, test } from 'vitest';
import {
  getCellOwnerKey,
  recordAssetOwner,
  retagAssetOwner,
  runInAssetOwnerScope,
} from '../../kernel/assets/AssetOwners';
import { BOOT_OWNER, getMemoryOwner } from './_dbg__GPUMemoryOwners';

/** An asset held by `owners`, the first registering it, the others getting it from the cache */
const heldBy = (...owners: string[]) => {
  const asset = {};
  runInAssetOwnerScope(owners[0], () => recordAssetOwner(asset));
  for (const owner of owners.slice(1)) runInAssetOwnerScope(owner, () => retagAssetOwner(asset));
  return asset;
};

describe('getMemoryOwner', () => {
  test('its only owner, or boot without one', () => {
    expect(getMemoryOwner({})).toBe(BOOT_OWNER);
    expect(getMemoryOwner(heldBy('ownersScene'))).toBe('ownersScene');
    expect(getMemoryOwner(heldBy(getCellOwnerKey('ownersScene', 7, 'far')))).toBe(
      'ownersScene#7/far'
    );
  });

  test("one cell's layers: the cell's key (p353 Phase 5 D10)", () => {
    const asset = heldBy(
      getCellOwnerKey('ownersScene', 7),
      getCellOwnerKey('ownersScene', 7, 'far'),
      getCellOwnerKey('ownersScene', 7, 'kept')
    );
    expect(getMemoryOwner(asset)).toBe('ownersScene#7');
  });

  test('several cells, or a cell and its scene: the scene', () => {
    const cells = heldBy(
      getCellOwnerKey('ownersScene', 7, 'far'),
      getCellOwnerKey('ownersScene', 8)
    );
    expect(getMemoryOwner(cells)).toBe('ownersScene');
    expect(getMemoryOwner(heldBy('ownersScene', getCellOwnerKey('ownersScene', 7)))).toBe(
      'ownersScene'
    );
  });

  test('two scenes: the latest', () => {
    expect(getMemoryOwner(heldBy('ownersA', getCellOwnerKey('ownersB', 7)))).toBe('ownersB#7');
  });
});
