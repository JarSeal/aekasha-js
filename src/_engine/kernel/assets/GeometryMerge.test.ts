import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene } from '../scene/Scene';
import { getAssetOwners, runInAssetOwnerScope } from './AssetOwners';
import type { AssetsDownProtocol, AssetsMergeGeometryRequest } from './AssetsAPITypes';
import { AssetsProtocolType } from './AssetsAPITypes';
import { getGeometry, saveBufferGeometry } from './Geometry';
import {
  mergeGeometryParts,
  mergeGeometryPartsAsync,
  registerMergedGeometry,
  registerMergedGeometryAsync,
  registerMergedGeoPropsAsync,
} from './GeometryMerge';

/** The worker's side, in this thread: whether `MERGE` runs the worker task, how many requests
 * were sent, and the last one's geometry count. */
const worker = vi.hoisted(() => ({ isOn: true, requests: 0, geometriesSent: 0 }));

// The worker task's request goes through structuredClone with its transfer list, as postMessage
// sends it, into the worker's own job, and its response back the same way: what the assets
// worker does, without a Worker (Node)
vi.mock(import('./AssetsAPI'), async (importOriginal) => {
  const actual = await importOriginal();
  const { assetsSwitchMerge } = await import('./worker/AssetsSwitchMerge');
  return {
    ...actual,
    runAssetTask: async <T>(
      _kind: unknown,
      workerTask: () => Promise<T>,
      mainThreadTask: () => Promise<T>
    ) => {
      const target = worker.isOn ? 'WORKER_THREAD' : 'MAIN_THREAD';
      const result = await (worker.isOn ? workerTask() : mainThreadTask());
      return { result, report: { target, loadedOn: target, durationMs: 0 } as const };
    },
    mergeGeometryInWorker: async (geometries, parts, options, transfer) => {
      worker.requests++;
      worker.geometriesSent = geometries.length;
      const request: AssetsMergeGeometryRequest = structuredClone(
        { type: AssetsProtocolType.MERGE_GEOMETRY, requestId: 1, geometries, parts, options },
        { transfer: [...transfer] }
      );
      let response: AssetsDownProtocol | undefined;
      assetsSwitchMerge(request, (message, list) => {
        response = structuredClone(message, { transfer: list });
      });
      if (response?.type !== AssetsProtocolType.MERGE_GEOMETRY) throw new Error('No response');
      return { geometry: response.geometry, warnings: response.warnings };
    },
  };
});

beforeAll(() => {
  createRootScene();
});

describe('mergeGeometryParts', () => {
  test('resolves registered ids and throws for an unregistered one', () => {
    const box = saveBufferGeometry(new THREE.BoxGeometry(), { id: 'geometryMergeTestBox' });
    const merged = mergeGeometryParts([{ geo: 'geometryMergeTestBox' }, { geo: box }]);
    expect(merged.attributes.position.count).toBe(48);
    expect(() => mergeGeometryParts([{ geo: 'geometryMergeTestNone' }])).toThrow(
      /geometryMergeTestNone/
    );
  });
});

describe('registerMergedGeometry', () => {
  test('registers the merge, and returns the registered one for a taken id', () => {
    const parts = [{ geo: new THREE.BoxGeometry() }, { geo: new THREE.SphereGeometry() }];
    const first = registerMergedGeometry(parts, { id: 'geometryMergeTestMerged' });
    expect(getGeometry('geometryMergeTestMerged')).toBe(first);
    expect(first.userData.mergeParts).toHaveLength(2);
    const again = registerMergedGeometry([{ geo: new THREE.BoxGeometry() }], {
      id: 'geometryMergeTestMerged',
    });
    expect(again).toBe(first);
  });
});

describe('registerMergedGeoPropsAsync', () => {
  const boxAsync = async (y: number) => {
    const geometry = await registerMergedGeoPropsAsync({
      id: `geometryMergeTestProps${y}`,
      type: 'MERGED',
      params: {
        parts: [
          { geo: 'geometryMergeTestUnit', position: { y }, key: 'plain' },
          {
            geo: 'geometryMergeTestUnit',
            position: { x: 10 },
            rotation: { z: Math.PI / 2 },
            scale: { x: 2, y: 1, z: 1 },
            materialSlot: 1,
            key: 'rotated',
          },
          {
            geo: 'geometryMergeTestUnit',
            position: { x: -10 },
            // A quarter turn about z, which wins over the rotation
            quaternion: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
            rotation: { x: 1 },
          },
        ],
        groups: 'BY_SLOT',
      },
    });
    geometry.computeBoundingBox();
    return geometry;
  };

  test('composes each part as a mesh: position, rotation (quaternion over it), scale', async () => {
    // A 2×1×1 box: the scale stretches it along its own x, the quarter turn puts that on y
    saveBufferGeometry(new THREE.BoxGeometry(1, 1, 1), { id: 'geometryMergeTestUnit' });
    const geometry = await boxAsync(0);
    const ranges = geometry.userData.mergeParts as { key?: string; vertexStart: number }[];
    expect(ranges.map((range) => range.key)).toEqual(['plain', undefined, 'rotated']);
    const partBox = (start: number) =>
      new THREE.Box3().setFromBufferAttribute(
        new THREE.Float32BufferAttribute(
          (geometry.attributes.position.array as Float32Array).slice(start * 3, (start + 24) * 3),
          3
        )
      );
    const rotated = partBox(ranges[2].vertexStart);
    expect(rotated.min.x).toBeCloseTo(9.5);
    expect(rotated.max.x).toBeCloseTo(10.5);
    expect(rotated.min.y).toBeCloseTo(-1);
    expect(rotated.max.y).toBeCloseTo(1);
    const quaternion = partBox(ranges[1].vertexStart);
    expect(quaternion.min.x).toBeCloseTo(-10.5);
    expect(quaternion.max.z).toBeCloseTo(0.5);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    expect(getGeometry('geometryMergeTestProps0')).toBe(geometry);
  });
});

