// The terrain gallery tab's Anti-tiling row sections (p305 Phase 2): the macro switch, the modes'
// and the macro's live values (uniforms on whichever variant a block shows), and the blocks'
// list, a click flying the camera to the block in the chosen pose: 30 m up (does DUAL_SCALE hide
// the repetition?), at eye height looking along the ground (does HEX show mip seams at grazing
// angles?) or close.
import {
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  ANTI_TILING_BLOCK_SIZE,
  ANTI_TILING_BLOCKS,
  ANTI_TILING_SET_ID,
  applyAntiTilingValues,
  DEFAULT_ANTI_TILING_VALUES,
  getAntiTilingValues,
  isAntiTilingMacroOn,
  setAntiTilingRowState,
  type AntiTilingBlock,
  type AntiTilingMode,
  type AntiTilingValues,
} from './antiTilingRow';

/** Where a click on a block puts the camera */
const POSES = ['TOP_30M', 'GRAZING', 'CLOSE'] as const;
type AntiTilingPose = (typeof POSES)[number];
const POSE_LABELS: Record<AntiTilingPose, string> = {
  TOP_30M: '30 m up',
  GRAZING: 'Grazing',
  CLOSE: 'Close',
};

const MODE_DESCRIPTIONS: Record<AntiTilingMode, string> = {
  NONE: 'Plain tiling: 1 tap a slot',
  DUAL_SCALE:
    'A second tap at 0.23 × the UV, turned 37°, mixed in by distance and macro patches: 2 taps',
  HEX: "Mikkelsen's hex tiling, the taps turned and offset at random, height-weighted: 3 taps",
};

/** The section's own state: the pose, the macro switch (the row's), the selected block */
const tabState = { pose: 'TOP_30M' as AntiTilingPose, isMacroOn: true };
let selectedMode: AntiTilingMode | null = null;

/** A block's camera pose: in front of its near edge (+z), looking at it */
const getPose = (block: AntiTilingBlock, pose: AntiTilingPose): GalleryCameraPose => {
  const half = ANTI_TILING_BLOCK_SIZE / 2;
  if (pose === 'GRAZING') {
    return {
      pos: { x: block.x, y: 1.7, z: block.z + half + 1 },
      look: { x: block.x, y: 0.4, z: block.z - half },
    };
  }
  if (pose === 'CLOSE') {
    return {
      pos: { x: block.x, y: 3, z: block.z + half - 2 },
      look: { x: block.x, y: 0, z: block.z + half - 9 },
    };
  }
  return {
    pos: { x: block.x, y: 30, z: block.z + half + 6 },
    look: { x: block.x, y: 0, z: block.z - 4 },
  };
};

const getBlockRow = (block: AntiTilingBlock) => ({
  itemId: block.mode,
  title: block.mode,
  subTitle: `${ANTI_TILING_SET_ID}, ${ANTI_TILING_BLOCK_SIZE} × ${ANTI_TILING_BLOCK_SIZE} m`,
  suffix: isAntiTilingMacroOn() ? 'macro' : '',
  description: MODE_DESCRIPTIONS[block.mode],
});

/** A live value's field: a slider over the uniform it sets on every block */
const valueItem = (
  key: keyof AntiTilingValues,
  label: string,
  range: { min: number; max: number; step: number },
  hint: string
): DebuggerPaneItem => ({
  key,
  target: getAntiTilingValues(),
  label,
  ...range,
  hint,
  onChange: () => applyAntiTilingValues(),
});

