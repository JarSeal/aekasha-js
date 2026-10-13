import type { DynamicCharacterContext } from './DynamicCharacterData';

// Crouching: the crouch capsule (CROUCH) replaces the walk capsule (MAIN) while the intent's
// `crouch` is on.

/** Swaps the standing (MAIN) and crouching (CROUCH) colliders. */
const setCrouching = (c: DynamicCharacterContext, isCrouching: boolean) => {
  c.state.isCrouching = isCrouching;
  (isCrouching ? c.mainCollider : c.crouchCollider).setEnabled(false);
  (isCrouching ? c.crouchCollider : c.mainCollider).setEnabled(true);
};

/** Follows the intent's `crouch` (only while the controller moves the body). */
export const updateCrouch = (
  c: DynamicCharacterContext,
  wantsCrouch: boolean,
  isControlled: boolean
) => {
  if (isControlled && wantsCrouch !== c.state.isCrouching) setCrouching(c, wantsCrouch);
};
