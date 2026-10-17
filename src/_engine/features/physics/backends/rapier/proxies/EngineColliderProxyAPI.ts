// The Rapier backend's collider API object.

import type Rapier from '@dimforge/rapier3d-compat';
import type {
  ColliderAPI,
  HeightFieldData,
  InteractionGroupsAPI,
  ShapeType,
} from '../../../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../../../types/PhysicsCommonTypes';
import { existsOrThrow } from '../../../../../utils/Assert';
import { backend, getCollider, toPlainRotation, toPlainVec } from '../RapierState';
/**
 * A collider's mass, as last given: a density, a mass, or full mass properties.
 * @internal
 */
export type ColliderMassMode =
  | { density: number }
  | { mass: number }
  | {
      mass: number;
      centerOfMass: PhysVector;
      principalAngularInertia: PhysVector;
      angularInertiaLocalFrame: PhysRotation;
    };

/**
 * A collider as a {@link ColliderAPI} on its Rapier collider. Its async forms run their `*Sync`
 * twins.
 * @internal
 */
export class EngineColliderProxyAPI implements ColliderAPI {
  private coll: Rapier.Collider;
  /** How its mass was last given, which Rapier can't tell (density() of a collider given a
   * mass is derived): a detached collider (p352 REMOVED tier) comes back with it. */
  massMode: ColliderMassMode = { density: 1 };
  /** Its own enabled flag, which Rapier can't tell apart from its body's (isEnabled() is false
   * on a disabled body), for a detached collider to come back with (p352 REMOVED tier). */
  ownEnabled = true;
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  /** The proxy of a collider createCollider just made (its Rapier collider found by `id`). */
  constructor(
    /** The collider's running id. */
    public id: number,
    /** The rigid body it's attached to, if any. */
    public parentId?: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
    // Retrieve the raw Rapier collider using the helper in RapierState.ts
    this.coll = existsOrThrow(
      getCollider(id),
      `Could not find collider in the engineAPI with id: ${id}`
    );
  }

  /**
   * Points the proxy at its re-created Rapier collider (reattachRigidBody, p352).
   * @internal
   */
  _rebind(coll: Rapier.Collider) {
    this.coll = coll;
  }

  // --- Metadata ---
  getUserDataSync() {
    return this.uData;
  }
  async getUserData() {
    return this.getUserDataSync();
  }
  setUserData(userData: Record<string, unknown>, addToExisting?: boolean) {
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
  }

  isValidSync() {
    return this.coll.isValid();
  }
  async isValid() {
    return this.isValidSync();
  }

  // --- Transformation ---
  translationSync(): PhysVector {
    const t = this.coll.translation();
    return { x: t.x, y: t.y, z: t.z };
  }
  async translation() {
    return this.translationSync();
  }

  translationWrtParentSync(): PhysVector | null {
    const t = this.coll.translationWrtParent();
    return t ? { x: t.x, y: t.y, z: t.z } : null;
  }
  async translationWrtParent() {
    return this.translationWrtParentSync();
  }

  rotationSync(): PhysRotation {
    const r = this.coll.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }
  async rotation() {
    return this.rotationSync();
  }

  rotationWrtParentSync(): PhysRotation | null {
    const r = this.coll.rotationWrtParent();
    return r ? { x: r.x, y: r.y, z: r.z, w: r.w } : null;
  }
  async rotationWrtParent() {
    return this.rotationWrtParentSync();
  }

  setTranslation(tra: PhysVector) {
    this.coll.setTranslation(new backend.RAPIER.Vector3(tra.x, tra.y, tra.z));
  }
  setTranslationWrtParent(tra: PhysVector) {
    this.coll.setTranslationWrtParent(new backend.RAPIER.Vector3(tra.x, tra.y, tra.z));
  }
  setRotation(rot: PhysRotation) {
    this.coll.setRotation(new backend.RAPIER.Quaternion(rot.x, rot.y, rot.z, rot.w));
  }
  setRotationWrtParent(rot: PhysRotation) {
    this.coll.setRotationWrtParent(new backend.RAPIER.Quaternion(rot.x, rot.y, rot.z, rot.w));
  }

  // --- Physical Properties ---
  isSensorSync() {
    return this.coll.isSensor();
  }
  async isSensor() {
    return this.isSensorSync();
  }
  setSensor(isSensor: boolean) {
    this.coll.setSensor(isSensor);
  }

  isEnabledSync() {
    return this.coll.isEnabled();
  }
  async isEnabled() {
    return this.isEnabledSync();
  }
  setEnabled(enabled: boolean) {
    this.coll.setEnabled(enabled);
    this.ownEnabled = enabled;
  }

  frictionSync() {
    return this.coll.friction();
  }
  async friction() {
    return this.frictionSync();
  }
  setFriction(friction: number) {
    this.coll.setFriction(friction);
  }

  restitutionSync() {
    return this.coll.restitution();
  }
  async restitution() {
    return this.restitutionSync();
  }
  setRestitution(restitution: number) {
    this.coll.setRestitution(restitution);
  }

  massSync() {
    return this.coll.mass();
  }
  async mass() {
    return this.massSync();
  }

  setMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation
  ): void {
    this.coll.setMassProperties(
      mass,
      new backend.RAPIER.Vector3(centerOfMass.x, centerOfMass.y, centerOfMass.z),
      new backend.RAPIER.Vector3(
        principalAngularInertia.x,
        principalAngularInertia.y,
        principalAngularInertia.z
      ),
      new backend.RAPIER.Quaternion(
        angularInertiaLocalFrame.x,
        angularInertiaLocalFrame.y,
        angularInertiaLocalFrame.z,
        angularInertiaLocalFrame.w
      )
    );
    this.massMode = {
      mass,
      centerOfMass: toPlainVec(centerOfMass),
      principalAngularInertia: toPlainVec(principalAngularInertia),
      angularInertiaLocalFrame: toPlainRotation(angularInertiaLocalFrame),
    };
  }

  densitySync() {
    return this.coll.density();
  }
  async density() {
    return this.densitySync();
  }
  setDensity(density: number) {
    this.coll.setDensity(density);
    this.massMode = { density };
  }
  setMass(mass: number) {
    this.coll.setMass(mass);
    this.massMode = { mass };
  }

  // --- Geometry Details ---
  shapeTypeSync(): ShapeType {
    return this.coll.shapeType() as unknown as ShapeType;
  }
  async shapeType() {
    return this.shapeTypeSync();
  }

  radiusSync(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.coll.shape as any).radius || 0;
  }
  async radius() {
    return this.radiusSync();
  }

  halfHeightSync(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.coll.shape as any).halfHeight || 0;
  }
  async halfHeight() {
    return this.halfHeightSync();
  }

  halfExtentsSync(): PhysVector {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const he = (this.coll.shape as any).halfExtents;
    return he ? { x: he.x, y: he.y, z: he.z } : { x: 0, y: 0, z: 0 };
  }
  async halfExtents() {
    return this.halfExtentsSync();
  }

  // --- Geometry (mesh-type shapes) ---
  // Same read-the-live-shape pattern as radiusSync/halfExtentsSync above. Rapier's
  // compat layer caches the JS-side Shape on first access (Collider.shape), so these
  // are plain property reads, not WASM round trips. The typed arrays are the ones the
  // shape itself owns: returned by reference (MAIN_THREAD is zero-copy by design) and
  // documented read-only on ColliderAPI. The worker's COLL_VERTICES/COLL_INDICES/
  // COLL_HEIGHTS handlers copy before transferring, precisely so transferring can't
  // neuter the live shape's buffers.

  verticesSync(): Float32Array | null {
    // The collider's own accessor first: for a ConvexPolyhedron built as a hull of loose points,
    // shape.vertices is the raw input point cloud, while this is the computed hull that
    // indicesSync()'s index buffer actually refers to.
    const colliderVertices = this.coll.vertices();
    if (colliderVertices instanceof Float32Array && colliderVertices.length)
      return colliderVertices;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = this.coll.shape as any;
    if (shape?.vertices instanceof Float32Array) return shape.vertices;
    // Segment (a, b) and Triangle/RoundTriangle (a, b, c) are the odd ones out: Rapier's
    // JS layer rebuilds them as separate Vector fields rather than a vertex buffer, even
    // though the WASM side stores them as one. Flatten them so every vertex-based shape
    // answers through this one accessor.
    const points = [shape?.a, shape?.b, shape?.c].filter(Boolean);
    if (!points.length) return null;
    const out = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      out[i * 3] = points[i].x;
      out[i * 3 + 1] = points[i].y;
      out[i * 3 + 2] = points[i].z;
    }
    return out;
  }
  async vertices() {
    return this.verticesSync();
  }

  indicesSync(): Uint32Array | null {
    // The collider's own accessor first: shape.indices is null for a ConvexPolyhedron built as a
    // hull of loose points (Rapier only computes that index buffer on the collider side).
    const colliderIndices = this.coll.indices();
    if (colliderIndices instanceof Uint32Array) return colliderIndices;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i = (this.coll.shape as any).indices;
    return i instanceof Uint32Array ? i : null;
  }
  async indices() {
    return this.indicesSync();
  }

  heightsSync(): HeightFieldData | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape = this.coll.shape as any;
    if (!(shape?.heights instanceof Float32Array)) return null;
    const scale = shape.scale;
    return {
      nrows: shape.nrows,
      ncols: shape.ncols,
      heights: shape.heights,
      scale: scale ? { x: scale.x, y: scale.y, z: scale.z } : { x: 1, y: 1, z: 1 },
    };
  }
  async heights() {
    return this.heightsSync();
  }

  normalSync(): PhysVector | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = (this.coll.shape as any).normal;
    return n ? { x: n.x, y: n.y, z: n.z } : null;
  }
  async normal() {
    return this.normalSync();
  }

  borderRadiusSync(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.coll.shape as any).borderRadius || 0;
  }
  async borderRadius() {
    return this.borderRadiusSync();
  }

  // --- Groups ---
  collisionGroupsSync(): InteractionGroupsAPI {
    return this.coll.collisionGroups();
  }
  async collisionGroups() {
    return this.collisionGroupsSync();
  }
  setCollisionGroups(groups: InteractionGroupsAPI) {
    this.coll.setCollisionGroups(groups);
  }

  solverGroupsSync(): InteractionGroupsAPI {
    return this.coll.solverGroups();
  }
  async solverGroups() {
    return this.solverGroupsSync();
  }
  setSolverGroups(groups: InteractionGroupsAPI) {
    this.coll.setSolverGroups(groups);
  }

  // --- Queries ---
  containsPointSync(point: PhysVector): boolean {
    return this.coll.containsPoint(new backend.RAPIER.Vector3(point.x, point.y, point.z));
  }
  async containsPoint(point: PhysVector) {
    return this.containsPointSync(point);
  }
}
