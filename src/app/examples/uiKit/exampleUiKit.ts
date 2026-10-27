import * as THREE from 'three/webgpu';
import {
  createActionMap,
  createMeshEntity,
  getDelta,
  getECSWorld,
  getMaterial,
  loadScene,
  registerOnSceneExit,
  setActionContextEnabled,
} from 'aekasha';
import {
  addToast,
  closeDraggableWindow,
  CMP,
  createButton,
  createCheckbox,
  createColorField,
  createDropDown,
  createFolder,
  createForm,
  createKbd,
  createMonitor,
  createProgressBar,
  createPropertyGrid,
  createQuaternionField,
  createSelectField,
  createSlider,
  createSplitButton,
  createTextField,
  createToaster,
  createVectorField,
  getDraggableWindow,
  getHUDRootCMP,
  getKindWindowId,
  openDialog,
  openDraggableWindow,
  registerDraggableWindowKind,
  removeToaster,
  toggleDraggableWindow,
  updateDraggableWindowsOfKind,
} from 'aekasha/ui';
import type { Button, ProgressBar, PropertyGrid, ToastType } from 'aekasha/ui';
import { SpinComponentType } from '../ecs/SpinComponent';
import './exampleUiKit.scss';

const SCENE_ID = 'exampleUiKit';
const TOASTER_ID = 'exampleUiKitToasts';
const SHAPE_WINDOW_KIND = 'exampleUiKitShape';
const SETTINGS_WINDOW_ID = 'exampleUiKitSettings';
const RENAME_WINDOW_ID = 'exampleUiKitRename';
const MENU_DIALOG_ID = 'exampleUiKitMenu';
const MENU_CONTEXT = 'MENU';
/** A turn is an eighth of a full one: a shape's window shows them as eight segments */
const TURNS_PER_REVOLUTION = 8;
const RAD_TO_DEG = 180 / Math.PI;
const NAME_MAX_LENGTH = 12;

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
const shapeTurns = {} as Record<ShapeId, number>;
const shapeEntityIds = {} as Record<ShapeId, number>;
const shapeButtons = {} as Record<ShapeId, Button>;
/** What the shapes are called: the Rename form changes it */
const shapeNames = {} as Record<ShapeId, string>;
/** The open shape windows' turn bars, set by their content and taken off when it goes */
const turnBars = new Map<ShapeId, ProgressBar>();
let groundColor = GROUND_COLORS[0].value;
/** The shape the Scene settings window shows, and its grid while the window is open */
let settingsShape: ShapeId = 'box';
let settingsGrid: PropertyGrid | null = null;

const getShapeName = (shapeId: ShapeId) => shapeNames[shapeId] ?? shapeId;
/** A shape's material id, from its first name: a rename leaves it */
const getMaterialId = (shapeId: ShapeId) =>
  `uiKit${SHAPES.find((s) => s.id === shapeId)?.name ?? shapeId}`;
const getColorLabel = (color: string) => COLORS.find((c) => c.value === color)?.label ?? color;

const getStandardMaterial = (materialId: string) => {
  const material = getMaterial(materialId);
  return material instanceof THREE.MeshStandardMaterial ? material : null;
};

const setMaterialColor = (materialId: string, color: string) =>
  getStandardMaterial(materialId)?.color.set(color);

const setMaterialWireframe = (materialId: string, on: boolean) => {
  const material = getStandardMaterial(materialId);
  if (!material || material.wireframe === on) return;
  material.wireframe = on;
  material.needsUpdate = true;
};

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
  const world = getECSWorld();
  for (const shape of SHAPES) {
    shapeColors[shape.id] = shape.color;
    shapeTurns[shape.id] = 0;
    shapeNames[shape.id] = shape.name;
    setMaterialColor(getMaterialId(shape.id), shape.color);
    setMaterialWireframe(getMaterialId(shape.id), false);
    // The ECS example's SPIN (its system runs in every world): still until the settings spin it
    world.addComponent(shapeEntityIds[shape.id], SpinComponentType.SPIN, {
      axis: { x: 0, y: 1, z: 0 },
      speed: 0,
    });
  }
  groundColor = GROUND_COLORS[0].value;
  setMaterialColor('uiKitGround', groundColor);
  settingsShape = 'box';

  const panel = createHudPanel();
  createToasts();
  // Registered on every visit, which replaces the kind's options: its windows close with the
  // scene and aren't saved (saveToLS), so none is restored before a visit registers it. A kind
  // whose windows are restored after a reload is registered once, in the app's `start`.
  registerShapeWindows();
  createActions();

  // What the scene added outside the ECS goes with it (one exit function per scene): removing
  // the panel removes the kit components in it, their tooltips and the split button's menu. Its
  // windows close or are removed by their own flags.
  registerOnSceneExit(SCENE_ID, () => {
    panel.remove();
    removeToaster(TOASTER_ID);
  });
};

