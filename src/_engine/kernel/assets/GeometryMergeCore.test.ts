import { describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  MERGE_PALETTE_INDEX_ATTRIBUTE,
  mergeGeometryPartsCore,
  type MergedGeometry,
} from './GeometryMergeCore';

const merge = (...args: Parameters<typeof mergeGeometryPartsCore>) =>
  mergeGeometryPartsCore(...args).geometry;

const vertex = (geometry: THREE.BufferGeometry, name: string, i: number) =>
  new THREE.Vector3().fromBufferAttribute(geometry.getAttribute(name), i);

/** Every triangle's face normal (from its winding) against its first vertex's normal. */
const windingAgreesWithNormals = (geometry: THREE.BufferGeometry) => {
  const index = geometry.index!;
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const pa = vertex(geometry, 'position', a);
    ab.subVectors(vertex(geometry, 'position', b), pa);
    ac.subVectors(vertex(geometry, 'position', c), pa);
    const face = ab.cross(ac);
    if (face.lengthSq() < 1e-12) continue;
    if (face.dot(vertex(geometry, 'normal', a)) <= 0) return false;
  }
  return true;
};

describe('transforms', () => {
  test('bakes positions by the matrix and normals by its normal matrix', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(5, 0, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
      new THREE.Vector3(1, 1, 1)
    );
    const merged = merge([{ geometry: box }, { geometry: box, matrix }]);
    const count = box.attributes.position.count;
    for (let i = 0; i < count; i++) {
      const expected = vertex(box, 'position', i).applyMatrix4(matrix);
      expect(vertex(merged, 'position', count + i).distanceTo(expected)).toBeLessThan(1e-6);
      const normal = vertex(box, 'normal', i).applyMatrix3(
        new THREE.Matrix3().getNormalMatrix(matrix)
      );
      expect(vertex(merged, 'normal', count + i).distanceTo(normal)).toBeLessThan(1e-6);
    }
    // The untransformed part is copied as it is
    expect(vertex(merged, 'position', 0).equals(vertex(box, 'position', 0))).toBe(true);
  });

  test('keeps normals perpendicular to the surface under non-uniform scale', () => {
    const sphere = new THREE.SphereGeometry(1, 16, 8);
    const merged = merge([{ geometry: sphere, matrix: new THREE.Matrix4().makeScale(3, 1, 1) }]);
    expect(windingAgreesWithNormals(merged)).toBe(true);
    // A vertex at 45° in xy: the stretched surface's normal leans towards y
    const normal = new THREE.Vector3(1, 1, 0).normalize();
    const expected = normal
      .clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().makeScale(3, 1, 1)));
    expect(expected.normalize().y).toBeGreaterThan(expected.x);
    for (let i = 0; i < merged.attributes.normal.count; i++) {
      expect(vertex(merged, 'normal', i).length()).toBeCloseTo(1, 5);
    }
  });

  test('flips a mirrored part’s winding and its tangents’ w', () => {
    const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    cylinder.computeTangents();
    const mirror = new THREE.Matrix4().makeScale(-1, 1, 1);
    const merged = merge([{ geometry: cylinder }, { geometry: cylinder, matrix: mirror }]);
    expect(windingAgreesWithNormals(merged)).toBe(true);
    const count = cylinder.attributes.position.count;
    const tangents = merged.getAttribute('tangent');
    expect(tangents.getW(count)).toBe(-cylinder.getAttribute('tangent').getW(0));
    expect(tangents.getW(0)).toBe(cylinder.getAttribute('tangent').getW(0));
    // Without the flip the mirrored half would face inwards
    const unflipped = cylinder.clone().applyMatrix4(mirror);
    expect(windingAgreesWithNormals(unflipped)).toBe(false);
  });
});

