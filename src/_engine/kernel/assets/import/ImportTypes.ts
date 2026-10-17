import type { RigidBodyParams } from '../../../features/physics/types/PhysicsBodyTypes';
import type { ColliderParams } from '../../../features/physics/types/PhysicsColliderTypes';
import type { TextureMapKeys } from '../Material';
import type { TexOpts } from '../Texture';
import type { MeshProps } from '../../mesh/Mesh';
import type { CoreEntityOpts } from '../../../schemas/_HelperSchemas';
import type { GeneratedAssetUrls } from '../AssetUrl';
import type { LodChainOptions } from '../../../features/lod/LodChainOptions';
import type * as THREE from 'three/webgpu';

/** Plain, structured-clone-safe vector (no THREE classes: a manifest must survive a worker hop). */
export type Vector3Like = { x: number; y: number; z: number };
/** Plain, structured-clone-safe quaternion. */
export type QuatLike = { x: number; y: number; z: number; w: number };

/**
 * What `importAssetAsync` imports: the file, the id its geometries and textures are
 * registered under, and which parts of it.
 */
export type ImportAssetParams = {
  /** Import id, also the geometry id prefix (`${id}/${nodeName}`). Default: file basename
   * without the extension. */
  id?: string;
  /** URL of a .glb or .gltf file (eg. '/debugger/assets/testModels/box01.glb'). From generated
   * data (an `*.importedAsset.json`), the asset pipeline's output (`__url`) is loaded instead, see
   * resolveAssetUrl; the import's id and identity stay this file. */
  fileName: string;
  /** Default false: glTF materials and their textures are disposed. true = also register every
   * texture used by an imported primitive's glTF material slot (as `${id}/${textureName}`), with
   * GLTFLoader's settings (flipY false, sRGB for color maps). `texOpts` override those settings for
   * every imported texture; `isPersistent` defaults to the import's own. */
  importTextures?: boolean | { texOpts?: TexOpts; isPersistent?: boolean };
  /** Only import one node (and its child nodes), picked by child index of the glTF root (after
   * the empty-wrapper unwrap) or by a nested index path ([2, 0] = first child of the third child).
   * Transforms stay relative to the glTF root. */
  meshIndex?: number | number[];
  /** Registers the geometries as persistent (they survive a ref count of 0 and
   * releaseImportedAsset without `includePersistent`). */
  isPersistent?: boolean;
  /** Generate a LOD chain (generateLodChain, p347) for every rendered geometry after the import:
   * true for the default options, or the options. Not awaited by the import; collider-only nodes
   * and skinned or morph-target geometry are skipped. A geometry that already has a chain keeps
   * it. Default false. */
  lodChain?: boolean | LodChainOptions;
  /** Throw instead of logging an error and resolving to null. */
  throwOnError?: boolean;
  /** Name/description for debug tooling (the Assets debugger tab). */
  debugData?: { name?: string; description?: string };
} & GeneratedAssetUrls;

/** Physics override for one imported node. Wins field-by-field over the node's Blender custom
 * props, or adds physics to a node that has none (then a collider and a rigid body are needed). */
export type ImportPhysicsParams = {
  /** The collider: `type`, the shape sizes, `density`, `friction`, `restitution` and the combine
   * rules override the custom props; the other fields are applied as they are. */
  collider?: ColliderParams;
  /** The rigid body: `rigidType` overrides the custom prop; the other fields are applied as they
   * are, but `translation` and `rotation` (the node and `transform` place it). */
  rigidBody?: RigidBodyParams;
  /** Overrides the `id` custom prop. */
  meshId?: string;
  /** Overrides the `isPhysObj` custom prop: whether the node gets physics. */
  isPhysObj?: boolean;
  /** Overrides the `keepMesh` custom prop: whether a physics node is also rendered. */
  keepMesh?: boolean;
  /** Overrides the `name` custom prop. */
  name?: string;
  /** Overrides the `index` custom prop: the compound group sharing one rigid body. */
  index?: number;
};

/** A node's Blender custom properties (glTF `extras`), normalized with the importer's defaults. */
export type ParsedCustomProps = {
  /** The node's raw custom props (glTF extras + GLTFLoader's `name`), for re-parsing with an
   * {@link ImportPhysicsParams} override. */
  raw: Record<string, unknown>;
  /** The node gets physics (the `isPhysObj` custom prop). */
  isPhysObj: boolean;
  /** Only set for physics nodes: whether the node is also rendered (false = collider only). */
  keepMesh?: boolean;
  /** Set on the node that carries the rigid body of its `index` group. Unknown values → 'FIXED'. */
  rigidType?: RigidBodyParams['rigidType'];
  /** Only set for physics nodes with a known `colliderType`. TRIMESH/CONVEXHULL/HEIGHTFIELD shape
   * data is derived from the geometry when spawning. */
  colliderParams?: ColliderParams;
  /** `userData_<key>` custom props, forwarded as the rigid body's `userData`. */
  rigidBodyUserData?: Record<string, unknown>;
  /** Compound group: all physics nodes with the same index share one rigid body. */
  index?: number;
  /** The `id` custom prop as a string, for the app: the engine doesn't read it. */
  id?: string;
  /** The `name` custom prop as a string, for the app: the engine doesn't read it. */
  name?: string;
  /** Problems found while parsing (eg. an unknown `colliderType`), logged by the importer. */
  warnings: string[];
};

