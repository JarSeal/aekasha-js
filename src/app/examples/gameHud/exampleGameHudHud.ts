import type { ActionBinding, ECSWorld } from 'aekasha';
import {
  CMP,
  createCompass,
  createCrosshair,
  createDialogueBox,
  createHotbar,
  createInputPrompt,
  createMinimapFrame,
  createNotificationFeed,
  createObjectiveTracker,
  createRadialMenu,
  createResourceBar,
  createSpatialNavigation,
  createSubtitles,
  createWorldAnchorLayer,
  getHUDRootCMP,
} from 'aekasha/ui';
import type { GameItem, InputPrompt, ResourceBar, WorldAnchor } from 'aekasha/ui';
import { WorldAnchorComponentType, registerWorldAnchorSync } from 'aekasha/toolkit/ecs';
import type { GameHudLevel, GameHudNpc } from './exampleGameHudLevel';

// The game HUD example's HUD: the kit's game pieces, each made from plain data and wired to the
// game through the callbacks the scene gives. The game's state and rules are the scene file's.

/** The hotbar's items at the start of a visit */
export const HOTBAR_ITEMS: GameItem[] = [
  { id: 'potion', name: 'Health potion', icon: 'gameHudPotion', count: 3, rarity: 'common' },
  { id: 'tonic', name: 'Stamina tonic', icon: 'gameHudTonic', count: 2, rarity: 'uncommon' },
  { id: 'whistle', name: 'Whistle', icon: 'gameHudWhistle', rarity: 'rare' },
];
/** The hotbar's slot count (the last one empty) */
export const HOTBAR_SLOTS = 4;

const EMOTES = [
  { id: 'wave', label: 'Wave', icon: 'gameHudWave', description: 'Say hello' },
  { id: 'cheer', label: 'Cheer', icon: 'gameHudStar', description: 'Celebrate' },
  { id: 'point', label: 'Point', icon: 'gameHudPoint', description: 'Show the way' },
  { id: 'shrug', label: 'Shrug', icon: 'gameHudShrug', description: 'Who knows?' },
];

/** What the HUD calls back into the game */
export type GameHudCallbacks = {
  /** A hotbar slot's click, Enter or Space (the app's map's keys call it too) */
  onUseSlot: (index: number) => void;
  onEmote: (id: string) => void;
  onAdvance: () => void;
  onChoice: (index: number) => void;
  onMapZoom: (direction: 1 | -1) => void;
};

/** The actions whose bindings the HUD's prompts show, each a map's `getBindings` */
export type GameHudPromptBindings = {
  interact: readonly ActionBinding[];
  fire: readonly ActionBinding[];
  use: readonly ActionBinding[];
  radial: readonly ActionBinding[];
  menu: readonly ActionBinding[];
};

// #region game-hud-vitals (shown in the Hub: hub/pages/examples/game-hud/)
/** The health and stamina bars, and the prompts under them, bottom left */
const createVitals = (bindings: GameHudPromptBindings) => {
  const panel = CMP({ class: 'exampleGameHudVitals exampleGameHudPlay' });
  const health = createResourceBar({
    label: 'Health',
    max: 100,
    value: 100,
    showValue: 'fraction',
    // A state and a word, not the colour alone: read in its value text too ('18 of 100, Low')
    thresholds: [
      { below: 0.25, state: 'danger', text: 'Low' },
      { below: 0.5, state: 'warning', text: 'Hurt' },
    ],
  });
  const stamina = createResourceBar({
    label: 'Stamina',
    max: 100,
    value: 100,
    segments: 4,
    class: 'exampleGameHudStamina',
    thresholds: [{ below: 0.2, state: 'warning', text: 'Tired' }],
  });
  panel.add(health.cmp);
  panel.add(stamina.cmp);
  // Each prompt shows the binding of the device the player uses now
  const row = panel.add({ class: 'exampleGameHudPrompts' });
  const prompts = {
    fire: createInputPrompt({ bindings: bindings.fire, label: 'Shoot' }),
    use: createInputPrompt({ bindings: bindings.use, label: 'Use' }),
    radial: createInputPrompt({ bindings: bindings.radial, label: 'Emotes (hold)' }),
    menu: createInputPrompt({ bindings: bindings.menu, label: 'Menu' }),
  };
  for (const prompt of Object.values(prompts)) row.add(prompt.cmp);
  return { panel, health, stamina, prompts };
};
// #endregion game-hud-vitals

