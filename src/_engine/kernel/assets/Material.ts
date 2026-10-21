// The material registry: createMaterial builds a material from its props (a `*.material.json`'s,
// or code's) and registers it, ref counted and owned by a scene like every registered asset.
// createMaterial is over the 150-line limit: most of it is the TSL path (a material JSON's
// `tslFile` and `nodes`), which p302's resolver registry rewrites, so it isn't split before that
// (p613 D2).
import * as THREE from 'three/webgpu';
import { deleteTexture, getTexture, getTextureRegistry } from './Texture';
import { getRootScene } from '../scene/Scene';
import { existsOrThrow } from '../../utils/Assert';
import { getAppData } from '../scene/AppData';
import { lerror, lwarn } from '../../utils/Logger';
import type { Node } from 'three/tsl';
import { color, texture, uniform } from 'three/tsl';
import { textureMapKeys } from '../../utils/Constants';
import { hashStringFNV1a } from '../../utils/Hash';
import { stableStringify } from '../../utils/StableStringify';
import { IS_DEBUG_ENV } from '../config/Config';
import { recordAssetOwner, retagAssetOwner } from './AssetOwners';
import { getSceneRetainedTextures } from '../scene/SceneHooks';

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
 * A material {@link createMaterial} builds: its `type` and that three material's parameters in
 * `params` (a texture slot also takes a registered texture's id). A node material type also takes
 * a TSL file (`tslFile`, a material JSON's): `nodes` holds each socket's inputs (`colorNode: {
 * lineColor: '#4fc3f7' }`: a texture id, a `'#rrggbb'` colour, a number, a boolean, or a vector as
 * an array or `{ x, y, z }`), made into uniforms the file's socket function gets, and
 * `staticDefines` the build-time flags it branches on. A `*.material.json`'s props.
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
  /** Registry id of the TSL functions (tslFile) to use, defaults to `id` (variants use their base's) */
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
  | {
      type: 'BASICNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshBasicNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'LAMBERTNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshLambertNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'PHONGNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshPhongNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'PHYSICALNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshPhysicalNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'STANDARDNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshStandardNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'MATCAPNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshMatcapNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'NORMALNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshNormalNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
  | {
      type: 'TOONNODEMATERIAL';
      params?: AllowTextureStrings<THREE.MeshToonNodeMaterialParameters>;
      tslFile?: string;
      nodes?: Record<string, Record<string, unknown>>;
      staticDefines?: Record<string, unknown>;
    }
);

/** The TSL material files loaded so far, by material id (see loadTslMaterialFileAsync) */
const loadedTslMaterialFiles = new Map<string, Record<string, unknown>>();

// A TSL texture input whose id isn't registered samples this: one white texel, made on the first
// one, shared and never disposed (it isn't registered, so no release reaches it)
let missingTexture: THREE.DataTexture | null = null;
const getMissingTexture = () => {
  if (!missingTexture) {
    missingTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    missingTexture.name = 'aekMissingTexture';
    missingTexture.needsUpdate = true;
  }
  return missingTexture;
};

/**
 * Loads a material's TSL file (its material JSON's `tslFile`) so {@link createMaterial} can build
 * it: the gathered data loads these files on demand (p607 D11). A scene load does it for the
 * scene's materials; code that creates such a material at another time awaits this first. A file
 * loads once. A production build has the files of the materials its scenes list (a development
 * one has all).
 * @param materialId the material JSON's id
 * @returns false when the app's data has no TSL file for this id
 * @example
 * ```ts
 * import { createMaterial, loadTslMaterialFileAsync } from 'aekasha';
 *
 * // A grid of its own, from the toolkit's triplanarGrid material file
 * if (await loadTslMaterialFileAsync('triplanarGrid')) {
 *   createMaterial({
 *     id: 'wideGrid',
 *     tslMaterialId: 'triplanarGrid',
 *     type: 'STANDARDNODEMATERIAL',
 *     tslFile: 'materials/triplanarGrid.tsl.ts',
 *     staticDefines: { minorLines: false },
 *     nodes: {
 *       colorNode: {
 *         lineThickness: 0.05,
 *         lineFrequency: 0.25,
 *         lineColor: '#4fc3f7',
 *         backgroundColor: '#202020',
 *       },
 *     },
 *   });
 * }
 * ```
 */
export const loadTslMaterialFileAsync = async (materialId: string) => {
  if (loadedTslMaterialFiles.has(materialId)) return true;
  const load = getAppData().tslMaterialFiles[materialId];
  if (!load) return false;
  const exports = await load();
  loadedTslMaterialFiles.set(materialId, exports);
  return true;
};

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

/**
 * Creates and registers a three material from its props (see {@link MatProps}): owned by the
 * scene loading (or current), released with it when nothing holds a ref. An `id` already
 * registered returns that material, re-tagged to the scene getting it, and builds nothing (the
 * props are ignored). A texture id that isn't registered is left out of `params` (warned); in a
 * TSL input it samples one white texel (warned).
 * @throws for an unknown `type`; for a TSL material whose file isn't loaded (see
 * {@link loadTslMaterialFileAsync}), whose socket function is empty, or whose input value can't be
 * made into a uniform
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

  let mat: Materials | null = null;

  // Standard Static Parameters Definitions
  const type = props.type;
  const params = props.params;

  let processedParams: Record<string, unknown> | undefined = undefined;

  if (params) {
    processedParams = { ...params };

    for (const key of textureMapKeys) {
      if (typeof processedParams[key] === 'string') {
        const texId = processedParams[key] as string;
        const texResource = getTexture(texId);

        if (texResource) {
          processedParams[key] = texResource;
        } else {
          lwarn(
            `Could not locate texture resource "${texId}" for parameter field "${key}" in material "${id}". Safely stripping field.`
          );
          delete processedParams[key];
        }
      }
    }
  }

  switch (type) {
    case 'LINEBASIC':
      mat = new THREE.LineBasicMaterial(processedParams);
      break;
    case 'LINEDASHED':
      mat = new THREE.LineDashedMaterial(processedParams);
      break;
    case 'BASIC':
      mat = new THREE.MeshBasicMaterial(processedParams);
      break;
    case 'DEPTH':
      mat = new THREE.MeshDepthMaterial(processedParams);
      break;
    case 'DISTANCE':
      mat = new THREE.MeshDistanceMaterial(processedParams);
      break;
    case 'LAMBERT':
      mat = new THREE.MeshLambertMaterial(processedParams);
      break;
    case 'MATCAP':
      mat = new THREE.MeshMatcapMaterial(processedParams);
      break;
    case 'NORMAL':
      mat = new THREE.MeshNormalMaterial(processedParams);
      break;
    case 'PHONG':
      mat = new THREE.MeshPhongMaterial(processedParams);
      break;
    case 'PHYSICAL':
      mat = new THREE.MeshPhysicalMaterial(processedParams);
      break;
    case 'STANDARD':
      mat = new THREE.MeshStandardMaterial(processedParams);
      break;
    case 'TOON':
      mat = new THREE.MeshToonMaterial(processedParams);
      break;
    case 'POINTS':
      mat = new THREE.PointsMaterial(processedParams);
      break;
    case 'SHADERRAW':
    case 'SHADER':
      mat = new THREE.ShaderMaterial(processedParams);
      break;
    case 'SHADOW':
      mat = new THREE.ShadowMaterial(processedParams);
      break;
    case 'SPRITE':
      mat = new THREE.SpriteMaterial(processedParams);
      break;
    case 'BASICNODEMATERIAL':
      mat = new THREE.MeshBasicNodeMaterial(processedParams);
      break;
    case 'LAMBERTNODEMATERIAL':
      mat = new THREE.MeshLambertNodeMaterial(processedParams);
      break;
    case 'PHONGNODEMATERIAL':
      mat = new THREE.MeshPhongNodeMaterial(processedParams);
      break;
    case 'PHYSICALNODEMATERIAL':
      mat = new THREE.MeshPhysicalNodeMaterial(processedParams);
      break;
    case 'STANDARDNODEMATERIAL':
      mat = new THREE.MeshStandardNodeMaterial(processedParams);
      break;
    case 'MATCAPNODEMATERIAL':
      mat = new THREE.MeshMatcapNodeMaterial(processedParams);
      break;
    case 'NORMALNODEMATERIAL':
      mat = new THREE.MeshNormalNodeMaterial(processedParams);
      break;
    case 'TOONNODEMATERIAL':
      mat = new THREE.MeshToonNodeMaterial(processedParams);
      break;
  }

  if (mat) {
    if (props.userData) mat.userData = props.userData;
    mat.userData.type = type;
  } else {
    const msg = `Incomplete properties for material (id: ${id}).`;
    lerror(msg);
    throw new Error(msg);
  }

  // TSL file
  if ('tslFile' in props && props.tslFile) {
    const tslMaterialId = props.tslMaterialId || id || '';
    if (
      !loadedTslMaterialFiles.has(tslMaterialId) &&
      getAppData().tslMaterialFiles[tslMaterialId]
    ) {
      const msg = `The TSL file of material "${tslMaterialId}" isn't loaded: a scene load loads its materials' files, other code awaits loadTslMaterialFileAsync("${tslMaterialId}") before createMaterial.`;
      lerror(msg);
      throw new Error(msg);
    }
    const activeMaterialRegistry = existsOrThrow(
      loadedTslMaterialFiles.get(tslMaterialId),
      `Could not locate compiled TSL Master Graph registry entry for material ID "${id}. Materials with a TSL file must have a *.material.json file."`
    );

    const staticDefines = props.staticDefines || {};

    if (props.nodes) {
      for (const nodeSocket of Object.keys(props.nodes)) {
        const masterGraphFunction = activeMaterialRegistry[nodeSocket];

        // If a named layout node function isn't explicitly exported or the node socket does not exist, gracefully pass it
        if (!masterGraphFunction || !(nodeSocket in mat)) {
          if (mat.type.endsWith('NodeMaterial')) {
            lwarn(`Could not locate node "${nodeSocket}" for material id "${id}".`);
          } else {
            lwarn(
              `Material id "${id}" is not a node material, it does not have node sockets (in this case "${nodeSocket}").`
            );
          }
          continue;
        }

        if (masterGraphFunction === ' ' || masterGraphFunction === '') {
          const msg = `Empty TSL function export caught at socket "${nodeSocket}" for material entry ID: "${id}".`;
          lerror(msg);
          throw new Error(msg);
        }

        const genericGraphFn = masterGraphFunction as (
          inputs: Record<string, unknown>,
          material: THREE.NodeMaterial,
          defines?: Record<string, unknown>
        ) => Node;

        const rawInputs = props.nodes[nodeSocket];
        const uniformNodesPayload: Record<string, unknown> = {};
        let nodeStaticDefines: Record<string, unknown> | undefined = undefined;

        for (const inputKey of Object.keys(rawInputs)) {
          const value = rawInputs[inputKey];
          let instantiatedNode;

          // Handle Texture Asset References
          if (inputKey === 'staticDefines' && typeof value === 'object' && value !== null) {
            nodeStaticDefines = { ...staticDefines, ...(value as Record<string, unknown>) };
          }
          // Handle textures
          else if (typeof value === 'string' && !value.startsWith('#')) {
            let texResource = getTexture(value);
            if (!texResource) {
              lwarn(
                `Could not locate texture resource for input "${inputKey}" in material "${id}" with value "${value}": it samples one white texel.`
              );
              // A sampler still, so the TSL function gets the node type it expects
              texResource = getMissingTexture();
            }
            // Convert directly into a sampler node, not a uniform buffer allocation
            instantiatedNode = texture(texResource);
          }
          // Handle Hex Color Strings
          else if (typeof value === 'string' && value.startsWith('#')) {
            instantiatedNode = uniform(color(value));
          }
          // Handle Booleans (Flags / Switches)
          else if (typeof value === 'boolean') {
            instantiatedNode = uniform(value);
          }
          // Handle Arrays (Alternative Vector Format: [x, y] or [x, y, z])
          else if (Array.isArray(value)) {
            if (value.length === 4) {
              instantiatedNode = uniform(new THREE.Vector4(value[0], value[1], value[2], value[3]));
            } else if (value.length === 3) {
              instantiatedNode = uniform(new THREE.Vector3(value[0], value[1], value[2]));
            } else if (value.length === 2) {
              instantiatedNode = uniform(new THREE.Vector2(value[0], value[1]));
            } else {
              const msg = `Unsupported array length (${value.length}) for input "${inputKey}" in material "${id}".`;
              lerror(msg);
              throw new Error(msg);
            }
          }
          // Handle Vector and Color Objects
          else if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, number>;

            if ('w' in obj) {
              instantiatedNode = uniform(
                new THREE.Vector4(obj.x || 0, obj.y || 0, obj.z || 0, obj.w || 0)
              );
            } else if ('z' in obj) {
              instantiatedNode = uniform(new THREE.Vector3(obj.x || 0, obj.y || 0, obj.z || 0));
            } else if ('y' in obj) {
              instantiatedNode = uniform(new THREE.Vector2(obj.x || 0, obj.y || 0));
            } else if ('r' in obj && 'g' in obj && 'b' in obj && 'a' in obj) {
              instantiatedNode = uniform(new THREE.Vector4(obj.r, obj.g, obj.b, obj.a));
            } else if ('r' in obj && 'g' in obj && 'b' in obj) {
              instantiatedNode = uniform(new THREE.Color(obj.r, obj.g, obj.b));
            } else {
              const msg = `Unknown object footprint for input "${inputKey}" in material "${id}". Keys: ${Object.keys(obj).join(', ')}`;
              lerror(msg);
              throw new Error(msg);
            }
          }
          // Handle Standard Float / Scalar Numbers
          else if (typeof value === 'number') {
            instantiatedNode = uniform(value);
          }
          // Everything else is forbidden
          else {
            const msg = `Unsupported input value type at socket "${nodeSocket}" for input "${inputKey}" in material entry ID: "${id}". Value: ${JSON.stringify(value)}.`;
            lerror(msg);
            throw new Error(msg);
          }

          // Cache dynamically so runtime update scripts can pinpoint the uniform
          if (!mat.userData.uniforms) mat.userData.uniforms = {};
          mat.userData.uniforms[`${nodeSocket}_${inputKey}`] = instantiatedNode;
          uniformNodesPayload[inputKey] = instantiatedNode;
        }

        // Execute graph function with its flat parameter values and assign directly to material socket
        mat[nodeSocket] = genericGraphFn(
          uniformNodesPayload,
          mat as THREE.NodeMaterial,
          nodeStaticDefines || staticDefines
        );
      }
    }

    mat.userData.hasTslFile = true;
  }

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
    tslMaterialId: baseProps.tslMaterialId || baseId,
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
 * uses them: a texture shared between materials (e.g. the same cached loadTexture id) survives
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
