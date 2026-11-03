import * as THREE from 'three/webgpu';
import {
  createActionMap,
  createMeshEntity,
  ECSSystemStage,
  existsOrThrow,
  getActionMap,
  getCameraByAppId,
  getECSWorld,
  getLastInputDevice,
  getMeshByAppId,
  getRenderer,
  getRootScene,
  onLastInputDeviceChange,
  registerOnSceneExit,
  setActionContextEnabled,
} from 'aekasha';
import type { ActionMap } from 'aekasha';
import { createDynamicCharacter } from 'aekasha/character';
import { createViewport, invalidateViewportLayout } from 'aekasha/viewports';
import { CMP, setPromptDevice } from 'aekasha/ui';
import type { DialogueLine, HitMarkerKind } from 'aekasha/ui';
import {
  createFollowObjectCameraRig,
  getCompassBearing,
  unregisterWorldAnchorSync,
  WorldAnchorComponentType,
} from 'aekasha/toolkit/ecs';
import { createGameHud, HOTBAR_ITEMS, HOTBAR_SLOTS } from './exampleGameHudHud';
import type { GameHud } from './exampleGameHudHud';
import { registerGameHudIcons } from './exampleGameHudIcons';
import { createGameHudLevelAsync } from './exampleGameHudLevel';
import type { GameHudLevel } from './exampleGameHudLevel';
import { createGameHudMenus } from './exampleGameHudMenus';
import type { GameHudSettings } from './exampleGameHudMenus';
import './exampleGameHud.scss';

const SCENE_ID = 'exampleGameHud';
const CHARACTER_ID = 'exampleGameHudPlayer';
const DIALOGUE_CONTEXT = 'DIALOGUE';
const LOGIC_SYSTEM_ID = 'exampleGameHudLogic';
const STEP_SYSTEM_ID = 'exampleGameHudStep';
/** Where the player starts and comes back to: south of the middle, facing north */
const SPAWN = { x: 0, y: 1, z: 6 };
const MAX_HEALTH = 100;
const MAX_STAMINA = 100;
const CRATE_HEALTH = 3;
/** The talk prompt shows within this distance of Mara (m) */
const TALK_DISTANCE = 2.5;
const BEACON_DISTANCE = 2;
/** The right stick's look speed, in the rig's mouse pixels a second */
const STICK_LOOK_SPEED = 900;
const MAP_ZOOMS = [0.6, 1, 1.6];

// #region game-hud-actions (shown in the Hub: hub/pages/examples/game-hud/)
/** The game's own actions (the character's are its brain's map): keyboard and mouse, and the
 * gamepad, both always on. The HUD's prompts and the controls page read these bindings. */
const createGameplayMap = () =>
  createActionMap({
    id: SCENE_ID,
    sceneId: SCENE_ID,
    actions: {
      interact: { type: 'BUTTON', name: 'Talk' },
      fire: { type: 'BUTTON', name: 'Shoot' },
      use: { type: 'BUTTON', name: 'Use the item' },
      previousItem: { type: 'BUTTON', name: 'Previous item' },
      nextItem: { type: 'BUTTON', name: 'Next item' },
      item1: { type: 'BUTTON', name: 'Item 1' },
      item2: { type: 'BUTTON', name: 'Item 2' },
      item3: { type: 'BUTTON', name: 'Item 3' },
      item4: { type: 'BUTTON', name: 'Item 4' },
      radial: { type: 'BUTTON', name: 'Emotes (hold)' },
      look: { type: 'AXIS_2D', name: 'Look' },
      menu: { type: 'BUTTON', name: 'Pause menu' },
      inventory: { type: 'BUTTON', name: 'Inventory' },
    },
    bindings: {
      interact: [
        { device: 'KEYBOARD', keys: ['e'] },
        { device: 'GAMEPAD', button: 'WEST' },
      ],
      fire: [
        { device: 'MOUSE', button: 'LEFT' },
        { device: 'GAMEPAD', button: 'RIGHT_TRIGGER' },
      ],
      use: [
        { device: 'KEYBOARD', keys: ['f'] },
        { device: 'GAMEPAD', button: 'NORTH' },
      ],
      previousItem: [{ device: 'GAMEPAD', button: 'DPAD_LEFT' }],
      nextItem: [{ device: 'GAMEPAD', button: 'DPAD_RIGHT' }],
      item1: [{ device: 'KEYBOARD', keys: ['1'] }],
      item2: [{ device: 'KEYBOARD', keys: ['2'] }],
      item3: [{ device: 'KEYBOARD', keys: ['3'] }],
      item4: [{ device: 'KEYBOARD', keys: ['4'] }],
      radial: [
        { device: 'KEYBOARD', keys: ['q'] },
        { device: 'GAMEPAD', button: 'RIGHT_SHOULDER' },
      ],
      look: [{ device: 'GAMEPAD', stick: 'RIGHT' }],
      menu: [
        { device: 'KEYBOARD', keys: ['Escape'] },
        { device: 'GAMEPAD', button: 'START' },
      ],
      inventory: [
        { device: 'KEYBOARD', keys: ['i'] },
        { device: 'GAMEPAD', button: 'SELECT' },
      ],
    },
  });
