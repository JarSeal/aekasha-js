// The determinism probe's report (p101 P0), apart from the probe (`debug/_dbg__PhysicsDeterminism.ts`)
// so the test bridge's public types can name it: a `_dbg__` module's types aren't documented.

/**
 * A finished probe run, as the `[PhysicsProbe] <sceneId> | <config> | <steps> | <hash>` line logs
 * it. The determinism probe's and the test bridge's (`TestBridgeProbeResult`).
 * @internal
 */
export type PhysicsProbeReport = {
  /** The probed scene */
  sceneId: string;
  /** `<workerTarget>/<transport> | <interpolation>` */
  config: string;
  /** The fixed steps after the scene enter the probe hashed at */
  steps: number;
  /** The hash of every dynamic body's state at that step */
  hash: string;
  /** The hashed bodies */
  bodyCount: number;
  /** Characters aren't hashed */
  characterCount: number;
};
