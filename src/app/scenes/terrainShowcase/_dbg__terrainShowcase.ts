// The terrain showcase's tab (p310 Phase 3, §3.7 without the camera presets: the follow camera on
// the player is the showcase's view, the gallery has the presets): the blocks (the player put on
// one), the weather (`_dbg__terrainShowcaseWeather.ts`: the scenarios and the weather's GPU cost),
// the day (its hour, playing, its speed), and the blocks' materials: a debug view and a
// quality tier on every block (the bunker's structure material takes the views), and the
// procedural block's rules on the CPU (its vertex colours) or in the shader. Each is a variant of
// the block's own material over its define, one shader per combination used.
import * as THREE from 'three/webgpu';
import {
  ECSSystemStage,
  existsOrThrow,
  getECSWorld,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  getRootScene,
  setMeshMaterial,
} from 'aekasha';
import { getCharacterById } from 'aekasha/character';
import {
  createDebuggerTab,
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerTabSection,
} from 'aekasha/debug';
import {
  getDayNightSpeed,
  getTimeOfDay,
  isDayNightPlaying,
  pauseDayNight,
  playDayNight,
  setDayNightSpeed,
  setTimeOfDay,
} from 'aekasha/skybox';
import { getTerrainBlock } from 'aekasha/terrain';
import {
  getTerrainQualityPreset,
  loadTerrainDebugViewsAsync,
  type TerrainQualityLevel,
} from 'aekasha/toolkit/terrain';
import { addShowcaseExitCleanup, TERRAIN_SHOWCASE_SCENE_ID } from './terrainShowcase';
import {
  getWeatherSections,
  startWeatherTab,
  type WeatherBlock,
} from './_dbg__terrainShowcaseWeather';

const TAB_ID = 'terrainShowcase';
const MOVE_SYSTEM_ID = 'terrainShowcasePlayerMove';
/** The player's character (`showcasePlayer.ts`) */
const PLAYER_ID = 'showcasePlayer';
/** The bunker's structure material, which takes the debug views (no quality tiers) */
const BUNKER_MATERIAL_ID = 'structureBunker';
const PROCEDURAL_BLOCK_ID = 'showcaseProcedural';
/** Metres over the ground the player is put at: its capsule's half height and a little */
const PLAYER_DROP = 1.2;

type ShowcaseDebugView =
  | 'NONE'
  | 'WEIGHTS'
  | 'TAPS'
  | 'WETNESS'
  | 'TEXEL_DENSITY'
  | 'NORMALS'
  | 'PROJECTION'
  | 'LAYER_COUNT';
type ShowcaseQuality = 'OWN' | TerrainQualityLevel;
type ProceduralRules = 'CPU' | 'SHADER';

/** A block of the showcase: its material and cliff layers (the tiers' projected ones), where the
 * player is put on it */
type ShowcaseBlock = {
  id: string;
  title: string;
  shows: string;
  materialId: string;
  cliffLayers: number[];
  start: { x: number; z: number };
};

const BLOCKS: readonly ShowcaseBlock[] = [
  {
    id: 'showcaseCoast',
    title: 'Coast',
    shows: 'Vertex colour, HEX on the dominant layer, slope-gated cliffs, the shoreline, tracks',
    materialId: 'terrainCoast',
    cliffLayers: [3],
    start: { x: -14, z: 6 },
  },
  {
    id: 'showcaseAlpine',
    title: 'Alpine slope',
    shows: 'Two splat maps and rules, 7 layers sparse, boulders from Blender, snow',
    materialId: 'terrainAlpine',
    cliffLayers: [3],
    start: { x: 116, z: 22 },
  },
  {
    id: 'showcaseWetlands',
    title: 'Wetlands',
    shows: 'Vertex colour, regional wetness, puddles, ruts, leaf litter, the bunker',
    materialId: 'terrainWetlands',
    cliffLayers: [],
    start: { x: -16, z: 136 },
  },
  {
    id: PROCEDURAL_BLOCK_ID,
    title: 'Procedural',
    shows: 'rulesTerrain: rules into vertex colours on the CPU, procedural scatter',
    materialId: 'terrainProcedural',
    cliffLayers: [3],
    start: { x: 113, z: 139 },
  },
];

