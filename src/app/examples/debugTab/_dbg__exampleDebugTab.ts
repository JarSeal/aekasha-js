import { registerOnAllSceneExits } from 'aekasha';
import {
  createDebuggerTab,
  persistDebuggerTabValue,
  recordOrCoalesceUndoRedoAction,
  registerStatsSource,
  registerUndoRedoActionHandler,
  updateDebuggerTab,
  type DebuggerTabContext,
} from 'aekasha/debug';
import { createFolder, createMonitor, createSlider } from 'aekasha/ui';
import {
  BOX_DEFAULTS,
  boxSettings,
  buildBoxes,
  DEBUG_TAB_SCENE_ID,
  getBoxCount,
  setBoxColor,
  shuffleBoxes,
} from './exampleDebugTab';

const TAB_ID = 'exampleBoxes';

// #region debug-tab-undo (shown in the Hub: hub/pages/examples/debug-tab/)
/** An undo entry's payload: plain JSON, since the history is saved in localStorage */
type BoxSettingChange = { key: 'count' | 'color' | 'radius'; prev: unknown; next: unknown };

const SETTING_NAMES = { count: 'Boxes', color: 'Box colour', radius: 'Ring radius' };

/** Applies a setting from code (an undo or a redo): the scene, the saved value and the tab */
const applyBoxSetting = (key: BoxSettingChange['key'], value: unknown) => {
  if (key === 'color') {
    setBoxColor(String(value));
  } else {
    boxSettings[key] = Number(value);
    buildBoxes();
  }
  // Only the tab's own inputs save on their own
  persistDebuggerTabValue(TAB_ID, key);
  updateDebuggerTab(TAB_ID);
};

/** Records a control's change: the ticks of one drag merge into one entry */
const recordBoxSetting = (key: BoxSettingChange['key'], value: unknown, prev: unknown) =>
  recordOrCoalesceUndoRedoAction<BoxSettingChange>(
    'exampleBoxes.setting',
    SETTING_NAMES[key],
    { key, prev, next: value },
    key
  );
// #endregion debug-tab-undo

// #region debug-tab-profiler (shown in the Hub: hub/pages/examples/debug-tab/)
/** The box count as an Overview row of the profiler (F8), under "App", while the scene runs */
const registerBoxesStatsSource = () => {
  const removeSource = registerStatsSource({
    id: 'exampleBoxes.count',
    label: 'Example boxes',
    read: getBoxCount,
    format: (count) => `${count} boxes`,
  });
  // Removed with the scene: the next scene's load runs this once, then drops it
  const removeExitHook = registerOnAllSceneExits('exampleBoxesStats', () => {
    removeSource();
    removeExitHook();
  });
};
// #endregion debug-tab-profiler

// #region debug-tab-kit (shown in the Hub: hub/pages/examples/debug-tab/)
/** A section of the UI kit's own pieces: a folder of fields on the tab's scheduler, so they
 * refresh with the tab's panes and pause while the tab isn't visible */
const createRingSection = ({ scheduler }: DebuggerTabContext) =>
  createFolder({
    title: 'Ring',
    scheduler,
    children: [
      createSlider({
        target: boxSettings,
        key: 'radius',
        label: 'Radius',
        min: 2,
        max: 8,
        step: 0.1,
        unit: 'm',
        onChange: (value, e) => {
          buildBoxes();
          // Not one of the tab's bindings, so it saves its key itself, at the drag's end, where
          // e.prev is the value before the drag
          if (!e.last) return;
          persistDebuggerTabValue(TAB_ID, 'radius');
          recordBoxSetting('radius', value, e.prev);
        },
      }),
      // Read only when the tab refreshes (refreshIntervalMs, updateDebuggerTab)
      createMonitor({
        get: () => 2 * boxSettings.radius * Math.sin(Math.PI / boxSettings.count),
        label: 'Spacing',
        interval: 'refresh',
        format: (spacing) => `${spacing.toFixed(2)} m`,
      }),
    ],
  }).cmp;
// #endregion debug-tab-kit

// #region debug-tab (shown in the Hub: hub/pages/examples/debug-tab/)
/** The example scene's "Boxes" tab: a scene tab, removed on the scene's exit */
export const createBoxesTab = () => {
  // Read-only figures, refreshed while the tab is visible
  const info = { boxes: 0 };

  // 'perScene' (the default): its entries undo only while this scene is current
  registerUndoRedoActionHandler<BoxSettingChange>('exampleBoxes.setting', {
    undo: ({ key, prev }) => applyBoxSetting(key, prev),
    redo: ({ key, next }) => applyBoxSetting(key, next),
  });
  registerBoxesStatsSource();

  createDebuggerTab({
    id: TAB_ID,
    title: 'Boxes',
    icon: 'geometry',
    sceneId: DEBUG_TAB_SCENE_ID,
    // The bindings bind to the scene's own settings, and these keys are saved under lsKey. They
    // are loaded into the object right here, when the tab is created.
    state: boxSettings,
    lsKey: 'AEK_debugExampleBoxes',
    persistKeys: ['count', 'color', 'radius'],
    // The heading's clear button removed the saved keys: back to the defaults
    onClearLS: () => {
      boxSettings.count = BOX_DEFAULTS.count;
      setBoxColor(BOX_DEFAULTS.color);
      buildBoxes();
    },
    refreshIntervalMs: 500,
    onRefresh: () => {
      info.boxes = getBoxCount();
    },
    // ctx.scheduler refreshes the panes, and the kit's own fields given it
    content: (ctx) => [
      {
        pane: true,
        content: [
          // onChange runs on user input only, after the value is saved
          {
            key: 'count',
            label: 'Boxes',
            min: 1,
            max: 60,
            step: 1,
            onChange: (value, e) => {
              buildBoxes();
              recordBoxSetting('count', value, e.prev);
            },
          },
          {
            key: 'color',
            label: 'Colour',
            kind: 'color',
            onChange: (value, e) => {
              setBoxColor(String(value));
              recordBoxSetting('color', value, e.prev);
            },
          },
          { type: 'button', title: 'Shuffle', label: 'Random places', onClick: shuffleBoxes },
          { type: 'separator' },
          { key: 'boxes', target: info, label: 'In the scene', readonly: true, format: String },
        ],
      },
      createRingSection(ctx),
    ],
  });
};
// #endregion debug-tab
