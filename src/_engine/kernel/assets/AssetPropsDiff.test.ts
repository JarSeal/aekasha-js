import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { getChangedPropPaths, warnIfAssetPropsIgnored } from './AssetPropsDiff';

// The warning log is a stand-in
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

describe('getChangedPropPaths', () => {
  test('finds none in equal props, whatever their key order', () => {
    const created = { id: 'a', type: 'BASIC', params: { color: '#ff0000', opacity: 0.5 } };
    const given = { params: { opacity: 0.5, color: '#ff0000' }, type: 'BASIC', id: 'a' };
    expect(getChangedPropPaths(created, given)).toEqual([]);
  });

  test("names a plain object key's own keys, any other key by itself", () => {
    const created = { type: 'BASIC', params: { color: '#ff0000', opacity: 1 }, isPersistent: true };
    const given = { type: 'LAMBERT', params: { color: '#00ff00', opacity: 1, transparent: true } };
    expect(getChangedPropPaths(created, given)).toEqual([
      'type',
      'params.color',
      'params.transparent',
      'isPersistent',
    ]);
  });

  test('skips debugData, and takes an undefined value as a missing key', () => {
    const created = { type: 'BOX', debugData: { name: 'Crate' }, params: { width: 1 } };
    const given = {
      type: 'BOX',
      debugData: { name: 'Other' },
      params: { width: 1, height: undefined },
    };
    expect(getChangedPropPaths(created, given)).toEqual([]);
  });

  test('compares a texture by its registry id: the scene loader passes it resolved', () => {
    const texture = new THREE.Texture();
    texture.userData.id = 'crateAlbedo';
    expect(
      getChangedPropPaths({ params: { map: texture } }, { params: { map: 'crateAlbedo' } })
    ).toEqual([]);
    expect(getChangedPropPaths({ params: { map: texture } }, { params: { map: 'other' } })).toEqual(
      ['params.map']
    );
  });

  test('compares a colour by its hex and a vector by its components', () => {
    const created = {
      params: { color: new THREE.Color('#336699'), normalScale: new THREE.Vector2(1, 2) },
    };
    expect(
      getChangedPropPaths(created, { params: { color: '#336699', normalScale: [1, 2] } })
    ).toEqual([]);
    expect(
      getChangedPropPaths(created, { params: { color: '#336699', normalScale: [1, 3] } })
    ).toEqual(['params.normalScale']);
  });

  test('compares nested plain data deeply, and a TSL node by identity without walking it', () => {
    const node = float(1);
    const created = { nodes: { colorNode: { tint: [1, 0, 0] } }, params: { colorNode: node } };
    expect(
      getChangedPropPaths(created, {
        nodes: { colorNode: { tint: [1, 0, 0] } },
        params: { colorNode: node },
      })
    ).toEqual([]);
    expect(
      getChangedPropPaths(created, {
        nodes: { colorNode: { tint: [0, 1, 0] } },
        params: { colorNode: float(1) },
      })
    ).toEqual(['nodes.colorNode', 'params.colorNode']);
  });
});

describe('warnIfAssetPropsIgnored', () => {
  test('warns naming the differing paths, or the save without props, and not for equal props', () => {
    fns.lwarn.mockClear();
    const created = { type: 'BASIC', params: { color: '#ff0000' } };
    warnIfAssetPropsIgnored('createMaterial', 'material', 'ground', created, created);
    warnIfAssetPropsIgnored('createMaterial', 'material', 'ground', created, { ...created });
    expect(fns.lwarn).not.toHaveBeenCalled();

    warnIfAssetPropsIgnored('createMaterial', 'material', 'ground', created, { type: 'LAMBERT' });
    expect(fns.lwarn).toHaveBeenLastCalledWith(
      expect.stringMatching(/createMaterial: "ground" .* other props \(type, params\.color\)/)
    );
    warnIfAssetPropsIgnored('createGeometry', 'geometry', 'knot', undefined, { type: 'BOX' });
    expect(fns.lwarn).toHaveBeenLastCalledWith(
      expect.stringMatching(/createGeometry: "knot" .* a save without props/)
    );
  });
});