const DEBUG_VIEWS: readonly { label: string; value: ShowcaseDebugView }[] = [
  { label: 'None', value: 'NONE' },
  { label: 'Weights', value: 'WEIGHTS' },
  { label: 'Taps', value: 'TAPS' },
  { label: 'Wetness', value: 'WETNESS' },
  { label: 'Texel density', value: 'TEXEL_DENSITY' },
  { label: 'Normals', value: 'NORMALS' },
  { label: 'Projection', value: 'PROJECTION' },
  { label: 'Layer count', value: 'LAYER_COUNT' },
];

const QUALITIES: readonly { label: string; value: ShowcaseQuality }[] = [
  { label: 'Own', value: 'OWN' },
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' },
  { label: 'Ultra', value: 'ULTRA' },
];

/** The tab's saved settings */
type ShowcaseTabState = {
  debugView: ShowcaseDebugView;
  quality: ShowcaseQuality;
  rules: ProceduralRules;
};

const DEFAULT_STATE: ShowcaseTabState = { debugView: 'NONE', quality: 'OWN', rules: 'CPU' };
const state: ShowcaseTabState = { ...DEFAULT_STATE };

/** This visit: false once the scene is left (an async apply checks it) */
let visit = { isCurrent: false };
let selectedBlockId: string | null = null;
/** The bunker's pieces, found by their material at the tab's start */
let bunkerMeshes: THREE.Mesh[] = [];
/** The player's move the next physics step applies */
const pendingMove = { isPending: false, x: 0, y: 0, z: 0 };
const ZERO_VELOCITY = { x: 0, y: 0, z: 0 };

const getBlockAppId = (blockId: string) => `terrainBlock/${blockId}`;

/** The procedural block's rules (its JSON's: the one source the shader's variant evaluates) */
const getProceduralRules = () => {
  const geometry = existsOrThrow(
    getTerrainBlock(PROCEDURAL_BLOCK_ID),
    `[terrainShowcase] The scene doesn't list "${PROCEDURAL_BLOCK_ID}".`
  ).geometry;
  return 'params' in geometry ? geometry.params.rules : undefined;
};

/**
 * A material's variant for the tab's view (over its define), or the material itself for the
 * defaults: the debug view, the quality tier (the toolkit's preset with the block's cliff layers;
 * none for the bunker) and, on the procedural block, its rules in the shader (`RULES` over the
 * macro noise it has; no vertex AO, which needs the vertex colour)
 */
const getViewMaterial = (materialId: string, block?: ShowcaseBlock) => {
  const base = existsOrThrow(
    getMaterial(materialId),
    `[terrainShowcase] No material "${materialId}".`
  );
  const isShaderRules = block?.id === PROCEDURAL_BLOCK_ID && state.rules === 'SHADER';
  const hasTier = Boolean(block) && state.quality !== 'OWN';
  if (state.debugView === 'NONE' && !hasTier && !isShaderRules) return base;
  let terrain = { ...(base.userData.terrainDefine as Record<string, unknown>) };
  if (isShaderRules) {
    const { ao: _ao, blend, ...rest } = terrain;
    const { mode } = blend as { mode?: string };
    terrain = { ...rest, blend: { source: 'RULES', mode, rules: getProceduralRules() } };
  }
  if (state.debugView !== 'NONE') terrain.debugView = state.debugView;
  if (block && hasTier) {
    terrain.quality = getTerrainQualityPreset({ cliffLayers: block.cliffLayers });
    terrain.qualityLevel = state.quality;
  }
  return getMaterialVariant(materialId, { staticDefines: { terrain } });
};

