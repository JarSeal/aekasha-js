// The material registry: createMaterial builds a material from its props (a `*.material.json`'s,
// or code's) and registers it, ref counted and owned by a scene like every registered asset. A
// node material's TSL graph (its TSL file's or registered functions, its inputs) is
// MaterialTsl.ts' (p302 D2, D3).
import * as THREE from 'three/webgpu';
import { deleteTexture, getTexture, getTextureRegistry } from './Texture';
import { getRootScene } from '../scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { textureMapKeys } from '../../utils/Constants';
import { hashStringFNV1a } from '../../utils/Hash';
import { stableStringify } from '../../utils/StableStringify';
import { IS_DEBUG_ENV } from '../config/Config';
import { recordAssetOwner, retagAssetOwner } from './AssetOwners';
import { getSceneRetainedTextures } from '../scene/SceneHooks';
import { applyTslGraph } from './MaterialTsl';

/**
 * A material the registry holds: any of three's materials. The same type as `THREE.Material`
 * (each material class extends it).
 */
export type Materials = THREE.Material;

const materials: {
  [id: string]: {
    resource: Materials;
    count: number;
    persistent?: boolean;
    /** The props the material was created with (createMaterial), the base for its variants */
    props?: MatProps;
    /** Variants only: the overrides key the variant was created for (see getMaterialVariant) */
    variantKey?: string;
  };
} = {};

/** A material's texture slot (`map`, `normalMap`, …), one of `textureMapKeys`. */
export type TextureMapKeys = (typeof textureMapKeys)[number];

/**
 * A material's texture in a slot, or undefined when it has none there (a material type has
 * only some of the slots).
 * @internal
 */
export const getMaterialMapTexture = (mat: THREE.Material, key: TextureMapKeys) =>
  (mat as unknown as Partial<Record<TextureMapKeys, THREE.Texture | null>>)[key] ?? undefined;

/**
 * A material type's parameters, where every texture map key (`map`, `normalMap`, …) also takes a
 * registered texture's id.
 */
export type AllowTextureStrings<T> = T extends unknown
  ? { [K in keyof T]: K extends TextureMapKeys ? T[K] | string : T[K] }
  : never;

/**
 * A node material's TSL graph, in {@link MatProps}: the functions (a TSL file's exports, or
 * {@link registerTslMaterial}'s) and the inputs made into the uniforms and texture nodes they get.
 * An input is a texture id, a `'#rrggbb'` colour, a number, a boolean, or a vector as an array or
 * `{ x, y, z }`.
 */
export type TslMaterialProps = {
  /** The TSL file exporting the functions (a material JSON's, which a JSON material has). A
   * material whose `tslMaterialId` names a {@link registerTslMaterial} registration needs none. */
  tslFile?: string;
  /** The inputs of the functions' `setup` (`{ albedo: 'sand01', scale: 4 }`), each kept as the
   * `setup_<key>` uniform. */
  inputs?: Record<string, unknown>;
  /** Per socket (`colorNode`, …), the inputs of the function of that name (`colorNode: { lineColor:
   * '#4fc3f7' }`), each kept as the `<socket>_<key>` uniform. A socket's `staticDefines` input is
   * merged over the material's for that socket. */
  nodes?: Record<string, Record<string, unknown>>;
  /** Build-time flags the functions branch on: another set is another shader. */
  staticDefines?: Record<string, unknown>;
};

/**
 * A material {@link createMaterial} builds: its `type` and that three material's parameters in
 * `params` (a texture slot also takes a registered texture's id). A node material type also takes
 * a TSL graph ({@link TslMaterialProps}): a `setup` function building any sockets from one graph
 * with the material's `inputs`, and a function per socket with that socket's inputs under `nodes`,
 * from a TSL file (`tslFile`, a material JSON's) or registered from code ({@link
 * registerTslMaterial}, named by `tslMaterialId`). A `*.material.json`'s props.
 */
