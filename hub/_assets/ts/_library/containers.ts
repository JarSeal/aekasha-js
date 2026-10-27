/**
 * The component library's containers (the Hub's `features/ui-kit/forms/` containers guide): the
 * folder, the fieldset, the property grid (and the dev page's Tweakpane parity box) and the form.
 */
import {
  addPropertyGridItems,
  createBindingScheduler,
  createButton,
  createCheckbox,
  createFieldset,
  createFolder,
  createForm,
  createMonitor,
  createNumberField,
  createPropertyGrid,
  createSelectField,
  createSlider,
  createSwitch,
  createTextField,
} from 'aekasha/ui';
import type { PropertyGridItem } from 'aekasha/ui';
import { ID_PREFIX, addGroup, addButton, addKitRoot } from './page';
import type { Demo } from './page';

// --- Folder ---

const FOLDER_ID = (name: string) => `${ID_PREFIX}Folder${name}`;

/** In the page: a light's folder (open) with a nested shadow folder (shut, hidden while the light
 * casts none: its `hidden` function), on one scheduler; each open and shut in the status line,
 * and a kit button that changes the values from outside and refreshes (a shut folder's fields are
 * read when it opens, without a flash) */
const initFolderDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = FOLDER_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const light = { intensity: 1.2, castShadow: true, bias: -0.0005, mapSize: 1024 };
  const scheduler = createBindingScheduler();
  const report = (title: string) => (open: boolean) => {
    status.textContent = `${title}: ${open ? 'open' : 'shut'}`;
  };

  const shadow = createFolder({
    id: FOLDER_ID('Shadow'),
    title: 'Shadow',
    expanded: false,
    hidden: () => !light.castShadow,
    scheduler,
    onExpandedChange: report('Shadow'),
    children: [
      createNumberField({
        id: FOLDER_ID('Bias'),
        label: 'Bias',
        target: light,
        key: 'bias',
        step: 0.0001,
        scheduler,
      }),
      createSelectField({
        label: 'Map size',
        target: light,
        key: 'mapSize',
        options: { '512': 512, '1024': 1024, '2048': 2048 },
        scheduler,
      }),
    ],
  });
  const lightFolder = createFolder({
    id: FOLDER_ID('Light'),
    title: 'Sun light',
    scheduler,
    onExpandedChange: report('Sun light'),
    children: [
      createSlider({
        id: FOLDER_ID('Intensity'),
        label: 'Intensity',
        target: light,
        key: 'intensity',
        min: 0,
        max: 5,
        step: 0.1,
        scheduler,
      }),
      createCheckbox({
        id: FOLDER_ID('CastShadow'),
        label: 'Cast shadows',
        target: light,
        key: 'castShadow',
        scheduler,
        // Its folder's `hidden` function is re-read on the refresh
        onChange: () => scheduler.refresh(),
      }),
      shadow,
    ],
  });
  const outside = createButton({
    id: FOLDER_ID('Outside'),
    label: 'Change the values from outside',
    onClick: () => {
      light.intensity = Math.round(((light.intensity + 0.7) % 5) * 10) / 10;
      light.bias = -0.001;
      scheduler.refresh();
    },
  });
  const group = addGroup(
    root,
    'A folder in a folder; the inner one shut, and hidden without shadows'
  );
  group.classList.add('hubDemoFields', 'hubDemoFolders');
  group.append(lightFolder.cmp.elem, outside.cmp.elem);
  root.append(status);
};

// --- Fieldset ---

const FIELDSET_ID = (name: string) => `${ID_PREFIX}Fieldset${name}`;

/** In the page: a form's two sections as fieldsets, the second one disabled by a Hub button (a
 * state): every field in it, its slider's thumb too */
const initFieldsetDemo: Demo = (box) => {
  const controls = addGroup(box, 'States');
  const root = addKitRoot(box);
  const profile = { name: 'Ada', region: 'eu', email: true, sounds: false, volume: 6 };
  const account = createFieldset({
    legend: 'Account',
    hint: 'Shown to other players',
    children: [
      createTextField({ id: FIELDSET_ID('Name'), label: 'Name', target: profile, key: 'name' }),
      createSelectField({
        id: FIELDSET_ID('Region'),
        label: 'Region',
        target: profile,
        key: 'region',
        options: [
          { text: 'Europe', value: 'eu' },
          { text: 'Americas', value: 'am' },
          { text: 'Asia', value: 'as' },
        ],
      }),
    ],
  });
  const notifications = createFieldset({
    legend: 'Notifications',
    children: [
      createCheckbox({ id: FIELDSET_ID('Email'), label: 'Email', target: profile, key: 'email' }),
      createSwitch({ label: 'Sounds', target: profile, key: 'sounds' }),
      createSlider({
        label: 'Volume',
        target: profile,
        key: 'volume',
        min: 0,
        max: 10,
        showInput: false,
      }),
    ],
  });
  const done = createButton({ id: FIELDSET_ID('Done'), label: 'Done', variant: 'primary' });
  const group = addGroup(root, 'Two sections of a form');
  group.classList.add('hubDemoFields', 'hubDemoFieldsets');
  group.append(account.cmp.elem, notifications.cmp.elem, done.cmp.elem);
  addButton(controls, 'Disable the notifications', () => notifications.setDisabled(true));
};