describe('mergeGeometryPartsAsync', () => {
  const mirrored = new THREE.Matrix4().makeScale(-1, 1, 1).setPosition(3, 0, 0);
  const parts = () => {
    const box =
      getGeometry('geometryMergeTestAsyncBox') ??
      saveBufferGeometry(new THREE.BoxGeometry(1, 2, 3), { id: 'geometryMergeTestAsyncBox' });
    // A function can't be cloned: the request carries attributes and index, not userData
    box.userData.notCloneable = () => {};
    return [
      { geo: 'geometryMergeTestAsyncBox', key: 'a' },
      { geo: new THREE.SphereGeometry(1, 8, 6), materialSlot: 1, key: 'b' },
      { geo: 'geometryMergeTestAsyncBox', matrix: mirrored, key: 'c' },
    ];
  };

  test("the worker's merge is the main thread's, each geometry sent once", async () => {
    const merged = await mergeGeometryPartsAsync(parts(), { groups: 'BY_SLOT' });
    expect(worker.geometriesSent).toBe(2);
    const expected = mergeGeometryParts(parts(), { groups: 'BY_SLOT' });
    expect(Object.keys(merged.attributes).sort()).toEqual(Object.keys(expected.attributes).sort());
    for (const name in expected.attributes) {
      expect(merged.attributes[name].array).toEqual(expected.attributes[name].array);
      expect(merged.attributes[name].itemSize).toBe(expected.attributes[name].itemSize);
    }
    expect(merged.index!.array).toEqual(expected.index!.array);
    expect(merged.groups).toEqual(expected.groups);
    expect(merged.userData.mergeParts).toEqual(expected.userData.mergeParts);
    expect(merged.boundingSphere!.radius).toBeCloseTo(expected.boundingSphere!.radius, 6);
    expect(merged.boundingBox!.equals(expected.boundingBox!)).toBe(true);
    // The request transferred copies: the registered box is whole
    expect(getGeometry('geometryMergeTestAsyncBox')!.attributes.position.array.length).toBe(72);
  });

  test('a refused merge rejects before anything is sent', async () => {
    worker.requests = 0;
    const skinned = new THREE.BoxGeometry();
    skinned.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(96), 4));
    await expect(mergeGeometryPartsAsync([{ geo: skinned }])).rejects.toThrow(/skinned/);
    await expect(mergeGeometryPartsAsync([{ geo: 'geometryMergeTestNone' }])).rejects.toThrow(
      /geometryMergeTestNone/
    );
    expect(worker.requests).toBe(0);
  });

  test('runs on the main thread where MERGE is targeted there', async () => {
    worker.isOn = false;
    worker.requests = 0;
    try {
      const merged = await mergeGeometryPartsAsync(parts());
      expect(merged.userData.mergeParts.map((range) => range.key)).toEqual(['a', 'b', 'c']);
      expect(worker.requests).toBe(0);
    } finally {
      worker.isOn = true;
    }
  });
});

describe('registerMergedGeometryAsync', () => {
  test("registers in the call's owner scope, not the one in force when it resolves", async () => {
    const pending = runInAssetOwnerScope('geometryMergeTestScene#1', () =>
      registerMergedGeometryAsync([{ geo: new THREE.BoxGeometry() }], {
        id: 'geometryMergeTestAsyncOwned',
      })
    );
    const geometry = await pending;
    expect(getGeometry('geometryMergeTestAsyncOwned')).toBe(geometry);
    expect(getAssetOwners(geometry)).toEqual(['geometryMergeTestScene#1']);
  });

  test('a taken id returns the registered geometry; of two overlapping calls the first wins', async () => {
    worker.requests = 0;
    const taken = await registerMergedGeometryAsync([{ geo: new THREE.BoxGeometry() }], {
      id: 'geometryMergeTestAsyncOwned',
    });
    expect(taken).toBe(getGeometry('geometryMergeTestAsyncOwned'));
    expect(worker.requests).toBe(0);

    const first = registerMergedGeometryAsync([{ geo: new THREE.BoxGeometry() }], {
      id: 'geometryMergeTestAsyncRace',
    });
    const second = registerMergedGeometryAsync([{ geo: new THREE.SphereGeometry() }], {
      id: 'geometryMergeTestAsyncRace',
    });
    const [a, b] = await Promise.all([first, second]);
    expect(b).toBe(a);
    expect(a.attributes.position.count).toBe(24);
  });
});