/** An NPC's nameplate: its name, and Mara's Talk prompt shown while the player is near */
const createNameplate = (npc: GameHudNpc, talk: InputPrompt | null) => {
  const plate = CMP({ class: 'exampleGameHudNameplate' });
  plate.add({
    tag: 'span',
    class: 'exampleGameHudNameplate__name',
    text: npc.name,
    style: { '--npc-color': npc.color },
  });
  if (talk) {
    talk.cmp.updateStyle({ display: 'none' });
    plate.add(talk.cmp);
  }
  return plate;
};

/** The beacon's waypoint: its name and the player's distance, kept at the screen's edge */
const createWaypoint = () => {
  const cmp = CMP({ class: 'exampleGameHudWaypoint' });
  cmp.add({ tag: 'span', class: 'exampleGameHudWaypoint__name', text: 'Beacon' });
  const distance = cmp.add({ tag: 'span', class: 'exampleGameHudWaypoint__distance', text: '' });
  let shown = -1;
  return {
    cmp,
    /** Written only when the whole metres change */
    setDistance: (metres: number) => {
      const rounded = Math.round(metres);
      if (rounded === shown) return;
      shown = rounded;
      distance.updateText(`${rounded} m`);
    },
    setText: (text: string) => distance.updateText(text),
  };
};

// #region game-hud-world (shown in the Hub: hub/pages/examples/game-hud/)
/**
 * The world's UI: an anchor layer whose anchors follow entities (the toolkit's sync reads each
 * `WORLD_ANCHOR` entity's drawn pose after the render and moves its anchor), the compass the
 * sync turns with the camera, and the anchors: the NPCs' nameplates, the crates' health and the
 * beacon's waypoint, kept on the screen's edge with an arrow when it's off screen.
 */
const createWorldUi = (world: ECSWorld, level: GameHudLevel, talk: InputPrompt) => {
  const layer = createWorldAnchorLayer({ cullDistance: 45 });
  const compass = createCompass({
    markers: { beacon: { bearing: 0, label: 'Beacon', icon: 'gameHudFlag', color: '#d9c27a' } },
  });
  registerWorldAnchorSync(world, { layer, compass });

  for (const npc of level.npcs) {
    world.addComponent(npc.entityId, WorldAnchorComponentType.WORLD_ANCHOR, {
      anchor: layer.addAnchor({
        content: createNameplate(npc, npc.id === 'mara' ? talk : null),
        align: 'above',
        maxDistance: 20,
      }),
      // Above the capsule's head: its entity's position is its centre
      offsetY: 1.1,
    });
  }
  const crateBars: ResourceBar[] = level.crates.map((crate, i) => {
    const bar = createResourceBar({
      label: `Crate ${i + 1}`,
      hideLabel: true,
      max: 3,
      value: 3,
      segments: 3,
      class: 'exampleGameHudCrateBar',
    });
    world.addComponent(crate.entityId, WorldAnchorComponentType.WORLD_ANCHOR, {
      // From the camera, 7 m behind the player
      anchor: layer.addAnchor({ content: bar.cmp, align: 'above', maxDistance: 20 }),
      offsetY: 0.8,
    });
    return bar;
  });
  const waypoint = createWaypoint();
  const waypointAnchor: WorldAnchor = layer.addAnchor({
    content: waypoint.cmp,
    align: 'above',
    offScreen: 'clamp',
    maxDistance: 1000,
  });
  world.addComponent(level.beacon.entityId, WorldAnchorComponentType.WORLD_ANCHOR, {
    anchor: waypointAnchor,
    offsetY: 1.8,
  });
  return { layer, compass, crateBars, waypoint };
};
// #endregion game-hud-world

