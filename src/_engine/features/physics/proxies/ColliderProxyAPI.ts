// The WORKER_THREAD collider: each call a message to the worker.

import type { ShapeType } from '@dimforge/rapier3d-compat';
import {
  commandWorker,
  messageWorkerAsync,
  queryWorker,
  throwWorkerSync,
  toPlainRot,
} from '../PhysicsMessaging';
import type { PhysicsCommandFor, PhysicsQueryType } from '../PhysicsMessaging';
import type { PhysicsResponse } from '../protocol/PhysicsDownProtocol';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type {
  ColliderAPI,
  HeightFieldData,
  InteractionGroupsAPI,
} from '../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';

/** The `*Sync` twins this proxy can't answer: their value is the worker's. */
const asyncOnly = (getter: string): never => throwWorkerSync('ColliderAPI', getter);

/**
 * A collider in WORKER_THREAD mode: each call is a message to the worker.
 * @internal
 */
export class ColliderProxyAPI implements ColliderAPI {
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  /** The proxy of a collider the worker made (its id and parent from the reply). */
  constructor(
    /** The collider's id. */
    public id: number,
    /** The rigid body it's attached to, if any. */
    public parentId?: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
  }

  /** A one-way command about this collider. */
  private command(message: PhysicsCommandFor<'colliderId'>) {
    commandWorker(message, 'colliderId', this.id);
  }

  /** A query for one of this collider's fields. */
  private ask<T extends PhysicsQueryType<'colliderId'>>(type: T) {
    return queryWorker(type, 'colliderId', this.id);
  }

  // --- Metadata ---
  async getUserData(): Promise<Record<string, unknown>> {
    const res = await this.ask(PhysicsProtocolType.COLL_GET_USERDATA);
    this.uData = res.userData;
    return res.userData;
  }
  getUserDataSync(): Record<string, unknown> {
    return this.uData;
  }
  setUserData(userData: Record<string, unknown>, addToExisting?: boolean): void {
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
    this.command({
      type: PhysicsProtocolType.COLL_SET_USERDATA,
      userData,
      addToExisting,
      isOneWay: true,
    });
  }

