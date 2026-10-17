import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type { RigidBodyAPI } from './types/PhysicsBodyTypes';
import type { ColliderAPI } from './types/PhysicsColliderTypes';
import type { PhysicsEngine } from './types/PhysicsConfigTypes';
import { ENGINES } from './backends/Engines';

let curEngineObj: unknown = null;

/**
 * Loads a physics backend: its engine package (Rapier's WASM included) and its backend module,
 * together. Both the facade (MAIN_THREAD) and the worker call it once.
 * @internal
 */
export const initPhysicsEngine = async (engineKey: PhysicsEngine) => {
  const engineFns = ENGINES[engineKey];
  const [engineObj, engineAPI] = await Promise.all([engineFns.init(), engineFns.loadEngineAPI()]);
  curEngineObj = engineObj;
  return { engine: engineFns.forceTypeEngine(curEngineObj), engineAPI };
};

/**
 * The engine package initPhysicsEngine loaded (Rapier's module), or null before it.
 * @internal
 */
export const getPhysicsEngine = () => curEngineObj;

/**
 * Every message type's number, for the facade's check of what the worker sends.
 * @internal
 */
export const ValidProtocolTypes = new Set(
  Object.values(PhysicsProtocolType).filter((v) => typeof v === 'number')
);

/**
 * The id of a body or collider given as itself or its id.
 * @internal
 */
export const getCollOrRigidId = (idOrAPI?: number | RigidBodyAPI | ColliderAPI) =>
  typeof idOrAPI === 'number' ? idOrAPI : idOrAPI?.id;