/** The whole HUD, its pieces' handles and its `remove` */
export type GameHud = ReturnType<typeof createGameHud>;

/**
 * Makes the HUD under the HUD root. `minimapSlot` is the minimap viewport's slot element, which
 * the frame goes into (the viewport places it).
 */
export const createGameHud = ({
  world,
  level,
  bindings,
  callbacks,
  minimapSlot,
}: {
  world: ECSWorld;
  level: GameHudLevel;
  bindings: GameHudPromptBindings;
  callbacks: GameHudCallbacks;
  minimapSlot: HTMLElement;
}) => {
  const hud = getHUDRootCMP();
  const talk = createInputPrompt({ bindings: bindings.interact, label: 'Talk' });
  // The layer first, so every other piece is drawn over the anchors
  const worldUi = createWorldUi(world, level, talk);
  hud.add(worldUi.layer.cmp);
  hud.add(worldUi.compass.cmp);

  const crosshair = createCrosshair({ shape: 'cross' });
  hud.add(crosshair.cmp);
  const vitals = createVitals(bindings);
  hud.add(vitals.panel);

  // #region game-hud-hotbar (shown in the Hub: hub/pages/examples/game-hud/)
  // The hotbar binds no keys: the game's map calls select and selectNext, and onUse is a slot's
  // click, Enter or Space. Each slot has a cooldown, which the game starts on a use.
  const hotbar = createHotbar({
    label: 'Items',
    slots: [...HOTBAR_ITEMS, ...Array<null>(HOTBAR_SLOTS - HOTBAR_ITEMS.length).fill(null)],
    selected: 0,
    cooldowns: true,
    placement: 'bottom',
    class: 'exampleGameHudPlay',
    onUse: (index) => callbacks.onUseSlot(index),
  });
  // #endregion game-hud-hotbar
  hud.add(hotbar.cmp);

  // #region game-hud-text (shown in the Hub: hub/pages/examples/game-hud/)
  const feed = createNotificationFeed({ placement: 'top-right', max: 5 });
  const tracker = createObjectiveTracker({ title: 'Objectives', placement: 'top-left' });
  // Raised over the hotbar (the stylesheet's --aek-subtitles-inset)
  const subtitles = createSubtitles({ class: 'exampleGameHudSubtitles' });
  const dialogue = createDialogueBox({
    label: 'Conversation',
    onAdvance: callbacks.onAdvance,
    onChoice: callbacks.onChoice,
  });
  // The gamepad's d-pad moves among the choices through it; the keys are the box's own
  const dialogueNav = createSpatialNavigation({ root: dialogue.cmp, handleKeys: false });
  // #endregion game-hud-text
  for (const piece of [feed, tracker, subtitles, dialogue]) hud.add(piece.cmp);

  const radial = createRadialMenu({
    label: 'Emotes',
    items: EMOTES,
    onSelect: (id) => callbacks.onEmote(id),
  });
  hud.add(radial.cmp);

  const minimap = createMinimapFrame({ label: 'Map', onZoom: callbacks.onMapZoom });
  // The viewport places its slot; the frame fills it (removed with `minimap.cmp.remove()`)
  minimapSlot.append(minimap.cmp.elem);

  return {
    ...worldUi,
    talk,
    crosshair,
    health: vitals.health,
    stamina: vitals.stamina,
    prompts: vitals.prompts,
    hotbar,
    feed,
    tracker,
    subtitles,
    dialogue,
    dialogueNav,
    radial,
    minimap,
    /** Hides the play pieces (the bars, the hotbar) while a conversation shows */
    setInConversation: (on: boolean) => {
      if (on) hud.updateAttr({ 'data-example-game-hud': 'conversation' });
      else hud.removeAttr('data-example-game-hud');
    },
    remove: () => {
      dialogueNav.dispose();
      hud.removeAttr('data-example-game-hud');
      for (const piece of [worldUi.layer, worldUi.compass, crosshair, hotbar, radial, minimap])
        piece.cmp.remove();
      for (const piece of [feed, tracker, subtitles, dialogue]) piece.cmp.remove();
      vitals.panel.remove();
    },
  };
};