/** One imported mesh primitive in an {@link ImportedAssetManifest}: its registered geometry,
 * where its node sits in the file, and its node's custom props. */
export type ImportedGeometryInfo = {
  /** Registry id (`${importId}/${nodeName}`, plus `#n` for multi-primitive meshes). */
  geometryId: string;
  /** The import it belongs to ({@link ImportedAssetManifest.id}). */
  importId: string;
  /** The node's name as GLTFLoader names it (sanitized and unique within the file). */
  nodeName: string;
  /** Node names from the glTF root down to (not including) this node, for debugging/filtering. */
  parentPath: string[];
  /** Relative to the glTF root (after the empty-wrapper unwrap). */
  transform: { position: Vector3Like; quaternion: QuatLike; scale: Vector3Like };
  /** The node's Blender custom props, parsed (physics, compound group, the app's own). */
  customProps: ParsedCustomProps;
  /** The primitive came from KHR_draco_mesh_compression (vertex order is not preserved). */
  isDracoCompressed: boolean;
  /** Only with importTextures: which registered texture filled which slot of this primitive's glTF
   * material, so an engine material can be given the same maps. */
  textureSlots?: Partial<Record<TextureMapKeys, string>>;
};

/**
 * What an import registered: `importAssetAsync`'s result, which `spawnImportedAsset`
 * spawns entities from. Plain data, the same whether the file was loaded on the main thread or in
 * the assets worker.
 */
export type ImportedAssetManifest = {
  /** The import id ({@link ImportAssetParams.id}, or the file's basename). */
  id: string;
  /** The file as the import was given it ({@link ImportAssetParams.fileName}), not the asset
   * pipeline's output it loaded. */
  fileName: string;
  /** One per imported mesh primitive, in node order. */
  geometries: ImportedGeometryInfo[];
  /** The registered textures' ids, with `importTextures` (empty without it). */
  textureIds: string[];
};

/** How `spawnImportedAsset` places, renders and adds physics to an import's nodes. */
export type SpawnImportedParams = {
  /** Root transform: every node's glTF-root-relative transform is composed under it. `rotation`
   * (Euler, radians) is only used when `quaternion` isn't given. */
  transform?: { position?: Vector3Like; quaternion?: QuatLike; rotation?: Vector3Like };
  /** Engine material (or a registered material id) for every visible piece; glTF materials are
   * never imported. A `meshProps` entry's `mat` wins for its piece. */
  material?: THREE.Material | string;
  /** Shadow flags for every visible piece (a `meshProps` entry's own flags win). */
  castShadow?: boolean;
  /** Like `castShadow`, for receiving shadows. */
  receiveShadow?: boolean;
  /** Per-piece mesh overrides, by node order in the manifest (array) or by geometryId (record).
   * `position`/`rotation`/`quaternion`/`scale` replace the composed transform instead of adding
   * to it. */
  meshProps?: Partial<MeshProps>[] | Record<string, Partial<MeshProps>>;
  /** Physics overrides by node order in the manifest (a single object = the first node). The
   * fields custom props also have win field-by-field over the node's custom props (or add physics
   * to a node without any); the other `rigidBody` fields (angvel, ccdEnabled, ...) and `collider`
   * fields (isSensor, event callbacks, explicit vertices, ...) are applied as-is.
   * `rigidBody.translation`/`rotation` are ignored (placement comes from the node and
   * `transform`). */
  physicsParams?: ImportPhysicsParams | ImportPhysicsParams[];
  /** Only spawn the nodes this returns true for (the rest of the import is ignored entirely). */
  filter?: (info: ImportedGeometryInfo) => boolean;
  /** Core entity options for every created entity. `appId` is the prefix of the entities'
   * appIds (default: the import id): `${appId}/${node}` for meshes, `${appId}/${node}-phys` for
   * headless physics entities. Spawning one import twice needs a different appId for stable
   * ids. */
  entityOpts?: CoreEntityOpts;
};

/** The entities `spawnImportedAsset` created, by the role they have. */
export type SpawnImportedResult = {
  /** Mesh entities, in manifest order (collider-only nodes get none). */
  meshEntityIds: number[];
  /** Entities carrying rigid bodies: a mesh entity (anchor) or a headless physics entity. */
  physicsEntityIds: number[];
};

/** One node `spawnImportedAsset` spawns, as the physics extension gets it
 * (`ImportPhysicsSpawn`): its geometry, parsed custom props and composed world transform. */
export type ImportSpawnNode = {
  info: ImportedGeometryInfo;
  geometry: THREE.BufferGeometry;
  props: ParsedCustomProps;
  /** The node's physicsParams override, for the fields custom props can't express. */
  override?: ImportPhysicsParams;
  /** appId part, unique within the import: the node name (+ `#n` for repeated names, ie. the
   * primitives of a multi-primitive mesh). */
  localName: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  /** The node's mesh entity, when it's rendered. */
  entityId?: number;
};
