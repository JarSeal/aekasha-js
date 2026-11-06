import type { EngineFeature } from '../../kernel/init/Features';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { setPhysicsTierAccess } from '../../kernel/ecs/PhysicsTierAccess';
import { facade } from './PhysicsState';
import {
  deleteScenePhysicsTierPolicies,
  installPhysicsTierPolicy,
  setPhysicsTierPolicyMember,
} from './PhysicsTierPolicy';
import { installPhysicsTiers, requestPhysicsTierWants } from './PhysicsTiers';

/**
 * The physics tiers' part of a scene load: the left scene's scene-scoped tier policies go. Exit
 * hooks run in reverse install order, so before physics' own exit deletes the physics entities.
 * @internal
 */
export const physicsTiersSceneHooks: SceneHooks = {
  exit: (prevSceneId) => deleteScenePhysicsTierPolicies(prevSceneId),
};

/**
 * The physics tiers feature (engine 6.0.0, p622 D8): simulation tiers (`requestPhysicsTier`: a
 * dynamic body frozen, disabled or taken out of the physics world, and put back) and the tier
 * distance policy (`setPhysicsTierPolicy`, its members through `createPhysicsEntity`'s
 * `tierPolicy`). Needs `physics()` listed before it; list it right after. Without it,
 * `requestPhysicsTier`, `setPhysicsTierPolicy` and `setPhysicsTierPolicyMember` throw,
 * `tierPolicy` is ignored with one warning, `getPhysicsTier` answers `FULL`, and a build leaves
 * the tiers' code out.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { physics, physicsTiers } from 'aekasha/physics';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [physics(), physicsTiers()], start: async () => {} });
 * ```
 */
export const physicsTiers = (): EngineFeature => ({
  id: 'physicstiers',
  requires: ['physics'],
  install: (ctx) => {
    installPhysicsTiers(ctx);
    installPhysicsTierPolicy(ctx);
    ctx.addSceneHooks(physicsTiersSceneHooks);
    facade.tiersInstalled = true;
    // For a feature owning physics entities (streaming()'s cells), which can't import physics
    setPhysicsTierAccess({
      requestTiers: requestPhysicsTierWants,
      setPolicyMember: (world, entityId, member) =>
        setPhysicsTierPolicyMember(entityId, member, world),
    });
  },
});