describe('attributes', () => {
  const withColor = () => {
    const box = new THREE.BoxGeometry();
    const colors = new Float32Array(box.attributes.position.count * 3).fill(0.25);
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return box;
  };

  test('UNION fills a missing colour with 1 and a missing uv with 0', () => {
    const plain = new THREE.BoxGeometry();
    plain.deleteAttribute('uv');
    const merged = merge([{ geometry: withColor() }, { geometry: plain }]);
    const count = plain.attributes.position.count;
    expect(merged.getAttribute('color').getX(0)).toBe(0.25);
    expect(merged.getAttribute('color').getZ(count)).toBe(1);
    expect(merged.getAttribute('uv').getY(count)).toBe(0);
  });

  test('INTERSECTION drops what not every part has', () => {
    const merged = merge([{ geometry: withColor() }, { geometry: new THREE.BoxGeometry() }], {
      attributes: 'INTERSECTION',
    });
    expect(merged.getAttribute('color')).toBeUndefined();
    expect(Object.keys(merged.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });

  test('computes the tangents a part lacks, or drops them with a warning', () => {
    const withTangents = new THREE.BoxGeometry();
    withTangents.computeTangents();
    const computed = mergeGeometryPartsCore([
      { geometry: withTangents },
      { geometry: new THREE.BoxGeometry() },
    ]);
    expect(computed.warnings).toEqual([]);
    expect(computed.geometry.getAttribute('tangent').count).toBe(48);

    const noUv = new THREE.BoxGeometry();
    noUv.deleteAttribute('uv');
    const dropped = mergeGeometryPartsCore([{ geometry: withTangents }, { geometry: noUv }]);
    expect(dropped.geometry.getAttribute('tangent')).toBeUndefined();
    expect(dropped.warnings).toHaveLength(1);
    // The source geometry is only read
    expect(new THREE.BoxGeometry().getAttribute('tangent')).toBeUndefined();
  });

  test('reads quantized and interleaved attributes as values', () => {
    const box = new THREE.BoxGeometry(2, 2, 2);
    const count = box.attributes.position.count;
    // Positions ±1 as normalized Int16, normals interleaved with the uvs
    const quantized = new Int16Array(count * 3);
    for (let i = 0; i < count * 3; i++)
      quantized[i] = Math.round(box.attributes.position.array[i] * 32767);
    const interleaved = new THREE.InterleavedBuffer(new Float32Array(count * 5), 5);
    for (let i = 0; i < count; i++) {
      interleaved.array.set(
        [
          ...vertex(box, 'normal', i).toArray(),
          box.attributes.uv.getX(i),
          box.attributes.uv.getY(i),
        ],
        i * 5
      );
    }
    const packed = new THREE.BufferGeometry();
    packed.setIndex(box.index);
    packed.setAttribute('position', new THREE.BufferAttribute(quantized, 3, true));
    packed.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    packed.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleaved, 2, 3));

    const merged = merge([{ geometry: packed }, { geometry: box }]);
    expect(merged.getAttribute('position').array).toBeInstanceOf(Float32Array);
    expect(merged.getAttribute('position').normalized).toBe(false);
    for (let i = 0; i < count; i++) {
      expect(vertex(merged, 'position', i).distanceTo(vertex(box, 'position', i))).toBeLessThan(
        1e-4
      );
      expect(vertex(merged, 'normal', i).equals(vertex(box, 'normal', i))).toBe(true);
      expect(merged.getAttribute('uv').getY(i)).toBe(box.attributes.uv.getY(i));
    }
  });

  test('keeps a shared normalized type and fills it with the type’s 1', () => {
    const box = new THREE.BoxGeometry();
    const colors = new Uint8Array(box.attributes.position.count * 4).fill(128);
    const colored = box.clone();
    colored.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
    const merged = merge([{ geometry: colored }, { geometry: box }]);
    const color = merged.getAttribute('color') as THREE.BufferAttribute;
    expect(color.array).toBeInstanceOf(Uint8Array);
    expect(color.normalized).toBe(true);
    expect(color.array[0]).toBe(128);
    expect(color.array[color.array.length - 1]).toBe(255);
  });

  test('refuses morphed, skinned and mismatched parts', () => {
    const morphed = new THREE.BoxGeometry();
    morphed.morphAttributes.position = [morphed.attributes.position.clone()];
    expect(() => merge([{ geometry: morphed }])).toThrow(/morph/);
    const skinned = new THREE.BoxGeometry();
    skinned.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(96), 4));
    expect(() => merge([{ geometry: skinned }])).toThrow(/skinned/);
    const wideUv = new THREE.BoxGeometry();
    wideUv.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(72), 3));
    expect(() => merge([{ geometry: new THREE.BoxGeometry() }, { geometry: wideUv }])).toThrow(
      /3 components/
    );
  });
});