// #endregion game-hud-actions

/** The player's look: a capsule with a nose on +X (its forward at yaw 0), as the character
 * example's */
const createPlayerVisual = () => {
  createMeshEntity(
    {
      geo: {
        id: 'exampleGameHudNoseGeo',
        type: 'BOX',
        params: { width: 0.5, height: 0.2, depth: 0.25 },
      },
      mat: { id: 'exampleGameHudNose', type: 'STANDARD', params: { color: '#333333' } },
      position: { x: 0.45, y: 0.45 },
    },
    { appId: 'exampleGameHudNose', doNotAddToScene: true }
  );
  createMeshEntity(
    {
      geo: {
        id: 'exampleGameHudBodyGeo',
        type: 'CAPSULE',
        params: { radius: 0.5, height: 0.6, capSegments: 8, radialSegments: 24 },
      },
      mat: { id: 'exampleGameHudBody', type: 'STANDARD', params: { color: '#f2c14e' } },
      castShadow: true,
      receiveShadow: true,
    },
    { appId: 'exampleGameHudBody' }
  );
  const body = existsOrThrow(getMeshByAppId('exampleGameHudBody'), 'No player body mesh');
  body.add(existsOrThrow(getMeshByAppId('exampleGameHudNose'), 'No nose mesh'));
  return body;
};

// #region game-hud-orbit (shown in the Hub: hub/pages/examples/game-hud/)
/**
 * The camera's orbit input: a right-drag on the canvas (the pointer's movement summed between
 * frames) and the right stick's rate, in the rig's pixels. The drag is DOM events, not an action
 * map: a map's `read()` is the last physics step's sample, which two frames between steps would
 * read twice. Returns the rig's `getMouseMoveInput` and the listeners' remover.
 */
const createOrbitInput = (look: () => { x: number; y: number }, isLocked: () => boolean) => {
  const canvas = existsOrThrow(getRenderer()?.domElement, 'No canvas');
  const moved = { x: 0, y: 0 };
  const out = { x: 0, y: 0 };
  let dragging = false;
  let last = performance.now();
  const onDown = (e: PointerEvent) => {
    if (e.button !== 2) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    moved.x += e.movementX;
    moved.y += e.movementY;
  };
  const onUp = () => {
    dragging = false;
  };
  // The right button is the orbit's, not the browser's menu
  const onContextMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  return {
    canvas,
    getMouseMoveInput: () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const stick = look();
      out.x = isLocked() ? 0 : moved.x + stick.x * STICK_LOOK_SPEED * dt;
      // The stick's up is positive, the pointer's down
      out.y = isLocked() ? 0 : moved.y - stick.y * STICK_LOOK_SPEED * dt;
      moved.x = 0;
      moved.y = 0;
      return out;
    },
    remove: () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
};
// #endregion game-hud-orbit

/** The minimap: a top-down orthographic camera over the game's scene, north up, in a viewport
 * at the bottom right, its slot the frame's place */
