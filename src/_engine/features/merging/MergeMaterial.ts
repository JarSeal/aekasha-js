import * as THREE from 'three/webgpu';
import {
  attribute,
  dFdx,
  dFdy,
  float,
  Fn,
  If,
  int,
  ivec2,
  normalMap,
  texture,
  textureLoad,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { sampleArrayLayer } from '../../kernel/assets/TextureArray';
import type { MergeMaterialSlot, SceneMergeMaterial } from './MergeMaterialSchema';

// The merge material (docs/plans/p374_multi-material-merging.md D3): one MeshStandardNodeMaterial
// for a palette of STANDARD materials. Each vertex carries its member's palette index
// (`aekMatIndex`, a flat varying), a float texture holds each member's parameter table entry, and
// one texture array per map slot holds each member's map as a layer. Loaded with an `import()` by
// the first scene that lists a palette (MergeMaterialLoad.ts), so an app without palettes never
// downloads it.

/**
 * The palette index attribute, `GeometryMergeCore.ts`' `MERGE_PALETTE_INDEX_ATTRIBUTE` (a copy:
 * importing it would split the merge core into a chunk of its own; `MergeMaterial.test.ts` checks
 * they match).
 * @internal
 */
export const MERGE_MATERIAL_INDEX_ATTRIBUTE = 'aekMatIndex';

/**
 * The palette's map slots in the merge material's order: the schema's `MERGE_MATERIAL_SLOTS`
 * (the runtime imports no zod; `MergeMaterial.test.ts` checks they match). A slot's index is its
 * flag bit.
 * @internal
 */
export const MERGE_MATERIAL_RUNTIME_SLOTS = [
  'map',
  'normalMap',
  'orm',
  'emissiveMap',
] as const satisfies readonly MergeMaterialSlot[];

/**
 * Texels (vec4s) per table entry, one row per entry:
 * 0: colour rgb (linear), opacity
 * 1: emissive rgb (linear), intensity
 * 2: roughness, metalness, normal scale x, y
 * 3: UV row 0 (m00, m01, m02), AO intensity
 * 4: UV row 1 (m10, m11, m12), slot flags (bit `i`: the member has slot `i`'s map, set only for a
 *    `SKIP` slot)
 * @internal
 */
export const MERGE_TABLE_TEXELS = 5;

/** What a member without a slot's map samples: white albedo, a flat normal, white ORM (its
 * scalars stay), white emissive (its colour stays). The gatherer's neutral layers hold the same. */
const NEUTRAL: Record<MergeMaterialSlot, [number, number, number, number]> = {
  map: [1, 1, 1, 1],
  normalMap: [0.5, 0.5, 1, 1],
  orm: [1, 1, 1, 1],
  emissiveMap: [1, 1, 1, 1],
};

/** Each `SKIP` slot's flag bits by member: bit `i` when the member has slot `i`'s map. */
const getSkipFlags = (palette: SceneMergeMaterial) => {
  const flags = new Array<number>(palette.materials.length).fill(0);
  MERGE_MATERIAL_RUNTIME_SLOTS.forEach((slot, bit) => {
    const info = palette.__slots[slot];
    if (info?.missing !== 'SKIP') return;
    info.has.forEach((has, index) => {
      if (has) flags[index] |= 1 << bit;
    });
  });
  return flags;
};

const scratchColor = new THREE.Color();

/**
 * The palette's parameter table, `MERGE_TABLE_TEXELS` RGBA floats per entry, from its baked
 * entries: colours converted as `THREE.Color.set` converts a member's (into the working colour
 * space), the UV transform the identity (a JSON member's maps have none).
 * @internal
 */
export const packMergeMaterialTable = (palette: SceneMergeMaterial) => {
  const entries = palette.__entries;
  const flags = getSkipFlags(palette);
  const data = new Float32Array(entries.length * MERGE_TABLE_TEXELS * 4);
  entries.forEach((entry, i) => {
    const { r, g, b } = scratchColor.set(entry.color);
    const emissive = new THREE.Color().set(entry.emissive);
    // prettier-ignore
    data.set([
      r, g, b, entry.opacity,
      emissive.r, emissive.g, emissive.b, entry.emissiveIntensity,
      entry.roughness, entry.metalness, entry.normalScale[0], entry.normalScale[1],
      1, 0, 0, entry.aoMapIntensity,
      0, 1, 0, flags[i],
    ], i * MERGE_TABLE_TEXELS * 4);
  });
  return data;
};

/** Whether a member's emissive term can be other than black */
const isEntryEmissive = (data: Float32Array, index: number) => {
  const o = index * MERGE_TABLE_TEXELS * 4 + 4;
  return (data[o] > 0 || data[o + 1] > 0 || data[o + 2] > 0) && data[o + 3] !== 0;
};

/**
 * The table as a float texture: one row of texels per entry, read with `textureLoad` (no
 * sampler, no filtering).
 * @internal
 */
export const createMergeMaterialTable = (palette: SceneMergeMaterial) => {
  const data = packMergeMaterialTable(palette);
  const table = new THREE.DataTexture(
    data,
    MERGE_TABLE_TEXELS,
    palette.__entries.length,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  table.minFilter = THREE.NearestFilter;
  table.magFilter = THREE.NearestFilter;
  table.generateMipmaps = false;
  table.needsUpdate = true;
  return table;
};

/**
 * What `userData.mergeMaterial` of a merge material holds.
 * @internal
 */
export type MergeMaterialInfo = {
  /** The palette's id (the material's registry id). */
  paletteId: string;
  /** The member materials' ids, by palette index. */
  materials: string[];
  /** The table texture's registry id. */
  tableId: string;
  /** The slot arrays it samples. */
  arrays: Partial<Record<MergeMaterialSlot, THREE.Texture>>;
};

/** The keys' prefix in `userData.uniforms`: `mergeMaterial_table`, `mergeMaterial_<slot>` */
const UNIFORM_PREFIX = 'mergeMaterial_';

/** The table and the arrays as texture nodes, in `userData.uniforms`: where a scene's asset
 * release, streaming's priming and the GPU memory tab look for a node material's textures */
const recordTextures = (
  material: THREE.Material,
  table: THREE.Texture,
  arrays: Partial<Record<MergeMaterialSlot, THREE.Texture>>
) => {
  const uniforms: Record<string, unknown> = { [`${UNIFORM_PREFIX}table`]: texture(table) };
  for (const slot of MERGE_MATERIAL_RUNTIME_SLOTS) {
    const array = arrays[slot];
    if (array) uniforms[`${UNIFORM_PREFIX}${slot}`] = texture(array);
  }
  material.userData.uniforms = uniforms;
};

/**
 * The merge material of a palette: a `MeshStandardNodeMaterial` whose sockets read the table
 * entry of the fragment's palette index (`aekMatIndex`) and sample each slot's array at that
 * layer, as a STANDARD member reads its scalars and maps. A slot without an array (none in the
 * palette, or not loaded) gives every member its neutral value, as a member without the map. A
 * `SKIP` slot samples only for a member with the map: the branch is per triangle, so the sample
 * takes the UV's derivatives from outside it. The members' agreed state (`__state`: `side`,
 * `alphaTest`, …) is set on it.
 * @internal
 * @param palette the scene data's palette
 * @param arrays each slot's loaded array (`<paletteId>.<slot>`)
 * @param tableId the registry id its table is saved under (the caller registers it)
 * @returns the material (unregistered) and its table texture
 */
export const createMergeMaterial = (
  palette: SceneMergeMaterial,
  arrays: Partial<Record<MergeMaterialSlot, THREE.Texture>>,
  tableId: string
) => {
  const table = createMergeMaterialTable(palette);
  const tableData = table.image.data as Float32Array;

  // Flat: one value per triangle by construction (a member's vertices share it)
  const index = varying(attribute(MERGE_MATERIAL_INDEX_ATTRIBUTE, 'uint'))
    .setInterpolation(THREE.InterpolationSamplingType.FLAT)
    .toUint() as unknown as Node<'uint'>;
  const layer = int(index) as unknown as Node;
  const row = (r: number) =>
    textureLoad(table, ivec2(int(r), int(index))) as unknown as Node<'vec4'>;
  const colorRow = row(0);
  const emissiveRow = row(1);
  const scalars = row(2);
  const uvRow0 = row(3);
  const uvRow1 = row(4);

  // The entry's UV transform, as a texture's matrix applies it: (M * vec3(uv, 1)).xy
  const meshUv = vec3(uv() as unknown as Node<'vec2'>, float(1));
  const entryUv = vec2(meshUv.dot(uvRow0.xyz), meshUv.dot(uvRow1.xyz)) as unknown as Node<'vec2'>;
  const flags = int(uvRow1.w) as unknown as Node<'int'>;
  // Made once, outside a SKIP branch: derivatives need every fragment of the quad
  let gradients: [Node, Node] | undefined;
  const getGradients = () =>
    (gradients ??= [dFdx(entryUv) as unknown as Node, dFdy(entryUv) as unknown as Node]);

  const sample = (slot: MergeMaterialSlot): Node<'vec4'> | undefined => {
    const array = arrays[slot];
    if (!array) return undefined;
    if (palette.__slots[slot]?.missing !== 'SKIP') {
      return sampleArrayLayer(array, entryUv, layer) as unknown as Node<'vec4'>;
    }
    const [ddx, ddy] = getGradients();
    const bit = 1 << MERGE_MATERIAL_RUNTIME_SLOTS.indexOf(slot);
    // A function node: `If` needs the builder's stack
    return Fn(() => {
      const result = vec4(...NEUTRAL[slot]).toVar();
      If(flags.bitAnd(int(bit)).notEqual(int(0)), () => {
        result.assign(sampleArrayLayer(array, entryUv, layer).grad(ddx, ddy));
      });
      return result;
    })() as unknown as Node<'vec4'>;
  };

  const material = new THREE.MeshStandardNodeMaterial();
  if (palette.__state) material.setValues(palette.__state as THREE.MeshStandardMaterialParameters);

  const albedo = sample('map');
  material.colorNode = albedo
    ? vec4(colorRow.xyz.mul(albedo.rgb), colorRow.w.mul(albedo.a))
    : colorRow;

  const orm = sample('orm');
  material.roughnessNode = (orm ? scalars.x.mul(orm.g) : scalars.x) as unknown as Node<'float'>;
  material.metalnessNode = (orm ? scalars.y.mul(orm.b) : scalars.y) as unknown as Node<'float'>;
  // three's aoMap: (ao - 1) * intensity + 1, on the indirect light only
  if (orm) material.aoNode = orm.r.sub(1).mul(uvRow0.w).add(1) as unknown as Node<'float'>;

  const normalSample = sample('normalMap');
  if (normalSample) {
    material.normalNode = normalMap(normalSample.xyz, scalars.zw) as unknown as Node<'vec3'>;
  }

  // The union of the members' features: emissive only when a member can be
  const emissiveMap = sample('emissiveMap');
  const hasEmissive = palette.__entries.some((_, i) => isEntryEmissive(tableData, i));
  if (hasEmissive) {
    const emissive = emissiveRow.xyz.mul(emissiveRow.w);
    material.emissiveNode = (emissiveMap
      ? emissive.mul(emissiveMap.rgb)
      : emissive) as unknown as Node<'vec3'>;
  }

  recordTextures(material, table, arrays);
  const info: MergeMaterialInfo = {
    paletteId: palette.id,
    materials: [...palette.materials],
    tableId,
    arrays: { ...arrays },
  };
  if (palette.userData) Object.assign(material.userData, palette.userData);
  material.userData.mergeMaterial = info;
  material.name = palette.debugData?.name ?? palette.id;
  return { material, table };
};
