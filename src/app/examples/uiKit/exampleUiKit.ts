import * as THREE from 'three/webgpu';
import {
  createActionMap,
  createMeshEntity,
  getECSWorld,
  getMaterial,
  registerOnSceneExit,
  setActionContextEnabled,
} from 'aekasha';
import {
  addToast,
  closeDraggableWindow,
  CMP,
  createDropDown,
  createToaster,
  getHUDRootCMP,
  getKindWindowId,
  openDialog,
  registerDraggableWindowKind,
  removeToaster,
  toggleDraggableWindow,
  updateDraggableWindowsOfKind,
} from 'aekasha/ui';
import type { TCMP, ToastType } from 'aekasha/ui';
import './exampleUiKit.scss';

const SCENE_ID = 'exampleUiKit';
const TOASTER_ID = 'exampleUiKitToasts';
const SHAPE_WINDOW_KIND = 'exampleUiKitShape';
const SETTINGS_WINDOW_ID = 'exampleUiKitSettings';
const MENU_DIALOG_ID = 'exampleUiKitMenu';
const MENU_CONTEXT = 'MENU';

type ShapeId = 'box' | 'pyramid' | 'prism';

const SHAPES: { id: ShapeId; name: string; color: string }[] = [
  { id: 'box', name: 'Box', color: '#e8833a' },
  { id: 'pyramid', name: 'Pyramid', color: '#3fa7a0' },
  { id: 'prism', name: 'Prism', color: '#c9b458' },
];
const COLORS = [
  { value: '#e8833a', label: 'Orange' },
  { value: '#3fa7a0', label: 'Teal' },
  { value: '#c9b458', label: 'Gold' },
  { value: '#8f6bd1', label: 'Violet' },
];
const GROUND_COLORS = [
  { value: '#59606e', label: 'Slate' },
  { value: '#a89a7c', label: 'Sand' },
  { value: '#5f7356', label: 'Moss' },
];

// The scene's state, set again on every visit
const shapeColors = {} as Record<ShapeId, string>;
const shapeEntityIds = {} as Record<ShapeId, number>;
const shapeButtons = {} as Record<ShapeId, TCMP>;
let groundColor = GROUND_COLORS[0].value;

const getShapeName = (shapeId: ShapeId) => SHAPES.find((s) => s.id === shapeId)?.name ?? shapeId;
const getColorLabel = (color: string) => COLORS.find((c) => c.value === color)?.label ?? color;

const setMaterialColor = (materialId: string, color: string) =>
  (getMaterial(materialId) as THREE.MeshStandardMaterial | undefined)?.color.set(color);

export const scene = async () => {
  createMeshEntity({
    geo: { id: 'uiKitGround', type: 'BOX', params: { width: 12, height: 0.2, depth: 8 } },
    mat: { id: 'uiKitGround', type: 'STANDARD', params: { color: GROUND_COLORS[0].value } },
    position: { y: -0.1 },
    receiveShadow: true,
  });
  shapeEntityIds.box = createMeshEntity({
    geo: { id: 'uiKitBox', type: 'BOX', params: { width: 1.4, height: 1.4, depth: 1.4 } },
    mat: { id: 'uiKitBox', type: 'STANDARD', params: { color: SHAPES[0].color } },
    position: { x: -2.6, y: 0.7 },
    castShadow: true,
  });
  shapeEntityIds.pyramid = createMeshEntity({
    geo: {
      id: 'uiKitPyramid',
      type: 'CONE',
      params: { radius: 1, height: 1.6, radialSegments: 4 },
    },
    mat: { id: 'uiKitPyramid', type: 'STANDARD', params: { color: SHAPES[1].color } },
    position: { y: 0.8 },
    castShadow: true,
  });
  shapeEntityIds.prism = createMeshEntity({
    geo: {
      id: 'uiKitPrism',
      type: 'CYLINDER',
      params: { radiusTop: 0.8, radiusBottom: 0.8, height: 1.4, radialSegments: 6 },
    },
    mat: { id: 'uiKitPrism', type: 'STANDARD', params: { color: SHAPES[2].color } },
    position: { x: 2.6, y: 0.7 },
    castShadow: true,
  });

  // A material outlives a visit: start each one from the defaults
  for (const shape of SHAPES) {
    shapeColors[shape.id] = shape.color;
    setMaterialColor(`uiKit${shape.name}`, shape.color);
  }
  groundColor = GROUND_COLORS[0].value;
  setMaterialColor('uiKitGround', groundColor);

  const panel = createHudPanel();
  createToasts();
  registerShapeWindows();
  createActions();

  // What the scene added outside the ECS goes with it (one exit function per scene). Its windows
  // close or are removed by their own flags.
  registerOnSceneExit(SCENE_ID, () => {
    panel.remove();
    removeToaster(TOASTER_ID);
  });
};