const createMinimap = () => {
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 80);
  // Looking straight down with -z (north) up: its rotation is set once, the frame moves it
  camera.up.set(0, 0, -1);
  camera.position.set(SPAWN.x, 40, SPAWN.z);
  camera.lookAt(SPAWN.x, 0, SPAWN.z);
  const viewport = createViewport({
    id: 'exampleGameHudMap',
    scene: existsOrThrow(getRootScene(), 'No root scene'),
    camera,
    anchor: 'BOTTOM_RIGHT',
    slotClass: 'exampleGameHudMinimap',
    transparent: false,
    clearColor: '#1c212b',
    toneMapping: 'RENDERER',
    sceneId: SCENE_ID,
  });
  return { camera, viewport };
};

/** Mara's conversation: a line each, its choices leading to the next, `null` ending it */
type ConversationLine = {
  text: string;
  next?: string | null;
  choices?: { label: string; next: string }[];
};

// #region game-hud-dialogue (shown in the Hub: hub/pages/examples/game-hud/)
const CHOICES = [
  { label: 'How do I break a crate?', next: 'crates' },
  { label: 'Where is the beacon?', next: 'beacon' },
  { label: 'Goodbye.', next: 'end' },
];
const CONVERSATION: Record<string, ConversationLine> = {
  start: {
    text: 'Welcome to the arena, traveller. Break the crates by the walls for their coin, then light the beacon in the north-west corner.',
    choices: CHOICES,
  },
  crates: {
    text: 'Aim with the crosshair and shoot. The marker says you hit, and a hit on the top is a critical one.',
    next: 'more',
  },
  beacon: {
    text: 'Follow the flag on your compass: it points the way even when the beacon is behind you.',
    next: 'more',
  },
  more: { text: 'Anything else?', choices: CHOICES },
  end: { text: 'Safe travels!', next: null },
};
// #endregion game-hud-dialogue

