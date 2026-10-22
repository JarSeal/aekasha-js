import { getECSWorld, lerror } from 'aekasha';
import { createDebuggerTab, debuggerListCMP } from 'aekasha/debug';
import { getMutualGravityConfig, setMutualGravityConfig } from 'aekasha/toolkit/ecs';
import {
  getSpaceAsteroids,
  resetSpaceAsteroids,
  spawnSpaceAsteroid,
  SPACE_SCENE_ID,
} from './space';

const TAB_ID = 'spaceDemo';

// Poses (7 per body) and masses of the bodies read for the energy sums, grown on demand
let poses = new Float64Array(7 * 16);
let masses = new Float64Array(16);

/** The group's energy: kinetic (translational) and the softened (Plummer) potential that the
 * mutual gravity's force comes from, -G·m₁·m₂ / √(r² + ε²) per pair. Without collisions their
 * sum stays about constant. */
const computeEnergy = () => {
  const world = getECSWorld();
  const { G, softening } = getMutualGravityConfig();
  const list = getSpaceAsteroids();
  if (masses.length < list.length) {
    poses = new Float64Array(list.length * 14);
    masses = new Float64Array(list.length * 2);
  }
  let kinetic = 0;
  let potential = 0;
  // Only the bodies that exist (one being created has none yet), packed
  let count = 0;
  for (const a of list) {
    const rb = world.getRigidBody(a.entityId);
    if (!rb) continue;
    rb.readPoseInto(poses, count * 7);
    masses[count++] = a.mass;
    const v = rb.linvel();
    kinetic += 0.5 * a.mass * (v.x * v.x + v.y * v.y + v.z * v.z);
  }
  const eps2 = softening * softening;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = poses[j * 7] - poses[i * 7];
      const dy = poses[j * 7 + 1] - poses[i * 7 + 1];
      const dz = poses[j * 7 + 2] - poses[i * 7 + 2];
      potential -= (G * masses[i] * masses[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
    }
  }
  return { kinetic, potential };
};

/** The space scene's "Space demo" tab (a scene tab: removed on the scene's exit, and created again
 * on every visit). Its settings are session-only: the scene sets the demo's gravity on every load. */
export const createSpaceDemoTab = () => {
  const state = { ...getMutualGravityConfig() };
  const energy = { kinetic: 0, potential: 0, total: 0 };
  const world = getECSWorld();

  createDebuggerTab({
    id: TAB_ID,
    title: 'Space demo',
    icon: 'rocket',
    sceneId: SPACE_SCENE_ID,
    state,
    refreshIntervalMs: 250,
    onRefresh: () => {
      Object.assign(state, getMutualGravityConfig());
      const { kinetic, potential } = computeEnergy();
      energy.kinetic = kinetic;
      energy.potential = potential;
      energy.total = kinetic + potential;
    },
    content: () => [
      {
        pane: true,
        content: [
          {
            type: 'folder',
            title: 'Mutual gravity',
            content: [
              {
                key: 'enabled',
                label: 'Gravity on',
                onChange: (value) => setMutualGravityConfig({ enabled: Boolean(value) }),
              },
              {
                key: 'G',
                label: 'G',
                min: 0,
                max: 10,
                step: 0.01,
                onChange: (value) => setMutualGravityConfig({ G: Number(value) }),
              },
              {
                key: 'softening',
                label: 'Softening ε (m)',
                min: 0.01,
                max: 5,
                step: 0.01,
                onChange: (value) => setMutualGravityConfig({ softening: Number(value) }),
              },
            ],
          },
          {
            type: 'button',
            title: 'Reset asteroids',
            label: 'Demo set, orbits for this G',
            onClick: () => {
              resetSpaceAsteroids().catch((error) =>
                lerror('[space] Resetting the asteroids failed', error)
              );
            },
          },
          {
            type: 'button',
            title: 'Spawn asteroid',
            label: 'Random, near the origin',
            onClick: () => {
              spawnSpaceAsteroid().catch((error) =>
                lerror('[space] Spawning an asteroid failed', error)
              );
            },
          },
          {
            type: 'folder',
            title: 'Energy',
            content: [
              {
                key: 'kinetic',
                target: energy,
                label: 'Kinetic',
                readonly: true,
                format: (v: number) => v.toFixed(2),
              },
              {
                key: 'potential',
                target: energy,
                label: 'Potential',
                readonly: true,
                format: (v: number) => v.toFixed(2),
              },
              {
                key: 'total',
                target: energy,
                label: 'Total',
                readonly: true,
                format: (v: number) => v.toFixed(2),
              },
            ],
          },
        ],
      },
      debuggerListCMP({
        id: 'spaceDemoAsteroids',
        heading: 'Asteroids',
        emptyText: 'No asteroids.',
        data: () =>
          getSpaceAsteroids().map((a) => {
            const v = world.getRigidBody(a.entityId)?.linvel() ?? { x: 0, y: 0, z: 0 };
            return {
              itemId: String(a.entityId),
              title: a.name,
              subTitle: `[seed ${a.seed}] [${a.entityId}]`,
              suffix: `${a.mass.toFixed(1)} kg`,
              description: `${Math.hypot(v.x, v.y, v.z).toFixed(2)} m/s`,
            };
          }),
      }),
    ],
  });
};
