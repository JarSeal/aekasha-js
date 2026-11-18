import * as THREE from 'three/webgpu';
import { lerror, lwarn } from '../../../utils/Logger';
import { getEntityIdByAppId } from '../../ecs/ECS';
import { getGeometryRegistry } from '../Geometry';
import { getMaterial } from '../Material';
import { createMeshEntity, type MeshProps } from '../../mesh/Mesh';
import { parseCustomProps } from './CustomProps';
import {
  getImportInstancesSpawn,
  getImportPhysicsSpawn,
  warnMissingImportExtension,
} from './ImportExtensions';
import { getImportedAsset, retagImportedAsset } from './ImportRegistry';
import type {
  ImportedAssetManifest,
  ImportedGeometryInfo,
  ImportSpawnNode,
  SpawnImportedParams,
  SpawnImportedResult,
} from './ImportTypes';

/** Used for visible pieces when no `material` is given (glTF materials are never imported). */
const DEFAULT_MATERIAL = { id: 'importedAssetDefault', type: 'STANDARD' } as const;

const getRootMatrix = (transform: SpawnImportedParams['transform']) => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  if (transform?.position)
    position.set(transform.position.x, transform.position.y, transform.position.z);
  if (transform?.quaternion) {
    const q = transform.quaternion;
    quaternion.set(q.x, q.y, q.z, q.w);
  } else if (transform?.rotation) {
    const r = transform.rotation;
    quaternion.setFromEuler(new THREE.Euler(r.x, r.y, r.z));
  }
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
};

const toSpawnNodes = (
  manifest: ImportedAssetManifest,
  params: SpawnImportedParams
): ImportSpawnNode[] => {
  const rootMatrix = getRootMatrix(params.transform);
  const overrides = Array.isArray(params.physicsParams)
    ? params.physicsParams
    : params.physicsParams
      ? [params.physicsParams]
      : [];
  const registry = getGeometryRegistry();
  const nameCounts = new Map<string, number>();
  const nodes: ImportSpawnNode[] = [];

  manifest.geometries.forEach((info, i) => {
    const count = (nameCounts.get(info.nodeName) || 0) + 1;
    nameCounts.set(info.nodeName, count);
    if (params.filter && !params.filter(info)) return;

    const geometry = registry[info.geometryId]?.resource;
    if (!geometry) {
      lerror(
        `spawnImportedAsset: geometry "${info.geometryId}" of import "${manifest.id}" is not registered (released?), node "${info.nodeName}" skipped.`
      );
      return;
    }

    const { position: p, quaternion: q, scale: s } = info.transform;
    const matrix = new THREE.Matrix4()
      .compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion(q.x, q.y, q.z, q.w),
        new THREE.Vector3(s.x, s.y, s.z)
      )
      .premultiply(rootMatrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);

    nodes.push({
      info,
      geometry,
      props: overrides[i] ? parseCustomProps(info.customProps.raw, overrides[i]) : info.customProps,
      override: overrides[i],
      localName: count > 1 ? `${info.nodeName}#${count - 1}` : info.nodeName,
      position,
      quaternion,
      scale,
    });
  });
  return nodes;
};

const MATRIX_SIZE = 16;

/** A node's instances in world space: its composed transform applied to each */
const toWorldInstances = (node: ImportSpawnNode, matrices: Float32Array) => {
  const nodeMatrix = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
  const instance = new THREE.Matrix4();
  const world = new Float32Array(matrices.length);
  for (let i = 0; i < matrices.length; i += MATRIX_SIZE) {
    instance.fromArray(matrices, i).premultiply(nodeMatrix).toArray(world, i);
  }
  return world;
};

const getMeshProps = (
  params: SpawnImportedParams,
  info: ImportedGeometryInfo,
  index: number
): Partial<MeshProps> | undefined =>
  Array.isArray(params.meshProps) ? params.meshProps[index] : params.meshProps?.[info.geometryId];

/**
 * Spawns an import's mesh and physics entities from its manifest: one mesh entity per visible
 * node (non-physics nodes and `keepMesh` physics nodes), using the registered geometry by id and
 * an engine material, at root transform ∘ node transform (node scale included), and the physics
 * the nodes' Blender custom props (or `physicsParams` overrides) describe, via the Physics API
 * (the `physics()` feature: without it, the physics nodes spawn no bodies, with a warning).
 * A piece is drawn merged into a merge group by its node's `merge` custom prop or the spawn's
 * `merge` (the `merging()` feature), joining at the group's next build.
 *
 * A node of GPU instances (`EXT_mesh_gpu_instancing`, eg. Blender's Geometry Nodes exported with
 * GPU Instances) is drawn as static instances in 16 m cells (`createStaticInstances`, the
 * `instancing()` feature), each cell a mesh entity `<appId>/<node>/<cellX>,<cellZ>`: its
 * `meshProps` entry's geometry, material, shadows and `lod` apply to every cell, its transform
 * fields, `merge` and physics don't. Without `instancing()` it warns once and draws the geometry
 * once, at the node. A point cloud (`aekScatterPoints`) spawns nothing: it's a scatter's data.
 * @param manifestOrId an import's manifest, or the id of an imported asset
 * @param params the root transform, the material, and the mesh and physics overrides
 * @returns the created entities (none, with an error logged, for an id that isn't imported)
 * @example
 * ```ts
 * import { spawnImportedAsset } from 'aekasha';
 *
 * // A crate imported earlier (importAssetAsync), as a dynamic body with a box collider
 * const { physicsEntityIds } = await spawnImportedAsset('crate', {
 *   transform: { position: { x: 0, y: 2, z: 0 } },
 *   material: 'crateMaterial',
 *   physicsParams: {
 *     isPhysObj: true,
 *     keepMesh: true,
 *     rigidBody: { rigidType: 'DYNAMIC' },
 *     collider: { type: 'BOX' },
 *   },
 * });
 * ```
 */
