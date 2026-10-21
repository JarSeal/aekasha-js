// Build-time LOD chains in a GLB (docs/plans/_DONE_p347_lod-chain-generation.md Phase 3). The asset
// pipeline (devTools/assetPipeline/lodChains.ts) writes each chain's levels as meshes no node
// references (`<mesh>__lod<n>`, a single primitive each), described by the root's extras: glTF
// viewers and GLTFLoader's scene parse don't touch them, and this file loads them explicitly. Not
// a second glTF scene: GLTFLoader reduces `parser.associations` to the last scene it loads, which
// would hide the default scene's nodes from extractPrimitives(). Runs on both threads (main-thread
// imports and the assets worker), so keep it free of imports that touch `window`/`document`.
import * as THREE from 'three/webgpu';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  deserializeAttribute,
  serializeGeometry,
  type TransferableAttribute,
} from '../../kernel/assets/import/GeometryTransfer';
import { getGLTFPrimitiveKey } from '../../kernel/assets/import/GLTFExtract';
import {
  GLTF_LOD_EXTRAS_KEY,
  GLTF_LOD_FORMAT_VERSION,
  type GLTFLodChainsExtras,
  type LodLevelVertices,
  type ResolvedLodChainOptions,
} from './LodChainOptions';

/**
 * A base primitive's prebuilt chain, as loaded.
 * For the kernel's glTF import and the LOD feature's import extension.
 * @internal
 */
export type ExtractedLodChain = {
  extent: number;
  baseTriangles: number;
  vertices: LodLevelVertices;
  options: ResolvedLodChainOptions;
  /** LOD1 onwards. Their attributes are the base's (`BASE`), shared by every level (`WELDED`) or
   * their own (`OWN`). */
  levels: { geometry: THREE.BufferGeometry; triangles: number; error: number }[];
};

/**
 * A file's prebuilt chains, by `getGLTFPrimitiveKey` (kernel/assets/import/GLTFExtract.ts) of their base.
 * What the LOD import extension hands the kernel's glTF extraction.
 * @internal
 */
export type GLTFLodChains = Map<string, ExtractedLodChain>;

/** A level mesh's geometry, loaded through the parser (cached, so its attributes are the same
 * objects as the base primitive's when it indexes them). */
const loadLevelGeometry = async (gltf: GLTF, meshIndex: number) => {
  try {
    const obj = (await gltf.parser.getDependency('mesh', meshIndex)) as THREE.Object3D;
    const mesh = (obj as THREE.Mesh).isMesh ? obj : obj.children[0];
    return (mesh as THREE.Mesh | undefined)?.geometry ?? null;
  } catch {
    return null;
  }
};

/**
 * Loads the prebuilt LOD chains of a parsed glTF, by `getGLTFPrimitiveKey` of their base, for
 * extractPrimitives(). Empty for a file without any, or with another format version.
 * Called through the LOD import extension, on both threads.
 * @internal
 */
export const readGLTFLodChains = async (gltf: GLTF): Promise<GLTFLodChains> => {
  const chains: GLTFLodChains = new Map();
  const extras = gltf.userData?.[GLTF_LOD_EXTRAS_KEY] as GLTFLodChainsExtras | undefined;
  if (extras?.version !== GLTF_LOD_FORMAT_VERSION) return chains;

  for (const chain of extras.chains) {
    const levels: ExtractedLodChain['levels'] = [];
    for (const { mesh, triangles, error } of chain.levels) {
      const geometry = await loadLevelGeometry(gltf, mesh);
      // A level missing from the file: the chain ends before it
      if (!geometry) break;
      levels.push({ geometry, triangles, error });
    }
    chains.set(getGLTFPrimitiveKey(chain.mesh, chain.primitive), {
      extent: chain.extent,
      baseTriangles: chain.baseTriangles,
      vertices: chain.vertices,
      options: extras.options,
      levels,
    });
  }
  return chains;
};

/**
 * A level's vertex arrays: the base's, the ones every level shares, or its own.
 * @internal
 */
export type TransferableLevelAttributes = 'BASE' | 'SHARED' | Record<string, TransferableAttribute>;

/**
 * A prebuilt chain as the assets worker sends it to the main thread: {@link serializeLodChain}'s
 * result, {@link deserializeLodChain}'s input.
 * @internal
 */