export type MatProps = {
  /** The registry id. A registered id returns the registered material (see
   * {@link createMaterial}). Default: the material's uuid. */
  id?: string;
  /** Never released by its scene or its last ref: only {@link deleteMaterial} removes it. */
  isPersistent?: boolean;
  /** The name (also the material's `name`) and description for the debug tooling. */
  debugData?: { name?: string; description?: string };
  /** The material's `userData` (the engine adds its own keys: `id`, `type`, `uniforms`, …). */
  userData?: Record<string, unknown>;
  /** The id of the TSL functions: a {@link registerTslMaterial} registration (looked up first) or
   * a loaded TSL file's material id. Default: `id` (variants use their base's). */
  tslMaterialId?: string;
} & (
  | { type: 'LINEBASIC'; params?: AllowTextureStrings<THREE.LineBasicMaterialParameters> }
  | { type: 'LINEDASHED'; params?: AllowTextureStrings<THREE.LineDashedMaterialParameters> }
  | { type: 'BASIC'; params?: AllowTextureStrings<THREE.MeshBasicMaterialParameters> }
  | { type: 'DEPTH'; params?: AllowTextureStrings<THREE.MeshDepthMaterialParameters> }
  | { type: 'DISTANCE'; params?: AllowTextureStrings<THREE.MeshDistanceMaterialParameters> }
  | { type: 'LAMBERT'; params?: AllowTextureStrings<THREE.MeshLambertMaterialParameters> }
  | { type: 'MATCAP'; params?: AllowTextureStrings<THREE.MeshMatcapMaterialParameters> }
  | { type: 'NORMAL'; params?: AllowTextureStrings<THREE.MeshNormalMaterialParameters> }
  | { type: 'PHONG'; params?: AllowTextureStrings<THREE.MeshPhongMaterialParameters> }
  | { type: 'PHYSICAL'; params?: AllowTextureStrings<THREE.MeshPhysicalMaterialParameters> }
  | { type: 'STANDARD'; params?: AllowTextureStrings<THREE.MeshStandardMaterialParameters> }
  | { type: 'TOON'; params?: AllowTextureStrings<THREE.MeshToonMaterialParameters> }
  | { type: 'POINTS'; params?: AllowTextureStrings<THREE.PointsMaterialParameters> }
  | { type: 'SHADERRAW'; params?: AllowTextureStrings<THREE.ShaderMaterialParameters> }
  | { type: 'SHADER'; params?: AllowTextureStrings<THREE.ShaderMaterialParameters> }
  | { type: 'SHADOW'; params?: AllowTextureStrings<THREE.ShadowMaterialParameters> }
  | { type: 'SPRITE'; params?: AllowTextureStrings<THREE.SpriteMaterialParameters> }
  | ({
      type: 'BASICNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshBasicNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'LAMBERTNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshLambertNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'PHONGNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshPhongNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'PHYSICALNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshPhysicalNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'STANDARDNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshStandardNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'MATCAPNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshMatcapNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'NORMALNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshNormalNodeMaterialParameters>;
    } & TslMaterialProps)
  | ({
      type: 'TOONNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshToonNodeMaterialParameters>;
    } & TslMaterialProps)
);

/**
 * Takes a ref on a registered material: it isn't released (by {@link decMaterialRef} or its
 * scene's release) while it has refs. A mesh entity takes one per material and releases them when
 * it's deleted or its material is swapped (`setMeshMaterial`); take one for a material something
 * else holds. An unregistered id does nothing.
 * @example
 * ```ts
 * import { createMaterial, decMaterialRef, incMaterialRef } from 'aekasha';
 *
 * createMaterial({ id: 'highlight', type: 'BASIC', params: { color: '#ffd000' } });
 * incMaterialRef('highlight'); // kept while the scene's code swaps it in and out
 * // … on the scene's exit:
 * decMaterialRef('highlight');
 * ```
 */
export const incMaterialRef = (id: string) => {
  if (materials[id]) {
    materials[id].count++;
  }
};

/**
 * Releases a ref {@link incMaterialRef} took: a non-persistent material whose last ref this was is
 * disposed, leaves the registry and releases the registered textures only it held (those a sky
 * box or the scene's background show stay). An unregistered id does nothing.
 */
export const decMaterialRef = (id: string) => {
  const entry = materials[id];
  if (!entry) return;

  entry.count--;

  if (entry.count <= 0 && !entry.persistent) {
    deleteTexturesFromMaterial(entry.resource);
    entry.resource.dispose();
    delete materials[id];
  }
};

/** The classic params three keeps as a `Vector2`: its `setValues` copies one only from a
 * `Vector2`, so a JSON's `[x, y]` would replace it with a plain array (a `uniformArray` in the
 * node material three builds for it) */