/** Every block and the bunker in the tab's view. The views must be loaded. */
const applyMaterials = () => {
  for (const block of BLOCKS) {
    const mesh = getMeshByAppId(getBlockAppId(block.id));
    if (mesh) setMeshMaterial(mesh, getViewMaterial(block.materialId, block) as THREE.Material);
  }
  const bunker = getViewMaterial(BUNKER_MATERIAL_ID) as THREE.Material;
  for (const mesh of bunkerMeshes) setMeshMaterial(mesh, bunker);
};

/** Loads the debug views when one is asked for, then applies the view (if the scene is still on) */
const applyMaterialsAsync = async () => {
  const startedOn = visit;
  if (state.debugView !== 'NONE' && !(await loadTerrainDebugViewsAsync())) return;
  if (startedOn.isCurrent) applyMaterials();
};

const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Puts the player over the block's start, at its ground's height, in the next physics step */
const movePlayerTo = (block: ShowcaseBlock) => {
  const mesh = getMeshByAppId(getBlockAppId(block.id));
  if (!mesh) return;
  rayOrigin.set(block.start.x, 500, block.start.z);
  raycaster.set(rayOrigin, DOWN);
  const hit = raycaster.intersectObject(mesh, false)[0];
  Object.assign(pendingMove, {
    isPending: true,
    x: block.start.x,
    y: (hit?.point.y ?? 0) + PLAYER_DROP,
    z: block.start.z,
  });
};

/** Physics writes go in a physics step, never in a frame's stages: the move the list queued */
const applyPendingMove = () => {
  if (!pendingMove.isPending) return;
  pendingMove.isPending = false;
  const character = getCharacterById(PLAYER_ID);
  if (!character) return;
  const body = getECSWorld().getRigidBody(character.entityId);
  body?.setTranslation(pendingMove, true);
  body?.setLinvel(ZERO_VELOCITY, true);
};

/** The blocks as the weather measurement takes them: each grid place's centre and edge */
const getWeatherBlocks = (): WeatherBlock[] =>
  BLOCKS.flatMap(({ id, title }) => {
    const grid = getTerrainBlock(id)?.grid;
    return grid
      ? [{ id, title, x: grid.x * grid.size, z: grid.z * grid.size, size: grid.size }]
      : [];
  });

/** The bunker's pieces: the scene's meshes in its structure material */
const findBunkerMeshes = () => {
  const material = getMaterial(BUNKER_MATERIAL_ID);
  const meshes: THREE.Mesh[] = [];
  getRootScene()?.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && (object as THREE.Mesh).material === material) {
      meshes.push(object as THREE.Mesh);
    }
  });
  return meshes;
};

/**
 * Creates the showcase's tab (the scene's load, debug env only): removed with the scene (its
 * `sceneId`), its step system and its visit by the scene's exit. Applies its saved view.
 */
