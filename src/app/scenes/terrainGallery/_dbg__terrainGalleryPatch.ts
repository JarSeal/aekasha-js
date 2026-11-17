// The terrain gallery tab's Blocks patch section (p306 Phase 3): the rules' source (the vertex
// colours the CPU laid, or the same rules in the shader) on the same blocks, the vertex AO, and the
// camera over the whole patch or low over a seam (two blocks' shared edge).
import { updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  getPatchView,
  PATCH_BLOCK_SIZE,
  PATCH_BOUNDS,
  setPatchView,
  type PatchRules,
} from './patchRow';

/** The section's fields' target: the patch's view, set through `setPatchView` */
const tabState: { rules: PatchRules; isVertexAo: boolean } = { rules: 'CPU', isVertexAo: true };

const CENTRE_X = (PATCH_BOUNDS.minX + PATCH_BOUNDS.maxX) / 2;
const CENTRE_Z = (PATCH_BOUNDS.minZ + PATCH_BOUNDS.maxZ) / 2;

/** In front of the patch (+z) and above it, looking at its middle */
const OVERVIEW_POSE: GalleryCameraPose = {
  pos: { x: CENTRE_X, y: 60, z: PATCH_BOUNDS.maxZ + 50 },
  look: { x: CENTRE_X, y: 0, z: CENTRE_Z },
};

/** Low over the seam between the middle column and the right one, in the front row */
const SEAM_X = CENTRE_X + PATCH_BLOCK_SIZE / 2;
const SEAM_POSE: GalleryCameraPose = {
  pos: { x: SEAM_X - 6, y: 14, z: PATCH_BOUNDS.maxZ + 6 },
  look: { x: SEAM_X, y: 2, z: PATCH_BOUNDS.maxZ - PATCH_BLOCK_SIZE / 2 },
};

/**
 * The Blocks patch's section of the gallery's tab: the rules' source, the vertex AO and the
 * camera's two poses.
 * @param tabId the gallery's tab, rebuilt from here
 * @returns the section
 */
export const getPatchSections = (tabId: string): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Blocks patch',
    id: 'terrainGalleryPatch',
    content: [
      {
        key: 'rules',
        target: tabState,
        label: 'Rules',
        kind: 'segmented',
        options: [
          { label: 'CPU', value: 'CPU' },
          { label: 'Shader', value: 'SHADER' },
        ],
        hint: 'Where the layers’ weights come from, the same rules on the same blocks: the vertex colours rulesTerrain laid on the CPU (a vertex every 0.5 m, interpolated), or the terrain material’s RULES per pixel (no vertex AO). The Weights debug view compares them',
        onChange: () => {
          setPatchView({ rules: tabState.rules });
          updateDebuggerTab(tabId, { rebuild: true });
        },
      },
      {
        key: 'isVertexAo',
        target: tabState,
        label: 'Vertex AO',
        kind: 'switch',
        hint: 'The horizon AO in the vertex colour’s A on the indirect light (CPU rules only)',
        disabled: () => tabState.rules !== 'CPU',
        onChange: () => setPatchView({ isVertexAo: tabState.isVertexAo }),
      },
      {
        type: 'button',
        title: 'Camera',
        label: 'Over the patch',
        onClick: () => flyGalleryCamera(OVERVIEW_POSE),
      },
      {
        type: 'button',
        title: '',
        label: 'Low over a seam',
        onClick: () => flyGalleryCamera(SEAM_POSE),
      },
    ],
  },
];

/** Starts the section for a visit: its fields at the patch's view */
export const startPatchTab = () => {
  const { rules, isVertexAo } = getPatchView();
  Object.assign(tabState, { rules, isVertexAo });
};