const VECTOR2_PARAMS = ['normalScale', 'clearcoatNormalScale'] as const;

/** A JSON's `[x, y]` or `{ x, y }` as a `Vector2`; any other value as it is */
const toVector2Param = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.length === 2 && value.every((n) => typeof n === 'number')
      ? new THREE.Vector2(value[0] as number, value[1] as number)
      : value;
  }
  if (!value || typeof value !== 'object' || (value as THREE.Vector2).isVector2) return value;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' ? new THREE.Vector2(x, y) : value;
};

type MaterialClass = new (params?: Record<string, unknown>) => Materials;

/** Each material type's three class: `params` is given to its constructor */
const MATERIAL_CLASSES: Record<MatProps['type'], MaterialClass> = {
  LINEBASIC: THREE.LineBasicMaterial,
  LINEDASHED: THREE.LineDashedMaterial,
  BASIC: THREE.MeshBasicMaterial,
  DEPTH: THREE.MeshDepthMaterial,
  DISTANCE: THREE.MeshDistanceMaterial,
  LAMBERT: THREE.MeshLambertMaterial,
  MATCAP: THREE.MeshMatcapMaterial,
  NORMAL: THREE.MeshNormalMaterial,
  PHONG: THREE.MeshPhongMaterial,
  PHYSICAL: THREE.MeshPhysicalMaterial,
  STANDARD: THREE.MeshStandardMaterial,
  TOON: THREE.MeshToonMaterial,
  POINTS: THREE.PointsMaterial,
  SHADERRAW: THREE.ShaderMaterial,
  SHADER: THREE.ShaderMaterial,
  SHADOW: THREE.ShadowMaterial,
  SPRITE: THREE.SpriteMaterial,
  BASICNODEMATERIAL: THREE.MeshBasicNodeMaterial,
  LAMBERTNODEMATERIAL: THREE.MeshLambertNodeMaterial,
  PHONGNODEMATERIAL: THREE.MeshPhongNodeMaterial,
  PHYSICALNODEMATERIAL: THREE.MeshPhysicalNodeMaterial,
  STANDARDNODEMATERIAL: THREE.MeshStandardNodeMaterial,
  MATCAPNODEMATERIAL: THREE.MeshMatcapNodeMaterial,
  NORMALNODEMATERIAL: THREE.MeshNormalNodeMaterial,
  TOONNODEMATERIAL: THREE.MeshToonNodeMaterial,
};

/** A material's `params` as its constructor takes them: a texture slot's id as the registered
 * texture (an unregistered one left out, warned), a `[x, y]` normal scale as a `Vector2` */
const resolveMaterialParams = (params: MatProps['params'], id: string | undefined) => {
  if (!params) return undefined;
  const resolved: Record<string, unknown> = { ...params };
  for (const key of textureMapKeys) {
    const texId = resolved[key];
    if (typeof texId !== 'string') continue;
    const texResource = getTexture(texId);
    if (texResource) {
      resolved[key] = texResource;
    } else {
      lwarn(
        `Could not locate texture resource "${texId}" for parameter field "${key}" in material "${id}". Safely stripping field.`
      );
      delete resolved[key];
    }
  }
  for (const key of VECTOR2_PARAMS) {
    if (key in resolved) resolved[key] = toVector2Param(resolved[key]);
  }
  return resolved;
};

/**
 * Creates and registers a three material from its props (see {@link MatProps}): owned by the
 * scene loading (or current), released with it when nothing holds a ref. An `id` already
 * registered returns that material, re-tagged to the scene getting it, and builds nothing (the
 * props are ignored). A texture id that isn't registered is left out of `params` (warned); in a
 * TSL input it samples one white texel (warned). A `normalScale` or `clearcoatNormalScale` given as
 * `[x, y]` or `{ x, y }` (a material JSON's) becomes a `Vector2`. A node material's TSL graph
 * ({@link TslMaterialProps}) runs its `setup` first, then its `nodes` sockets' functions, which
 * may set a socket `setup` set again (the debug env warns).
 * @throws for an unknown `type`; for a TSL material whose file isn't loaded (see
 * {@link loadTslMaterialFileAsync}) and that no {@link registerTslMaterial} call registered, whose
 * TSL export isn't a function, or whose input value can't be made into a uniform
 * @example
 * ```ts
 * import { createMaterial } from 'aekasha';
 *
 * const crate = createMaterial({
 *   id: 'crateMaterial',
 *   type: 'STANDARDNODEMATERIAL',
 *   params: { map: 'crateAlbedo', roughness: 0.8 },
 * });
 * ```
 */