export type TransferableLodChain = Omit<ExtractedLodChain, 'levels'> & {
  /** `WELDED` only: the vertex arrays every level indexes, sent once */
  shared?: Record<string, TransferableAttribute>;
  levels: {
    index: TransferableAttribute;
    attributes: TransferableLevelAttributes;
    triangles: number;
    error: number;
  }[];
};

const hasAttributesOf = (geometry: THREE.BufferGeometry, other: THREE.BufferGeometry) => {
  const names = Object.keys(geometry.attributes);
  return (
    names.length === Object.keys(other.attributes).length &&
    names.every((name) => geometry.attributes[name] === other.attributes[name])
  );
};

/** The arrays of a geometry made of the given parts, as serializeGeometry() describes them. */
const serializeParts = (
  parts: { index?: THREE.BufferAttribute | null; attributes?: THREE.BufferGeometry['attributes'] },
  transfer: Set<ArrayBuffer>
) => {
  const geometry = new THREE.BufferGeometry();
  if (parts.index) geometry.setIndex(parts.index);
  for (const [name, attr] of Object.entries(parts.attributes ?? {})) {
    geometry.setAttribute(name, attr);
  }
  return serializeGeometry(geometry, transfer);
};

/**
 * Describes a prebuilt chain for the worker hop. GLTFLoader gives the levels the base's attribute
 * objects (or, `WELDED`, the first level's), and serializing each level on its own would copy
 * them per level: a level that shares them is sent as its index only.
 * The assets worker's GLTF job calls it.
 * @internal
 * @param base the chain's base geometry, serialized into the same message
 * @param transfer collects the ArrayBuffers to pass as the postMessage transfer list
 */
export const serializeLodChain = (
  chain: ExtractedLodChain,
  base: THREE.BufferGeometry,
  transfer: Set<ArrayBuffer>
): TransferableLodChain => {
  const sharedSource =
    chain.vertices === 'BASE'
      ? base
      : chain.vertices === 'WELDED'
        ? chain.levels[0]?.geometry
        : null;
  const shared =
    chain.vertices === 'WELDED' && sharedSource
      ? serializeParts({ attributes: sharedSource.attributes }, transfer).attributes
      : undefined;
  return {
    extent: chain.extent,
    baseTriangles: chain.baseTriangles,
    vertices: chain.vertices,
    options: chain.options,
    ...(shared ? { shared } : {}),
    levels: chain.levels.map(({ geometry, triangles, error }) => {
      const isShared = !!sharedSource && hasAttributesOf(geometry, sharedSource);
      const data = serializeParts(
        { index: geometry.index, ...(isShared ? {} : { attributes: geometry.attributes }) },
        transfer
      );
      const attributes: TransferableLevelAttributes = isShared
        ? chain.vertices === 'BASE'
          ? 'BASE'
          : 'SHARED'
        : data.attributes;
      return { index: data.index!, attributes, triangles, error };
    }),
  };
};

/**
 * Rebuilds a chain described by {@link serializeLodChain}: a level that shared its attributes gets
 * the same attribute objects again (the base's, or one set for every level).
 * The LOD import extension calls it.
 * @internal
 * @param base the chain's base geometry, already rebuilt
 */
export const deserializeLodChain = (
  data: TransferableLodChain,
  base: THREE.BufferGeometry
): ExtractedLodChain => {
  const toAttributes = (attributes: Record<string, TransferableAttribute>) =>
    Object.fromEntries(
      Object.entries(attributes).map(([name, attr]) => [name, deserializeAttribute(attr)])
    );
  const shared = data.shared ? toAttributes(data.shared) : undefined;
  return {
    extent: data.extent,
    baseTriangles: data.baseTriangles,
    vertices: data.vertices,
    options: data.options,
    levels: data.levels.map(({ index, attributes, triangles, error }) => {
      const geometry = new THREE.BufferGeometry();
      const source =
        attributes === 'BASE'
          ? base.attributes
          : attributes === 'SHARED'
            ? shared ?? {}
            : toAttributes(attributes);
      for (const [name, attr] of Object.entries(source)) geometry.setAttribute(name, attr);
      geometry.setIndex(deserializeAttribute(index));
      return { geometry, triangles, error };
    }),
  };
};
