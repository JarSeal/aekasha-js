// The terrain gallery tab's Decals row section (p309 Phase 1): the camera over the row's panels,
// the whole row or one atlas's views.
import type { DebuggerTabSection } from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import { DECALS_PANELS, DECALS_ROW_BOUNDS } from './decalsRow';

/** In front of the panels (+z) and above them, looking down at their middle */
const getPose = (minX: number, maxX: number, minZ: number, maxZ: number): GalleryCameraPose => {
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  return { pos: { x, y: span * 0.7, z: z + span * 0.45 }, look: { x, y: 0, z } };
};

/** One atlas's panels' pose */
const getAtlasPose = (atlasId: string) => {
  const panels = DECALS_PANELS.filter((panel) => panel.atlas.id === atlasId);
  const { width, depth } = panels[0].atlas;
  return getPose(
    Math.min(...panels.map((panel) => panel.x)) - width / 2,
    Math.max(...panels.map((panel) => panel.x)) + width / 2,
    panels[0].z - depth / 2,
    panels[0].z + depth / 2
  );
};

/**
 * The Decals row's section of the gallery's tab: the camera over the row or an atlas's panels.
 * @returns the section
 */
export const getDecalsSections = (): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Decals',
    id: 'terrainGalleryDecals',
    content: [
      {
        type: 'button',
        title: 'Camera',
        label: 'Over the row',
        onClick: () =>
          flyGalleryCamera(
            getPose(
              DECALS_ROW_BOUNDS.minX,
              DECALS_ROW_BOUNDS.maxX,
              DECALS_ROW_BOUNDS.minZ,
              DECALS_ROW_BOUNDS.maxZ
            )
          ),
      },
      {
        type: 'button',
        title: '',
        label: 'Ground decals',
        onClick: () => flyGalleryCamera(getAtlasPose('decalsGround')),
      },
      {
        type: 'button',
        title: '',
        label: 'Structure decals',
        onClick: () => flyGalleryCamera(getAtlasPose('decalsStructure')),
      },
    ],
  },
];
