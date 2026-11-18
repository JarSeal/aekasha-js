// The terrain gallery tab's Wet/dry row sections (p307 Phases 2-3): the surface conditions' wetness
// and puddle level (a slider each and the exit's steps, 0, 0.3, 0.6 and 1: the scene's JSON starts
// them `MANUAL`, so they hold), the row's quality (`FULL`, `SIMPLE`) and the `WETNESS` view, and the
// blocks' list, a click flying the camera to the block. The "Surface conditions" tab has the rest
// of the weather.
import { debuggerListCMP, updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { getSurfaceConditions, setSurfaceConditions } from 'aekasha/surface';
import { getTextureSet } from 'aekasha/texturesets';
import { loadTerrainDebugViewsAsync } from 'aekasha/toolkit/terrain';
import { flyToGalleryBlock } from './_dbg__terrainGalleryCamera';
import {
  REGIONAL_WET_KEY,
  setWetRowView,
  WET_BLOCKS,
  type WetBlock,
  type WetKey,
  type WetRowView,
} from './wetRow';

/** The wetness and puddle level steps the plan's exits judge each category at */
const WETNESS_STEPS = [0, 0.3, 0.6, 1] as const;

/** The row's view (bound by the fields); the selected block */
const tabState: WetRowView & { isWetnessView: boolean } = {
  quality: 'FULL',
  debugView: 'NONE',
  isWetnessView: false,
};
let selectedKey: WetKey | null = null;

/** The wetness slider's binding: the live state, written through the public API */
const conditions = {
  get wetness() {
    return getSurfaceConditions()?.wetness ?? 0;
  },
  set wetness(value: number) {
    setSurfaceConditions({ wetness: value });
  },
  get puddleLevel() {
    return getSurfaceConditions()?.puddleLevel ?? 0;
  },
  set puddleLevel(value: number) {
    setSurfaceConditions({ puddleLevel: value });
  },
};

/** Applies the row's view, loading the debug views first for `WETNESS`; the latest call wins */
let viewRequest = 0;
const applyViewAsync = async () => {
  const request = ++viewRequest;
  tabState.debugView = tabState.isWetnessView ? 'WETNESS' : 'NONE';
  if (tabState.debugView === 'WETNESS') await loadTerrainDebugViewsAsync();
  if (request !== viewRequest) return;
  setWetRowView(tabState);
};

const getBlockRow = (block: WetBlock) => {
  const surface = getTextureSet(block.sets[0])?.surface;
  return {
    itemId: block.key,
    title: block.title,
    subTitle: surface
      ? `porosity ${surface.porosity}, darkening ${surface.wetDarkening}, drying ${surface.dryingSpeed}, puddles ${surface.puddleResponse}`
      : 'not loaded',
    description:
      block.key === REGIONAL_WET_KEY
        ? `${block.sets.join(', ')}; regional wetness along its left edge`
        : block.sets.join(', '),
  };
};

/**
 * The Wet/dry row's sections of the gallery's tab: its pane (the wetness, its steps, the quality,
 * the view) and the blocks' list (a click flies the camera there).
 * @param tabId the gallery's tab, rebuilt from here
 * @param onSelect a block was picked in the list (the other lists drop their selection)
 * @returns the sections, in order
 */
export const getWetSections = (tabId: string, onSelect: () => void): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Wet/dry row',
    id: 'terrainGalleryWet',
    content: [
      {
        key: 'wetness',
        target: conditions,
        label: 'Wetness',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'The surface conditions’ wetness (aekasha/surface), which every wet material reads; the scene holds it (MANUAL mode), the Surface conditions tab has the weather',
      },
      ...WETNESS_STEPS.map((wetness) => ({
        type: 'button' as const,
        title: `Wetness ${wetness}`,
        onClick: () => {
          setSurfaceConditions({ wetness });
          updateDebuggerTab(tabId);
        },
      })),
      {
        key: 'puddleLevel',
        target: conditions,
        label: 'Puddle level',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'The surface conditions’ puddle level: puddles fill the relief up to it × each set’s puddleResponse, in patches, on the flat (FULL only)',
      },
      ...WETNESS_STEPS.map((puddleLevel) => ({
        type: 'button' as const,
        title: `Puddles ${puddleLevel}`,
        onClick: () => {
          setSurfaceConditions({ puddleLevel });
          updateDebuggerTab(tabId);
        },
      })),
      { type: 'separator' },
      {
        key: 'quality',
        target: tabState,
        label: 'Quality',
        kind: 'segmented',
        options: [
          { label: 'Full', value: 'FULL' },
          { label: 'Simple', value: 'SIMPLE' },
        ],
        hint: 'The row’s wet.quality: full (the relief and the cavities shape the wetness, the film flattens the normal) or simple (the response and the sky exposure only, a low tier’s)',
        onChange: () => void applyViewAsync(),
      },
      {
        key: 'isWetnessView',
        target: tabState,
        label: 'WETNESS view',
        kind: 'switch',
        hint: 'The terrain material’s WETNESS debug view on the row: red the pores filling, yellow under a water film, the blue of a puddle over either (magenta to white), dark grey dry',
        onChange: () => void applyViewAsync(),
      },
    ],
  },
  debuggerListCMP({
    id: 'terrainGalleryWetBlocks',
    heading: 'Wet/dry',
    perItemConfig: {
      onClick: (key) => {
        const block = WET_BLOCKS.find((candidate) => candidate.key === key);
        if (!block) return;
        selectedKey = block.key;
        onSelect();
        flyToGalleryBlock(block);
        updateDebuggerTab(tabId, { rebuild: true });
      },
    },
    selectedItemId: () => selectedKey,
    data: () => WET_BLOCKS.map(getBlockRow),
  }),
];

/** Drops the row's selection (another list was clicked) */
export const clearWetSelection = () => {
  selectedKey = null;
};

/** Starts the row's part of the tab for a visit: no selection, the row's own view */
export const startWetTab = () => {
  Object.assign(tabState, { quality: 'FULL', debugView: 'NONE', isWetnessView: false });
  selectedKey = null;
  viewRequest++;
};