// #region ui-kit-hud (shown in the Hub: hub/pages/examples/ui-kit/)
/** The HUD panel: a button per shape (its window), the settings and the menu */
const createHudPanel = () => {
  const panel = getHUDRootCMP().add({ class: 'exampleUiKitHud' });
  panel.add({ tag: 'h2', text: 'Shapes' });
  for (const shape of SHAPES) {
    shapeButtons[shape.id] = panel.add({
      tag: 'button',
      class: 'exampleUiKitShapeButton',
      text: shape.name,
      // A custom property, which the button's swatch (its ::before) reads
      style: { '--swatch': shapeColors[shape.id] },
      onClick: () => toggleShapeWindow(shape.id),
    });
  }
  const row = panel.add({ class: 'exampleUiKitRow' });
  row.add({ tag: 'button', text: 'Settings', onClick: () => toggleSettingsWindow() });
  row.add({ tag: 'button', text: 'Menu', onClick: () => openMenu() });
  panel.add({ class: 'exampleUiKitHint', text: 'Space: turn the shapes\nEsc: menu' });
  return panel;
};

const applyShapeColor = (shapeId: ShapeId, color: string) => {
  shapeColors[shapeId] = color;
  setMaterialColor(`uiKit${getShapeName(shapeId)}`, color);
  // Written in place: no new props object per update
  shapeButtons[shapeId].updateStyle({ '--swatch': color });
};

const setShapeColor = (shapeId: ShapeId, color: string) => {
  applyShapeColor(shapeId, color);
  showToast(`${getShapeName(shapeId)}: ${getColorLabel(color)}`);
};
// #endregion ui-kit-hud

// #region ui-kit-windows (shown in the Hub: hub/pages/examples/ui-kit/)
/** One window kind for the shapes: each window's content is built from its data */
const registerShapeWindows = () =>
  registerDraggableWindowKind(SHAPE_WINDOW_KIND, {
    content: (data) => createShapePanel(data?.shapeId as ShapeId),
  });

const createShapePanel = (shapeId: ShapeId) => {
  const panel = CMP({ class: 'exampleUiKitPanel' });
  panel.add({ tag: 'label', text: 'Colour' });
  const colorDropDown = createDropDown({
    options: COLORS,
    value: () => shapeColors[shapeId],
    onChange: (color) => {
      setShapeColor(shapeId, color);
      // The label re-reads `value` on an open and on refresh()
      colorDropDown.refresh();
    },
    title: 'Colour',
  });
  panel.add(colorDropDown.cmp);
  panel.add({ tag: 'button', text: 'Turn', onClick: () => turnShape(shapeId) });
  return panel;
};

/** Opens the shape's window, brings it to the front, or closes it when it's on top */
const toggleShapeWindow = (shapeId: ShapeId) =>
  toggleDraggableWindow({
    id: getKindWindowId(SHAPE_WINDOW_KIND, shapeId),
    kind: SHAPE_WINDOW_KIND,
    data: { shapeId },
    title: getShapeName(shapeId),
    // Right of the HUD panel (px: its top left corner); a kind's next window cascades from it
    position: { x: 200, y: 72 },
    size: { w: 240, h: 170 },
    closeOnSceneChange: true,
  });

/** A single window: its content passed on the open */
const toggleSettingsWindow = () =>
  toggleDraggableWindow({
    id: SETTINGS_WINDOW_ID,
    title: 'Settings',
    content: () => createSettingsPanel(),
    // A % position is the window's centre: near the right edge, below the toasts
    position: { x: 86, y: 58 },
    units: { position: { x: '%', y: '%' } },
    size: { w: 260, h: 240 },
    closeOnSceneChange: true,
  });

const createSettingsPanel = () => {
  const panel = CMP({ class: 'exampleUiKitPanel' });
  panel.add({ tag: 'label', text: 'Ground' });
  const groundDropDown = createDropDown({
    options: GROUND_COLORS,
    value: () => groundColor,
    onChange: (color) => {
      groundColor = color;
      setMaterialColor('uiKitGround', color);
      groundDropDown.refresh();
    },
    title: 'Ground',
  });
  panel.add(groundDropDown.cmp);
  panel.add({ tag: 'label', text: 'Toasts' });
  const row = panel.add({ class: 'exampleUiKitRow' });
  row.add({ tag: 'button', text: 'Info', onClick: () => showToast('Just so you know') });
  row.add({ tag: 'button', text: 'Warning', onClick: () => showToast('Careful now', 'warning') });
  return panel;
};
// #endregion ui-kit-windows