describe('index and parts', () => {
  test('is Uint16 while it fits and Uint32 past 65 535 vertices', () => {
    const small = merge([{ geometry: new THREE.BoxGeometry() }]);
    expect(small.index!.array).toBeInstanceOf(Uint16Array);
    const plane = new THREE.PlaneGeometry(1, 1, 255, 255); // 65 536 vertices
    const big = merge([{ geometry: plane }]);
    expect(big.index!.array).toBeInstanceOf(Uint32Array);
    expect(big.index!.getX(big.index!.count - 1)).toBe(plane.index!.getX(plane.index!.count - 1));
  });

  test('indexes non-indexed parts and offsets every part’s indices', () => {
    const box = new THREE.BoxGeometry();
    const soup = box.toNonIndexed();
    const merged = merge([{ geometry: box }, { geometry: soup, key: 'soup' }]);
    const parts = (merged as MergedGeometry).userData.mergeParts;
    expect(parts).toEqual([
      { vertexStart: 0, vertexCount: 24, indexStart: 0, indexCount: 36, materialSlot: 0 },
      {
        key: 'soup',
        vertexStart: 24,
        vertexCount: 36,
        indexStart: 36,
        indexCount: 36,
        materialSlot: 0,
      },
    ]);
    expect(merged.index!.getX(36)).toBe(24);
    expect(merged.index!.getX(71)).toBe(59);
    expect(merged.groups).toEqual([]);
  });

  test('BY_SLOT sorts the parts by slot into one group each', () => {
    const box = new THREE.BoxGeometry();
    const merged = merge(
      [
        { geometry: box, materialSlot: 1, key: 'a' },
        { geometry: box, materialSlot: 0, key: 'b' },
        { geometry: box, materialSlot: 1, key: 'c' },
        { geometry: box, key: 'd' },
      ],
      { groups: 'BY_SLOT' }
    );
    expect(merged.userData.mergeParts.map((part) => part.key)).toEqual(['b', 'd', 'a', 'c']);
    expect(merged.groups).toEqual([
      { start: 0, count: 72, materialIndex: 0 },
      { start: 72, count: 72, materialIndex: 1 },
    ]);
  });

  test('non-indexed output: each part’s vertices are its index range', () => {
    const merged = merge(
      [{ geometry: new THREE.BoxGeometry() }, { geometry: new THREE.BoxGeometry() }],
      {
        indexed: false,
      }
    );
    expect(merged.index).toBeNull();
    expect(merged.attributes.position.count).toBe(72);
    expect(merged.userData.mergeParts[1]).toMatchObject({ vertexStart: 36, vertexCount: 36 });
  });

  test('no parts give an empty geometry with bounds', () => {
    const empty = merge([]);
    expect(empty.attributes.position.count).toBe(0);
    expect(empty.userData.mergeParts).toEqual([]);
    expect(empty.boundingSphere).not.toBeNull();
  });

  test('computes the bounds of the whole merge', () => {
    const merged = merge([
      { geometry: new THREE.BoxGeometry(2, 2, 2) },
      {
        geometry: new THREE.BoxGeometry(2, 2, 2),
        matrix: new THREE.Matrix4().makeTranslation(10, 0, 0),
      },
    ]);
    expect(merged.boundingBox!.min.x).toBe(-1);
    expect(merged.boundingBox!.max.x).toBe(11);
  });
});

