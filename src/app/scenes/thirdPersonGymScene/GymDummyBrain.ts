import { registerBrainKind } from 'aekasha/character';

/** `GYM_DUMMY`'s params, all optional (`brain: { kind: 'GYM_DUMMY' }` takes the defaults). */
export type GymDummyBrainParams = {
  /** How long each behaviour lasts before it jumps and switches (ms, counted in steps; default
   * 1000). */
  periodMs?: number;
};

declare module 'aekasha/character' {
  interface CharacterBrainKinds {
    /** The gym's dummy: turns, then every period jumps and switches between walking forward and
     * turning left. */
    GYM_DUMMY: GymDummyBrainParams;
  }
}

/**
 * Registers the gym dummy's brain kind (`GYM_DUMMY`, the app feature's install): an input-less
 * character that turns left until its first period ends, then every period jumps and switches
 * between walking forward and turning left. It counts steps from its first think, so it moves the
 * same way on every visit.
 */
export const registerGymDummyBrain = () => {
  registerBrainKind('GYM_DUMMY', (params) => {
    const periodMs = params.periodMs ?? 1000;
    let action: 'FORWARD' | 'TURN' | null = null;
    let periodStartStep = -1;
    return {
      kind: 'GYM_DUMMY',
      think: (intent, step, dt) => {
        const periodSteps = Math.max(1, Math.round(periodMs / (dt * 1000)));
        if (periodStartStep < 0) {
          periodStartStep = step;
        } else if (step - periodStartStep >= periodSteps) {
          action = action !== 'FORWARD' ? 'FORWARD' : 'TURN';
          intent.jump = true;
          periodStartStep = step;
        }
        // The move and the turn last one step (the controller clears them): written every step
        if (action === 'FORWARD') intent.moveForward += 1;
        else intent.turn += 1;
      },
    };
  });
};
