import * as THREE from 'three/webgpu';
import { lerror, lwarn } from '../../utils/Logger';
import { getEntityIdByAppId } from '../ECS';
import { getGeometryRegistry } from '../Geometry';
import { getMaterial } from '../Material';
import { createMeshEntity, type MeshProps } from '../MeshManager';
import { parseCustomProps } from './CustomProps';
import { getImportPhysicsSpawn, warnMissingImportExtension } from './ImportExtensions';
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
 * @param manifestOrId an {@link ImportedAssetManifest} or the id of an imported asset
 * @param params {@link SpawnImportedParams}
 * @returns Promise<{@link SpawnImportedResult}>
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

  const meshEntityIds: number[] = [];
  nodes.forEach((node) => {
    if (node.props.isPhysObj && !node.props.keepMesh) return;
    const index = manifest.geometries.indexOf(node.info);
    const meshProps = getMeshProps(params, node.info, index);
    const appId =
      meshProps?.appId ?? (appIdPrefix ? `${appIdPrefix}/${node.localName}` : undefined);
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
        appId,
      },
      { ...params.entityOpts, appId }
    );
    meshEntityIds.push(node.entityId);
  });

  // The physics extension (`physics()`) spawns the bodies and colliders the nodes describe
  let physicsEntityIds: number[] = [];
  if (nodes.some((node) => node.props.isPhysObj)) {
    const spawnPhysics = getImportPhysicsSpawn();
    if (spawnPhysics) physicsEntityIds = await spawnPhysics({ nodes, params, appIdPrefix });
    else warnMissingImportExtension('physics', 'spawnImportedAsset (a node with physics)');
  }
  return { meshEntityIds, physicsEntityIds };
};
