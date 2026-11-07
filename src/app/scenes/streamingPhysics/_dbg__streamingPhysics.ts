import { createDebuggerTab, openDebuggerTab } from 'aekasha/debug';
import { STREAMING_PHYSICS_SCENE_ID, streamingPhysicsPlough } from './streamingPhysics';

// The streaming physics scene's tab (debug env): the plough's speed and a stop, and buttons to the
// engine's Streaming and Physics API tabs. Nothing is persisted: every load starts with the plough
// moving at its default speed.

const TAB_ID = 'streamingPhysicsDemo';
/** The engine's Streaming tab (features/streaming/debug/_dbg__Streaming.ts) */
const STREAMING_TAB_ID = 'streamingControls';
/** The engine's Physics API tab (features/physics/debug/_dbg__PhysicsAPI.ts) */
const PHYSICS_TAB_ID = 'physicsApiControls';

/** Creates the scene's tab (removed on its exit). */
export const createStreamingPhysicsTab = () => {
  createDebuggerTab({
    id: TAB_ID,
    title: 'Streaming physics',
    icon: 'easel',
    sceneId: STREAMING_PHYSICS_SCENE_ID,
    content: () => [
      {
        pane: true,
        content: [
          { label: 'Plough moving', target: streamingPhysicsPlough, key: 'isMoving' },
          {
            label: 'Speed (m/s)',
            target: streamingPhysicsPlough,
            key: 'speed',
            min: 2,
            max: 60,
            step: 2,
          },
          {
            type: 'button',
            title: 'Open the Streaming tab',
            onClick: () => openDebuggerTab(STREAMING_TAB_ID),
          },
          {
            type: 'button',
            title: 'Open the Physics API tab',
            onClick: () => openDebuggerTab(PHYSICS_TAB_ID),
          },
        ],
      },
    ],
  });
};