// #region ui-kit-hud (shown in the Hub: hub/pages/examples/ui-kit/)
/** The HUD panel: a button per shape (its window), the turns, the settings, the rename form and
 * the menu */
const createHudPanel = () => {
  const panel = getHUDRootCMP().add({ class: 'exampleUiKitHud' });
  panel.add({ tag: 'h2', text: 'Shapes' });
  for (const shape of SHAPES) {
    const button = createButton({
      label: shape.name,
      class: 'exampleUiKitShapeButton',
      tooltip: 'Its window: its colour and its turns',
      onClick: () => toggleShapeWindow(shape.id),
    });
    // A custom property, which the button's swatch (its ::before) reads
    button.cmp.updateStyle({ '--swatch': shapeColors[shape.id] });
    shapeButtons[shape.id] = button;
    panel.add(button.cmp);
  }
  // An action and its variants: turn them all, or one, from the menu button next to it. A getter
  // of items, read on each open, so a renamed shape's item has its new name
  const turn = createSplitButton({
    label: 'Turn all',
    kbd: createKbd({ keys: 'Space' }),
    menuLabel: 'Turn one',
    onClick: () => turnAllShapes(),
    items: () => [
      ...SHAPES.map((shape) => ({
        label: `Turn ${getShapeName(shape.id)}`,
        onSelect: () => turnShape(shape.id),
      })),
      { type: 'separator' as const },
      { label: 'Reset the colours', onSelect: () => resetColors() },
    ],
  });
  panel.add(turn.cmp);
  panel.add(createButton({ label: 'Settings', onClick: () => toggleSettingsWindow() }).cmp);
  panel.add(createButton({ label: 'Rename', onClick: () => toggleRenameWindow() }).cmp);
  // `kbd` is a hint (and `aria-keyshortcuts`): the key is the scene's action map's
  panel.add(
    createButton({ label: 'Menu', kbd: createKbd({ keys: 'Escape' }), onClick: () => openMenu() })
      .cmp
  );
  return panel;
};

const applyShapeColor = (shapeId: ShapeId, color: string) => {
  shapeColors[shapeId] = color;
  setMaterialColor(getMaterialId(shapeId), color);
  // Written in place: no new props object per update
  shapeButtons[shapeId].cmp.updateStyle({ '--swatch': color });
};

/** A colour from a shape window's drop-down: the settings' colour field shows it (a flash) */
const setShapeColor = (shapeId: ShapeId, color: string) => {
  applyShapeColor(shapeId, color);
  settingsGrid?.refresh();
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
  // A full turn in eighths: one segment fills per turn
  const turns = createProgressBar({
    label: 'Turned',
    max: TURNS_PER_REVOLUTION,
    segments: TURNS_PER_REVOLUTION,
    value: shapeTurns[shapeId] % TURNS_PER_REVOLUTION,
  });
  turnBars.set(shapeId, turns);
  const panel = CMP({
    class: 'exampleUiKitPanel',
    // The content goes on a close or a rebuild: its bar with it, unless a rebuild's is in already
    onRemoveCmp: () => {
      if (turnBars.get(shapeId) === turns) turnBars.delete(shapeId);
    },
  });
  panel.add({ tag: 'label', text: 'Colour' });
  const colorDropDown = createDropDown({
    options: COLORS,
    value: () => shapeColors[shapeId],
    onChange: (color) => {
      // The trigger's label re-reads `value` after this
      setShapeColor(shapeId, color);
    },
    // A colour the settings' colour field set that isn't one of these
    placeholder: 'Custom',
    title: 'Colour',
  });
  panel.add(colorDropDown.cmp);
  panel.add(turns.cmp);
  panel.add(createButton({ label: 'Turn', size: 'sm', onClick: () => turnShape(shapeId) }).cmp);
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
    position: { x: 260, y: 72 },
    size: { w: 260, h: 200 },
    closeOnSceneChange: true,
  });

/** A single window: its content passed on the open */
const toggleSettingsWindow = () =>
  toggleDraggableWindow({
    id: SETTINGS_WINDOW_ID,
    title: 'Scene settings',
    content: () => createSettingsPanel(),
    // A % position is the window's centre: near the right edge, below the toasts
    position: { x: 80, y: 56 },
    units: { position: { x: '%', y: '%' } },
    size: { w: 380, h: 400 },
    closeOnSceneChange: true,
  });
