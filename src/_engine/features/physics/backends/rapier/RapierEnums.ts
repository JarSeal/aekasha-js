// The Physics API's enums that mirror Rapier's, converted in one place. Their members have Rapier's
// names and numbers (EngineRapier.test.ts checks each pair against the installed Rapier), so a
// conversion is a cast through the number.

import type { RigidBodyType, ShapeType as RapierShapeType } from '@dimforge/rapier3d-compat';
import type { RigidBodyTypeAPI } from '../../types/PhysicsBodyTypes';
import type { ShapeType } from '../../types/PhysicsColliderTypes';

/**
 * The API's body type as Rapier's.
 * @internal
 */
export const toRapierBodyType = (type: RigidBodyTypeAPI) => type as number as RigidBodyType;

/**
 * Rapier's body type as the API's.
 * @internal
 */
export const fromRapierBodyType = (type: RigidBodyType) => type as number as RigidBodyTypeAPI;

/**
 * Rapier's shape type as the API's.
 * @internal
 */
export const fromRapierShapeType = (type: RapierShapeType) => type as number as ShapeType;
