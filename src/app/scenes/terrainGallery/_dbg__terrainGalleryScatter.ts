// The terrain gallery tab's Scatter row section (p308 Phase 4): the weather the row is judged in,
// dry or wet (the surface conditions' wetness and puddle level, which every row shares: the
// Wet/dry row's sliders set them finer), and the camera over the rock block, low at its halves'
// seam or over the leaf litter.
import { updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { getSurfaceConditions, setSurfaceConditions } from 'aekasha/surface';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import { LEAF_BLOCK, SCATTER_BLOCK } from './scatterRow';

/** The weathers: the wetness and the puddle level (wet: the scene JSON's start) */
const WEATHERS = {
  DRY: { wetness: 0, puddleLevel: 0 },
  WET: { wetness: 0.6, puddleLevel: 0.6 },
  SOAKED: { wetness: 1, puddleLevel: 0.8 },
} as const;
type Weather = keyof typeof WEATHERS | 'OTHER';

/** The weather field's binding: the conditions' wetness and puddle level, read back as a weather */
const binding = {
  get weather(): Weather {
    const conditions = getSurfaceConditions();
    const match = Object.entries(WEATHERS).find(
      ([, values]) =>
        values.wetness === conditions?.wetness && values.puddleLevel === conditions?.puddleLevel
    );
    return (match?.[0] as Weather | undefined) ?? 'OTHER';
  },
  set weather(value: Weather) {
    if (value !== 'OTHER') setSurfaceConditions({ ...WEATHERS[value] });
  },
};

const { x, z, size } = SCATTER_BLOCK;
/** In front of the block (+z) and above it, the whole block in view */
const OVERVIEW_POSE: GalleryCameraPose = {
  pos: { x, y: size * 0.75, z: z + size * 0.95 },
  look: { x, y: 0, z: z + size * 0.05 },
};
/** Low at the halves' seam, looking along it: the procedural half on the left */
const SEAM_POSE: GalleryCameraPose = {
  pos: { x, y: 2.2, z: z + size / 2 + 2 },
  look: { x, y: 0.2, z: z - size * 0.1 },
};

/** Low over the leaf block, from its front */
const LEAF_POSE: GalleryCameraPose = {
  pos: { x: LEAF_BLOCK.x, y: 1.6, z: LEAF_BLOCK.z + LEAF_BLOCK.size / 2 + 1.5 },
  look: { x: LEAF_BLOCK.x, y: 0, z: LEAF_BLOCK.z + 1 },
};

/**
 * The Scatter row's section of the gallery's tab: the weather and the camera's three poses.
 * @param tabId the gallery's tab, rebuilt from here
 * @returns the section
 */
export const getScatterSections = (tabId: string): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Scatter',
    id: 'terrainGalleryScatter',
    content: [
      {
        key: 'weather',
        target: binding,
        label: 'Weather',
        kind: 'segmented',
        options: [
          { label: 'Dry', value: 'DRY' },
          { label: 'Wet', value: 'WET' },
          { label: 'Soaked', value: 'SOAKED' },
        ],
        hint: 'The surface conditions’ wetness and puddle level (every row’s; the Wet/dry row’s sliders set them finer): dry 0 and 0, wet 0.6 and 0.6 (the scene’s start), soaked 1 and 0.8. The ground and the rocks get wet by the same response',
        onChange: () => updateDebuggerTab(tabId, { rebuild: true }),
      },
      {
        type: 'button',
        title: 'Camera',
        label: 'Over the block',
        onClick: () => flyGalleryCamera(OVERVIEW_POSE),
      },
      {
        type: 'button',
        title: '',
        label: 'Low at the seam',
        onClick: () => flyGalleryCamera(SEAM_POSE),
      },
      {
        type: 'button',
        title: '',
        label: 'Over the leaves',
        onClick: () => flyGalleryCamera(LEAF_POSE),
      },
    ],
  },
];