describe('palette index (p374 D3)', () => {
  const paletteValues = (geometry: THREE.BufferGeometry) =>
    Array.from(geometry.getAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE).array as Uint8Array);
  const gpuTypeOf = (geometry: THREE.BufferGeometry, name: string) =>
    (geometry.getAttribute(name) as THREE.BufferAttribute).gpuType;

  test("writes each part's index into its vertices as an integer, 0 for a part without", () => {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const merged = merge([
      { geometry: tri, paletteIndex: 3 },
      { geometry: tri },
      { geometry: tri, paletteIndex: 1, key: 'c' },
    ]);
    const attr = merged.getAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE) as THREE.BufferAttribute;
    expect(attr.array).toBeInstanceOf(Uint8Array);
    expect(attr.itemSize).toBe(1);
    expect(attr.normalized).toBe(false);
    expect(attr.gpuType).toBe(THREE.IntType);
    expect(paletteValues(merged)).toEqual([3, 3, 3, 0, 0, 0, 1, 1, 1]);
    expect(merged.userData.mergeParts.map((part) => part.paletteIndex)).toEqual([3, 0, 1]);
  });

  test('no part with an index: no attribute, no index in the ranges', () => {
    const merged = merge([{ geometry: new THREE.BoxGeometry() }]);
    expect(merged.getAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE)).toBeUndefined();
    expect(merged.userData.mergeParts[0]).not.toHaveProperty('paletteIndex');
  });

  test('is Uint16 past index 255, and follows BY_SLOT’s order', () => {
    const box = new THREE.BoxGeometry();
    const merged = merge(
      [
        { geometry: box, materialSlot: 1, paletteIndex: 300 },
        { geometry: box, materialSlot: 0, paletteIndex: 7 },
      ],
      { groups: 'BY_SLOT' }
    );
    const array = merged.getAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE).array;
    expect(array).toBeInstanceOf(Uint16Array);
    expect(array[0]).toBe(7);
    expect(array[24]).toBe(300);
    expect(merged.userData.mergeParts.map((part) => part.paletteIndex)).toEqual([7, 300]);
  });

  test("replaces a part's own index; without new indices an integer attribute stays one", () => {
    const first = merge([{ geometry: new THREE.BoxGeometry(), paletteIndex: 5 }]);
    const again = merge([
      { geometry: first, paletteIndex: 2 },
      { geometry: new THREE.BoxGeometry() },
    ]);
    expect(paletteValues(again).slice(0, 24)).toEqual(new Array(24).fill(2));
    // Merged again as it is: copied raw into an integer array, a part without it filled with 0
    const kept = merge([{ geometry: first }, { geometry: new THREE.BoxGeometry() }]);
    expect(kept.getAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE).array).toBeInstanceOf(Uint8Array);
    expect(gpuTypeOf(kept, MERGE_PALETTE_INDEX_ATTRIBUTE)).toBe(THREE.IntType);
    expect(paletteValues(kept)).toEqual([...new Array(24).fill(5), ...new Array(24).fill(0)]);
    expect(kept.userData.mergeParts[0]).not.toHaveProperty('paletteIndex');
  });

  test('integer attributes of different widths merge into the widest', () => {
    const narrow = new THREE.BoxGeometry();
    const narrowIds = new THREE.BufferAttribute(new Uint8Array(24).fill(200), 1);
    narrowIds.gpuType = THREE.IntType;
    narrow.setAttribute('ids', narrowIds);
    const wide = new THREE.BoxGeometry();
    const wideIds = new THREE.BufferAttribute(new Uint16Array(24).fill(40000), 1);
    wideIds.gpuType = THREE.IntType;
    wide.setAttribute('ids', wideIds);
    const merged = merge([{ geometry: narrow }, { geometry: wide }]);
    const ids = merged.getAttribute('ids');
    expect(ids.array).toBeInstanceOf(Uint16Array);
    expect(gpuTypeOf(merged, 'ids')).toBe(THREE.IntType);
    expect([ids.array[0], ids.array[24]]).toEqual([200, 40000]);
  });

  test('a non-indexed result keeps the integer type', () => {
    const merged = merge([{ geometry: new THREE.BoxGeometry(), paletteIndex: 4 }], {
      indexed: false,
    });
    expect(merged.index).toBeNull();
    expect(gpuTypeOf(merged, MERGE_PALETTE_INDEX_ATTRIBUTE)).toBe(THREE.IntType);
    expect(paletteValues(merged)).toEqual(new Array(36).fill(4));
  });

  test('throws for an index that is not an integer from 0 to 65 535', () => {
    const box = new THREE.BoxGeometry();
    for (const paletteIndex of [-1, 1.5, 65536, Number.NaN]) {
      expect(() => merge([{ geometry: box, paletteIndex }])).toThrow(/paletteIndex/);
    }
  });
});