// #endregion ui-kit-windows

// #region ui-kit-settings (shown in the Hub: hub/pages/examples/ui-kit/)
const ORIGIN = { x: 0, y: 0, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

const getSpin = (shapeId: ShapeId) =>
  getECSWorld().getComponent(shapeEntityIds[shapeId], SpinComponentType.SPIN);

/** The options of a select of the shapes: a getter, read on each open, has their names now */
const getShapeOptions = () =>
  SHAPES.map((shape) => ({ label: getShapeName(shape.id), value: shape.id }));

/**
 * The Scene settings: a property grid whose rows follow the shape picked at its top, each bound
 * with a getter and a setter to the scene's own state (the ECS, the materials, this file's
 * records), and a folder for the scene's ground and its frame time
 */
const createSettingsPanel = () => {
  const panel = CMP({
    class: 'exampleUiKitPanel',
    onRemoveCmp: () => {
      if (settingsGrid === grid) settingsGrid = null;
    },
  });
  const id = () => shapeEntityIds[settingsShape];
  const grid = createPropertyGrid({
    labelWidth: 30,
    children: [
      createSelectField({
        label: 'Shape',
        get: () => settingsShape,
        set: (shapeId) => {
          settingsShape = shapeId;
        },
        options: getShapeOptions,
        // Every row reads the new shape's values (the changed ones flash)
        onChange: () => grid.refresh(),
      }),
      // Its SPIN component's speed, in radians a second, shown in degrees
      createSlider({
        label: 'Spin',
        get: () => (getSpin(settingsShape)?.speed ?? 0) * RAD_TO_DEG,
        set: (degrees) => {
          const spin = getSpin(settingsShape);
          if (spin) spin.speed = degrees / RAD_TO_DEG;
        },
        min: 0,
        max: 360,
        step: 5,
        unit: '°/s',
      }),
      createColorField({
        label: 'Colour',
        get: () => shapeColors[settingsShape],
        set: (color) => applyShapeColor(settingsShape, color),
        palette: COLORS.map((color) => color.value),
        // A finished pick: the shape's window shows it
        onChange: (_color, { last }) => {
          if (last) updateDraggableWindowsOfKind(SHAPE_WINDOW_KIND);
        },
      }),
      // The ECS transform's vectors are to read: a write goes through setTransform
      createVectorField({
        label: 'Position',
        get: () => getECSWorld().getPosition(id()) ?? ORIGIN,
        set: (pos) => getECSWorld().setTransform(id(), { pos }),
        step: 0.1,
      }),
      // Read every 100 ms: it follows the spin and the turns. Y first (YXZ), so a turn about y
      // shows as its own angle all the way round (in XYZ past 90° it's x and z at 180°)
      createQuaternionField({
        label: 'Rotation',
        get: () => getECSWorld().getRotation(id()) ?? NO_ROTATION,
        set: (rot) => getECSWorld().setTransform(id(), { rot }),
        order: 'YXZ',
        interval: 100,
      }),
      createCheckbox({
        label: 'Wireframe',
        get: () => getStandardMaterial(getMaterialId(settingsShape))?.wireframe ?? false,
        set: (on) => setMaterialWireframe(getMaterialId(settingsShape), on),
      }),
      createFolder({
        title: 'Scene',
        children: [
          createSelectField({
            label: 'Ground',
            get: () => groundColor,
            set: (color) => {
              groundColor = color;
              setMaterialColor('uiKitGround', color);
            },
            options: GROUND_COLORS,
          }),
          // Read every 200 ms (a monitor's default), while it shows
          createMonitor({
            label: 'Frame time',
            get: () => getDelta() * 1000,
            precision: 1,
            unit: 'ms',
          }),
        ],
      }),
    ],
  });
  settingsGrid = grid;
  panel.add(grid.cmp);
  panel.add({ tag: 'label', text: 'Toasts' });
  const row = panel.add({ class: 'exampleUiKitRow' });
  row.add(
    createButton({ label: 'Info', size: 'sm', onClick: () => showToast('Just so you know') }).cmp
  );
  row.add(
    createButton({
      label: 'Warning',
      size: 'sm',
      onClick: () => showToast('Careful now', 'warning'),
    }).cmp
  );
  return panel;
};
// #endregion ui-kit-settings

// #region ui-kit-form (shown in the Hub: hub/pages/examples/ui-kit/)
const toggleRenameWindow = () =>
  toggleDraggableWindow({
    id: RENAME_WINDOW_ID,
    title: 'Rename a shape',
    content: () => createRenamePanel(),
    // Under the HUD panel
    position: { x: 16, y: 390 },
    size: { w: 300, h: 320 },
    closeOnSceneChange: true,
  });

const isNameTaken = (name: string, shapeId: ShapeId) =>
  SHAPES.some(
    (shape) =>
      shape.id !== shapeId && getShapeName(shape.id).toLowerCase() === name.trim().toLowerCase()
  );

/**
 * A form: a select and a required, checked text field bound to its own values (`{ target, key }`),
 * which a valid submit reads. The form shows each error under its field and a summary that takes
 * the focus; Enter in the text field submits it.
 */
const createRenamePanel = () => {
  const values: { shapeId: ShapeId; name: string } = { shapeId: 'box', name: '' };
  const form = createForm({
    children: [
      createSelectField({
        label: 'Shape',
        target: values,
        key: 'shapeId',
        options: getShapeOptions,
      }),
      createTextField({
        label: 'New name',
        target: values,
        key: 'name',
        hint: `At most ${NAME_MAX_LENGTH} characters`,
        maxLength: NAME_MAX_LENGTH,
        required: 'Give the shape a name',
        validate: (name) =>
          isNameTaken(name, values.shapeId) ? 'Another shape has that name' : null,
      }),
    ],
    submitLabel: 'Rename',
    resetLabel: 'Reset',
    onSubmit: () => {
      renameShape(values.shapeId, values.name.trim());
      // The fields back to their defaults, the checks off until the next submit; the select's
      // label read again (its value is the same, its option's name isn't)
      form.reset();
      form.refresh();
    },
  });
  const panel = CMP({ class: 'exampleUiKitPanel' });
  panel.add(form.cmp);
  return panel;
};

const renameShape = (shapeId: ShapeId, name: string) => {
  const previous = getShapeName(shapeId);
  shapeNames[shapeId] = name;
  shapeButtons[shapeId].setLabel(name);
  // An open window's title: opening it again updates it
  const windowId = getKindWindowId(SHAPE_WINDOW_KIND, shapeId);
  if (getDraggableWindow(windowId)?.isOpen) {
    openDraggableWindow({ id: windowId, title: name, focusFirstElement: false });
  }
  // The settings' shape select shows the new name
  settingsGrid?.refresh();
  showToast(`${previous} is now ${name}`, 'success');
};
// #endregion ui-kit-form

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
let menuButtons: Button[] = [];

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
  gameplay.onPressed('turn', () => turnAllShapes());

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
    size: { w: 320, h: 210 },
    minSize: { w: 280, h: 190 },
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
    createButton({
      label: 'Resume',
      variant: 'primary',
      onClick: () => closeDraggableWindow(MENU_DIALOG_ID),
    }),
    createButton({ label: 'Reset the colours', onClick: () => resetColors() }),
    // The app's scene loader (src/index.ts) covers the reload: its loading overlay
    createButton({
      label: 'Reload the scene',
      onClick: () => void loadScene({ sceneId: SCENE_ID }),
    }),
  ];
  for (const button of menuButtons) panel.add(button.cmp);
  return panel;
};

