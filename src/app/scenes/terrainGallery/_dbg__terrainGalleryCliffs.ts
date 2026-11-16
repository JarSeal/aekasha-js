// The terrain gallery tab's Cliffs row sections (p305 Phase 5): the row's settings (the projecting
// blocks' normal blend and the gated block's mode, a material each; the sharpness and the gate's
// slopes, uniforms written live) and the blocks' list, a click flying the camera above the block,
// to its steep face or to its gentle one (the gate's band).
import {
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  applyCliffsSettings,
  applyCliffsValues,
  CLIFFS_BLOCK_SIZE,
  CLIFFS_BLOCK_Y,
  CLIFFS_BLOCKS,
  CLIFFS_GATED_MODES,
  CLIFFS_NORMAL_BLENDS,
  DEFAULT_CLIFFS_VALUES,
  getCliffsProjection,
  getCliffsValues,
  type CliffsBlock,
  type CliffsKey,
  type CliffsValues,
} from './cliffsRow';

/** Where a click on a block puts the camera */
const POSES = ['ABOVE', 'STEEP', 'GENTLE'] as const;
type CliffsPose = (typeof POSES)[number];
const POSE_LABELS: Record<CliffsPose, string> = {
  ABOVE: 'Above',
  STEEP: 'Steep face',
  GENTLE: 'Gentle face',
};

/** The section's own state: the pose; the selected block */
const tabState = { pose: 'ABOVE' as CliffsPose };
let selectedKey: CliffsKey | null = null;

/**
 * A block's camera pose: above and in front of its near edge (+z), the whole block in view; at eye
 * height off the mesa's steep face (+x, about 85°), looking at it; or off its gentle face (−x, the
 * gate's band), looking up it
 */
const getPose = (block: CliffsBlock, pose: CliffsPose): GalleryCameraPose => {
  const y = CLIFFS_BLOCK_Y;
  if (pose === 'STEEP') {
    return {
      pos: { x: block.x + 20, y: y + 4, z: block.z + 6 },
      look: { x: block.x + 9, y: y + 4, z: block.z },
    };
  }
  if (pose === 'GENTLE') {
    return {
      pos: { x: block.x - 24, y: y + 8, z: block.z - 6 },
      look: { x: block.x - 8, y: y + 4, z: block.z },
    };
  }
  return {
    pos: { x: block.x, y: y + 34, z: block.z + CLIFFS_BLOCK_SIZE / 2 + 16 },
    look: { x: block.x, y, z: block.z - 2 },
  };
};

/** The texture fetches of a pixel on a block's LITE `cliffs01`: 2 slots per plane */
const getFetches = (key: CliffsKey) => {
  const projection = getCliffsProjection(key);
  if (projection.mode === 'PLANAR') return '2 fetches';
  if (projection.slopeGate) return '2 fetches, 6 past the gate’s first slope';
  return `${projection.mode === 'TRIPLANAR' ? 6 : 4} fetches`;
};

const getBlockRow = (block: CliffsBlock) => {
  const projection = getCliffsProjection(block.key);
  return {
    itemId: block.key,
    title: block.title,
    subTitle:
      projection.mode === 'PLANAR' ? 'PLANAR' : `${projection.mode}, ${projection.normalBlend}`,
    suffix: getFetches(block.key),
    description: block.description,
  };
};

/** A live value's field: a slider over the uniform it sets on the blocks that have it */
const valueItem = (
  key: keyof CliffsValues,
  label: string,
  range: { min: number; max: number; step: number },
  hint: string
): DebuggerPaneItem => ({
  key,
  target: getCliffsValues(),
  label,
  ...range,
  hint,
  onChange: () => applyCliffsValues(),
});

