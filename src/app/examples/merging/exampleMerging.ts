import * as THREE from 'three/webgpu';
import {
  ComponentType,
  createActionMap,
  createMeshEntity,
  createSeededRandom,
  ECSSystemStage,
  existsOrThrow,
  getECSWorld,
  getEntityIdByAppId,
  getRenderer,
  registerOnSceneExit,
} from 'aekasha';
import {
  addToMergeGroup,
  dissolveMergeGroup,
  getMergeGroupOf,
  removeFromMergeGroup,
  updateMergeMember,
} from 'aekasha/merging';
import { createExampleHud } from '../exampleHud';

const SCENE_ID = 'exampleMerging';
const HUD_SYSTEM_ID = 'exampleMergingHud';
/** The courtyard's half side: 12 floor tiles of 2 m a side */
const HALF = 12;
/** The walls' centre line, just outside the floor */
const WALL = HALF + 0.3;
/** The gate: the scene JSON's one mesh */
const GATE_ID = 'exampleMergingGate';

// #region merging-kit (shown in the Hub: hub/pages/examples/merging/)
/** The floor's group: named, so its settings come from the scene JSON's `mergeGroups` entry */
const FLOOR_GROUP = 'exampleMergingFloor';

const placeKit = () => {
  const floor: number[] = [];
  const stone: number[] = [];

  // 1. The floor: 144 tiles in one named group. They receive the sun's shadow and cast none.
  for (let x = -HALF + 1; x < HALF; x += 2) {
    for (let z = -HALF + 1; z < HALF; z += 2) {
      floor.push(
        createMeshEntity({
          geo: 'exampleMergingTile',
          mat: 'exampleMergingTile',
          position: { x, y: -0.1, z },
          receiveShadow: true,
          merge: FLOOR_GROUP,
        })
      );
    }
  }

  // 2. The walls: three courses of blocks round the floor, the top one broken (the same gaps on
  // every visit: a seeded random), and a gap in the front wall for the gate. 'AUTO' groups them
  // by material, shadow flags and cell: the scene's 16 m cells cut the courtyard into four.
  const random = createSeededRandom(3);
  for (let course = 0; course < 3; course++) {
    for (let along = -HALF + 1; along < HALF; along += 2) {
      for (let side = 0; side < 4; side++) {
        const isGateGap = side === 0 && Math.abs(along) === 1 && course < 2;
        if (isGateGap || (course === 2 && random() < 0.35)) continue;
        const acrossZ = side < 2;
        const sign = side % 2 === 0 ? 1 : -1;
        stone.push(
          createMeshEntity({
            geo: 'exampleMergingBlock',
            mat: 'exampleMergingStone',
            position: acrossZ
              ? { x: along, y: 0.5 + course, z: sign * WALL }
              : { x: sign * WALL, y: 0.5 + course, z: along },
            rotation: { y: acrossZ ? 0 : Math.PI / 2 },
            castShadow: true,
            receiveShadow: true,
            merge: 'AUTO',
          })
        );
      }
    }
  }

  // 3. Two rows of pillars: another geometry, the same material, so the same groups
  const pillars: number[] = [];
  for (const z of [-8, -4, 0, 4, 8]) {
    for (const x of [-5, 5]) {
      pillars.push(
        createMeshEntity({
          geo: 'exampleMergingPillar',
          mat: 'exampleMergingStone',
          position: { x, y: 1.6, z },
          castShadow: true,
          receiveShadow: true,
          merge: 'AUTO',
        })
      );
    }
  }
  stone.push(...pillars);
  return { floor, stone, pillars };
};
// #endregion merging-kit