export const scene = async () => {
  registerGameHudIcons();
  const level = await createGameHudLevelAsync();
  const world = getECSWorld();

  // A dynamic character on a CAMERA_RELATIVE brain: W A S D or the left stick move it along the
  // camera's view, and its map (`<id>:input`) is one of the controls page's
  const visual = createPlayerVisual();
  const { character } = await createDynamicCharacter({
    id: CHARACTER_ID,
    name: 'Player',
    visual,
    brain: {
      kind: 'CAMERA_RELATIVE',
      params: {
        bindings: {
          move: [
            { device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
            { device: 'GAMEPAD', stick: 'LEFT' },
          ],
          jump: [
            { device: 'KEYBOARD', keys: [' '] },
            { device: 'GAMEPAD', button: 'SOUTH' },
          ],
          run: [
            { device: 'KEYBOARD', keys: ['Shift'] },
            { device: 'GAMEPAD', button: 'LEFT_STICK' },
          ],
          crouch: [
            { device: 'KEYBOARD', keys: ['c'] },
            { device: 'GAMEPAD', button: 'EAST' },
          ],
        },
        runMode: 'HOLD',
      },
    },
  });
  world.getRigidBody(character.entityId)?.setTranslation(SPAWN, true);
  const brainMap = existsOrThrow(getActionMap(`${CHARACTER_ID}:input`), 'No player brain map');
  const gameplay = createGameplayMap();

  const game = createGame({
    level,
    gameplay,
    brainMap,
    visual,
    characterEntityId: character.entityId,
  });
  registerOnSceneExit(SCENE_ID, game.remove);
};

/** The game's state and rules over the HUD, the menus and the level: everything a visit adds
 * goes in its `remove` */
const createGame = ({
  level,
  gameplay,
  brainMap,
  visual,
  characterEntityId,
}: {
  level: GameHudLevel;
  gameplay: ReturnType<typeof createGameplayMap>;
  brainMap: ActionMap;
  visual: THREE.Object3D;
  characterEntityId: number;
}) => {
  const world = getECSWorld();
  const camera = existsOrThrow(getCameraByAppId('exampleGameHudCamera'), 'No example camera');
  const state = {
    health: MAX_HEALTH,
    stamina: MAX_STAMINA,
    crateHealth: level.crates.map(() => CRATE_HEALTH),
    cratesBroken: 0,
    counts: HOTBAR_ITEMS.map((item) => item.count ?? 0),
    hasTalked: false,
    beaconLit: false,
    inPit: false,
    nearMara: false,
    heardIvo: false,
    heardPell: false,
    zoom: 1,
    safeUntil: 0,
    line: null as string | null,
  };
  /** What the next physics step applies: the shots' impulses and a respawn */
  const pending = {
    impulses: [] as { entityId: number; x: number; y: number; z: number }[],
    respawn: false,
  };
  const timers: number[] = [];

  let hud: GameHud | null = null;
  const applySettings = (settings: GameHudSettings) => {
    if (!hud) return;
    hud.crosshair.setShape(settings.crosshair);
    hud.subtitles.cmp.updateStyle({
      display: settings.subtitles ? null : 'none',
      '--aek-subtitles-font-size': `var(--aek-font-size-${settings.subtitleSize})`,
    });
    // The minimap's slot is sized in the kit's units, which the UI scale changes
    invalidateViewportLayout();
  };
  const refreshPrompts = () => {
    if (!hud) return;
    hud.talk.setBindings(gameplay.getBindings('interact'));
    hud.prompts.fire.setBindings(gameplay.getBindings('fire'));
    hud.prompts.use.setBindings(gameplay.getBindings('use'));
    hud.prompts.radial.setBindings(gameplay.getBindings('radial'));
    hud.prompts.menu.setBindings(gameplay.getBindings('menu'));
  };
  // Before the HUD: it applies the saved bindings, which the prompts then show
  const menus = createGameHudMenus({
    sceneId: SCENE_ID,
    maps: [brainMap, gameplay],
    onApply: applySettings,
    onBindingsChange: refreshPrompts,
  });

  const minimap = createMinimap();
  const look = gameplay.read('look');
  const orbit = createOrbitInput(
    () => look,
    () => hud?.radial.isOpen() ?? false
  );
  // #region game-hud-camera (shown in the Hub: hub/pages/examples/game-hud/)
  // The camera orbits the player 7 m out, over its shoulder and about 8° down: the screen's
  // centre (the crosshair) looks past its head and reaches crate height 5 to 12 m ahead. The
  // compass, the minimap's arrow and the aim all follow it; a vertical drag pitches it.
  createFollowObjectCameraRig({
    id: 'exampleGameHudCam',
    sceneId: SCENE_ID,
    camera,
    targetMesh: visual,
    offset: { x: 0, y: 1, z: 6.9 },
    targetHeight: 0.9,
    smoothingTime: 0.08,
    getMouseMoveInput: orbit.getMouseMoveInput,
  });
  // #endregion game-hud-camera

  const setZoom = (direction: 1 | -1) => {
    state.zoom = Math.max(0, Math.min(MAP_ZOOMS.length - 1, state.zoom + direction));
    minimap.camera.zoom = MAP_ZOOMS[state.zoom];
    minimap.camera.updateProjectionMatrix();
    hud?.minimap.setZoomEnabled({
      zoomIn: state.zoom < MAP_ZOOMS.length - 1,
      zoomOut: state.zoom > 0,
    });
  };

  hud = createGameHud({
    world,
    level,
    bindings: {
      interact: gameplay.getBindings('interact'),
      fire: gameplay.getBindings('fire'),
      use: gameplay.getBindings('use'),
      radial: gameplay.getBindings('radial'),
      menu: gameplay.getBindings('menu'),
    },
    callbacks: {
      onUseSlot: (index) => useSlot(index),
      onEmote: (id) => emote(id),
      onAdvance: () => advance(),
      onChoice: (index) => choose(index),
      onMapZoom: setZoom,
    },
    minimapSlot: minimap.viewport.slotElem,
  });
  const ui = hud;
  applySettings(menus.settings);

  // #region game-hud-prompts (shown in the Hub: hub/pages/examples/game-hud/)
  // Every prompt follows the device the player last used: one line
  setPromptDevice(getLastInputDevice());
  const stopDeviceWatch = onLastInputDeviceChange(setPromptDevice);
  // #endregion game-hud-prompts

  ui.tracker.setObjective('talk', { text: 'Talk to Mara' });
  // No label: her nameplate names her, and two labels at close bearings overlap
  ui.compass.setMarker('mara', { bearing: 0, color: '#e8833a' });
  ui.feed.add({ text: 'Welcome to the arena', icon: 'gameHudFlag', tone: 'info' });
  timers.push(
    window.setTimeout(
      () =>
        ui.subtitles.show({
          speaker: 'Mara',
          speakerColor: '#e8833a',
          text: 'Over here, traveller!',
        }),
      1500
    )
  );

  // #region game-hud-hotbar-use (shown in the Hub: hub/pages/examples/game-hud/)
  /** Uses a hotbar slot's item: its cooldown says when it's ready again, its count goes down */
  const useSlot = (index: number) => {
    ui.hotbar.select(index);
    const slot = ui.hotbar.slots[index];
    const item = slot.getItem();
    if (!item) {
      ui.feed.add({ text: 'Nothing in that slot', key: 'emptySlot' });
      return;
    }
    if (slot.cooldown?.isRunning()) {
      ui.feed.add({
        text: `${item.name} isn't ready`,
        key: `notReady:${item.id}`,
        tone: 'warning',
      });
      return;
    }
    if (item.id === 'potion' && state.health >= MAX_HEALTH) {
      ui.feed.add({ text: 'Health is full', key: 'fullHealth' });
      return;
    }
    if (item.id === 'potion') {
      state.health = Math.min(MAX_HEALTH, state.health + 35);
      ui.feed.add({ text: '+35 health', key: 'heal', icon: 'gameHudHeart', tone: 'success' });
      slot.cooldown?.start(4000);
    } else if (item.id === 'tonic') {
      state.stamina = MAX_STAMINA;
      ui.feed.add({ text: 'Stamina restored', icon: 'gameHudTonic', tone: 'success' });
      slot.cooldown?.start(6000);
    } else if (item.id === 'whistle') {
      ui.subtitles.show({
        speaker: 'Mara',
        speakerColor: '#e8833a',
        text: 'I hear you! Over here.',
      });
      slot.cooldown?.start(3000);
    }
    if (state.counts[index] > 0) {
      state.counts[index]--;
      if (state.counts[index] === 0) ui.hotbar.setItem(index, null);
      else slot.setCount(state.counts[index]);
    }
  };
  // #endregion game-hud-hotbar-use

  const emote = (id: string) => {
    const words: Record<string, string> = {
      wave: 'Hello there!',
      cheer: 'Woo!',
      point: 'Over there!',
      shrug: 'Who knows?',
    };
    ui.subtitles.show({ speaker: 'You', text: words[id] ?? id });
  };

  // #region game-hud-fire (shown in the Hub: hub/pages/examples/game-hud/)
  const raycaster = new THREE.Raycaster();
  const screenCentre = new THREE.Vector2(0, 0);
  const crateMeshes = level.crates.map((crate) => crate.mesh);

  /** A shot through the crosshair: the first crate on the ray loses health and is knocked (the
   * impulse waits for the next physics step), and the hit marker says how it went */
  const fire = () => {
    raycaster.setFromCamera(screenCentre, camera);
    const hit = raycaster.intersectObjects(crateMeshes, false)[0];
    const index = hit ? crateMeshes.indexOf(hit.object as THREE.Mesh) : -1;
    if (index < 0 || state.crateHealth[index] <= 0) return;
    const crate = level.crates[index];
    state.crateHealth[index]--;
    ui.crateBars[index].setValue(state.crateHealth[index]);
    const isTop = hit.point.y > crate.mesh.position.y + 0.4;
    const broken = state.crateHealth[index] === 0;
    const kind: HitMarkerKind = broken ? 'kill' : isTop ? 'critical' : 'hit';
    ui.crosshair.showHitMarker(kind);
    // A nudge along the shot (a 1 kg crate): a hit on the top pushes it less
    const push = isTop ? 0.4 : 1;
    const { direction } = raycaster.ray;
    pending.impulses.push({
      entityId: crate.entityId,
      x: direction.x * push,
      y: 0.5,
      z: direction.z * push,
    });
    if (broken) breakCrate(index);
  };
  // #endregion game-hud-fire

  const breakCrate = (index: number) => {
    const crate = level.crates[index];
    crate.material.color.set('#3a3330');
    // Its health bar goes with the component (the anchor sync's removal hook)
    world.removeComponent(crate.entityId, WorldAnchorComponentType.WORLD_ANCHOR);
    state.cratesBroken++;
    ui.feed.add({ text: '+25 gold', key: 'gold', icon: 'gameHudCoin', tone: 'warning' });
    if (!state.hasTalked) return;
    updateCrateObjective();
  };
  const updateCrateObjective = () => {
    const total = level.crates.length;
    ui.tracker.setObjective('crates', {
      text: 'Break the crates',
      count: { value: state.cratesBroken, total },
    });
    if (state.cratesBroken === total) ui.tracker.complete('crates');
  };

  // #region game-hud-conversation (shown in the Hub: hub/pages/examples/game-hud/)
  const portrait = CMP({
    class: 'exampleGameHudPortrait',
    text: 'M',
    attr: { 'aria-hidden': 'true' },
  });
  /** A conversation turns gameplay off and its own map on (E or SOUTH confirms, the d-pad moves
   * among the choices), and puts the focus in the box, so Enter, Space and the arrows are its */
  const dialogueMap = createActionMap({
    id: `${SCENE_ID}:dialogue`,
    sceneId: SCENE_ID,
    context: DIALOGUE_CONTEXT,
    actions: {
      confirm: { type: 'BUTTON', name: 'Continue' },
      up: { type: 'BUTTON', name: 'Up' },
      down: { type: 'BUTTON', name: 'Down' },
    },
    bindings: {
      confirm: [
        { device: 'KEYBOARD', keys: ['e'] },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ],
      up: [{ device: 'GAMEPAD', button: 'DPAD_UP' }],
      down: [{ device: 'GAMEPAD', button: 'DPAD_DOWN' }],
    },
  });
  dialogueMap.onPressed('confirm', () => {
    // A focused choice is picked, else the line goes on
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && ui.dialogue.cmp.elem.contains(focused)) focused.click();
    else ui.dialogue.confirm();
  });
  dialogueMap.onPressed('up', () => ui.dialogueNav.move('up'));
  dialogueMap.onPressed('down', () => ui.dialogueNav.move('down'));
  setActionContextEnabled(DIALOGUE_CONTEXT, false);

  const showLine = (key: string) => {
    state.line = key;
    const line = CONVERSATION[key];
    const shown: DialogueLine = {
      text: line.text,
      speaker: 'Mara',
      speakerColor: '#e8833a',
      portrait,
      choices: line.choices,
    };
    ui.dialogue.setLine(shown);
  };
  const startConversation = () => {
    setActionContextEnabled('GAMEPLAY', false);
    setActionContextEnabled(DIALOGUE_CONTEXT, true);
    ui.setInConversation(true);
    showLine('start');
    ui.dialogue.focus();
  };
  const endConversation = () => {
    state.line = null;
    ui.dialogue.setLine(null);
    ui.setInConversation(false);
    setActionContextEnabled(DIALOGUE_CONTEXT, false);
    setActionContextEnabled('GAMEPLAY', true);
    if (state.hasTalked) return;
    state.hasTalked = true;
    ui.tracker.complete('talk');
    ui.compass.removeMarker('mara');
    updateCrateObjective();
    ui.tracker.setObjective('beacon', { text: 'Light the beacon' });
  };
  const advance = () => {
    const next = state.line ? CONVERSATION[state.line].next : null;
    if (next) showLine(next);
    else endConversation();
  };
  const choose = (index: number) => {
    const choice = state.line ? CONVERSATION[state.line].choices?.[index] : undefined;
    if (choice) showLine(choice.next);
  };
  // #endregion game-hud-conversation

  // The game's keys (UI: the callbacks at the device event, also while paused)
  gameplay.onPressed('fire', fire);
  gameplay.onPressed('use', () => useSlot(Math.max(0, ui.hotbar.getSelected())));
  gameplay.onPressed('previousItem', () => ui.hotbar.selectNext(-1));
  gameplay.onPressed('nextItem', () => ui.hotbar.selectNext(1));
  gameplay.onPressed('item1', () => ui.hotbar.select(0));
  gameplay.onPressed('item2', () => ui.hotbar.select(1));
  gameplay.onPressed('item3', () => ui.hotbar.select(2));
  gameplay.onPressed('item4', () => ui.hotbar.select(HOTBAR_SLOTS - 1));
  gameplay.onPressed('interact', () => {
    if (state.nearMara && state.line === null) startConversation();
  });
  // #region game-hud-radial (shown in the Hub: hub/pages/examples/game-hud/)
  // Held to open, released to pick what the pointer or the right stick points at
  gameplay.onPressed('radial', () => ui.radial.open());
  gameplay.onReleased('radial', () => {
    if (ui.radial.isOpen() && !ui.radial.select()) ui.radial.close();
  });
  // #endregion game-hud-radial
  gameplay.onPressed('menu', () => menus.open());
  gameplay.onPressed('inventory', () => menus.openInventory());
  const onWheel = (e: WheelEvent) => {
    if (gameplay.isActive() && e.deltaY !== 0) ui.hotbar.selectNext(Math.sign(e.deltaY));
  };
  orbit.canvas.addEventListener('wheel', onWheel, { passive: true });

  // #region game-hud-frame (shown in the Hub: hub/pages/examples/game-hud/)
  const lastPosition = visual.position.clone();
  // About the crate's box (a 1 m cube): the ring promises a hit only where the shot lands
  const sphere = new THREE.Sphere(new THREE.Vector3(), 0.55);
  const run = brainMap.read('run');
  /**
   * Every frame, after the physics sync: the HUD from the drawn pose. Each setter writes only
   * when its value changed, so most frames write nothing. Not simulation: the bars, the prompts
   * and the markers are the player's view, and the physics writes wait for the step.
   */
  const updateHud = (_world: unknown, dt: number) => {
    const { x, z } = visual.position;
    const speed = dt > 0 ? Math.hypot(x - lastPosition.x, z - lastPosition.z) / dt : 0;
    lastPosition.copy(visual.position);
    const isPlaying = gameplay.isActive();

    // Stamina drains while running, comes back while not
    const running = run.isDown && speed > 1;
    state.stamina = Math.max(0, Math.min(MAX_STAMINA, state.stamina + (running ? -25 : 12) * dt));
    ui.stamina.setValue(state.stamina);

    // The fire pit burns while the player stands in it
    const pit = level.firePit;
    const inPit = Math.abs(x - pit.x) < pit.halfSize && Math.abs(z - pit.z) < pit.halfSize;
    if (inPit && !state.inPit) ui.feed.add({ text: 'Too hot!', key: 'hot', tone: 'danger' });
    state.inPit = inPit;
    const isSafe = pending.respawn || performance.now() < state.safeUntil;
    if (inPit && isPlaying && !isSafe) state.health = Math.max(0, state.health - 30 * dt);
    if (state.health === 0) {
      state.health = MAX_HEALTH;
      pending.respawn = true;
      // The drawn pose reaches the spawn a frame or two after the step moves the body
      state.safeUntil = performance.now() + 500;
      ui.feed.add({ text: 'You were burned', key: 'burned', tone: 'danger' });
    }
    ui.health.setValue(state.health);

    // The crosshair opens up while moving, and rings a crate it's on
    ui.crosshair.setSpread(Math.round(Math.min(speed, 8) * 2));
    raycaster.setFromCamera(screenCentre, camera);
    let onCrate = false;
    for (let i = 0; i < level.crates.length && !onCrate; i++) {
      if (state.crateHealth[i] <= 0) continue;
      sphere.center.copy(level.crates[i].mesh.position);
      onCrate = raycaster.ray.intersectsSphere(sphere);
    }
    ui.crosshair.setState(onCrate ? 'target' : 'default');

    // Mara's talk prompt, and the others' lines as the player passes
    const [mara, ivo, pell] = level.npcs;
    const nearMara = Math.hypot(x - mara.position.x, z - mara.position.z) < TALK_DISTANCE;
    if (nearMara !== state.nearMara) {
      state.nearMara = nearMara;
      ui.talk.cmp.updateStyle({ display: nearMara ? null : 'none' });
    }
    if (!state.heardIvo && Math.hypot(x - ivo.position.x, z - ivo.position.z) < 4) {
      state.heardIvo = true;
      ui.subtitles.show({
        speaker: ivo.name,
        speakerColor: ivo.color,
        text: 'Mind the fire pit, it bites.',
      });
    }
    if (!state.heardPell && Math.hypot(x - pell.position.x, z - pell.position.z) < 4) {
      state.heardPell = true;
      ui.subtitles.show({
        speaker: pell.name,
        speakerColor: pell.color,
        text: "They say the beacon hasn't been lit in years.",
      });
    }

    // The waypoint's distance and the compass's markers, from the player
    const beacon = level.beacon.position;
    const beaconDistance = Math.hypot(x - beacon.x, z - beacon.z);
    if (!state.beaconLit) ui.waypoint.setDistance(beaconDistance);
    ui.compass.setMarkerBearing('beacon', getCompassBearing(beacon.x - x, beacon.z - z));
    if (!state.hasTalked) {
      ui.compass.setMarkerBearing(
        'mara',
        getCompassBearing(mara.position.x - x, mara.position.z - z)
      );
    }
    if (state.hasTalked && !state.beaconLit && beaconDistance < BEACON_DISTANCE) lightBeacon();

    // The minimap follows the player, north up; its arrow turns with the player's facing (+X)
    minimap.camera.position.set(x, 40, z);
    const e = visual.matrixWorld.elements;
    ui.minimap.setPlayerHeading(getCompassBearing(e[0], e[2]));

    // The radial menu's stick, while it's open (the Gamepad API's y is down)
    if (ui.radial.isOpen() && look.value > 0) ui.radial.setDirection(look.x, -look.y);
  };
  // #endregion game-hud-frame

  const lightBeacon = () => {
    state.beaconLit = true;
    level.beacon.material.emissive.set('#f2c14e');
    ui.waypoint.setText('Lit');
    ui.tracker.complete('beacon');
    ui.feed.add({ text: 'The beacon is lit', icon: 'gameHudFlag', tone: 'success' });
  };

  // #region game-hud-step (shown in the Hub: hub/pages/examples/game-hud/)
  // Physics writes go in a physics step, never in a frame's stages: the shots' impulses and the
  // respawn the frame queued
  const applyPending = () => {
    for (const impulse of pending.impulses) {
      world.getRigidBody(impulse.entityId)?.applyImpulse(impulse, true);
    }
    pending.impulses.length = 0;
    if (!pending.respawn) return;
    pending.respawn = false;
    world.getRigidBody(characterEntityId)?.setTranslation(SPAWN, true);
  };
  // #endregion game-hud-step
  world.addSystem(ECSSystemStage.APP_LOGIC, LOGIC_SYSTEM_ID, updateHud);
  world.addSystem(ECSSystemStage.APP_PHYSICS_STEP, STEP_SYSTEM_ID, applyPending);

  return {
    remove: () => {
      world.removeSystem(LOGIC_SYSTEM_ID);
      world.removeSystem(STEP_SYSTEM_ID);
      unregisterWorldAnchorSync(world);
      for (const timer of timers) window.clearTimeout(timer);
      stopDeviceWatch();
      orbit.canvas.removeEventListener('wheel', onWheel);
      orbit.remove();
      menus.remove();
      ui.remove();
      portrait.remove();
      dialogueMap.delete();
      // A visit that ends in a conversation or a menu leaves the contexts as they were
      setActionContextEnabled(DIALOGUE_CONTEXT, false);
      setActionContextEnabled('MENU', false);
      setActionContextEnabled('GAMEPLAY', true);
    },
  };
};
