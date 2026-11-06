import type { ECSWorld } from './ECS';
import type { PhysicsTier } from '../../features/physics/PhysicsTierTypes';

// Physics tier access (p353 Phase 4 D3, D8): kernel registries the physics tiers fill and read, so
// a feature that owns physics entities (streaming()'s cells) asks for tiers, and creates bodies
// in a tier, without importing physics. Both are inert without `physicsTiers()`.

/**
 * What a caller wants for one entity's tier: a tier, or `POLICY` (the entity follows its world's
 * tier policy, which decides for its whole joint group).
 * @internal
 */
export type PhysicsTierWant = PhysicsTier | 'POLICY';

/**
 * The physics tiers' functions, set by `physicsTiers()`'s install.
 * @internal
 */
export type PhysicsTierAccess = {
  /**
   * Requests a tier for each of `entityIds` with a want (`wantOf`; null: none), quietly skipping
   * an entity that can't have tiers (no `DYNAMIC` `createPhysicsEntity` body, a character). A
   * joint group changes tier as one, so it gets the finest want of all its members (`wantOf` is
   * asked for the members not listed too): `FULL` < `STATIC` < `DISABLED` < `REMOVED`, and a
   * `POLICY` member leaves the group to the policy (nothing is requested for it).
   */
  requestTiers: (
    world: ECSWorld,
    entityIds: readonly number[],
    wantOf: (entityId: number) => PhysicsTierWant | null
  ) => void;
  /** Puts the entity in its world's tier policy, or takes it out (its tier stays as it is). False
   * when it has no `DYNAMIC` `createPhysicsEntity` body. */
  setPolicyMember: (world: ECSWorld, entityId: number, member: boolean) => boolean;
};

let access: PhysicsTierAccess | null = null;

/**
 * Sets the physics tiers' functions (`physicsTiers()`'s install; null: none, a test's reset).
 * @internal
 */
export const setPhysicsTierAccess = (next: PhysicsTierAccess | null) => {
  access = next;
};

/**
 * The physics tiers' functions, or null without `physicsTiers()`.
 * @internal
 */
export const getPhysicsTierAccess = () => access;

// --- CREATION SCOPE (D3) ---

/**
 * The tier the `DYNAMIC` bodies `createPhysicsEntity` makes inside a scope start in, unless its
 * `initialTier` says otherwise.
 * @internal
 */
export type PhysicsCreationScope = {
  /** The tier a new body starts in. */
  readonly tier: 'FULL' | 'STATIC' | 'DISABLED';
  /** Set when the scope's entities are held out of the tier policy: a `tierPolicy` entity joins
   * nothing and is reported here instead (once its body exists). */
  readonly holdPolicyMember: ((world: ECSWorld, entityId: number) => void) | null;
};

let creationScope: PhysicsCreationScope | null = null;

/**
 * Runs `fn` (synchronous) with `scope` as the creation scope: the `createPhysicsEntity` calls it
 * makes, up to its first `await`, read it at their call.
 * @internal
 */
export const runInPhysicsCreationScope = <T>(
  scope: PhysicsCreationScope | null,
  fn: () => T
): T => {
  const prev = creationScope;
  creationScope = scope;
  try {
    return fn();
  } finally {
    creationScope = prev;
  }
};

/**
 * The creation scope in effect, or null.
 * @internal
 */
export const getPhysicsCreationScope = () => creationScope;
