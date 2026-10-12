// The physics half of spawnImportedAsset (SpawnImported.ts): the physics feature's import
// extension (p607 D5), loaded on the first spawn with physics nodes.
import * as THREE from 'three/webgpu';
import type { ColliderParams, RigidBodyParams } from '../Physics/PhysicsAPITypes';
import { createPhysicsEntity } from '../PhysicsManager';
import type { ImportPhysicsSpawn } from './ImportExtensions';
import type { ImportSpawnNode } from './ImportTypes';
import { deriveColliderFromGeometry } from './MeshColliderGeometry';

/**
 * Physics of the spawned nodes (the `physics()` feature's import extension, PhysicsFeature.ts):
 * one rigid body per custom prop `index` group (nodes without an index form one group together),
 * carried by the group's node with a `rigidType`, plus one collider per physics node of the group.
 *
 * The rigid body attaches to an existing mesh entity (the anchor): the rigid body node itself when
 * it's visible, otherwise the group's first visible node. Every other collider is offset by its
 * node's transform relative to the anchor's position + rotation. A group with no visible node
 * becomes a headless physics entity at the rigid body node's transform.
 * @internal
 * @returns the entity ids carrying the rigid bodies
 */
export const spawnImportedPhysics = async ({ nodes, params, appIdPrefix }: ImportPhysicsSpawn) => {
  const groups: ImportSpawnNode[][] = [];
  const withoutIndex = nodes.filter((n) => typeof n.props.index !== 'number');
  if (withoutIndex.length) groups.push(withoutIndex);
  const indexes = [
    ...new Set(nodes.map((n) => n.props.index).filter((i) => typeof i === 'number')),
  ];
  for (const index of indexes) groups.push(nodes.filter((n) => n.props.index === index));

  const physicsEntityIds: number[] = [];
  for (const group of groups) {
    const rigid = group.find((n) => n.props.rigidType);
    if (!rigid?.props.isPhysObj || !rigid.props.colliderParams) continue;
    const members = [
      rigid,
      ...group.filter(
        (n) => n !== rigid && !n.props.rigidType && n.props.isPhysObj && n.props.colliderParams
      ),
    ];
    // Same anchor search order as before: rigid node, then colliders, then non-collider nodes
    const searchOrder = [
      rigid,
      ...group.filter((n) => n !== rigid && !n.props.rigidType && n.props.colliderParams),
      ...group.filter((n) => n !== rigid && !n.props.rigidType && !n.props.colliderParams),
    ];
    const anchor = searchOrder.find((n) => n.entityId !== undefined) || rigid;
    const anchorInverse = new THREE.Matrix4()
      .compose(anchor.position, anchor.quaternion, new THREE.Vector3(1, 1, 1))
      .invert();

    const colliders: ColliderParams[] = [];
    for (const member of members) {
      // Override fields custom props can't express (isSensor, event callbacks, explicit
      // vertices, ...) pass through; the parsed fields already include the override's values
      const colliderParams = {
        ...member.override?.collider,
        ...member.props.colliderParams,
      } as ColliderParams;
      let collider = deriveColliderFromGeometry(colliderParams, {
        geometry: member.geometry,
        info: member.info,
      });
      if (!collider) continue;
      if (member !== anchor && !collider.translation && !collider.rotation) {
        const offset = new THREE.Matrix4()
          .compose(member.position, member.quaternion, new THREE.Vector3(1, 1, 1))
          .premultiply(anchorInverse);
        const pos = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        offset.decompose(pos, rot, new THREE.Vector3());
        // Identity rotation is left out so it can't override a shape's own `orientation`
        const isRotated = Math.abs(rot.w) < 1 - 1e-6;
        collider = {
          ...collider,
          translation: { x: pos.x, y: pos.y, z: pos.z },
          ...(isRotated ? { rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w } } : {}),
        };
      }
      colliders.push(collider);
    }
    if (!colliders.length) continue;

    // The override's other rigid body fields (angvel, ccdEnabled, ...) pass through; placement
    // is the spawner's (translation/rotation come from the node and the root transform)
    const overrideRigidBody: Partial<RigidBodyParams> = { ...rigid.override?.rigidBody };
    delete overrideRigidBody.translation;
    delete overrideRigidBody.rotation;
    const userData = { ...rigid.props.rigidBodyUserData, ...overrideRigidBody.userData };
    const rigidBody: RigidBodyParams = {
      ...overrideRigidBody,
      rigidType: rigid.props.rigidType as RigidBodyParams['rigidType'],
      ...(Object.keys(userData).length ? { userData } : {}),
    };
    const isHeadless = anchor.entityId === undefined;
    const entityId = await createPhysicsEntity(
      colliders,
      isHeadless
        ? {
            ...rigidBody,
            translation: { x: anchor.position.x, y: anchor.position.y, z: anchor.position.z },
            rotation: {
              x: anchor.quaternion.x,
              y: anchor.quaternion.y,
              z: anchor.quaternion.z,
              w: anchor.quaternion.w,
            },
          }
        : rigidBody,
      anchor.entityId,
      isHeadless
        ? {
            ...params.entityOpts,
            appId: appIdPrefix ? `${appIdPrefix}/${rigid.localName}-phys` : undefined,
          }
        : undefined
    );
    physicsEntityIds.push(entityId);
  }
  return physicsEntityIds;
};
