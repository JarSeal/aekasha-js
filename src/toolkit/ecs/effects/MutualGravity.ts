import { getECSWorld, type ECSWorld, registerOnAllSceneExits, ECSSystemStage } from 'aekasha';
import type { PhysVector, RigidBodyAPI } from 'aekasha/physics';

// Mutual (N-body) gravity between the registered dynamic bodies, one APP_PHYSICS_STEP system per
// world; the doc for app code is on registerMutualGravityEffect.

/**
 * The mutual gravity's settings, global (every world, every scene): read them with
 * {@link getMutualGravityConfig}, change them with {@link setMutualGravityConfig}.
 */
export interface MutualGravityConfig {
  /** Gravitational constant in scene units (default 1: m/s² per kg of the attractor at 1 m). */
  G: number;
  /** Softening length ε in metres (default 0.5): about the size of the bodies. */
  softening: number;
  /** Whether the forces are applied (default true). Turning it off resets the forces once. */
  enabled: boolean;
}

/**
 * A gravity body as `getGravityBodies` lists it.
 * @internal
 */
export interface GravityBody {
  /** The body's entity. */
  entityId: number;
  /** Its gravitational mass. */
  mass: number;
}

const DEFAULT_CONFIG: MutualGravityConfig = { G: 1, softening: 0.5, enabled: true };
const config: MutualGravityConfig = { ...DEFAULT_CONFIG };

// Each world's bodies, entity id → mass (an entity id is unique only within its world)
const bodiesByWorld = new Map<ECSWorld, Map<number, number>>();
// The worlds whose bodies' forces may be non-zero (so turning gravity off resets them once)
const worldsWithForces = new Set<ECSWorld>();

// Per-sub-step scratch, grown on demand: poses (7 per body), forces (3 per body), the bodies
let poses = new Float64Array(7 * 16);
let forces = new Float64Array(3 * 16);
const stepBodies: RigidBodyAPI[] = [];
let stepMasses = new Float64Array(16);
const force: PhysVector = { x: 0, y: 0, z: 0 };

// Grows the scratch for n bodies, keeping the masses already collected this sub-step (the poses
// and forces are written after the collection)
const ensureCapacity = (n: number) => {
  if (stepMasses.length >= n) return;
  const size = Math.max(n, stepMasses.length * 2);
  poses = new Float64Array(7 * size);
  forces = new Float64Array(3 * size);
  const masses = new Float64Array(size);
  masses.set(stepMasses);
  stepMasses = masses;
};

const mutualGravitySystem = (world: ECSWorld) => {
  const bodies = bodiesByWorld.get(world);
  if (!bodies?.size) return;

  // Collect this world's live bodies, dropping the ones that are gone
  let n = 0;
  stepBodies.length = 0;
  for (const [entityId, mass] of bodies) {
    const rb = world.isAlive(entityId) ? world.getRigidBody(entityId) : undefined;
    if (!rb || rb.isBeingDeleted) {
      bodies.delete(entityId);
      continue;
    }
    ensureCapacity(n + 1);
    stepBodies.push(rb);
    stepMasses[n] = mass;
    n++;
  }
  if (!n) return;

  if (!config.enabled) {
    if (worldsWithForces.delete(world)) {
      for (let i = 0; i < n; i++) stepBodies[i].resetForces(true);
    }
    return;
  }

  for (let i = 0; i < n; i++) stepBodies[i].readPoseInto(poses, i * 7);
  forces.fill(0, 0, n * 3);

  const eps2 = config.softening * config.softening;
  for (let i = 0; i < n; i++) {
    const pi = i * 7;
    const mi = stepMasses[i];
    for (let j = i + 1; j < n; j++) {
      const pj = j * 7;
      const dx = poses[pj] - poses[pi];
      const dy = poses[pj + 1] - poses[pi + 1];
      const dz = poses[pj + 2] - poses[pi + 2];
      const d2 = dx * dx + dy * dy + dz * dz + eps2;
      if (d2 === 0) continue;
      // G·mi·mj / (r² + ε²)^(3/2), times the (unnormalized) separation
      const s = (config.G * mi * stepMasses[j]) / (d2 * Math.sqrt(d2));
      const fx = dx * s;
      const fy = dy * s;
      const fz = dz * s;
      forces[i * 3] += fx;
      forces[i * 3 + 1] += fy;
      forces[i * 3 + 2] += fz;
      forces[j * 3] -= fx;
      forces[j * 3 + 1] -= fy;
      forces[j * 3 + 2] -= fz;
    }
  }

  // Rapier keeps user forces until reset, so each sub-step replaces the last one's. The force
  // object is reused: MAIN_THREAD copies it into Rapier, WORKER_THREAD clones it at capture.
  for (let i = 0; i < n; i++) {
    const rb = stepBodies[i];
    rb.resetForces(false);
    force.x = forces[i * 3];
    force.y = forces[i * 3 + 1];
    force.z = forces[i * 3 + 2];
    rb.addForce(force, true);
  }
  worldsWithForces.add(world);
};

