// The terrain gallery tab's Structures row sections (p305 Phase 7): the pillars' motion (moving or
// held, so the object space's texture can be compared at rest), and the pieces' list, a click
// flying the camera in front of the piece (the pillars: between them).
import { debuggerListCMP, updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { flyGalleryCamera, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import {
  isStructuresMoving,
  setStructuresMoving,
  STRUCTURES_PIECES,
  type StructuresKey,
  type StructuresPiece,
} from './structuresRow';

/** The section's own state: whether the pillars move (bound by the switch); the selected piece */
const tabState = { isMoving: true };
let selectedKey: StructuresKey | null = null;

/** The pillars' midpoint: a click on either looks at both */
const PILLARS_X = (STRUCTURES_PIECES[2].x + STRUCTURES_PIECES[3].x) / 2;

/** A piece's camera pose: 14 m in front (+z) and 5 m up, looking at its middle */
const getPose = (piece: StructuresPiece): GalleryCameraPose => {
  const isPillar = piece.key === 'MOVING_OBJECT' || piece.key === 'MOVING_WORLD';
  const x = isPillar ? PILLARS_X : piece.x;
  return {
    pos: { x, y: 5, z: piece.z + 14 },
    look: { x, y: 1, z: piece.z },
  };
};

const getPieceRow = (piece: StructuresPiece) => ({
  itemId: piece.key,
  title: piece.title,
  subTitle: piece.space === 'OBJECT' ? 'Object space' : 'World space',
  description: piece.description,
});

/**
 * The Structures row's sections of the gallery's tab: its pane (the pillars' motion) and the
 * pieces' list (a click flies the camera there).
 * @param tabId the gallery's tab, rebuilt from here
 * @param onSelect a piece was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getStructuresSections = (
  tabId: string,
  onSelect: () => void
): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Structures row',
    id: 'terrainGalleryStructures',
    content: [
      {
        key: 'isMoving',
        target: tabState,
        label: 'Pillars move',
        kind: 'switch',
        hint: 'The two pillars turning and rising: the object space’s texture sticks to its pillar, the world space’s slides over it; off holds them where they are',
        onChange: (value) => setStructuresMoving(Boolean(value)),
      },
    ],
  },
  debuggerListCMP({
    id: 'terrainGalleryStructuresPieces',
    heading: 'Structures',
    perItemConfig: {
      onClick: (key) => {
        const piece = STRUCTURES_PIECES.find((candidate) => candidate.key === key);
        if (!piece) return;
        selectedKey = piece.key;
        onSelect();
        flyGalleryCamera(getPose(piece));
        updateDebuggerTab(tabId, { rebuild: true });
      },
    },
    selectedItemId: () => selectedKey,
    data: () => STRUCTURES_PIECES.map(getPieceRow),
  }),
];

/** Drops the row's selection (another list was clicked) */
export const clearStructuresSelection = () => {
  selectedKey = null;
};

/** Starts the row's part of the tab for a visit: no selection, the switch at the row's state */
export const startStructuresTab = () => {
  tabState.isMoving = isStructuresMoving();
  selectedKey = null;
};
