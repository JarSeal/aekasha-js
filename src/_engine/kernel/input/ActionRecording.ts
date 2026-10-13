// Recording and replaying an action map's samples (p610 D4): per step, as plain data, so a run
// can be replayed (a ghost, a demo), drive a test without devices, or come from a network peer.
// Its own module: an app that never records bundles none of it.

import { lwarn } from '../../utils/Logger';
import { setActionMapRecorder, setActionMapReplay } from './Actions';
import type {
  ActionFrame,
  ActionFrameState,
  ActionMap,
  ActionRecording,
  ActionState,
} from './ActionTypes';

/** A recording in progress ({@link recordActions}). */
export type ActionRecorder = {
  /** Stops recording (later samples aren't kept). */
  stop(): ActionRecording;
};

/** A replay in progress ({@link playActionRecording}). */
export type ActionPlayback = {
  /** Ends the replay: the map's devices drive it again from its next sample. */
  stop(): void;
  /** False once it has played its last step, was stopped or its map was deleted. */
  isPlaying(): boolean;
};

/** {@link playActionRecording}'s options. */
export type ActionPlaybackOpts = {
  /**
   * `RECORDED_STEPS` (default): each frame plays at the step it was recorded at, and the replay
   * starts over when the step goes back (a scene loaded again starts from step 0), so a run of a
   * scene replays from its start. `NEXT_SAMPLE`: the recording's first step plays at the next
   * sample.
   */
  from?: 'RECORDED_STEPS' | 'NEXT_SAMPLE';
};

/** The state's fields that aren't idle, or null when it's idle. */
const toFrameState = (state: Readonly<ActionState>): ActionFrameState | null => {
  let data: ActionFrameState | null = null;
  if (state.isDown) (data ??= {}).isDown = true;
  if (state.pressedCount) (data ??= {}).pressedCount = state.pressedCount;
  if (state.releasedCount) (data ??= {}).releasedCount = state.releasedCount;
  if (state.value) (data ??= {}).value = state.value;
  if (state.x) (data ??= {}).x = state.x;
  if (state.y) (data ??= {}).y = state.y;
  return data;
};

/**
 * Records a map's samples, from its next one: a frame per step in which an action wasn't idle.
 * Throws when the map is being recorded already.
 * @example
 * const recorder = recordActions(playerMap);
 * // ... later
 * const recording = recorder.stop(); // plain data: JSON.stringify it, replay it
 */
export const recordActions = (map: ActionMap): ActionRecorder => {
  const ids = Object.keys(map.actions);
  const frames: ActionFrame[] = [];
  let firstStep: number | undefined;
  let lastStep: number | undefined;
  let removeRecorder: (() => void) | null = null;
  removeRecorder = setActionMapRecorder(map, {
    onSample: (step) => {
      firstStep ??= step;
      lastStep = step;
      let actions: ActionFrame['actions'] | null = null;
      for (let i = 0; i < ids.length; i++) {
        const data = toFrameState(map.read(ids[i]));
        if (data) (actions ??= {})[ids[i]] = data;
      }
      if (actions) frames.push({ step, actions });
    },
    onMapDeleted: () => {
      removeRecorder = null;
    },
  });
  return {
    stop: () => {
      removeRecorder?.();
      removeRecorder = null;
      return { mapId: map.id, firstStep, lastStep, frames: frames.slice() };
    },
  };
};

/**
 * Replays a recording on a map: it stands in for the map's devices (which neither count nor call
 * its callbacks meanwhile; the replayed presses and releases call them at the sample), whatever
 * its context, until its last step. Throws when the map is replaying already.
 * @example
 * const playback = playActionRecording(playerMap, recording, { from: 'NEXT_SAMPLE' });
 */
export const playActionRecording = (
  map: ActionMap,
  recording: ActionRecording,
  opts: ActionPlaybackOpts = {}
): ActionPlayback => {
  if (recording.mapId !== map.id) {
    lwarn(`playActionRecording: a recording of "${recording.mapId}" plays on "${map.id}".`);
  }
  const frames = recording.frames;
  const firstStep = recording.firstStep ?? frames[0]?.step ?? 0;
  const lastStep = recording.lastStep ?? frames[frames.length - 1]?.step ?? firstStep - 1;
  const fromNextSample = opts.from === 'NEXT_SAMPLE';
  let offset: number | null = fromNextSample ? null : 0;
  let next = 0;
  let previous = -Infinity;
  let isPlaying = true;
  let removeReplay: (() => void) | null = null;

  const end = () => {
    isPlaying = false;
    removeReplay?.();
    removeReplay = null;
  };

  removeReplay = setActionMapReplay(map, {
    frameAt: (step) => {
      offset ??= step - firstStep;
      const s = step - offset;
      if (s < previous) next = 0; // a new world: start over
      previous = s;
      if (s > lastStep) {
        isPlaying = false;
        removeReplay = null;
        return null;
      }
      while (next < frames.length && frames[next].step < s) next++;
      if (next < frames.length && frames[next].step === s) return frames[next++].actions;
      return undefined;
    },
    onMapDeleted: () => {
      isPlaying = false;
      removeReplay = null;
    },
  });

  return { stop: end, isPlaying: () => isPlaying };
};