// --- Property grid ---

const GRID_ID = (name: string) => `${ID_PREFIX}Grid${name}`;

/** In the page: a scene's settings as a property grid (its own scheduler): fields of each kind, a
 * long label cut, a folder in a folder whose controls line up with the top's, a monitor; the label
 * column's width in the status line, and a kit button that changes values and refreshes */
const initPropertyGridDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = GRID_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const scene = {
    speed: 1.5,
    wireframe: false,
    shadows: true,
    quality: 'high',
    name: 'Harbour',
    fogDensity: 0.02,
    intensity: 1.2,
    bias: -0.0005,
    bodies: 128,
  };
  const grid = createPropertyGrid({
    id: GRID_ID('Separator'),
    onLabelWidthChange: (width) => {
      status.textContent = `Label column: ${width} %`;
    },
    children: [
      createTextField({ id: GRID_ID('Name'), label: 'Name', target: scene, key: 'name' }),
      createSlider({
        id: GRID_ID('Speed'),
        label: 'Speed',
        target: scene,
        key: 'speed',
        min: 0,
        max: 5,
        step: 0.1,
      }),
      createCheckbox({
        id: GRID_ID('Wireframe'),
        label: 'Wireframe',
        target: scene,
        key: 'wireframe',
      }),
      createSelectField({
        label: 'Quality',
        target: scene,
        key: 'quality',
        options: [
          { text: 'Low', value: 'low' },
          { text: 'High', value: 'high' },
        ],
      }),
      createNumberField({
        label: 'Exponential fog density near the horizon',
        target: scene,
        key: 'fogDensity',
        min: 0,
        step: 0.01,
      }),
      createFolder({
        title: 'Sun light',
        children: [
          createSlider({
            label: 'Intensity',
            target: scene,
            key: 'intensity',
            min: 0,
            max: 5,
            step: 0.1,
          }),
          createSwitch({ label: 'Shadows', target: scene, key: 'shadows' }),
          createFolder({
            title: 'Shadow',
            children: [
              createNumberField({ label: 'Bias', target: scene, key: 'bias', step: 0.0001 }),
            ],
          }),
        ],
      }),
      createMonitor({ label: 'Bodies', target: scene, key: 'bodies', precision: 0 }),
    ],
  });
  const outside = createButton({
    id: GRID_ID('Outside'),
    label: 'Change the values from outside',
    onClick: () => {
      scene.speed = Math.round(((scene.speed + 1.3) % 5) * 10) / 10;
      scene.bodies += 16;
      grid.refresh();
    },
  });
  const group = addGroup(root, 'A scene’s settings; drag the column’s edge, or use its arrows');
  group.classList.add('hubDemoFields', 'hubDemoGrids');
  group.append(grid.cmp.elem, outside.cmp.elem);
  root.append(status);
};

// --- Tweakpane parity (the dev page's: p804 D14) ---

/** One property grid of declarative items, a row per row of p804 Phase 0's census whose field
 * exists, each hinted with the census's source line; the last write in the status line */
const initPropertyGridParityDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const state = {
    oracle: false,
    shadowIntensity: 1,
    domain: 'default',
    storageMode: 'MAP',
    cellSize: 4,
    bias: -0.00005,
    radius: 1,
    scope: 'Scene',
    maxMembers: 1234,
    summary: 'default: 128 members in 42 cells\nplayers: 2 members in 2 cells',
    labelText: 'Ray 1',
    castShadow: true,
    shadowMapSize: 1024,
    cellsColor: 0x44aaff,
    skyColor: '#87ceeb',
    helperColor: '#ff00ff',
    gridCenterColor: { r: 0.27, g: 0.27, b: 0.27 },
    cameraPosition: { x: 0, y: 5, z: 10 },
    bodyRotation: { x: 0, y: Math.PI / 4, z: 0, order: 'XYZ' },
  };
  const note = {
    text: 'The env bake already lights PBR materials, and this adds to it. For Lambert/Phong materials (no environment) and stylized looks.',
  };
  const report =
    (label: string) =>
    (value: unknown, { last }: { last: boolean }) => {
      status.textContent = `${label}: ${String(value)} (${last ? 'last' : 'step'})`;
    };
  const field = (source: string, item: PropertyGridItem): PropertyGridItem =>
    ({
      hint: source,
      ...item,
      ...('label' in item && item.type === undefined ? { onChange: report(item.label) } : {}),
    }) as PropertyGridItem;
  const grid = createPropertyGrid();
  addPropertyGridItems(grid, [
    {
      type: 'folder',
      title: 'Edit fields',
      items: [
        field('_dbg__SpatialGrid.ts:568', {
          target: state,
          key: 'oracle',
          label: 'Brute-force oracle',
        }),
        field('_dbg__LightGUI.ts:838', {
          target: state,
          key: 'shadowIntensity',
          label: 'Shadow Intensity',
          min: 0,
          max: 10,
          step: 0.001,
        }),
        field('_dbg__SpatialGrid.ts:508', {
          target: state,
          key: 'domain',
          label: 'Domain',
          options: [
            { value: 'default', text: 'Default' },
            { value: 'players', text: 'Players' },
          ],
        }),
        field('_dbg__ECS.ts:120', {
          target: state,
          key: 'storageMode',
          label: 'Storage mode',
          options: { Map: 'MAP', 'Typed Array': 'TYPED_ARRAY' },
        }),
        field('_dbg__SpatialGrid.ts:522', {
          target: state,
          key: 'cellSize',
          label: 'Cell size',
          min: 0.1,
          step: 0.5,
        }),
        field('_dbg__LightGUI.ts:816', {
          target: state,
          key: 'bias',
          label: 'Shadow Bias',
          step: 0.00001,
        }),
        field('_dbg__LightGUI.ts:865', {
          target: state,
          key: 'radius',
          label: 'Shadow Radius',
          min: 0,
        }),
        field('_dbg__RayTester.ts:557', { target: state, key: 'labelText', label: 'Label' }),
        field('_dbg__SpatialGrid.ts:586', {
          target: state,
          key: 'cellsColor',
          label: 'Wireframe color',
          kind: 'color',
        }),
        field('_dbg__BaseFolder.ts:26', { target: state, key: 'skyColor', label: 'Color' }),
        field('_dbg__RayTester.ts:492', {
          target: state,
          key: 'helperColor',
          label: 'Helper color',
          kind: 'color',
        }),
        field('_dbg__DebugTools.ts:682', {
          target: state,
          key: 'gridCenterColor',
          label: "Grid's center line color",
        }),
        field('_dbg__DebugTools.ts:549', {
          target: state,
          key: 'cameraPosition',
          label: 'Position',
        }),
        field('_dbg__Character.ts:213', {
          target: state,
          key: 'bodyRotation',
          label: 'Rotation',
          step: Math.PI / 8,
        }),
        field('the view: list blade (_dbg__LightGUI.ts)', {
          kind: 'select',
          label: 'Shadow map width',
          value: 1024,
          options: { '512': 512, '1024': 1024, '2048': 2048 },
        }),
      ],
    },
    {
      type: 'folder',
      title: 'Monitors',
      items: [
        field('_dbg__SpatialGrid.ts:521', {
          target: state,
          key: 'scope',
          label: 'Scope',
          readonly: true,
        }),
        field('_dbg__LightGUI.ts:506', {
          get: () => Math.floor(performance.now() / 250) % 100,
          label: 'Intensity',
          readonly: true,
          interval: 250,
        }),
        field('_dbg__SpatialGrid.ts:560', {
          target: state,
          key: 'maxMembers',
          label: 'Max members',
          readonly: true,
          format: (value) => (value as number).toLocaleString('en'),
        }),
        field('_dbg__SpatialGrid.ts:674', {
          target: state,
          key: 'summary',
          label: 'All domains',
          readonly: true,
          multiline: true,
          rows: 4,
          interval: 0,
        }),
        field('_dbg__AmbientLightFolder.ts:21', {
          target: note,
          key: 'text',
          label: 'Note',
          readonly: true,
          multiline: true,
          rows: 3,
        }),
      ],
    },
    {
      type: 'folder',
      title: 'Hidden and disabled functions',
      items: [
        field('the checkbox the two below read', {
          target: state,
          key: 'castShadow',
          label: 'Cast shadow',
        }),
        field('a disabled function', {
          target: state,
          key: 'bias',
          label: 'Bias',
          step: 0.00001,
          disabled: () => !state.castShadow,
        }),
        field('a hidden function', {
          target: state,
          key: 'shadowMapSize',
          label: 'Map size',
          options: { '512': 512, '1024': 1024 },
          hidden: () => !state.castShadow,
        }),
        { type: 'button', title: 'Refresh (the tab’s refresh)', onClick: () => grid.refresh() },
      ],
    },
    {
      type: 'folder',
      title: 'Structure',
      expanded: false,
      items: [
        {
          type: 'folder',
          title: 'A nested folder',
          items: [{ target: state, key: 'cellSize', label: 'Cell size', step: 0.5 }],
        },
        { type: 'separator' },
        {
          type: 'button',
          title: 'A button',
          onClick: () => (status.textContent = 'A button: clicked'),
        },
        {
          type: 'button',
          title: 'Rebuild',
          label: 'With a label',
          onClick: () => (status.textContent = 'With a label: clicked'),
        },
        {
          type: 'custom',
          build: (container) => {
            // _dbg__DayNightFolder.ts' speed buttons, as kit buttons in the custom item's CMP
            const row = container.add({ class: 'hubDemoParityCustom' });
            for (const speed of [1, 10, 100]) {
              row.add(
                createButton({
                  label: `×${speed}`,
                  size: 'sm',
                  onClick: () => (status.textContent = `Speed: ×${speed}`),
                }).cmp
              );
            }
          },
        },
      ],
    },
  ]);
  const group = addGroup(root, 'The census’s rows, each hinted with its source');
  group.classList.add('hubDemoFields', 'hubDemoGrids');
  group.append(grid.cmp.elem);
  root.append(status);
};

