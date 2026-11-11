import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  int,
  ivec2,
  normalMap,
  storage,
  textureLoad,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { sampleArrayLayer } from 'aekasha';

// p374 Phase 0: the merge material written by hand (docs/plans/p374_multi-material-merging.md D3).
// One MeshStandardNodeMaterial for a palette of STANDARD materials: each vertex carries its
// material's palette index (`aekMatIndex`, flat), a parameter table holds each entry's scalars and
// UV transform, and one texture array per map slot holds each entry's map as a layer. Phase 2 moves
// this into the merging feature.

/** The attribute that carries a vertex's palette index. */
export const MAT_INDEX_ATTRIBUTE = 'aekMatIndex';

/** The palette index attribute's storage: Phase 0 tries each on both backends. */
export type MatIndexType = 'uint8' | 'uint16' | 'uint32' | 'float32';

/** Where the parameter table lives: a uniform array, a float texture (`textureLoad`) or a storage
 * buffer (WebGL2 reads it through three's PBO path). */
export type TableKind = 'UNIFORM' | 'TEXTURE' | 'STORAGE';

/**
 * A palette entry's parameters: a STANDARD material's scalars and its maps' UV transform.
 * Colours in the working (linear) colour space, as `THREE.Color` holds them.
 */
export type PaletteEntry = {
  color: THREE.Color;
  opacity: number;
  emissive: THREE.Color;
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  normalScale: THREE.Vector2;
  aoMapIntensity: number;
  /** The maps' UV transform (a texture's `matrix`: offset, repeat, rotation, centre). */
  uvMatrix: THREE.Matrix3;
};

/** vec4s per table entry:
 * 0: colour rgb, opacity
 * 1: emissive rgb, intensity
 * 2: roughness, metalness, normal scale x, y
 * 3: UV row 0 (m00, m01, m02), AO intensity
 * 4: UV row 1 (m10, m11, m12), flags (unused yet) */
export const TABLE_VEC4S = 5;

/** A STANDARD material's entry: its scalars, and the UV transform of its first map. */
export const getPaletteEntry = (mat: THREE.MeshStandardMaterial): PaletteEntry => {
  const firstMap = mat.map ?? mat.normalMap ?? mat.aoMap ?? mat.roughnessMap ?? mat.metalnessMap;
  const uvMatrix = new THREE.Matrix3();
  if (firstMap) {
    if (firstMap.matrixAutoUpdate) firstMap.updateMatrix();
    uvMatrix.copy(firstMap.matrix);
  }
  return {
    color: mat.color.clone(),
    opacity: mat.opacity,
    emissive: mat.emissive.clone(),
    emissiveIntensity: mat.emissiveIntensity,
    roughness: mat.roughness,
    metalness: mat.metalness,
    normalScale: mat.normalScale.clone(),
    aoMapIntensity: mat.aoMapIntensity,
    uvMatrix,
  };
};

/** The table's floats, `TABLE_VEC4S` vec4s per entry. */
export const packPaletteTable = (entries: PaletteEntry[]) => {
  const data = new Float32Array(entries.length * TABLE_VEC4S * 4);
  entries.forEach((entry, i) => {
    const e = entry.uvMatrix.elements; // column-major
    // prettier-ignore
    data.set([
      entry.color.r, entry.color.g, entry.color.b, entry.opacity,
      entry.emissive.r, entry.emissive.g, entry.emissive.b, entry.emissiveIntensity,
      entry.roughness, entry.metalness, entry.normalScale.x, entry.normalScale.y,
      e[0], e[3], e[6], entry.aoMapIntensity,
      e[1], e[4], e[7], 0,
    ], i * TABLE_VEC4S * 4);
  });
  return data;
};

/** The palette index as a typed array of `type`, one per vertex. */
export const createMatIndexAttribute = (values: number[], type: MatIndexType) => {
  if (type === 'float32') return new THREE.BufferAttribute(new Float32Array(values), 1);
  const ArrayType = type === 'uint8' ? Uint8Array : type === 'uint16' ? Uint16Array : Uint32Array;
  const attr = new THREE.BufferAttribute(new ArrayType(values), 1);
  // WebGL2 reads it as an integer (vertexAttribIPointer) only with IntType
  attr.gpuType = THREE.IntType;
  return attr;
};

/** A table row reader: entry `index`'s vec4 number `row`. */
type RowReader = (index: Node<'uint'>, row: number) => Node<'vec4'>;