export const createTerrainShowcaseTab = () => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  selectedBlockId = null;
  pendingMove.isPending = false;
  bunkerMeshes = findBunkerMeshes();
  const world = getECSWorld();
  world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, MOVE_SYSTEM_ID, applyPendingMove);
  const weatherBlocks = getWeatherBlocks();
  const endWeatherTab = startWeatherTab(weatherBlocks, TAB_ID);
  addShowcaseExitCleanup(() => {
    thisVisit.isCurrent = false;
    world.removeSystem(MOVE_SYSTEM_ID);
    bunkerMeshes = [];
    endWeatherTab();
  });

  createDebuggerTab({
    id: TAB_ID,
    title: 'Terrain showcase',
    icon: 'texture',
    sceneId: TERRAIN_SHOWCASE_SCENE_ID,
    state,
    lsKey: 'AEK_debugTerrainShowcase',
    persistKeys: ['debugView', 'quality', 'rules'],
    // The day's fields follow the playing sky
    refreshIntervalMs: 500,
    onClearLS: () => {
      Object.assign(state, DEFAULT_STATE);
      applyMaterials();
    },
    content: () => [
      debuggerListCMP({
        id: 'terrainShowcaseBlocks',
        heading: 'Blocks',
        perItemConfig: {
          onClick: (blockId) => {
            const block = BLOCKS.find(({ id }) => id === blockId);
            if (!block) return;
            selectedBlockId = blockId;
            movePlayerTo(block);
            updateDebuggerTab(TAB_ID, { rebuild: true });
          },
        },
        selectedItemId: () => selectedBlockId,
        data: () =>
          BLOCKS.map((block) => ({
            itemId: block.id,
            title: block.title,
            subTitle: block.shows,
            suffix: block.id === PROCEDURAL_BLOCK_ID ? 'engine' : 'Blender',
          })),
      }),
      // Its fields bind their own targets, none of this tab's state keys
      ...(getWeatherSections(weatherBlocks, TAB_ID) as DebuggerTabSection<ShowcaseTabState>[]),
      {
        pane: true,
        title: 'Day',
        id: 'terrainShowcaseDay',
        content: [
          {
            label: 'Time of day',
            get: () => getTimeOfDay() ?? 10.5,
            set: (hours: unknown) => setTimeOfDay(Number(hours)),
            kind: 'slider',
            min: 0,
            max: 24,
            step: 0.25,
            unit: 'h',
            hint: 'The sky’s hour (the scene’s 10:30, standing still, on every visit). The surface conditions dry faster under a high sun and slowest at night',
          },
          {
            label: 'Play the day',
            get: () => isDayNightPlaying(),
            set: (isPlaying: unknown) => (isPlaying ? playDayNight() : pauseDayNight()),
            kind: 'switch',
            hint: 'Runs the day-night cycle from the hour above (20 minutes a day at speed 1)',
          },
          {
            label: 'Speed',
            get: () => getDayNightSpeed() ?? 1,
            set: (speed: unknown) => setDayNightSpeed(Number(speed)),
            kind: 'slider',
            min: 0.25,
            max: 40,
            step: 0.25,
            unit: '×',
            hint: 'The cycle’s time multiplier: 20 is a day a minute',
          },
        ],
      },
      {
        pane: true,
        title: 'Materials',
        id: 'terrainShowcaseMaterials',
        content: [
          {
            key: 'debugView',
            label: 'Debug view',
            kind: 'select',
            options: DEBUG_VIEWS.map((option) => ({ ...option })),
            hint: 'The terrain material’s debug view on every block and the bunker: the layers’ weights (layer 0 white, 1 red, 2 green, 3 blue, 4 yellow, …), the material’s texture fetches a pixel (up to 2 dark blue, 4 blue, 8 cyan, 12 green, 16 yellow, 24 orange, 32 red, more magenta), the wetness (the weather’s, the regional and the shore’s; pale blue under snow), the texel density, the shaded normal, the projections’ planes, the layers weighing in a pixel',
            onChange: () => void applyMaterialsAsync(),
          },
          {
            key: 'quality',
            label: 'Quality',
            kind: 'segmented',
            options: QUALITIES.map((option) => ({ ...option })),
            hint: 'The quality tier (getTerrainQualityPreset, the cliff layers projected) on every block: low (no anti-tiling, 2 layers a pixel, cliffs biplanar slope-gated), medium (dual scale, 3, triplanar gated), high (hex on the dominant layer, 3, triplanar gated), ultra (hex on all, 4, triplanar); own: each material’s own fields',
            onChange: () => applyMaterials(),
          },
          {
            key: 'rules',
            label: 'Procedural rules',
            kind: 'segmented',
            options: [
              { label: 'CPU', value: 'CPU' },
              { label: 'Shader', value: 'SHADER' },
            ],
            hint: 'Where the procedural block’s layer weights come from, the same rules (its JSON’s): the vertex colours rulesTerrain laid on the CPU (a vertex every 0.5 m, with the horizon AO), or the terrain material’s RULES per pixel (no vertex AO). The Weights view compares them',
            onChange: () => applyMaterials(),
          },
        ],
      },
    ],
  });
  if (state.debugView !== 'NONE') void applyMaterialsAsync();
  else if (state.quality !== 'OWN' || state.rules !== 'CPU') applyMaterials();
};
