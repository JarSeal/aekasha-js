// The terrain gallery tab's Wet/dry row sections (p307 Phases 2-5): the surface conditions' wetness,
// puddle level and rain (a slider each, the first two with the exits' steps, 0, 0.3, 0.6 and 1:
// the scene's JSON starts them `MANUAL`, so they hold; in `MANUAL` the rain only ripples and runs
// down the streaks, it wets nothing; the Surface conditions tab's `SIMULATED` mode and Rain shower
// show the streaks fade after), the water level the beach's shoreline follows (a switch and a
// slider over the block's heights), the snow cover and the temperature (sliders with the exit's
// steps: in `MANUAL` the snow melts only in look, slush, not into the wetness; below 0 °C frost),
// the rain occlusion map's switch (p307 Phase 6: the canopy over the mud block, the boulder's
// overhang), the row's quality (`FULL`, `SIMPLE`) and view (the shading, `WETNESS`, `TAPS`), and
// the blocks' list, a click flying the camera to the block. The "Surface conditions" tab has the
// rest of the weather.
import { debuggerListCMP, updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import {
  getSurfaceConditions,
  isRainOcclusionEnabled,
  setRainOcclusionEnabled,
  setSurfaceConditions,
} from 'aekasha/surface';
import { getTextureSet } from 'aekasha/texturesets';
import { loadTerrainDebugViewsAsync } from 'aekasha/toolkit/terrain';
import { flyToGalleryBlock } from './_dbg__terrainGalleryCamera';
import {
  REGIONAL_WET_KEY,
  setWetRowView,
  SHORE_WET_KEY,
  WET_BLOCKS,
  WET_PIECES,
  type WetBlock,
  type WetKey,
  type WetRowView,
} from './wetRow';

/** The wetness and puddle level steps the plan's exits judge each category at */
const WETNESS_STEPS = [0, 0.3, 0.6, 1] as const;
/** The snow cover's steps, and the temperature's: frozen, freezing, thawing to slush */
const SNOW_STEPS = [0, 0.3, 0.6, 1] as const;
const TEMPERATURE_STEPS = [-10, -5, 0, 3, 8] as const;
/** The temperature slider's range, °C */
const TEMPERATURE_RANGE = [-15, 15] as const;

/** The water level the switch turns back on at (the last one shown), metres */
let lastWaterLevel = 0.15;
/** The water level slider's range: the beach's flat (under 0.4 m) to its ramp's top (about 2.1 m) */
const WATER_LEVEL_RANGE = [-0.3, 2.5] as const;

/** The row's view (bound by the fields); the selected block */
const tabState: WetRowView = { quality: 'FULL', debugView: 'NONE' };
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
  get rain() {
    return getSurfaceConditions()?.rain ?? 0;
  },
  set rain(value: number) {
    setSurfaceConditions({ rain: value });
  },
  get hasWaterLevel() {
    return (getSurfaceConditions()?.waterLevel ?? null) !== null;
  },
  set hasWaterLevel(value: boolean) {
    setSurfaceConditions({ waterLevel: value ? lastWaterLevel : null });
  },
  get waterLevel() {
    const level = getSurfaceConditions()?.waterLevel ?? null;
    if (level !== null) lastWaterLevel = level;
    return lastWaterLevel;
  },
  set waterLevel(value: number) {
    lastWaterLevel = value;
    setSurfaceConditions({ waterLevel: value });
  },
  get snowCoverage() {
    return getSurfaceConditions()?.snowCoverage ?? 0;
  },
  set snowCoverage(value: number) {
    setSurfaceConditions({ snowCoverage: value });
  },
  get temperature() {
    return getSurfaceConditions()?.temperature ?? 0;
  },
  set temperature(value: number) {
    setSurfaceConditions({ temperature: value });
  },
  get isRainOccluded() {
    return isRainOcclusionEnabled() ?? false;
  },
  set isRainOccluded(value: boolean) {
    setRainOcclusionEnabled(value);
  },
};

/** Applies the row's view, loading the debug views first for a debug view; the latest call wins */
let viewRequest = 0;
const applyViewAsync = async () => {
  const request = ++viewRequest;
  if (tabState.debugView !== 'NONE') await loadTerrainDebugViewsAsync();
  if (request !== viewRequest) return;
  setWetRowView(tabState);
};

