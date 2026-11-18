import type * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { lwarn } from '../../../utils/Logger';
import type { LodChainOptions } from '../../../features/lod/LodChainOptions';
import type {
  ExtractedLodChain,
  GLTFLodChains,
  TransferableLodChain,
} from '../../../features/lod/LodChainGLTF';
import type { MeshLodDef } from '../../../features/lod/LodTypes';
import type { CoreEntityOpts } from '../../../schemas/_HelperSchemas';
import type { MeshProps } from '../../mesh/Mesh';
import type { ImportedAssetManifest, ImportSpawnNode, SpawnImportedParams } from './ImportTypes';

// The import seam (p607 D5): what features add to `importAssetAsync` and `spawnImportedAsset`.
// Physics spawns the bodies the nodes' custom props describe, LOD reads the prebuilt LOD chains a
// file carries and starts the ones an import asks for, instancing draws a node's GPU instances
// (p308 D3). The kernel's import calls them here and imports none of these features; an import
// that needs a missing one warns once, naming the feature.

/** What `spawnImportedAsset` hands the physics extension: the spawned nodes (the visible ones
 * with their mesh entity) and the spawn's params. */
export type ImportPhysicsSpawn = {
  nodes: readonly ImportSpawnNode[];
  params: SpawnImportedParams;
  /** The appId prefix of the spawn's entities, or undefined when they get generated appIds. */
  appIdPrefix: string | undefined;
};

/** What `spawnImportedAsset` hands the instancing extension for one node of GPU instances: what
 * `createStaticInstances` draws them with. */
export type ImportInstancesSpawn = {
  /** Names the cells: each cell's app id is `<id>/<cellX>,<cellZ>`. */
  id: string;
  /** The node's geometry (or its `meshProps` entry's). */
  geometry: MeshProps['geo'];
  /** The node's material. */
  material: MeshProps['mat'];
  /** The instances in world space (the spawn's root and the node's transform applied), 16 floats
   * each. */
  matrices: Float32Array;
  /** A colour per instance, linear RGB. */
  colors?: Float32Array;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Every cell's levels of detail. */
  lod?: MeshLodDef;
  /** The cells' entity options, without an `appId` (`id` names them). */
  entityOpts?: CoreEntityOpts;
};

/** The LOD extension's part of an import (see {@link ImportExtension}). */
export type ImportLodChainsExtension = {
  /** Reads the prebuilt LOD chains of a file parsed on the main thread, by
   * `getGLTFPrimitiveKey` of their base primitive. */
  read: (gltf: GLTF) => Promise<GLTFLodChains>;
  /** Rebuilds a prebuilt chain the assets worker read, around its base geometry. */
  deserialize: (chain: TransferableLodChain, base: THREE.BufferGeometry) => ExtractedLodChain;
  /** Registers the prebuilt chains of the geometries an import registered. Awaited by the import,
   * so a `lodChain` request right after it finds them. */
  registerPrebuilt: (
    importId: string,
    prebuilt: { geometryId: string; chain: ExtractedLodChain }[]
  ) => Promise<void>;
  /** Starts the chains an import's `lodChain` asks for. Not awaited by the import. */
  request: (manifest: ImportedAssetManifest, lodChain: true | LodChainOptions) => void;
};

/**
 * A feature's part of the imports (`FeatureContext.registerImportExtension`): each member is
 * optional, and each one has one provider (a second throws). Engine features only so far:
 * `physics()` spawns the bodies, `lod()` handles the LOD chains, `instancing()` draws the GPU
 * instances.
 */
export type ImportExtension = {
  /** The feature's id, named by the warning of an import that needs the missing extension. */
  id: string;
  /** Spawns the physics bodies and colliders the nodes' custom props (or `physicsParams`)
   * describe, and returns their entity ids. */
  spawnPhysics?: (spawn: ImportPhysicsSpawn) => Promise<number[]>;
  /** Reads, registers and generates LOD chains. */
  lodChains?: ImportLodChainsExtension;
  /** Draws a node's GPU instances in cells of static instances, and resolves the cells' entity
   * ids (none when the scene was left while its code loaded). */
  spawnInstances?: (spawn: ImportInstancesSpawn) => Promise<number[]>;
};

let physicsExtension: ImportExtension | null = null;
let lodChainsExtension: ImportExtension | null = null;
let instancesExtension: ImportExtension | null = null;
const warnedMissing = new Set<string>();

/**
 * Registers a feature's import extension (`FeatureContext.registerImportExtension`). Throws when
 * another extension already provides one of its members.
 * @internal
 */
export const registerImportExtension = (extension: ImportExtension) => {
  const taken = (current: ImportExtension | null, member: string) => {
    if (!current) return;
    throw new Error(
      `registerImportExtension: '${extension.id}' adds \`${member}\`, which '${current.id}' already adds.`
    );
  };
  if (extension.spawnPhysics) taken(physicsExtension, 'spawnPhysics');
  if (extension.lodChains) taken(lodChainsExtension, 'lodChains');
  if (extension.spawnInstances) taken(instancesExtension, 'spawnInstances');
  if (extension.spawnPhysics) physicsExtension = extension;
  if (extension.lodChains) lodChainsExtension = extension;
  if (extension.spawnInstances) instancesExtension = extension;
};

/**
 * The physics spawn of the registered extensions, if any.
 * @internal
 */
export const getImportPhysicsSpawn = () => physicsExtension?.spawnPhysics ?? null;

/**
 * The LOD chain hooks of the registered extensions, if any.
 * @internal
 */
export const getImportLodChains = () => lodChainsExtension?.lodChains ?? null;

/**
 * The GPU instances' spawn of the registered extensions, if any.
 * @internal
 */
export const getImportInstancesSpawn = () => instancesExtension?.spawnInstances ?? null;

/**
 * Warns once per feature and use that an import needs a feature that isn't installed.
 * @internal
 * @param featureId the missing feature's id (`'physics'`, `'lod'`, `'instancing'`)
 * @param use what needed it, the subject of the warning, eg. "spawnImportedAsset (a node with
 *   physics custom props)"
 */
export const warnMissingImportExtension = (featureId: string, use: string) => {
  const key = `${featureId}|${use}`;
  if (warnedMissing.has(key)) return;
  warnedMissing.add(key);
  lwarn(
    `${use} needs the '${featureId}' feature, which isn't installed: add \`${featureId}()\` (from 'aekasha/${featureId}') to InitEngine's \`features\`. Ignored (warned once).`
  );
};