export const createMaterial = (props: MatProps) => {
  const id = props.id;

  if (id && materials[id]) {
    retagAssetOwner(materials[id].resource);
    return materials[id].resource;
  }

  const type = props.type;
  const MaterialClass: MaterialClass | undefined = MATERIAL_CLASSES[type];
  if (!MaterialClass) {
    const msg = `Incomplete properties for material (id: ${id}).`;
    lerror(msg);
    throw new Error(msg);
  }
  const mat = new MaterialClass(resolveMaterialParams(props.params, id));
  if (props.userData) mat.userData = props.userData;
  mat.userData.type = type;

  // Only a node material has a TSL graph (a plain one's id may name a registration)
  if ((mat as THREE.NodeMaterial).isNodeMaterial) applyTslGraph(mat as THREE.NodeMaterial, props);

  if (props.debugData) {
    if (props.debugData.name) {
      mat.name = props.debugData.name;
      mat.userData.name = props.debugData.name;
    }
    if (props.debugData.description) {
      mat.userData.description = props.debugData.description;
    }
  }

  saveMaterial(mat, id, props.isPersistent);
  if (id && materials[id]?.resource === mat) materials[id].props = props;
  return mat;
};

/** What a {@link getMaterialVariant} variant changes of its base material's props. */
export type MaterialVariantOverrides = {
  /** Merged over the base's `params` (shallowly). */
  params?: Record<string, unknown>;
  /** Merged over the base's `staticDefines` (shallowly): another set is another shader. */
  staticDefines?: Record<string, unknown>;
  /** Merged over the base's `nodes`, per socket. */
  nodes?: Record<string, Record<string, unknown>>;
};

// Only to keep variant ids short (collisions are resolved in getMaterialVariant)
const hashString = (str: string) => hashStringFNV1a(str).toString(36);

/**
 * Returns a variant of a registered material: a separate material created from the base
 * material's creation props with `overrides` merged over them (`params` and `staticDefines`
 * shallowly, `nodes` per socket), cached and shared by all callers with equal overrides.
 * Variants have no per-frame cost (unlike per-object uniforms) and TSL functions can branch on
 * their `staticDefines` at build time, at the price of one material (and, for differing
 * `staticDefines`, one shader) per unique override set. Variants are ref counted and disposed like
 * any other non-persistent material. Override values should be plain data (eg. texture ids, not
 * texture objects), since they form the variant's cache key.
 * @param baseId registered material id (created with createMaterial)
 * @param overrides params, staticDefines and TSL node inputs to override
 * @throws when `baseId` isn't registered, or wasn't created by createMaterial
 * @example
 * ```ts
 * import { getMaterialVariant } from 'aekasha';
 *
 * // A darker crate, shared by every caller asking for the same overrides
 * const darkCrate = getMaterialVariant('crateMaterial', { params: { color: '#606060' } });
 * ```
 */
export const getMaterialVariant = (baseId: string, overrides: MaterialVariantOverrides) => {
  const base = existsOrThrow(
    materials[baseId],
    `Could not find base material "${baseId}" for a material variant.`
  );
  const baseProps = existsOrThrow(
    base.props,
    `Material "${baseId}" has no creation props (it was not created with createMaterial), so it can't have variants.`
  );

  const variantKey = stableStringify(overrides);
  let variantId = `${baseId}#${hashString(variantKey)}`;
  for (let i = 2; materials[variantId] && materials[variantId].variantKey !== variantKey; i++) {
    variantId = `${baseId}#${hashString(variantKey)}-${i}`;
  }
  if (materials[variantId]) {
    retagAssetOwner(materials[variantId].resource);
    return materials[variantId].resource;
  }

  const props = { ...baseProps } as MatProps & MaterialVariantOverrides;
  if (overrides.params) props.params = { ...props.params, ...overrides.params };
  if (overrides.staticDefines) {
    props.staticDefines = { ...props.staticDefines, ...overrides.staticDefines };
  }
  if (overrides.nodes) {
    const nodes = { ...props.nodes };
    for (const socket in overrides.nodes) {
      nodes[socket] = { ...nodes[socket], ...overrides.nodes[socket] };
    }
    props.nodes = nodes;
  }

  const variant = createMaterial({
    ...props,
    id: variantId,
    isPersistent: false,
    // The base's TSL functions, for a TSL material only
    ...(base.resource.userData.hasTslFile
      ? { tslMaterialId: baseProps.tslMaterialId || baseId }
      : {}),
  } as MatProps);
  materials[variantId].variantKey = variantKey;
  variant.userData.variantOf = baseId;
  return variant;
};

