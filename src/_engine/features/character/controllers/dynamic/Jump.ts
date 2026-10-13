import * as THREE from 'three/webgpu';
import type { DynamicCharacterContext } from './DynamicCharacterData';

// Jumping: the jump impulse (grounded, standing, off the cooldown) and the jump phase (locomotion
// state `JUMP`).

/** A jump that hasn't left the ground after this long (ms, eg. under a low ceiling) is over. */
const JUMP_LIFT_OFF_GRACE = 250;

const _jumpImpulse = new THREE.Vector3();

/** The jump phase (JUMP) lasts until the character stops rising in the air or lands. */
export const updateJumpPhase = (c: DynamicCharacterContext, step: number, stepMs: number) => {
  const { state, internal } = c;
  if (!internal.isJumping) return;
  if (!state.isGrounded) internal.jumpLeftGround = true;
  if (
    state.isTumbling ||
    (internal.jumpLeftGround && (state.isGrounded || state.relVelocity.y <= 0)) ||
    (!internal.jumpLeftGround && (step - internal.jumpStep) * stepMs > JUMP_LIFT_OFF_GRACE)
  ) {
    internal.isJumping = false;
  }
};

/** Jumps when the intent asks for it, the character is grounded and standing, and the cooldown is
 * over. Last in the tick: an impulse after the tick's setLinvel calls adds to them instead of being
 * overwritten (the WORKER_THREAD commands replay in order). */
export const tryJump = (
  c: DynamicCharacterContext,
  wantsJump: boolean,
  isControlled: boolean,
  step: number,
  stepMs: number
) => {
  const { state, config, internal } = c;
  if (
    wantsJump &&
    isControlled &&
    !state.isTumbling &&
    state.isGrounded &&
    !state.isCrouching &&
    (internal.jumpStep < 0 || (step - internal.jumpStep) * stepMs > config.jumpCooldown)
  ) {
    c.body.applyImpulse(_jumpImpulse.set(0, config.jumpAmount, 0), true);
    internal.jumpStep = step;
    internal.isJumping = true;
    internal.jumpLeftGround = false;
  }
};