// #region ui-kit-toasts (shown in the Hub: hub/pages/examples/ui-kit/)
/** The scene's toaster, top right. The engine makes one only in the debug env, so an app that
 * shows toasts makes its own (and names it on each toast: the debug one stays the default). */
const createToasts = () =>
  getHUDRootCMP().add(
    createToaster({
      id: TOASTER_ID,
      settings: {
        verticalPosition: 'top',
        horizontalPosition: 'right',
        toastDirection: 'down',
        toastAppearFromDirection: 'right',
        offset: { x: '-16px', y: '16px' },
      },
    })
  );

const showToast = (message: string, type?: ToastType) =>
  addToast({ message, type, toasterId: TOASTER_ID });
// #endregion ui-kit-toasts

// #region ui-kit-menu (shown in the Hub: hub/pages/examples/ui-kit/)
let menuButtons: TCMP[] = [];

/** The gameplay keys, and the menu's in a context of its own, off until the menu opens */
const createActions = () => {
  const gameplay = createActionMap({
    id: SCENE_ID,
    sceneId: SCENE_ID,
    actions: {
      menu: { type: 'BUTTON', name: 'Pause menu' },
      turn: { type: 'BUTTON', name: 'Turn the shapes' },
    },
    bindings: {
      menu: [{ device: 'KEYBOARD', keys: ['Escape'] }],
      turn: [{ device: 'KEYBOARD', keys: [' '] }],
    },
  });
  gameplay.onPressed('menu', () => openMenu());
  gameplay.onPressed('turn', () => SHAPES.forEach((shape) => turnShape(shape.id)));

  const menu = createActionMap({
    id: `${SCENE_ID}:menu`,
    sceneId: SCENE_ID,
    context: MENU_CONTEXT,
    actions: {
      up: { type: 'BUTTON', name: 'Previous item' },
      down: { type: 'BUTTON', name: 'Next item' },
    },
    bindings: {
      up: [{ device: 'KEYBOARD', keys: ['ArrowUp'] }],
      down: [{ device: 'KEYBOARD', keys: ['ArrowDown'] }],
    },
  });
  menu.onPressed('up', () => moveMenuFocus(-1));
  menu.onPressed('down', () => moveMenuFocus(1));
  setActionContextEnabled(MENU_CONTEXT, false);
};

/** The pause menu: gameplay off, the menu's keys on, until it closes (Escape, Resume, or a
 * scene change, which removes it) */
const openMenu = () => {
  setActionContextEnabled('GAMEPLAY', false);
  setActionContextEnabled(MENU_CONTEXT, true);
  openDialog({
    id: MENU_DIALOG_ID,
    title: 'Paused',
    content: () => createMenuPanel(),
    size: { w: 320, h: 220 },
    minSize: { w: 280, h: 180 },
    closeOnEscape: true,
    removeOnSceneChange: true,
    onClose: () => {
      setActionContextEnabled(MENU_CONTEXT, false);
      setActionContextEnabled('GAMEPLAY', true);
    },
  });
};

const createMenuPanel = () => {
  const panel = CMP({ class: 'exampleUiKitMenu' });
  menuButtons = [
    panel.add({
      tag: 'button',
      text: 'Resume',
      onClick: () => closeDraggableWindow(MENU_DIALOG_ID),
    }),
    panel.add({ tag: 'button', text: 'Reset the colours', onClick: () => resetColors() }),
  ];
  panel.add({ class: 'exampleUiKitHint', text: '↑ ↓: choose · Enter: press · Esc: resume' });
  return panel;
};

const moveMenuFocus = (step: number) => {
  const current = menuButtons.findIndex((button) => button.elem === document.activeElement);
  const next = (current + step + menuButtons.length) % menuButtons.length;
  menuButtons[next]?.focus();
};
// #endregion ui-kit-menu

const resetColors = () => {
  for (const shape of SHAPES) applyShapeColor(shape.id, shape.color);
  // The open shape windows' drop-downs show the new colours
  updateDraggableWindowsOfKind(SHAPE_WINDOW_KIND);
  showToast('Colours reset');
};

// An eighth of a turn around y
const turnStep = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);

const turnShape = (shapeId: ShapeId) => {
  const world = getECSWorld();
  const rotation = world.getRotation(shapeEntityIds[shapeId]);
  if (rotation) world.setTransform(shapeEntityIds[shapeId], { rot: rotation.multiply(turnStep) });
};