/**
 * The registered material with the id, or undefined.
 * @example
 * ```ts
 * import { getMaterial, getMeshByAppId, setMeshMaterial } from 'aekasha';
 *
 * const crate = getMeshByAppId('crate');
 * const highlight = getMaterial('highlight');
 * if (crate && highlight) setMeshMaterial(crate, highlight);
 * ```
 */
export const getMaterial = (id: string) => materials[id]?.resource;

/**
 * The material registry by id: each entry's material (`resource`), ref count, persistence,
 * creation props and variant key. Read it, never write it.
 * @internal
 */
export const getMaterialRegistry = () => materials;

/** Whether any registered material other than `except` still holds a texture (in a map slot or a
 * TSL node input) matching `test` (texture refcounts aren't tracked per material, so this is
 * checked at release time). */
const isTextureInUseByOtherMaterial = (
  except: Materials | null,
  test: (texture: THREE.Texture) => boolean
) => {
  for (const id in materials) {
    const other = materials[id].resource;
    if (other === except) continue;
    for (let i = 0; i < textureMapKeys.length; i++) {
      const texture = getMaterialMapTexture(other, textureMapKeys[i]);
      if (texture && test(texture)) return true;
    }
    // TSL node inputs (createMaterial keeps them in userData.uniforms): texture nodes
    const uniforms = other.userData.uniforms as Record<string, unknown> | undefined;
    for (const key in uniforms) {
      const node = uniforms[key] as { isTextureNode?: boolean; value?: THREE.Texture } | undefined;
      if (node?.isTextureNode && node.value && test(node.value)) return true;
    }
  }
  return false;
};

/**
 * Whether any registered material holds `texture`, or another texture under the same registry id
 * (eg. a clone of it). Texture ref counts aren't tracked, so this is how a registered texture's
 * owner (eg. an import) can tell whether it's safe to delete.
 * @internal
 * @param texture registered texture
 */
export const isTextureUsedByAnyMaterial = (texture: THREE.Texture) => {
  const id = texture.userData?.id as string | undefined;
  return isTextureInUseByOtherMaterial(
    null,
    (t) => t === texture || (id !== undefined && t.userData?.id === id)
  );
};

/**
 * The registered textures that stay though no material holds them: what the `retainedTextures`
 * scene hooks name (the sky box's) and the root scene's background and environment. The one rule
 * both a material's release ({@link deleteTexturesFromMaterial}) and a scene's
 * (`releaseSceneOwnedAssets`) keep by. A new set per call: read it once per release.
 * @internal
 */
export const getKeptTextures = (): Set<THREE.Texture> => {
  const kept = getSceneRetainedTextures();
  const rootScene = getRootScene();
  if (rootScene?.background instanceof THREE.Texture) kept.add(rootScene.background);
  if (rootScene?.environment) kept.add(rootScene.environment);
  return kept;
};

/**
 * Releases a material's textures from VRAM cache, as far as no other registered material still
 * uses them: a texture shared between materials (e.g. the same loadTextureAsync id) survives
 * until its last material goes. A texture that isn't the registered one itself — typically a
 * `.clone()` of it, which copies the source's `userData.id` — belongs to the material alone and
 * is disposed directly; the registered source is then released with the last material holding
 * any texture under its id. Persistent registered textures, and those {@link getKeptTextures}
 * names (a sky box's, the scene's background), are never released here: the scene's release
 * takes them once nothing keeps them.
 * @internal
 * @param mat the material being released
 * @param opts.keepRegistered only dispose the textures the material holds alone (eg. clones), and
 * leave registered textures for the caller to release
 */
