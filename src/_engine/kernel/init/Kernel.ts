import { installCoreSystems } from '../ecs/ECSCoreSystems';
import { installObjectFrustumCulling } from '../ecs/ObjectFrustumCullingSystem';
import type { FeatureContext } from './Features';
import { installGroups } from '../scene/Group';
import { installMeshes } from '../mesh/Mesh';
import { installRaycast } from '../render/Raycast';
import { installCameras } from '../camera/Camera';
import { installLights } from '../light/Light';

/**
 * Installs the kernel's systems and hooks (p607 D2): the core ECS plumbing, frustum culling,
 * meshes, groups, ray casting, cameras and lights. Always installed, never listed in `features`.
 * `InitEngine` calls it before the first world, so the core plugin's systems come first in every
 * world. Their debug modules load later in the boot (debug env), before the features install; the
 * input devices register nothing here: each adds its listeners on its first binding.
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
  // Hooks and a resizer only, last: before p612 they registered after the first world and the
  // 3D symbols, whose hooks on the same tags are add hooks (these are delete hooks)
  installCameras(ctx);
  installLights(ctx);
};
