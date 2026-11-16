// The terrain gallery tab's Rules row sections (p305 Phase 4): the rules' live values (uniforms on
// whichever variant a block shows: the rocks' slope and noise, the snow line and facing, the
// cliffs' slope, the height blend) and the blocks' list, a click flying the camera above the block
// (the layers' layout) or close to its cliff band (the rules' borders).
import {
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerPaneItem,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  applyRulesValues,
  getDefaultRulesValues,
  getRulesStorage,
  getRulesTerrain,
  getRulesValues,
  RULES_BLOCK_SIZE,
  RULES_BLOCKS,
  type RulesBlock,
  type RulesKey,
  type RulesValues,
} from './rulesRow';

/** Where a click on a block puts the camera */
const POSES = ['ABOVE', 'CLOSE'] as const;
type RulesPose = (typeof POSES)[number];
const POSE_LABELS: Record<RulesPose, string> = { ABOVE: 'Above', CLOSE: 'Close' };

/** The section's own state: the pose; the selected block */
const tabState = { pose: 'ABOVE' as RulesPose };
let selectedKey: RulesKey | null = null;

/**
 * A block's camera pose: above and in front of its near edge (+z), the whole block in view, or
 * close in front of the cliff band, looking along it
 */
const getPose = (block: RulesBlock, pose: RulesPose): GalleryCameraPose => {
  const half = RULES_BLOCK_SIZE / 2;
  const { bottom, top } = getRulesTerrain();
  if (pose === 'CLOSE') {
    return {
      pos: { x: block.x - 10, y: bottom + 7, z: block.z + 16 },
      look: { x: block.x + 6, y: bottom + 5, z: block.z - 2 },
    };
  }
  return {
    pos: { x: block.x, y: top + 38, z: block.z + half + 26 },
    look: { x: block.x, y: bottom, z: block.z - 4 },
  };
};

const getBlockRow = (block: RulesBlock) => ({
  itemId: block.key,
  title: block.title,
  subTitle: block.sets.join(', '),
  suffix: `${block.sets.length} layers, ${getRulesStorage(block)}`,
  description: block.description,
});

/** A live value's field: a slider over the uniform it sets on both blocks */
const valueItem = (
  key: keyof RulesValues,
  label: string,
  range: { min: number; max: number; step: number },
  hint: string
): DebuggerPaneItem => ({
  key,
  target: getRulesValues(),
  label,
  ...range,
  hint,
  onChange: () => applyRulesValues(),
});

/**
 * The Rules row's sections of the gallery's tab: its pane (the camera pose of a click, the rules'
 * live values, their reset) and the blocks' list (a click flies the camera there).
 * @param tabId the gallery's tab, refreshed and rebuilt from here
 * @param onSelect a block was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getRulesSections = (tabId: string, onSelect: () => void): DebuggerTabSection[] => {
  const { bottom, top } = getRulesTerrain();
  return [
    {
      pane: true,
      title: 'Rules row',
      id: 'terrainGalleryRules',
      content: [
        {
          key: 'pose',
          target: tabState,
          label: 'Camera',
          kind: 'segmented',
          options: POSES.map((pose) => ({ label: POSE_LABELS[pose], value: pose })),
          hint: 'Where a click on a block puts the camera: above (the layers’ layout) or close (the cliff band’s borders)',
          onChange: () => {
            const block = RULES_BLOCKS.find(({ key }) => key === selectedKey);
            if (block) flyGalleryCamera(getPose(block, tabState.pose));
          },
        },
        { type: 'separator' },
        valueItem(
          'rocksSlope',
          'Rocks from slope',
          { min: 0, max: 90, step: 1 },
          'Rule 0 (rocks02): whole from this slope in degrees, fading over 8° under it'
        ),
        valueItem(
          'rocksNoise',
          'Rocks noise',
          { min: 0, max: 1, step: 0.01 },
          'Rule 0’s noise amount: macroNoise’s A at 18 m a tile moves the rocks’ coverage by up to this either way'
        ),
        valueItem(
          'snowHeight',
          'Snow from height',
          { min: Math.floor(bottom), max: Math.ceil(top), step: 0.1 },
          'Rule 1 (snow01): whole from this world height in metres (fading over 3 m under it), on slopes under 38°'
        ),
        valueItem(
          'snowFacing',
          'Snow facing',
          { min: 0, max: 180, step: 1 },
          'Rule 1: on slopes facing within this many degrees of north (−z), fading over 35° past it; flat tops always'
        ),
        valueItem(
          'cliffSlope',
          'Cliffs from slope',
          { min: 0, max: 90, step: 1 },
          'Rule 2 (cliffs01): whole from this slope in degrees, fading over 6° under it'
        ),
        valueItem(
          'heightBlendDepth',
          'Height blend depth',
          { min: 0.02, max: 0.5, step: 0.01 },
          'The height blend’s transition over the rules’ weights: smaller, sharper borders'
        ),
        {
          type: 'button',
          title: 'Reset',
          label: 'The row’s defaults',
          onClick: () => {
            Object.assign(getRulesValues(), getDefaultRulesValues());
            applyRulesValues();
            updateDebuggerTab(tabId, { rebuild: true });
          },
        },
      ],
    },
    debuggerListCMP({
      id: 'terrainGalleryRulesBlocks',
      heading: 'Rules',
      perItemConfig: {
        onClick: (key) => {
          const block = RULES_BLOCKS.find((candidate) => candidate.key === key);
          if (!block) return;
          selectedKey = block.key;
          onSelect();
          flyGalleryCamera(getPose(block, tabState.pose));
          updateDebuggerTab(tabId, { rebuild: true });
        },
      },
      selectedItemId: () => selectedKey,
      data: () => RULES_BLOCKS.map(getBlockRow),
    }),
  ];
};

/** Drops the row's selection (another list was clicked) */
export const clearRulesSelection = () => {
  selectedKey = null;
};

/** Starts the row's part of the tab for a visit: no selection, the first pose */
export const startRulesTab = () => {
  tabState.pose = 'ABOVE';
  selectedKey = null;
};