export const deleteTexturesFromMaterial = (mat: Materials, opts?: { keepRegistered?: boolean }) => {
  let kept: Set<THREE.Texture> | undefined;
  for (let i = 0; i < textureMapKeys.length; i++) {
    const texture = getMaterialMapTexture(mat, textureMapKeys[i]);
    if (!texture) continue;
    if (isTextureInUseByOtherMaterial(mat, (t) => t === texture)) continue;

    const id = texture.userData?.id as string | undefined;
    const registered = id ? getTextureRegistry()[id] : undefined;
    if (!registered || registered.resource !== texture) texture.dispose();
    if (opts?.keepRegistered) continue;
    if (
      id &&
      registered &&
      !registered.persistent &&
      !isTextureInUseByOtherMaterial(mat, (t) => t.userData?.id === id)
    ) {
      kept ??= getKeptTextures();
      if (!kept.has(registered.resource)) deleteTexture(id);
    }
  }
};

/**
 * Disposes one or many registered materials and removes them from the registry, whatever their
 * refs and persistence. An unregistered id is skipped.
 * @param id material id or array of ids
 * @param deleteTextures also release the textures only this material holds, as its last ref's
 * release does
 * @example
 * ```ts
 * import { deleteMaterial } from 'aekasha';
 *
 * deleteMaterial('highlight', true);
 * ```
 */
export const deleteMaterial = (id: string | string[], deleteTextures?: boolean) => {
  const targetIds = Array.isArray(id) ? id : [id];

  for (const matId of targetIds) {
    const entry = materials[matId];
    if (!entry) continue;

    if (deleteTextures) deleteTexturesFromMaterial(entry.resource);
    entry.resource.dispose();
    delete materials[matId];
  }
};

// A material passed to saveMaterial under an id another one holds isn't registered, so nothing
// releases it: said in the debug env
const warnDroppedMaterial = (id: string) => {
  if (!IS_DEBUG_ENV) return;
  lwarn(
    `saveMaterial: "${id}" is registered already, so the material passed in isn't registered (dispose it, or check getMaterial("${id}") before creating one).`
  );
};

/**
 * Registers a material you built, or each of an array's (as `<id>-<index>`): owned by the scene
 * loading (or current), like {@link createMaterial}'s. An id already registered keeps its material
 * and leaves the one passed in unregistered (the debug env warns when they differ): dispose it, or
 * check {@link getMaterial} before creating one.
 * @param material the material, or a mesh's material array
 * @param givenId its registry id (an array's members get `-0`, `-1`, …). Default: each one's uuid
 * @param isPersistent never released by its scene or its last ref
 * @returns the registered material (for an array: the array passed in)
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getMaterial, saveMaterial } from 'aekasha';
 *
 * const glow =
 *   getMaterial('glow') ?? saveMaterial(new THREE.MeshBasicNodeMaterial({ color: '#80e0ff' }), 'glow');
 * ```
 */
export const saveMaterial = (
  material: Materials | Materials[],
  givenId?: string,
  isPersistent?: boolean
) => {
  if (!Array.isArray(material)) {
    const id = givenId || material.uuid;
    if (materials[id]) {
      if (materials[id].resource !== material) warnDroppedMaterial(id);
      retagAssetOwner(materials[id].resource);
      return materials[id].resource;
    }

    material.userData.id = id;
    materials[id] = {
      resource: material,
      count: 0,
      ...(isPersistent ? { persistent: true } : {}),
    };
    recordAssetOwner(material);
    return material;
  }

  for (let i = 0; i < material.length; i++) {
    const mat = material[i];
    if (!mat.isMaterial) continue;
    const combinedId = givenId ? `${givenId}-${i}` : mat.uuid;
    if (materials[combinedId]) {
      if (materials[combinedId].resource !== mat) warnDroppedMaterial(combinedId);
      retagAssetOwner(materials[combinedId].resource);
      continue;
    }

    mat.userData.id = combinedId;
    materials[combinedId] = {
      resource: mat,
      count: 0,
      ...(isPersistent ? { persistent: true } : {}),
    };
    recordAssetOwner(mat);
  }

  return material;
};

/**
 * Whether a material is registered under the id.
 * @internal
 */
export const doesMatExist = (id: string) => Boolean(materials[id]);
