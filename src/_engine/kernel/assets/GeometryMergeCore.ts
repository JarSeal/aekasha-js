// The geometry merge itself (p371 D1), worker-safe: three only (no Logger, Config or registry),
// so the assets worker's merge job (p371 D4) runs it as it is. `GeometryMerge.ts` resolves ids,
// logs the warnings and registers.
import * as THREE from 'three/webgpu';

/**
 * A part {@link mergeGeometryPartsCore} merges: a geometry, already resolved.
 * @internal
 */
export type ResolvedMergePart = {
  geometry: THREE.BufferGeometry;
  matrix?: THREE.Matrix4;
  materialSlot?: number;
  paletteIndex?: number;
  key?: string;
};

/**
 * The per-vertex attribute a merge writes each part's `paletteIndex` into (p374 D3): an integer
 * (`gpuType` `IntType`), which the merge material reads as a flat `uint`.
 * @internal
 */
export const MERGE_PALETTE_INDEX_ATTRIBUTE = 'aekMatIndex';

/** The largest palette index (a `Uint16` attribute). */
const MAX_PALETTE_INDEX = 65535;

/** How a merge builds its geometry (`mergeGeometryParts`' options). */
export type MergeGeometryOptions = {
  /** `BY_SLOT` sorts the parts by `materialSlot` and makes one geometry group per slot (for a
   * mesh with a material array); `NONE` (default) makes no groups. */
  groups?: 'NONE' | 'BY_SLOT';
  /** `UNION` (default) keeps every attribute any part has, filling it with a default (uv 0,
   * colour 1, others 0; a missing tangent computed) where a part lacks it; `INTERSECTION` keeps
   * only the attributes every part has. */
  attributes?: 'UNION' | 'INTERSECTION';
  /** An indexed result (default true); false gives a non-indexed one. */
  indexed?: boolean;
};

/** A merged part's ranges in the merged geometry's buffers (its `userData.mergeParts` entry). */
export type MergePartRange = {
  /** The part's `key`, when it had one. */
  key?: string;
  /** Its first vertex in the merged attributes. */
  vertexStart: number;
  /** Its vertex count. */
  vertexCount: number;
  /** Its first index in the merged index (a non-indexed result: its first vertex). */
  indexStart: number;
  /** Its index count (a non-indexed result: its vertex count). */
  indexCount: number;
  /** Its material slot (0 when it had none). */
  materialSlot: number;
  /** Its palette index, when the merge wrote `aekMatIndex` (some part had one; 0 for a part
   * without). */
  paletteIndex?: number;
};

/** A merged geometry: a `BufferGeometry` whose `userData.mergeParts` maps each part to its
 * ranges, in the merged order (`BY_SLOT` sorts the parts). */
export type MergedGeometry = THREE.BufferGeometry & {
  userData: { mergeParts: MergePartRange[] };
};

/** Attributes whose values are directions or positions, always written as Float32. */
const FLOAT_ATTRIBUTES = new Set(['position', 'normal', 'tangent']);

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type TypedArrayConstructor = new (length: number) => THREE.TypedArray;
/** The arrays three's `normalize` / `denormalize` take (no Float64Array). */
type NormalizableArray = Parameters<typeof THREE.MathUtils.denormalize>[1];

/** What the merged attribute is written as. */
type AttributePlan = {
  name: string;
  itemSize: number;
  arrayType: TypedArrayConstructor;
  normalized: boolean;
  /** Values copied as they are (same type and `normalized` in every part), else denormalized */
  rawCopy: boolean;
  /** The default component, as written into `arrayType` */
  fill: number;
  /** `IntType` when every part's attribute is read as an integer (and copied raw) */
  gpuType?: typeof THREE.IntType;
};

