import { createDebuggerTab, openDebuggerTab } from 'aekasha/debug';
import {
  STREAMING_GRID_SCENE_ID,
  streamingGridContent,
  streamingGridFlight,
} from './streamingGrid';

// The streaming grid's scene tab (debug env): what the camera, the streaming focus, does (fly
// across the grid, hover on a cell boundary, stay), the flight's speed, whether the cells' crates
// bring a shader of their own (priming tests), and a button to the engine's Streaming tab. Nothing
// is persisted: every load starts flying, with shared shaders.

const TAB_ID = 'streamingGridDemo';
/** The engine's Streaming tab (features/streaming/debug/_dbg__Streaming.ts) */
const STREAMING_TAB_ID = 'streamingControls';

/** Creates the scene's tab (removed on its exit). */
export const createStreamingGridTab = () => {
  createDebuggerTab({
    id: TAB_ID,
    title: 'Streaming grid',
    icon: 'easel',
    sceneId: STREAMING_GRID_SCENE_ID,
    content: () => [
      {
        pane: true,
        content: [
          {
            label: 'Camera',
            target: streamingGridFlight,
            key: 'mode',
            options: [
              { text: 'Fly across the grid', value: 'FLY' },
              { text: 'Hover on a cell boundary', value: 'HOVER' },
              { text: 'Stay', value: 'STILL' },
            ],
          },
          {
            label: 'Speed (m/s)',
            target: streamingGridFlight,
            key: 'speed',
            min: 5,
            max: 120,
            step: 5,
          },
          {
            label: 'A shader per cell',
            target: streamingGridContent,
            key: 'uniqueCrateShaders',
          },
          {
            type: 'button',
            title: 'Open the Streaming tab',
            onClick: () => openDebuggerTab(STREAMING_TAB_ID),
          },
        ],
      },
    ],
  });
};