export const spawnImportedAsset = async (
  manifestOrId: ImportedAssetManifest | string,
  params: SpawnImportedParams = {}
): Promise<SpawnImportedResult> => {
  const manifest = typeof manifestOrId === 'string' ? getImportedAsset(manifestOrId) : manifestOrId;
  if (!manifest) {
    lerror(`spawnImportedAsset: no imported asset with id "${manifestOrId}" (import it first).`);
    return { meshEntityIds: [], physicsEntityIds: [] };
  }
  // Claimed for the scene spawning it (its collider-only geometries take no refs), see AssetOwners
  retagImportedAsset(manifest.id);

  const nodes = toSpawnNodes(manifest, params);
  let appIdPrefix: string | undefined = params.entityOpts?.appId ?? manifest.id;
  if (nodes.length && getEntityIdByAppId(`${appIdPrefix}/${nodes[0].localName}`) !== undefined) {
    lwarn(
      `spawnImportedAsset: entities with the appId prefix "${appIdPrefix}" already exist, so this spawn of "${manifest.id}" gets generated appIds. Pass a distinct entityOpts.appId for stable ones.`
    );
    appIdPrefix = undefined;
  }

  let material: MeshProps['mat'] = DEFAULT_MATERIAL;
  if (typeof params.material === 'string') {
    const registered = getMaterial(params.material);
    if (registered) material = registered;
    else lerror(`spawnImportedAsset: material "${params.material}" not found, using the default.`);
  } else if (params.material) {
    material = params.material;
  }

  // The spawn's `merge` leaves out the physics groups (an `index`, or the nodes without one) whose
  // body moves: their anchor's mesh moves with it
  const movingGroups = new Set(
    nodes
      .filter((node) => node.props.rigidType && node.props.rigidType !== 'FIXED')
      .map((node) => node.props.index)
  );

  const meshEntityIds: number[] = [];
  const spawnInstances = getImportInstancesSpawn();
  const instancedNodes = new Set<ImportSpawnNode>();
  nodes.forEach((node) => {
    const index = manifest.geometries.indexOf(node.info);
    const meshProps = getMeshProps(params, node.info, index);
    const appId =
      meshProps?.appId ?? (appIdPrefix ? `${appIdPrefix}/${node.localName}` : undefined);
    const { instances } = node.info;
    if (instances && spawnInstances) {
      instancedNodes.add(node);
      if (node.props.isPhysObj || node.props.merge) {
        lwarn(
          `spawnImportedAsset: node "${node.info.nodeName}" of import "${manifest.id}" has GPU instances, which get no physics or merge (its custom props ask for them): ignored.`
        );
      }
      const { appId: _appId, ...entityOpts } = params.entityOpts ?? {};
      meshEntityIds.push(
        ...spawnInstances({
          // Generated app ids (a spawn whose prefix is taken) are unique, as a mesh's UUID
          id: appId ?? `${manifest.id}/${node.localName}/${THREE.MathUtils.generateUUID()}`,
          geometry: meshProps?.geo ?? node.info.geometryId,
          material: meshProps?.mat ?? material,
          matrices: toWorldInstances(node, instances.matrices),
          colors: instances.colors,
          castShadow: meshProps?.castShadow ?? params.castShadow,
          receiveShadow: meshProps?.receiveShadow ?? params.receiveShadow,
          lod: meshProps?.lod,
          entityOpts,
        })
      );
      return;
    }
    if (instances) {
      warnMissingImportExtension(
        'instancing',
        'spawnImportedAsset (a node of GPU instances; drawn once, at the node)'
      );
    }
    if (node.props.isPhysObj && !node.props.keepMesh) return;
    const hasTransformOverride = Boolean(meshProps?.rotation || meshProps?.quaternion);
    node.entityId = createMeshEntity(
      {
        ...meshProps,
        geo: meshProps?.geo ?? node.info.geometryId,
        mat: meshProps?.mat ?? material,
        castShadow: meshProps?.castShadow ?? params.castShadow,
        receiveShadow: meshProps?.receiveShadow ?? params.receiveShadow,
        position: meshProps?.position ?? node.position,
        quaternion: hasTransformOverride ? meshProps?.quaternion : node.quaternion,
        scale: meshProps?.scale ?? node.scale,
        merge:
          meshProps?.merge ??
          node.props.merge ??
          (movingGroups.has(node.props.index) ? undefined : params.merge),
        appId,
      },
      { ...params.entityOpts, appId }
    );
    meshEntityIds.push(node.entityId);
  });

  // The physics extension (`physics()`) spawns the bodies and colliders the nodes describe
  let physicsEntityIds: number[] = [];
  const physicsNodes = instancedNodes.size
    ? nodes.filter((node) => !instancedNodes.has(node))
    : nodes;
  if (physicsNodes.some((node) => node.props.isPhysObj)) {
    const spawnPhysics = getImportPhysicsSpawn();
    if (spawnPhysics) {
      physicsEntityIds = await spawnPhysics({ nodes: physicsNodes, params, appIdPrefix });
    } else warnMissingImportExtension('physics', 'spawnImportedAsset (a node with physics)');
  }
  return { meshEntityIds, physicsEntityIds };
};