const getArray = (attr: AnyAttribute) =>
  (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (attr as THREE.InterleavedBufferAttribute).data.array
    : (attr as THREE.BufferAttribute).array;

/** A component's stored value, not denormalized (an interleaved attribute read through its
 * stride). */
const readRaw = (attr: AnyAttribute, index: number, component: number) => {
  if ((attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const inter = attr as THREE.InterleavedBufferAttribute;
    return inter.data.array[index * inter.data.stride + inter.offset + component];
  }
  return (attr as THREE.BufferAttribute).array[index * attr.itemSize + component];
};

/** A component's value: denormalized for a normalized attribute. */
const readValue = (attr: AnyAttribute, index: number, component: number) => {
  const raw = readRaw(attr, index, component);
  return attr.normalized
    ? THREE.MathUtils.denormalize(raw, getArray(attr) as NormalizableArray)
    : raw;
};

const defaultValue = (name: string) => (name === 'color' ? 1 : 0);

/** Parts with morph targets or skinning can't share one buffer (p370 §4). */
const assertMergeable = (geometry: THREE.BufferGeometry, i: number) => {
  const morphs = Object.entries(geometry.morphAttributes)
    .filter(([, list]) => list?.length)
    .map(([name]) => name);
  if (morphs.length) {
    throw new Error(
      `Merge part ${i} has morph attributes (${morphs.join(', ')}): a morphed geometry can't be merged.`
    );
  }
  if (geometry.attributes.skinIndex || geometry.attributes.skinWeight) {
    throw new Error(`Merge part ${i} is skinned (skinIndex / skinWeight): it can't be merged.`);
  }
  const position = geometry.attributes.position as AnyAttribute | undefined;
  if (!position || position.itemSize !== 3) {
    throw new Error(`Merge part ${i} has no 3-component "position" attribute.`);
  }
};

/**
 * Throws for parts the merge refuses, before any work: a morphed or skinned part, one without a
 * 3-component position, or one attribute with different item sizes across parts.
 * {@link mergeGeometryPartsCore} runs it first, and `mergeGeometryPartsAsync` on the main
 * thread before it sends anything, so a refused merge throws there instead of failing in the
 * worker and running again.
 * @internal
 * @param geometries the parts' geometries, in the parts' order (for the errors' part indices)
 */
export const assertMergeableParts = (geometries: readonly THREE.BufferGeometry[]) => {
  const itemSizes = new Map<string, number>();
  geometries.forEach((geometry, i) => {
    assertMergeable(geometry, i);
    for (const name in geometry.attributes) {
      const { itemSize } = geometry.attributes[name];
      const earlier = itemSizes.get(name);
      if (earlier === undefined) itemSizes.set(name, itemSize);
      else if (earlier !== itemSize) {
        throw new Error(
          `Merge part ${i}'s "${name}" has ${itemSize} components, an earlier part's ${earlier}.`
        );
      }
    }
  });
};

/**
 * Throws for a part whose `paletteIndex` isn't an integer from 0 to 65 535 (a `Uint16`
 * attribute). `mergeGeometryPartsAsync` runs it on the main thread before it sends anything.
 * @internal
 */
export const assertPaletteIndices = (parts: readonly { paletteIndex?: number }[]) => {
  parts.forEach(({ paletteIndex }, i) => {
    if (paletteIndex === undefined) return;
    if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex > MAX_PALETTE_INDEX) {
      throw new Error(
        `Merge part ${i}'s paletteIndex is ${paletteIndex}: an integer from 0 to ${MAX_PALETTE_INDEX}.`
      );
    }
  });
};

/** The palette index attribute's array: `Uint8` up to index 255, else `Uint16`; undefined when
 * no part has a palette index. */
const getPaletteIndexArrayType = (parts: ResolvedMergePart[]) => {
  let max = -1;
  for (const part of parts) {
    if (part.paletteIndex !== undefined) max = Math.max(max, part.paletteIndex);
  }
  if (max < 0) return undefined;
  return max > 255 ? Uint16Array : Uint8Array;
};

/** A temporary geometry with the part's tangents computed (the part itself is only read), or
 * null when it lacks the normals or uvs that takes. */
const computePartTangents = (geometry: THREE.BufferGeometry) => {
  const { position, normal, uv } = geometry.attributes;
  if (!normal || !uv) return null;
  const temp = new THREE.BufferGeometry();
  temp.setAttribute('position', position);
  temp.setAttribute('normal', normal);
  temp.setAttribute('uv', uv);
  temp.setIndex(geometry.index ?? createTrivialIndex(position.count));
  temp.computeTangents();
  return temp.getAttribute('tangent') as THREE.BufferAttribute;
};

const createTrivialIndex = (count: number) => {
  const array = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  for (let i = 0; i < count; i++) array[i] = i;
  return new THREE.BufferAttribute(array, 1);
};

/** Whether an attribute is read as an integer in the shader (`gpuType` `IntType`, which only a
 * plain `BufferAttribute` carries). */
const isIntegerAttribute = (attr: AnyAttribute) =>
  (attr as THREE.BufferAttribute).gpuType === THREE.IntType && !attr.normalized;

/** The widest of the parts' integer array types, or undefined when one isn't an integer array. */
const getWidestIntegerArray = (arrays: Set<unknown>) => {
  let widest: TypedArrayConstructor | undefined;
  for (const array of arrays) {
    if (array === Float32Array || array === Float64Array) return undefined;
    const type = array as TypedArrayConstructor & { BYTES_PER_ELEMENT: number };
    if (!widest || type.BYTES_PER_ELEMENT > (widest as typeof type).BYTES_PER_ELEMENT) {
      widest = type;
    }
  }
  return widest;
};

/** The merged attributes, from the parts' attributes and the attribute mode (the parts checked
 * by {@link assertMergeableParts}). `skip` is an attribute the merge writes itself. */
const planAttributes = (
  parts: ResolvedMergePart[],
  mode: 'UNION' | 'INTERSECTION',
  tangents: (AnyAttribute | null)[],
  warnings: string[],
  skip?: string
): AttributePlan[] => {
  type Seen = {
    itemSize: number;
    count: number;
    arrays: Set<unknown>;
    normalized: Set<boolean>;
    isInteger: boolean;
  };
  const seen = new Map<string, Seen>();
  for (let i = 0; i < parts.length; i++) {
    const attributes = parts[i].geometry.attributes;
    for (const name in attributes) {
      if (name === skip) continue;
      const attr = attributes[name] as AnyAttribute;
      const entry = seen.get(name);
      if (!entry) {
        seen.set(name, {
          itemSize: attr.itemSize,
          count: 1,
          arrays: new Set([getArray(attr).constructor]),
          normalized: new Set([attr.normalized]),
          isInteger: isIntegerAttribute(attr),
        });
        continue;
      }
      entry.count++;
      entry.arrays.add(getArray(attr).constructor);
      entry.normalized.add(attr.normalized);
      entry.isInteger &&= isIntegerAttribute(attr);
    }
  }

  const plans: AttributePlan[] = [];
  for (const [name, entry] of seen) {
    const inEvery = entry.count === parts.length;
    if (!inEvery && mode === 'INTERSECTION') continue;
    if (!inEvery && name === 'tangent') {
      const missing = parts.findIndex(
        (part, i) => !part.geometry.attributes.tangent && !tangents[i]
      );
      if (missing !== -1) {
        warnings.push(
          `part ${missing} has no tangents and no normals and uvs to compute them from: the merged geometry has no "tangent" attribute.`
        );
        continue;
      }
    }
    const isFloat = FLOAT_ATTRIBUTES.has(name);
    // An integer attribute (eg. a palette index) stays one: its values copied raw into the
    // widest of its parts' integer arrays
    const integerArray =
      entry.isInteger && !isFloat ? getWidestIntegerArray(entry.arrays) : undefined;
    if (integerArray) {
      plans.push({
        name,
        itemSize: entry.itemSize,
        arrayType: integerArray,
        normalized: false,
        rawCopy: true,
        fill: 0,
        gpuType: THREE.IntType,
      });
      continue;
    }
    const sameStorage = entry.arrays.size === 1 && entry.normalized.size === 1;
    const rawCopy = !isFloat && sameStorage;
    const arrayType = rawCopy
      ? ([...entry.arrays][0] as TypedArrayConstructor)
      : (Float32Array as TypedArrayConstructor);
    const normalized = rawCopy && [...entry.normalized][0];
    const value = defaultValue(name);
    const fill = normalized
      ? THREE.MathUtils.normalize(value, new arrayType(0) as NormalizableArray)
      : value;
    plans.push({ name, itemSize: entry.itemSize, arrayType, normalized, rawCopy, fill });
  }
  return plans;
};

/** The parts' order in the merge: as given, or sorted by slot (stable) for `BY_SLOT`. */
const orderParts = (parts: ResolvedMergePart[], groups: 'NONE' | 'BY_SLOT') => {
  const order = parts.map((_, i) => i);
  if (groups === 'BY_SLOT') {
    order.sort((a, b) => (parts[a].materialSlot ?? 0) - (parts[b].materialSlot ?? 0) || a - b);
  }
  return order;
};

const scratchVector = new THREE.Vector3();
const scratchNormalMatrix = new THREE.Matrix3();
const scratchLinearMatrix = new THREE.Matrix3();

/** Writes one part's vertices into the merged attributes from `vertexStart`, transformed. */
const writePartAttributes = (
  part: ResolvedMergePart,
  tangent: AnyAttribute | null,
  plans: AttributePlan[],
  arrays: THREE.TypedArray[],
  vertexStart: number,
  isMirrored: boolean
) => {
  const { geometry, matrix } = part;
  const count = geometry.attributes.position.count;
  if (matrix) {
    scratchNormalMatrix.getNormalMatrix(matrix);
    scratchLinearMatrix.setFromMatrix4(matrix);
  }
  for (let p = 0; p < plans.length; p++) {
    const plan = plans[p];
    const out = arrays[p];
    const { itemSize, name } = plan;
    const source =
      (name === 'tangent' ? geometry.attributes.tangent ?? tangent : null) ??
      (geometry.attributes[name] as AnyAttribute | undefined);
    const base = vertexStart * itemSize;
    if (!source) {
      out.fill(plan.fill, base, base + count * itemSize);
      continue;
    }
    if (matrix && (name === 'position' || name === 'normal' || name === 'tangent')) {
      for (let v = 0; v < count; v++) {
        scratchVector.set(
          readValue(source, v, 0),
          readValue(source, v, 1),
          readValue(source, v, 2)
        );
        if (name === 'position') scratchVector.applyMatrix4(matrix);
        else if (name === 'normal') scratchVector.applyMatrix3(scratchNormalMatrix).normalize();
        else scratchVector.applyMatrix3(scratchLinearMatrix).normalize();
        const o = base + v * itemSize;
        out[o] = scratchVector.x;
        out[o + 1] = scratchVector.y;
        out[o + 2] = scratchVector.z;
        // A mirrored part's bitangent (cross(normal, tangent) * w) flips with it: negate w back
        if (itemSize === 4) out[o + 3] = readValue(source, v, 3) * (isMirrored ? -1 : 1);
      }
      continue;
    }
    const read = plan.rawCopy ? readRaw : readValue;
    for (let v = 0; v < count; v++) {
      const o = base + v * itemSize;
      for (let c = 0; c < itemSize; c++) out[o + c] = read(source, v, c);
    }
  }
};

/** Writes one part's triangles into the merged index from `indexStart`, offset by its first
 * vertex, with the winding flipped for a mirrored part. */
const writePartIndex = (
  geometry: THREE.BufferGeometry,
  out: THREE.TypedArray,
  indexStart: number,
  vertexStart: number,
  isMirrored: boolean
) => {
  const { index } = geometry;
  const count = index ? index.count : geometry.attributes.position.count;
  for (let i = 0; i < count; i++) {
    out[indexStart + i] = (index ? index.getX(i) : i) + vertexStart;
  }
  if (!isMirrored) return;
  for (let i = indexStart; i + 2 < indexStart + count; i += 3) {
    const second = out[i + 1];
    out[i + 1] = out[i + 2];
    out[i + 2] = second;
  }
};

const createEmpty = (): MergedGeometry => {
  const geometry = new THREE.BufferGeometry() as MergedGeometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  geometry.userData.mergeParts = [];
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Merges resolved parts into one new geometry with their transforms baked (p371 D1): see
 * `mergeGeometryParts` for the rules. Worker-safe; the parts are only read.
 * @internal
 * @returns the merged geometry (unregistered) and the warnings for the caller to log
 * @throws for a morphed or skinned part, one without a 3-component position, or one attribute
 * with different item sizes across parts
 */
export const mergeGeometryPartsCore = (
  parts: ResolvedMergePart[],
  opts: MergeGeometryOptions = {}
): { geometry: MergedGeometry; warnings: string[] } => {
  const { groups = 'NONE', attributes = 'UNION', indexed = true } = opts;
  const warnings: string[] = [];
  if (!parts.length) return { geometry: createEmpty(), warnings };
  assertMergeableParts(parts.map((part) => part.geometry));
  assertPaletteIndices(parts);

  // A part missing tangents others have gets its own computed (UNION only)
  const hasTangents = parts.some((part) => part.geometry.attributes.tangent);
  const tangents = parts.map((part) =>
    attributes === 'UNION' && hasTangents && !part.geometry.attributes.tangent
      ? computePartTangents(part.geometry)
      : null
  );
  // Any part with a palette index: every vertex gets one (p374 D3), replacing a part's own
  const paletteType = getPaletteIndexArrayType(parts);
  const plans = planAttributes(
    parts,
    attributes,
    tangents,
    warnings,
    paletteType ? MERGE_PALETTE_INDEX_ATTRIBUTE : undefined
  );

  const order = orderParts(parts, groups);
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const part of parts) {
    const { index, attributes: attrs } = part.geometry;
    vertexTotal += attrs.position.count;
    indexTotal += index ? index.count : attrs.position.count;
  }

  const arrays = plans.map((plan) => new plan.arrayType(vertexTotal * plan.itemSize));
  const paletteArray = paletteType && new paletteType(vertexTotal);
  const indexArray =
    vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
  const ranges: MergePartRange[] = [];
  let vertexStart = 0;
  let indexStart = 0;
  for (const i of order) {
    const part = parts[i];
    const isMirrored = part.matrix ? part.matrix.determinant() < 0 : false;
    const vertexCount = part.geometry.attributes.position.count;
    const indexCount = part.geometry.index ? part.geometry.index.count : vertexCount;
    writePartAttributes(part, tangents[i], plans, arrays, vertexStart, isMirrored);
    writePartIndex(part.geometry, indexArray, indexStart, vertexStart, isMirrored);
    const paletteIndex = part.paletteIndex ?? 0;
    paletteArray?.fill(paletteIndex, vertexStart, vertexStart + vertexCount);
    ranges.push({
      ...(part.key !== undefined ? { key: part.key } : {}),
      vertexStart,
      vertexCount,
      indexStart,
      indexCount,
      materialSlot: part.materialSlot ?? 0,
      ...(paletteArray ? { paletteIndex } : {}),
    });
    vertexStart += vertexCount;
    indexStart += indexCount;
  }

  let geometry = new THREE.BufferGeometry();
  plans.forEach((plan, p) => {
    const attr = new THREE.BufferAttribute(arrays[p], plan.itemSize, plan.normalized);
    if (plan.gpuType) attr.gpuType = plan.gpuType;
    geometry.setAttribute(plan.name, attr);
  });
  if (paletteArray) {
    const attr = new THREE.BufferAttribute(paletteArray, 1);
    // WebGL2 reads it as an integer (vertexAttribIPointer) only so
    attr.gpuType = THREE.IntType;
    geometry.setAttribute(MERGE_PALETTE_INDEX_ATTRIBUTE, attr);
  }
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  if (groups === 'BY_SLOT') {
    for (const range of ranges) {
      const last = geometry.groups[geometry.groups.length - 1];
      if (last && last.materialIndex === range.materialSlot) last.count += range.indexCount;
      else geometry.addGroup(range.indexStart, range.indexCount, range.materialSlot);
    }
  }
  if (!indexed) {
    // Each index becomes a vertex: a part's vertices are its index range now
    geometry = geometry.toNonIndexed();
    // three's toNonIndexed makes new attributes without their gpuType
    for (const plan of plans) {
      if (plan.gpuType)
        (geometry.attributes[plan.name] as THREE.BufferAttribute).gpuType = plan.gpuType;
    }
    if (paletteArray) {
      (geometry.attributes[MERGE_PALETTE_INDEX_ATTRIBUTE] as THREE.BufferAttribute).gpuType =
        THREE.IntType;
    }
    for (const range of ranges) {
      range.vertexStart = range.indexStart;
      range.vertexCount = range.indexCount;
    }
  }

  const merged = geometry as MergedGeometry;
  merged.userData.mergeParts = ranges;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return { geometry: merged, warnings };
};