// #region merging-edit (shown in the Hub: hub/pages/examples/merging/)
const toQuaternion = (axis: THREE.Vector3, angle: number) => {
  const { x, y, z, w } = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  return { x, y, z, w };
};
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const createEdits = (kit: ReturnType<typeof placeKit>) => {
  const world = getECSWorld();
  // The scene JSON's mesh, with "merge": "AUTO" there. A scene's JSON meshes are made after its
  // code has run, so it's looked up when it's needed.
  const getGate = () => existsOrThrow(getEntityIdByAppId(GATE_ID), 'No gate.');
  const toppled = new Set<number>();
  let isMerged = true;
  let isGateOpen = false;

  // A member moved: its part of the merged mesh is written again where it is now, in place
  const swingGate = () => {
    isGateOpen = !isGateOpen;
    const gate = getGate();
    world.setTransform(gate, {
      // Hinged at its left end: open, it stands across the courtyard's side of the gap
      pos: isGateOpen ? { x: -2, y: 1, z: WALL - 2 } : { x: 0, y: 1, z: WALL },
      rot: toQuaternion(Y_AXIS, isGateOpen ? Math.PI / 2 : 0),
    });
    if (getMergeGroupOf(gate)) updateMergeMember(gate);
  };

  // A member removed: its triangles in the merged mesh collapse, and it's drawn on its own,
  // free to move without telling its group
  const toppleNextPillar = () => {
    const pillar = kit.pillars.find((id) => !toppled.has(id));
    if (pillar === undefined) return;
    toppled.add(pillar);
    if (getMergeGroupOf(pillar)) removeFromMergeGroup([pillar]);
    const { x, z } = existsOrThrow(
      world.getComponent(pillar, ComponentType.TRANSFORM),
      'The pillar has no transform.'
    ).position;
    world.setTransform(pillar, {
      pos: { x: x + Math.sign(x) * 1.6, y: 0.35, z },
      rot: toQuaternion(Z_AXIS, Math.PI / 2),
    });
  };

  // Every group dissolved (each piece drawn on its own), then merged again
  const toggleMerged = () => {
    const stone = [...kit.stone, getGate()];
    if (isMerged) {
      const groups = new Set([...kit.floor, ...stone].map((id) => getMergeGroupOf(id)));
      for (const groupId of groups) if (groupId) dissolveMergeGroup(groupId);
    } else {
      addToMergeGroup(FLOOR_GROUP, kit.floor);
      addToMergeGroup(
        'AUTO',
        stone.filter((id) => !toppled.has(id))
      );
    }
    isMerged = !isMerged;
  };

  return { swingGate, toppleNextPillar, toggleMerged, isMerged: () => isMerged };
};
// #endregion merging-edit

// #region merging-scene (shown in the Hub: hub/pages/examples/merging/)
export const scene = async () => {
  // The ground round the courtyard: one mesh, nothing to merge it with
  createMeshEntity({
    geo: { id: 'exampleMergingGround', type: 'BOX', params: { width: 90, height: 0.2, depth: 90 } },
    mat: { id: 'exampleMergingGround', type: 'STANDARD', params: { color: '#5d6b4a' } },
    position: { y: -0.15 },
    receiveShadow: true,
  });

  // The pieces join their groups at the load's end: its first frame is already merged
  const edits = createEdits(placeKit());

  const actions = createActionMap({
    id: SCENE_ID,
    sceneId: SCENE_ID,
    actions: {
      merge: { type: 'BUTTON', name: 'Merge or draw each piece' },
      gate: { type: 'BUTTON', name: 'Swing the gate' },
      topple: { type: 'BUTTON', name: 'Topple a pillar' },
    },
    bindings: {
      merge: [{ device: 'KEYBOARD', keys: [' '] }],
      gate: [{ device: 'KEYBOARD', keys: ['g'] }],
      topple: [{ device: 'KEYBOARD', keys: ['r'] }],
    },
  });
  actions.onPressed('merge', edits.toggleMerged);
  actions.onPressed('gate', edits.swingGate);
  actions.onPressed('topple', edits.toppleNextPillar);

  // The draw calls, read in LATE_MAIN: right after the frame's render (the sun's shadow pass
  // included), before three resets them for the next one
  const hud = createExampleHud('');
  let shownCalls = -1;
  const world = getECSWorld();
  world.addSystem(ECSSystemStage.LATE_MAIN, HUD_SYSTEM_ID, () => {
    const calls = getRenderer()?.info.render.drawCalls ?? 0;
    if (calls === shownCalls) return;
    shownCalls = calls;
    const state = edits.isMerged() ? 'merged' : 'each piece on its own';
    hud.updateText(
      `Space: merge / draw each piece · G: swing the gate · R: topple a pillar\n` +
        `${state}: ${calls} draw calls`
    );
  });
  registerOnSceneExit(SCENE_ID, () => world.removeSystem(HUD_SYSTEM_ID));
};
// #endregion merging-scene
