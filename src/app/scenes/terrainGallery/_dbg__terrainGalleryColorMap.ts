// The terrain gallery tab's Colour map row sections (p305 Phase 7): the row's live values (the
// detail normals' fade, where the far surface starts, its band, the colour map's detail fade:
// uniforms), the colour maps' rebake, and the blocks' list, a click flying the camera above the
// block or into a third person's view across it (the far band within the block).
import {
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  applyColorMapValues,
  COLOR_MAP_BLOCKS,
  DEFAULT_COLOR_MAP_VALUES,
  getColorMapSummary,
  getColorMapValues,
  rebakeColorMapsAsync,
  type ColorMapBlock,
  type ColorMapKey,
  type ColorMapValues,
} from './colorMapRow';
import { getRulesTerrain, RULES_BLOCK_SIZE } from './rulesRow';

/** Where a click on a block puts the camera */
const POSES = ['ABOVE', 'THIRD_PERSON'] as const;
type ColorMapPose = (typeof POSES)[number];
const POSE_LABELS: Record<ColorMapPose, string> = {
  ABOVE: 'Above',
  THIRD_PERSON: 'Third person',
};

/** The section's own state: the pose; the selected block */
const tabState = { pose: 'THIRD_PERSON' as ColorMapPose };
let selectedKey: ColorMapKey | null = null;

/**
 * A block's camera pose: straight down from 30 m over its top, the whole block in view; or 9 m up
 * at its near edge (+z) looking across it, the far band (from 40 m by default) on the block
 */
const getPose = (block: ColorMapBlock, pose: ColorMapPose): GalleryCameraPose => {
  const { top } = getRulesTerrain();
  const half = RULES_BLOCK_SIZE / 2;
  if (pose === 'THIRD_PERSON') {
    return {
      pos: { x: block.x, y: top + 1, z: block.z + half + 2 },
      look: { x: block.x, y: top - 6, z: block.z - half },
    };
  }
  return {
    pos: { x: block.x, y: top + 30, z: block.z + 0.01 },
    look: { x: block.x, y: top, z: block.z },
  };
};

const getBlockRow = (block: ColorMapBlock) => ({
  itemId: block.key,
  title: block.title,
  subTitle: getColorMapSummary(block.key),
  description: block.description,
});

/** A live value's field: a slider over the uniform it sets on the blocks that have it */
const valueItem = (
  key: keyof ColorMapValues,
  label: string,
  range: { min: number; max: number; step: number },
  hint: string
): DebuggerPaneItem => ({
  key,
  target: getColorMapValues(),
  label,
  ...range,
  hint,
  onChange: () => applyColorMapValues(),
});

/**
 * The Colour map row's sections of the gallery's tab: its pane (the camera pose of a click, the
 * live values, the rebake, their reset) and the blocks' list (a click flies the camera there).
 * @param tabId the gallery's tab, refreshed and rebuilt from here
 * @param onSelect a block was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getColorMapSections = (tabId: string, onSelect: () => void): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Colour map row',
    id: 'terrainGalleryColorMap',
    content: [
      {
        key: 'pose',
        target: tabState,
        label: 'Camera',
        kind: 'segmented',
        options: POSES.map((pose) => ({ label: POSE_LABELS[pose], value: pose })),
        hint: 'Where a click on a block puts the camera: straight down from 30 m over its top, or 1 m over its top at its near edge looking across it (the far band on the block)',
        onChange: () => {
          const block = COLOR_MAP_BLOCKS.find(({ key }) => key === selectedKey);
          if (block) flyGalleryCamera(getPose(block, tabState.pose));
        },
      },
      { type: 'separator' },
      valueItem(
        'fadeFrom',
        'Fade from',
        { min: 0, max: 200, step: 1 },
        'The view distance in metres where the detail normals start fading to the geometry’s (every block but the source)'
      ),
      valueItem(
        'fadeTo',
        'Far from',
        { min: 1, max: 300, step: 1 },
        'Where the detail normals have faded and the far surface starts, metres (kept past Fade from): the far blocks sample no layer past it and its band'
      ),
      valueItem(
        'farBlend',
        'Far band',
        { min: 0, max: 40, step: 0.5 },
        'The metres past the far start over which the near surface gives way to the far one (both sampled there; 0 a hard switch)'
      ),
      valueItem(
        'detailFrom',
        'Detail from',
        { min: 0, max: 200, step: 1 },
        'The colour map + detail block: where its layers’ detail starts fading out, metres'
      ),
      valueItem(
        'detailTo',
        'Detail to',
        { min: 1, max: 300, step: 1 },
        'Where the detail is gone, the colour map alone (kept past Detail from)'
      ),
      {
        type: 'button',
        title: 'Colour maps',
        label: 'Bake again',
        onClick: () => void rebakeColorMapsAsync(),
      },
      {
        type: 'button',
        title: 'Reset',
        label: 'The row’s defaults',
        onClick: () => {
          Object.assign(getColorMapValues(), DEFAULT_COLOR_MAP_VALUES);
          applyColorMapValues();
          updateDebuggerTab(tabId, { rebuild: true });
        },
      },
    ],
  },
  debuggerListCMP({
    id: 'terrainGalleryColorMapBlocks',
    heading: 'Colour map',
    perItemConfig: {
      onClick: (key) => {
        const block = COLOR_MAP_BLOCKS.find((candidate) => candidate.key === key);
        if (!block) return;
        selectedKey = block.key;
        onSelect();
        flyGalleryCamera(getPose(block, tabState.pose));
        updateDebuggerTab(tabId, { rebuild: true });
      },
    },
    selectedItemId: () => selectedKey,
    data: () => COLOR_MAP_BLOCKS.map(getBlockRow),
  }),
];

/** Drops the row's selection (another list was clicked) */
export const clearColorMapSelection = () => {
  selectedKey = null;
};

/** Starts the row's part of the tab for a visit: no selection, the third person's pose */
export const startColorMapTab = () => {
  tabState.pose = 'THIRD_PERSON';
  selectedKey = null;
};
