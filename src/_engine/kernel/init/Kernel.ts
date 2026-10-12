import { installCoreSystems } from '../ecs/ECSCoreSystems';
import { installObjectFrustumCulling } from '../ecs/ObjectFrustumCullingSystem';
import type { FeatureContext } from './Features';
import { installGroups } from '../scene/Group';
import { installMeshes } from '../mesh/Mesh';
import { installRaycast } from '../render/Raycast';

/**
 * Installs the kernel's systems and hooks (p607 D2): the core ECS plumbing, frustum culling,
 * meshes, groups and ray casting. Always installed, never listed in `features`. `InitEngine`
 * calls it before the first world, so the core plugin's systems come first in every world.
 * (The cameras, the lights and the input register in `InitEngine` itself.)
 * @internal
 */
export const installKernel = (ctx: FeatureContext) => {
  // No two of these register into the same stage and order or on the same component type, so
  // their order here doesn't change the system order
  installCoreSystems(ctx);
  installObjectFrustumCulling(ctx);
  installMeshes(ctx);
  installGroups(ctx);
  installRaycast(ctx);
};