  async isValid(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.COLL_IS_VALID)).isValid;
  }
  isValidSync(): boolean {
    return asyncOnly('isValid');
  }

  // --- Transformation ---
  async translation(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.COLL_TRANSLATION)).translation;
  }
  translationSync(): PhysVector {
    return asyncOnly('translation');
  }

  async translationWrtParent(): Promise<PhysVector | null> {
    return (await this.ask(PhysicsProtocolType.COLL_TRANSLATION_WRT_PARENT)).translation;
  }
  translationWrtParentSync(): PhysVector | null {
    return asyncOnly('translationWrtParent');
  }

  async rotation(): Promise<PhysRotation> {
    return (await this.ask(PhysicsProtocolType.COLL_ROTATION)).rotation;
  }
  rotationSync(): PhysRotation {
    return asyncOnly('rotation');
  }

  async rotationWrtParent(): Promise<PhysRotation | null> {
    return (await this.ask(PhysicsProtocolType.COLL_ROTATION_WRT_PARENT)).rotation;
  }
  rotationWrtParentSync(): PhysRotation | null {
    return asyncOnly('rotationWrtParent');
  }

  setTranslation(tra: PhysVector): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_TRANSLATION, tra });
  }
  setTranslationWrtParent(tra: PhysVector): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_TRANSLATION_WRT_PARENT, tra });
  }
  setRotation(rot: PhysRotation): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_ROTATION, rot: toPlainRot(rot) });
  }
  setRotationWrtParent(rot: PhysRotation): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_ROTATION_WRT_PARENT, rot: toPlainRot(rot) });
  }

  // --- Physical Properties ---
  async isSensor(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.COLL_IS_SENSOR)).isSensor;
  }
  isSensorSync(): boolean {
    return asyncOnly('isSensor');
  }
  setSensor(isSensor: boolean): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_SENSOR, isSensor });
  }

  async isEnabled(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.COLL_IS_ENABLED)).isEnabled;
  }
  isEnabledSync(): boolean {
    return asyncOnly('isEnabled');
  }
  setEnabled(enabled: boolean): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_ENABLED, enabled });
  }

  async friction(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_FRICTION)).friction;
  }
  frictionSync(): number {
    return asyncOnly('friction');
  }
  setFriction(friction: number): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_FRICTION, friction });
  }

  async restitution(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_RESTITUTION)).restitution;
  }
  restitutionSync(): number {
    return asyncOnly('restitution');
  }
  setRestitution(restitution: number): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_RESTITUTION, restitution });
  }

  async mass(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_MASS)).mass;
  }
  massSync(): number {
    return asyncOnly('mass');
  }
  setMass(mass: number): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_MASS, mass });
  }

  setMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation
  ): void {
    this.command({
      type: PhysicsProtocolType.COLL_SET_MASS_PROPERTIES,
      mass,
      centerOfMass,
      principalAngularInertia,
      angularInertiaLocalFrame,
      isOneWay: true, // Fire-and-forget
    });
  }

  async density(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_DENSITY)).density;
  }
  densitySync(): number {
    return asyncOnly('density');
  }
  setDensity(density: number): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_DENSITY, density });
  }

  // --- Geometry Details ---
  async shapeType(): Promise<ShapeType> {
    return (await this.ask(PhysicsProtocolType.COLL_SHAPE_TYPE)).shapeType;
  }
  shapeTypeSync(): ShapeType {
    return asyncOnly('shapeType');
  }

  async radius(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_RADIUS)).radius;
  }
  radiusSync(): number {
    return asyncOnly('radius');
  }

  async halfHeight(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_HALF_HEIGHT)).halfHeight;
  }
  halfHeightSync(): number {
    return asyncOnly('halfHeight');
  }

  async halfExtents(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.COLL_HALF_EXTENTS)).halfExtents;
  }
  halfExtentsSync(): PhysVector {
    return asyncOnly('halfExtents');
  }

  // --- Geometry (mesh-type shapes) ---
  // One RPC per collider, paid once when its debug wireframe is first built —
  // never per frame. The worker sends the typed arrays as Transferables rather than
  // structured clones, since mesh data can be large.

  async vertices(): Promise<Float32Array | null> {
    return (await this.ask(PhysicsProtocolType.COLL_VERTICES)).vertices;
  }
  verticesSync(): Float32Array | null {
    return asyncOnly('vertices');
  }

  async indices(): Promise<Uint32Array | null> {
    return (await this.ask(PhysicsProtocolType.COLL_INDICES)).indices;
  }
  indicesSync(): Uint32Array | null {
    return asyncOnly('indices');
  }

  async heights(): Promise<HeightFieldData | null> {
    return (await this.ask(PhysicsProtocolType.COLL_HEIGHTS)).heights;
  }
  heightsSync(): HeightFieldData | null {
    return asyncOnly('heights');
  }

  async normal(): Promise<PhysVector | null> {
    return (await this.ask(PhysicsProtocolType.COLL_NORMAL)).normal;
  }
  normalSync(): PhysVector | null {
    return asyncOnly('normal');
  }

  async borderRadius(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.COLL_BORDER_RADIUS)).borderRadius;
  }
  borderRadiusSync(): number {
    return asyncOnly('borderRadius');
  }

  // --- Groups ---
  async collisionGroups(): Promise<InteractionGroupsAPI> {
    return (await this.ask(PhysicsProtocolType.COLL_COLLISION_GROUPS)).groups;
  }
  collisionGroupsSync(): InteractionGroupsAPI {
    return asyncOnly('collisionGroups');
  }
  setCollisionGroups(groups: InteractionGroupsAPI): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_COLLISION_GROUPS, groups });
  }

  async solverGroups(): Promise<InteractionGroupsAPI> {
    return (await this.ask(PhysicsProtocolType.COLL_SOLVER_GROUPS)).groups;
  }
  solverGroupsSync(): InteractionGroupsAPI {
    return asyncOnly('solverGroups');
  }
  setSolverGroups(groups: InteractionGroupsAPI): void {
    this.command({ type: PhysicsProtocolType.COLL_SET_SOLVER_GROUPS, groups });
  }

  // --- Queries ---
  async containsPoint(point: PhysVector): Promise<boolean> {
    return (
      await messageWorkerAsync<PhysicsResponse<PhysicsProtocolType.COLL_CONTAINS_POINT>>({
        type: PhysicsProtocolType.COLL_CONTAINS_POINT,
        colliderId: this.id,
        point,
      })
    ).isInside;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the interface's signature
  containsPointSync(_point: PhysVector): boolean {
    return asyncOnly('containsPoint');
  }
}