/**
 * The Anti-tiling row's sections of the gallery's tab: its pane (the macro switch, the camera pose
 * of a click, the live values, their reset) and the blocks' list (a click flies the camera there).
 * @param tabId the gallery's tab, refreshed and rebuilt from here
 * @param onSelect a block was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getAntiTilingSections = (
  tabId: string,
  onSelect: () => void
): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Anti-tiling row',
    id: 'terrainGalleryAntiTiling',
    content: [
      {
        key: 'isMacroOn',
        target: tabState,
        label: 'Macro',
        kind: 'switch',
        hint: 'The macro variation (macroNoise at the world XZ): brightness from R, hue and roughness from G, DUAL_SCALE’s patches from B. Another shader per block',
        onChange: (value) => {
          setAntiTilingRowState({ isMacroOn: Boolean(value) });
          updateDebuggerTab(tabId);
        },
      },
      {
        key: 'pose',
        target: tabState,
        label: 'Camera',
        kind: 'segmented',
        options: POSES.map((pose) => ({ label: POSE_LABELS[pose], value: pose })),
        hint: 'Where a click on a block puts the camera: 30 m up (repetition), at eye height along the ground (grazing mips) or close',
        onChange: () => {
          const block = ANTI_TILING_BLOCKS.find(({ mode }) => mode === selectedMode);
          if (block) flyGalleryCamera(getPose(block, tabState.pose));
        },
      },
      { type: 'separator' },
      valueItem(
        'farScale',
        'Far scale',
        { min: 0.05, max: 0.95, step: 0.01 },
        'DUAL_SCALE: the second tap’s scale of the UV (0.23: tiles 4.3 × as large)'
      ),
      valueItem(
        'distanceFrom',
        'Far share from, m',
        { min: 0, max: 100, step: 1 },
        'DUAL_SCALE: where the second tap’s share starts to grow'
      ),
      valueItem(
        'distanceTo',
        'Far share to, m',
        { min: 1, max: 200, step: 1 },
        'DUAL_SCALE: where it reaches its far share (keep it over “from”)'
      ),
      valueItem(
        'hexContrast',
        'Hex contrast',
        { min: 0.05, max: 0.95, step: 0.01 },
        'HEX: the taps’ blend gain (0.5 none; over it sharper hex borders)'
      ),
      valueItem(
        'hexRotation',
        'Hex rotation',
        { min: 0, max: 1, step: 0.01 },
        'HEX: how far a tap turns, of a full turn either way (0: none)'
      ),
      valueItem(
        'macroScale',
        'Macro scale, m',
        { min: 8, max: 400, step: 1 },
        'The metres a macro tile covers'
      ),
      valueItem(
        'macroBrightness',
        'Macro brightness',
        { min: 0, max: 1, step: 0.01 },
        'How far R lightens and darkens the albedo'
      ),
      valueItem(
        'macroHue',
        'Macro hue, °',
        { min: 0, max: 180, step: 1 },
        'How far G turns the hue, either way'
      ),
      valueItem(
        'macroRoughness',
        'Macro roughness',
        { min: 0, max: 1, step: 0.01 },
        'How far G scales the roughness'
      ),
      {
        type: 'button',
        title: 'Reset',
        label: 'The row’s defaults',
        onClick: () => {
          Object.assign(getAntiTilingValues(), DEFAULT_ANTI_TILING_VALUES);
          applyAntiTilingValues();
          updateDebuggerTab(tabId, { rebuild: true });
        },
      },
    ],
  },
  debuggerListCMP({
    id: 'terrainGalleryAntiTilingBlocks',
    heading: 'Anti-tiling',
    perItemConfig: {
      onClick: (mode) => {
        const block = ANTI_TILING_BLOCKS.find((candidate) => candidate.mode === mode);
        if (!block) return;
        selectedMode = block.mode;
        onSelect();
        flyGalleryCamera(getPose(block, tabState.pose));
        updateDebuggerTab(tabId, { rebuild: true });
      },
    },
    selectedItemId: () => selectedMode,
    data: () => ANTI_TILING_BLOCKS.map(getBlockRow),
  }),
];

/** Drops the row's selection (another list was clicked) */
export const clearAntiTilingSelection = () => {
  selectedMode = null;
};

/** Starts the row's part of the tab for a visit: the macro on, no selection, the first pose */
export const startAntiTilingTab = () => {
  tabState.isMacroOn = isAntiTilingMacroOn();
  tabState.pose = 'TOP_30M';
  selectedMode = null;
};