/**
 * Adds a dynamic physics entity to the mutual gravity of `world`, or updates its mass. Use the
 * body's real mass, so it falls as it's pulled: with a density-based collider that's density ×
 * collider volume (eg. `generateAsteroid`'s `hullVolume` for a `CONVEXHULL` collider). The body is
 * pulled from the next physics sub-step on, by the system {@link registerMutualGravityEffect}
 * registered on that world.
 * @param entityId an entity with a dynamic rigid body (`createPhysicsEntity`)
 * @param mass its gravitational mass
 * @param world the ECS world the entity lives in (default: the default world)
 */
export const addGravityBody = (entityId: number, mass: number, world?: ECSWorld) => {
  const w = world || getECSWorld();
  if (!w) return;
  let bodies = bodiesByWorld.get(w);
  if (!bodies) bodiesByWorld.set(w, (bodies = new Map()));
  bodies.set(entityId, mass);
};

/**
 * Removes an entity from the mutual gravity, in every world it was added in, and resets its user
 * forces (when its body still exists). An entity that isn't a gravity body is a no-op.
 * @param entityId an entity added with {@link addGravityBody}
 */
export const removeGravityBody = (entityId: number) => {
  for (const [world, bodies] of bodiesByWorld) {
    if (!bodies.delete(entityId)) continue;
    const rb = world.isAlive(entityId) ? world.getRigidBody(entityId) : undefined;
    if (rb && !rb.isBeingDeleted) rb.resetForces(true);
  }
};

/**
 * Removes every gravity body (their forces are left as they are: this runs on scene exit, when
 * the bodies are deleted anyway). Exported for the tests.
 * @internal
 */
export const clearGravityBodies = () => {
  bodiesByWorld.clear();
  worldsWithForces.clear();
};

/**
 * The registered gravity bodies (entity id and mass), in every world. Exported for the tests.
 * @internal
 */
export const getGravityBodies = (): GravityBody[] => {
  const list: GravityBody[] = [];
  for (const bodies of bodiesByWorld.values()) {
    for (const [entityId, mass] of bodies) list.push({ entityId, mass });
  }
  return list;
};

/**
 * Sets any of the mutual gravity's settings, from the next physics sub-step on: the rest keep
 * their values, as does a key given as `undefined`.
 */
export const setMutualGravityConfig = (partial: Partial<MutualGravityConfig>) => {
  if (partial.G !== undefined) config.G = partial.G;
  if (partial.softening !== undefined) config.softening = partial.softening;
  if (partial.enabled !== undefined) config.enabled = partial.enabled;
};

/** A copy of the mutual gravity's current settings (changing it changes nothing). */
export const getMutualGravityConfig = (): MutualGravityConfig => ({ ...config });

/**
 * The mutual gravity's default settings. Exported for the tests.
 * @internal
 */
export const getMutualGravityDefaults = (): MutualGravityConfig => ({ ...DEFAULT_CONFIG });

/**
 * Registers the mutual (N-body) Newtonian gravity on `world`, for zero-g scenes: a system at
 * `APP_PHYSICS_STEP` (default order 0) that, every fixed physics sub-step, sets each gravity
 * body's user force (reset first) to the sum of the pulls of all the others. Add the bodies with
 * {@link addGravityBody}. A second call on the same world is a no-op.
 *
 * The pull uses Plummer softening, F = G·m₁·m₂·r / (r² + ε²)^(3/2), which is G·m₁·m₂ / r² for
 * r ≫ ε but stays finite as two bodies meet, so touching rocks don't fling apart. Each pair is
 * computed once and applied equal and opposite, so momentum is conserved to float error. The cost
 * is O(n²) per sub-step, fine for tens of bodies.
 *
 * Bodies are dropped once their entity or rigid body is gone, and all of them on every scene exit.
 * The settings ({@link MutualGravityConfig}) are global, not per scene: a scene that changes them
 * sets them on enter.
 * @returns `world`
 * @remarks The positions come from each body's pose at the sub-step: exact in `MAIN_THREAD` mode;
 * in `WORKER_THREAD` mode the last pose the worker synced back, so the forces can be a frame stale
 * and the simulation isn't deterministic there (like the characters).
 */
export const registerMutualGravityEffect = (world: ECSWorld) => {
  world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, 'mutualGravitySystem', mutualGravitySystem);
  registerOnAllSceneExits('mutualGravity', clearGravityBodies);
  return world;
};
