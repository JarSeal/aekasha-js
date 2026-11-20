// The terrain gallery tab's Orientation block section (p310 §2.1, p306 Phase 5's check): the block's
// layer weights from its vertex colours or its twin's splat map, and the camera above it, where the
// corner markers must land on the same corners either way.
import type { DebuggerTabSection } from 'aekasha/debug';
import { flyGalleryCamera } from './_dbg__terrainGalleryCamera';
import {
  ORIENTATION_BLOCK,
  setOrientationSource,
  type OrientationSource,
} from './orientationBlock';

/** The section's state as its fields bind it (the scene's default on every visit) */
const orientationState = { source: 'VERTEX_COLOR' as OrientationSource };

/** Resets the section for a visit (the block spawns drawn by its vertex colours) */
export const startOrientationTab = () => {
  orientationState.source = 'VERTEX_COLOR';
};

/**
 * The tab's Orientation block section
 * @returns the section
 */
export const getOrientationSections = (): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Orientation block',
    id: 'terrainGalleryOrientation',
    content: [
      {
        key: 'source',
        target: orientationState,
        label: 'Weights from',
        kind: 'segmented',
        options: [
          { label: 'Vertex colour', value: 'VERTEX_COLOR' },
          { label: 'Splat map', value: 'SPLAT_MAP' },
        ],
        hint: 'terrainBlockTest’s orientation block (the terrain add-on’s export): its vertex colours, or its splat map twin’s material at its UVs. From above, both must put snow on the red corner at the top left (−x, −z), mud on the green one at the top right (+x, −z), and the mound near the bottom right (+x, +z)',
        onChange: (value) => setOrientationSource(value as OrientationSource),
      },
      {
        type: 'button',
        title: 'Camera above it',
        onClick: () =>
          flyGalleryCamera({
            // Nearly straight down, −z up the screen: the top view the markers are named from
            pos: { x: ORIENTATION_BLOCK.x, y: 42, z: ORIENTATION_BLOCK.z + 0.5 },
            look: { x: ORIENTATION_BLOCK.x, y: 0, z: ORIENTATION_BLOCK.z },
          }),
      },
    ],
  },
];
