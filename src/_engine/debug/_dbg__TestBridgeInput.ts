// The test bridge's scripted input and character paths (p610 D6): key events dispatched right
// before given fixed steps, and every character's pose hashed per step, so a recorded run of a
// character scene gives the same path before and after a refactor (on MAIN_THREAD, where the
// characters are deterministic). Both run in MainLoop's pre-step hook, at the step clock.

import { getECSWorld } from '../kernel/ecs/ECS';
import { setPreStepHook } from '../kernel/loop/MainLoop';
import { getPhysicsSubStepIndex } from '../features/physics/PhysicsAPI';
import { getPhysicsDeterminismProbeSteps } from '../features/physics/debug/_dbg__PhysicsDeterminism';
import { getCharacters } from '../features/character/Character';
import type { TestBridgeCharacterPaths, TestBridgeInputScript } from './TestBridge';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const f32 = new Float32Array(1);
const f32Bits = new Uint32Array(f32.buffer);
const pose = new Float64Array(7);

/** FNV-1a (32-bit) over a word's four bytes, as the determinism probe hashes */
const fnvWord = (hash: number, word: number) => {
  let h = hash;
  for (let i = 0; i < 4; i++) {
    h ^= (word >>> (i * 8)) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
};

const fnvString = (hash: number, text: string) => {
  let h = hash;
  for (let i = 0; i < text.length; i++) h = fnvWord(h, text.charCodeAt(i));
  return h;
};

type PathRun = {
  steps: number;
  hash: number;
  characterIds: Set<string>;
  states: Map<string, Set<string>>;
};

let frames: TestBridgeInputScript['frames'] = [];
let nextFrame = 0;
let lastStep = -1;
let run: PathRun | null = null;
const heldKeys = new Set<string>();

const newRun = (): PathRun => ({
  steps: 0,
  hash: FNV_OFFSET,
  characterIds: new Set(),
  states: new Map(),
});

const dispatchKey = (type: 'keydown' | 'keyup', key: string) => {
  if (type === 'keydown') heldKeys.add(key);
  else heldKeys.delete(key);
  window.dispatchEvent(
    new KeyboardEvent(type, {
      key,
      shiftKey: heldKeys.has('Shift'),
      ctrlKey: heldKeys.has('Control'),
      altKey: heldKeys.has('Alt'),
      metaKey: heldKeys.has('Meta'),
    })
  );
};

/** Hashes every character's pose (the state the previous step left) and locomotion state, in id
 * order. */
const recordPaths = (pathRun: PathRun) => {
  const world = getECSWorld();
  const characters = getCharacters(world).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let h = pathRun.hash;
  for (const char of characters) {
    const body = world.getRigidBody(char.entityId);
    if (!body) continue;
    body.readPoseInto(pose);
    h = fnvString(h, char.id);
    for (let i = 0; i < pose.length; i++) {
      f32[0] = pose[i];
      h = fnvWord(h, f32Bits[0]);
    }
    const state = String(char.data.locomotionState ?? '');
    h = fnvString(h, state);
    pathRun.characterIds.add(char.id);
    let states = pathRun.states.get(char.id);
    if (!states) {
      states = new Set();
      pathRun.states.set(char.id, states);
    }
    states.add(state);
  }
  pathRun.hash = h;
  pathRun.steps++;
};

const onPreStep = () => {
  const step = getPhysicsSubStepIndex();
  if (step < 0) return;
  // A fresh world (a scene load) starts again from step 0: the script and the paths start over
  if (step < lastStep) {
    nextFrame = 0;
    run = null;
    for (const key of [...heldKeys]) dispatchKey('keyup', key);
  }
  lastStep = step;

  while (nextFrame < frames.length && frames[nextFrame].step <= step) {
    const frame = frames[nextFrame++];
    if (frame.step < step) continue;
    for (const key of frame.up ?? []) dispatchKey('keyup', key);
    for (const key of frame.down ?? []) dispatchKey('keydown', key);
  }

  const probeSteps = getPhysicsDeterminismProbeSteps();
  if (probeSteps === null || step >= probeSteps) return;
  run ??= newRun();
  recordPaths(run);
};

/** Installs the pre-step hook with the runner's input script (null: paths only). */
export const installTestInput = (script: TestBridgeInputScript | null) => {
  frames = [...(script?.frames ?? [])].sort((a, b) => a.step - b.step);
  nextFrame = 0;
  setPreStepHook(onPreStep);
};

export const getCharacterPaths = (): TestBridgeCharacterPaths => {
  if (!run || !run.characterIds.size) return { status: 'NONE' };
  const states: Record<string, string[]> = {};
  for (const [id, set] of run.states) states[id] = [...set].sort();
  return {
    status: 'DONE',
    steps: run.steps,
    hash: run.hash.toString(16).padStart(8, '0'),
    characterCount: run.characterIds.size,
    states,
  };
};