// --- Form ---

const FORM_ID = (name: string) => `${ID_PREFIX}Form${name}`;

/** In the page: a new player's form in two fieldsets (a required name with a length check, a
 * required region, an age of 13 or more, the rules to accept), its submit a promise (the button
 * loading for a moment); Hub buttons submit it empty (the summary and the errors) and fill it in */
const initFormDemo: Demo = (box) => {
  const controls = addGroup(box, 'States');
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = FORM_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const player = { name: '', region: '', age: 30, rules: false };
  const regions = [
    { text: 'Europe', value: 'eu' },
    { text: 'Americas', value: 'am' },
    { text: 'Asia', value: 'as' },
  ];
  const form = createForm({
    id: FORM_ID('Form'),
    submitLabel: 'Create',
    resetLabel: 'Start again',
    onSubmit: () => {
      status.textContent = 'Creating…';
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const region = regions.find((option) => option.value === player.region)?.text;
          status.textContent = `Created ${player.name} (${region}, ${player.age})`;
          resolve();
        }, 400);
      });
    },
    onReset: () => {
      status.textContent = 'Reset: every field at its default';
    },
    children: [
      createFieldset({
        legend: 'Player',
        children: [
          createTextField({
            id: FORM_ID('Name'),
            label: 'Name',
            target: player,
            key: 'name',
            required: 'Enter a name',
            validate: (name) =>
              name.trim().length < 3 ? 'Name must be 3 characters or more' : null,
          }),
          createSelectField({
            id: FORM_ID('Region'),
            label: 'Region',
            target: player,
            key: 'region',
            options: regions,
            placeholder: 'Choose a region',
            required: 'Choose a region',
          }),
          createNumberField({
            id: FORM_ID('Age'),
            label: 'Age',
            target: player,
            key: 'age',
            min: 0,
            max: 120,
            step: 1,
            hint: 'Players are 13 or older',
            validate: (age) => (age < 13 ? 'Age must be 13 or more' : null),
          }),
        ],
      }),
      createFieldset({
        legend: 'Rules',
        children: [
          createCheckbox({
            id: FORM_ID('Rules'),
            label: 'I accept the rules',
            target: player,
            key: 'rules',
            required: 'Accept the rules to go on',
          }),
        ],
      }),
    ],
  });
  const group = addGroup(root, 'A new player; Create checks it');
  group.classList.add('hubDemoFields', 'hubDemoForms');
  group.append(form.cmp.elem);
  root.append(status);
  addButton(controls, 'Submit it empty', () => form.submit());
  addButton(controls, 'Fill it in', () => {
    Object.assign(player, { name: 'Ada', region: 'eu', age: 36, rules: true });
    form.refresh();
  });
};

/** The containers group's demos by their box's key (`data-hub-demo`) */
export const CONTAINERS_DEMOS: Record<string, Demo> = {
  folder: initFolderDemo,
  fieldset: initFieldsetDemo,
  propertyGrid: initPropertyGridDemo,
  propertyGridParity: initPropertyGridParityDemo,
  form: initFormDemo,
};
