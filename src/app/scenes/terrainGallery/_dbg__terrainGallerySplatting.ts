// The terrain gallery tab's Splatting row sections (p305 Phase 3): the height blend's and the
// vertex AO's live values (uniforms on whichever variant a block shows), and the blocks' list, a
// click flying the camera to the block from above (its pattern) or close (a border).
import {
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  applySplattingValues,
  DEFAULT_SPLATTING_VALUES,
  getSplattingStorage,
  getSplattingValues,
  SPLATTING_BLOCK_SIZE,
  SPLATTING_BLOCK_Y,
  SPLATTING_BLOCKS,
  type SplattingBlock,
  type SplattingKey,
  type SplattingValues,
} from './splattingRow';

/** Where a click on a block puts the camera */
const POSES = ['ABOVE', 'CLOSE'] as const;
type SplattingPose = (typeof POSES)[number];
const POSE_LABELS: Record<SplattingPose, string> = { ABOVE: 'Above', CLOSE: 'Close' };

/** The section's own state: the pose; the selected block */
const tabState = { pose: 'ABOVE' as SplattingPose };
let selectedKey: SplattingKey | null = null;

/** A block's camera pose: in front of its near edge (+z), looking at it */
const getPose = (block: SplattingBlock, pose: SplattingPose): GalleryCameraPose => {
  const half = SPLATTING_BLOCK_SIZE / 2;
  const y = SPLATTING_BLOCK_Y;
  if (pose === 'CLOSE') {
    return {
      pos: { x: block.x, y: y + 3.5, z: block.z + half - 3 },
      look: { x: block.x, y, z: block.z + half - 10 },
    };
  }
  return {
    pos: { x: block.x, y: y + 22, z: block.z + half + 8 },
    look: { x: block.x, y, z: block.z - 2 },
  };
};

const getBlockRow = (block: SplattingBlock) => ({
  itemId: block.key,
  title: block.title,
  subTitle: block.sets.join(', '),
  suffix: `${block.sets.length} layers, ${getSplattingStorage(block)}`,
  description: block.description,
});

/** A live value's field: a slider over the uniform it sets on every block that has it */
const valueItem = (
  key: keyof SplattingValues,
  label: string,
  range: { min: number; max: number; step: number },
  hint: string
): DebuggerPaneItem => ({
  key,
  target: getSplattingValues(),
  label,
  ...range,
  hint,
  onChange: () => applySplattingValues(),
});

/**
 * The Splatting row's sections of the gallery's tab: its pane (the camera pose of a click, the
 * live values, their reset) and the blocks' list (a click flies the camera there).
 * @param tabId the gallery's tab, refreshed and rebuilt from here
 * @param onSelect a block was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getSplattingSections = (tabId: string, onSelect: () => void): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Splatting row',
    id: 'terrainGallerySplatting',
    content: [
      {
        key: 'pose',
        target: tabState,
        label: 'Camera',
        kind: 'segmented',
        options: POSES.map((pose) => ({ label: POSE_LABELS[pose], value: pose })),
        hint: 'Where a click on a block puts the camera: above (the pattern) or close (a border)',
        onChange: () => {
          const block = SPLATTING_BLOCKS.find(({ key }) => key === selectedKey);
          if (block) flyGalleryCamera(getPose(block, tabState.pose));
        },
      },
      { type: 'separator' },
      valueItem(
        'heightBlendDepth',
        'Height blend depth',
        { min: 0.02, max: 0.5, step: 0.01 },
        'The height blend’s transition (HEIGHT blocks): smaller, sharper borders'
      ),
      valueItem(
        'rocksOffset',
        'Rocks height offset',
        { min: -1, max: 1, step: 0.01 },
        'Layer 1’s (rocks01) heightOffset: over 0 the rocks rise through their neighbours’ borders'
      ),
      valueItem(
        'vertexAoInfluence',
        'Vertex AO influence',
        { min: 0, max: 1, step: 0.01 },
        'The RGB_AO block’s vertex AO in aoNode (indirect light); LITE starts at ao.bakedAlbedoInfluence, 0.5'
      ),
      {
        type: 'button',
        title: 'Reset',
        label: 'The row’s defaults',
        onClick: () => {
          Object.assign(getSplattingValues(), DEFAULT_SPLATTING_VALUES);
          applySplattingValues();
          updateDebuggerTab(tabId, { rebuild: true });
        },
      },
    ],
  },
  debuggerListCMP({
    id: 'terrainGallerySplattingBlocks',
    heading: 'Splatting',
    perItemConfig: {
      onClick: (key) => {
        const block = SPLATTING_BLOCKS.find((candidate) => candidate.key === key);
        if (!block) return;
        selectedKey = block.key;
        onSelect();
        flyGalleryCamera(getPose(block, tabState.pose));
        updateDebuggerTab(tabId, { rebuild: true });
      },
    },
    selectedItemId: () => selectedKey,
    data: () => SPLATTING_BLOCKS.map(getBlockRow),
  }),
];

/** Drops the row's selection (another list was clicked) */
export const clearSplattingSelection = () => {
  selectedKey = null;
};

/** Starts the row's part of the tab for a visit: no selection, the first pose */
export const startSplattingTab = () => {
  tabState.pose = 'ABOVE';
  selectedKey = null;
};
