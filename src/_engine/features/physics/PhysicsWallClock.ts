/**
 * The wall clock under the deprecated `getPhysGameTime()` and its pause bookkeeping. No
 * simulation code reads it (the characters count fixed steps since p610); it goes with
 * `getPhysGameTime()` in engine 6.0.0. The simulation lint (`SIMULATION_FILES` in
 * `eslint.config.js`) allow-lists this file alone. Measurement reads use `readStatsClock`
 * (`utils/StatsClock.ts`) instead.
 * @internal
 */
export const readPhysicsWallClock = () => performance.now();