/** The table in its kind's storage, and what has to be disposed with it. */
const createTableReader = (
  kind: TableKind,
  data: Float32Array,
  entryCount: number
): { read: RowReader; dispose: () => void } => {
  if (kind === 'UNIFORM') {
    const vectors: THREE.Vector4[] = [];
    for (let i = 0; i < data.length; i += 4) {
      vectors.push(new THREE.Vector4(data[i], data[i + 1], data[i + 2], data[i + 3]));
    }
    const table = uniformArray(vectors, 'vec4');
    return {
      read: (index, row) =>
        table.element(index.mul(TABLE_VEC4S).add(row)) as unknown as Node<'vec4'>,
      dispose: () => {},
    };
  }
  if (kind === 'TEXTURE') {
    // One row of texels per entry: no filtering, read by texel
    const tex = new THREE.DataTexture(
      data,
      TABLE_VEC4S,
      entryCount,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return {
      read: (index, row) =>
        textureLoad(tex, ivec2(int(row), int(index))) as unknown as Node<'vec4'>,
      dispose: () => tex.dispose(),
    };
  }
  const buffer = new THREE.StorageBufferAttribute(data, 4);
  const table = storage(buffer, 'vec4', entryCount * TABLE_VEC4S).toReadOnly();
  return {
    read: (index, row) => table.element(index.mul(TABLE_VEC4S).add(row)) as unknown as Node<'vec4'>,
    dispose: () => {},
  };
};

/** The merge material's per-slot arrays: layer `i` is palette entry `i`'s map (or its neutral). */
export type PaletteArrays = {
  /** sRGB albedo (rgb) and alpha (a). */
  map: THREE.Texture;
  /** Tangent-space normal map (linear). */
  normalMap: THREE.Texture;
  /** AO (r), roughness (g), metalness (b), linear: three's own channels for these maps. */
  orm: THREE.Texture;
};

/**
 * The merge material: a `MeshStandardNodeMaterial` whose sockets read the table entry of the
 * fragment's palette index and sample each slot's array at that layer, as a STANDARD material
 * reads its scalars and maps.
 * @returns the material, and a dispose for the table's storage (the arrays are the caller's)
 */
export const createMergeMaterialPrototype = (opts: {
  arrays: PaletteArrays;
  entries: PaletteEntry[];
  table: TableKind;
  indexType: MatIndexType;
  /** Features left out (Phase 0's bisection): `orm` (scalars only), `emissive` */
  strip?: Set<string>;
}) => {
  const { arrays, entries, table, indexType, strip = new Set() } = opts;
  const reader = createTableReader(table, packPaletteTable(entries), entries.length);

  // Flat: one value per triangle by construction (a member's vertices share it)
  const indexAttr = attribute(MAT_INDEX_ATTRIBUTE, indexType === 'float32' ? 'float' : 'uint');
  const index = varying(indexAttr)
    .setInterpolation(THREE.InterpolationSamplingType.FLAT)
    .toUint() as unknown as Node<'uint'>;
  const layer = int(index) as unknown as Node;
  const row = (r: number) => reader.read(index, r);

  const colorRow = row(0);
  const emissiveRow = row(1);
  const scalars = row(2);
  const uvRow0 = row(3);
  const uvRow1 = row(4);

  // The entry's UV transform, as a texture's matrix applies it: (M * vec3(uv, 1)).xy
  const meshUv = vec3(uv() as unknown as Node<'vec2'>, float(1));
  const entryUv = vec2(meshUv.dot(uvRow0.xyz), meshUv.dot(uvRow1.xyz)) as unknown as Node<'vec2'>;

  const albedo = sampleArrayLayer(arrays.map, entryUv, layer);
  const normalSample = sampleArrayLayer(arrays.normalMap, entryUv, layer);
  const orm = sampleArrayLayer(arrays.orm, entryUv, layer);

  const mat = new THREE.MeshStandardNodeMaterial();
  const albedoRgb = albedo.rgb as unknown as Node<'vec3'>;
  const albedoAlpha = albedo.a as unknown as Node<'float'>;
  mat.colorNode = vec4(colorRow.xyz.mul(albedoRgb), colorRow.w.mul(albedoAlpha));
  if (!strip.has('emissive')) {
    mat.emissiveNode = emissiveRow.xyz.mul(emissiveRow.w) as unknown as Node<'vec3'>;
  }
  if (strip.has('orm')) {
    mat.roughnessNode = scalars.x as unknown as Node<'float'>;
    mat.metalnessNode = scalars.y as unknown as Node<'float'>;
  } else {
    mat.roughnessNode = scalars.x.mul(orm.g) as unknown as Node<'float'>;
    mat.metalnessNode = scalars.y.mul(orm.b) as unknown as Node<'float'>;
    // three's aoMap: (ao - 1) * intensity + 1, on the indirect light only
    mat.aoNode = orm.r.sub(1).mul(uvRow0.w).add(1) as unknown as Node<'float'>;
  }
  mat.normalNode = normalMap(normalSample.xyz, scalars.zw) as unknown as Node<'vec3'>;
  return { material: mat, dispose: reader.dispose };
};