const getBlockRow = (block: WetBlock) => {
  const surface = getTextureSet(block.sets[0])?.surface;
  const piece = WET_PIECES.find((candidate) => candidate.block === block.key);
  const notes = [
    ...(block.key === REGIONAL_WET_KEY ? ['regional wetness along its left edge'] : []),
    ...(piece ? [`${piece.title} ${piece.note}`] : []),
    ...(block.key === SHORE_WET_KEY ? ['a shoreline along the water level'] : []),
  ];
  return {
    itemId: block.key,
    title: block.title,
    subTitle: surface
      ? `porosity ${surface.porosity}, darkening ${surface.wetDarkening}, drying ${surface.dryingSpeed}, puddles ${surface.puddleResponse}`
      : 'not loaded',
    description: [block.sets.join(', '), ...notes].join('; '),
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
        hint: 'The surface conditions’ wetness (aekasha/surface), which every wet material reads (and the streaks stay damp by, until it’s half dry); the scene holds it (MANUAL mode), the Surface conditions tab has the weather',
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
      {
        key: 'rain',
        target: conditions,
        label: 'Rain',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'The surface conditions’ rain: rings ripple where water stands (puddles, a film on the flat) within 30 m, more drops the harder it rains, and water runs down the wall’s and the boulder’s streaks; at 0 the ripple atlas isn’t sampled (the TAPS view), nor the streaks’ noise on a dry face',
      },
      {
        key: 'hasWaterLevel',
        target: conditions,
        label: 'Water level',
        hint: 'The surface conditions’ water level: the beach’s shoreline follows it (waves washing up, the sand they reach saturated, a 1.5 m damp band above), a water plane over the block shows it',
      },
      {
        key: 'waterLevel',
        target: conditions,
        label: 'Water level y',
        min: WATER_LEVEL_RANGE[0],
        max: WATER_LEVEL_RANGE[1],
        step: 0.05,
        disabled: () => !conditions.hasWaterLevel,
      },
      {
        key: 'snowCoverage',
        target: conditions,
        label: 'Snow cover',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'The surface conditions’ snow cover: snow01 over every block and piece, flat ground first, then the slopes and the high points, nothing past 55°; at 0 its set isn’t sampled (the TAPS view)',
      },
      ...SNOW_STEPS.map((snowCoverage) => ({
        type: 'button' as const,
        title: `Snow ${snowCoverage}`,
        onClick: () => {
          setSurfaceConditions({ snowCoverage });
          updateDebuggerTab(tabId);
        },
      })),
      {
        key: 'temperature',
        target: conditions,
        label: 'Temperature °C',
        min: TEMPERATURE_RANGE[0],
        max: TEMPERATURE_RANGE[1],
        step: 0.5,
        hint: 'The surface conditions’ temperature: below 0 °C the snow is frozen (the wetness doesn’t show on it) and frost forms, full at −5 °C (whiter and rougher, the dense sets most: ice loses its mirror; crystals sparkle within 10 m, on frozen snow too); from 0 to 3 °C the snow turns to slush (greyer, smoother, wet) and its meltwater wets the ground around it. In MANUAL mode nothing melts away: the Surface conditions tab’s SIMULATED mode melts the cover into the wetness',
      },
      ...TEMPERATURE_STEPS.map((temperature) => ({
        type: 'button' as const,
        title: `${temperature} °C`,
        onClick: () => {
          setSurfaceConditions({ temperature });
          updateDebuggerTab(tabId);
        },
      })),
      {
        key: 'isRainOccluded',
        target: conditions,
        label: 'Rain occlusion map',
        disabled: () => isRainOcclusionEnabled() === null,
        hint: 'The rainOcclusion() feature’s map (global: the Surface conditions tab has its stats): the canopy, the wall and the boulder keep the rain off what’s under them, so the mud under the canopy and the ground under the boulder’s overhang stay dry, without puddles, ripples or snow. Off, every material reads open sky (the facing alone)',
      },
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
        key: 'debugView',
        target: tabState,
        label: 'View',
        kind: 'segmented',
        options: [
          { label: 'Shaded', value: 'NONE' },
          { label: 'Wetness', value: 'WETNESS' },
          { label: 'Taps', value: 'TAPS' },
        ],
        hint: 'The row’s terrain debug view. WETNESS: red the pores filling, yellow under a water film, the blue of a puddle over either (magenta to white), pale blue the snow, dark grey dry. TAPS: the texture fetches at the pixel, the ripples’ two only where it rains on standing water, the streaks’ one on a steep face while it’s wet or rains, the snow set’s two where it covers',
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
  Object.assign(tabState, { quality: 'FULL', debugView: 'NONE' });
  selectedKey = null;
  viewRequest++;
};