const moveMenuFocus = (step: number) => {
  const current = menuButtons.findIndex((button) => button.cmp.elem === document.activeElement);
  const next = (current + step + menuButtons.length) % menuButtons.length;
  menuButtons[next]?.cmp.focus();
};
// #endregion ui-kit-menu

const resetColors = () => {
  for (const shape of SHAPES) applyShapeColor(shape.id, shape.color);
  // The open shape windows' drop-downs show the new colours, and the settings' colour field
  updateDraggableWindowsOfKind(SHAPE_WINDOW_KIND);
  settingsGrid?.refresh();
  showToast('Colours reset');
};

// An eighth of a turn around y
const turnStep = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  (Math.PI * 2) / TURNS_PER_REVOLUTION
);
const nextRotation = new THREE.Quaternion();

const turnShape = (shapeId: ShapeId) => {
  const world = getECSWorld();
  // getRotation's quaternion is to read: the turned one goes through setTransform
  const rotation = world.getRotation(shapeEntityIds[shapeId]);
  if (!rotation) return;
  world.setTransform(shapeEntityIds[shapeId], {
    rot: nextRotation.copy(rotation).multiply(turnStep),
  });
  shapeTurns[shapeId]++;
  // Written in place in the open window, if there is one
  turnBars.get(shapeId)?.setValue(shapeTurns[shapeId] % TURNS_PER_REVOLUTION);
};

const turnAllShapes = () => SHAPES.forEach((shape) => turnShape(shape.id));