/** A build-time setting's field: a segmented control swapping the blocks' materials */
const settingItem = (
  key: 'normalBlend' | 'gatedMode',
  label: string,
  options: readonly string[],
  hint: string,
  tabId: string
): DebuggerPaneItem => ({
  key,
  target: getCliffsValues(),
  label,
  kind: 'segmented',
  options: options.map((option) => ({ label: option, value: option })),
  hint,
  onChange: () => {
    applyCliffsSettings();
    updateDebuggerTab(tabId, { rebuild: true });
  },
});

/**
 * The Cliffs row's sections of the gallery's tab: its pane (the camera pose of a click, the
 * settings, the live values, their reset) and the blocks' list (a click flies the camera there).
 * @param tabId the gallery's tab, refreshed and rebuilt from here
 * @param onSelect a block was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getCliffsSections = (tabId: string, onSelect: () => void): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Cliffs row',
    id: 'terrainGalleryCliffs',
    content: [
      {
        key: 'pose',
        target: tabState,
        label: 'Camera',
        kind: 'segmented',
        options: POSES.map((pose) => ({ label: POSE_LABELS[pose], value: pose })),
        hint: 'Where a click on a block puts the camera: above, off the mesa’s steep face (+x, about 85°) or off its gentle one (−x, about 48°: the gate’s band)',
        onChange: () => {
          const block = CLIFFS_BLOCKS.find(({ key }) => key === selectedKey);
          if (block) flyGalleryCamera(getPose(block, tabState.pose));
        },
      },
      { type: 'separator' },
      settingItem(
        'normalBlend',
        'Normal blend',
        CLIFFS_NORMAL_BLENDS,
        'How each plane’s normal map meets the geometry’s on the projecting blocks: whiteout (Golus’s default), UDN (flatter, cheaper) or RNM (reoriented)',
        tabId
      ),
      settingItem(
        'gatedMode',
        'Gated mode',
        CLIFFS_GATED_MODES,
        'The slope-gated block’s projection past the gate',
        tabId
      ),
      valueItem(
        'triplanarSharpness',
        'Triplanar sharpness',
        { min: 1, max: 32, step: 0.5 },
        'TRIPLANAR’s exponent on the facing (the triplanar block, and the gated one in TRIPLANAR): higher narrows where the planes blend'
      ),
      valueItem(
        'biplanarSharpness',
        'Biplanar k',
        { min: 1, max: 32, step: 0.5 },
        'BIPLANAR’s k (Quilez; 8 his look): higher narrows where the two planes blend'
      ),
      valueItem(
        'gateFrom',
        'Gate from',
        { min: 0, max: 89, step: 1 },
        'The slope in degrees under which the gated block is planar: its pixels sample one plane'
      ),
      valueItem(
        'gateTo',
        'Gate to',
        { min: 1, max: 90, step: 1 },
        'The slope in degrees past which the gated block is wholly projected (kept over Gate from)'
      ),
      {
        type: 'button',
        title: 'Reset',
        label: 'The row’s defaults',
        onClick: () => {
          Object.assign(getCliffsValues(), DEFAULT_CLIFFS_VALUES);
          applyCliffsSettings();
          updateDebuggerTab(tabId, { rebuild: true });
        },
      },
    ],
  },
  debuggerListCMP({
    id: 'terrainGalleryCliffsBlocks',
    heading: 'Cliffs',
    perItemConfig: {
      onClick: (key) => {
        const block = CLIFFS_BLOCKS.find((candidate) => candidate.key === key);
        if (!block) return;
        selectedKey = block.key;
        onSelect();
        flyGalleryCamera(getPose(block, tabState.pose));
        updateDebuggerTab(tabId, { rebuild: true });
      },
    },
    selectedItemId: () => selectedKey,
    data: () => CLIFFS_BLOCKS.map(getBlockRow),
  }),
];

/** Drops the row's selection (another list was clicked) */
export const clearCliffsSelection = () => {
  selectedKey = null;
};

/** Starts the row's part of the tab for a visit: no selection, the first pose */
export const startCliffsTab = () => {
  tabState.pose = 'ABOVE';
  selectedKey = null;
};
