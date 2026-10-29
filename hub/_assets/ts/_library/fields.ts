/**
 * The component library's fields (the Hub's `features/ui-kit/forms/` fields guide): the
 * drop-down, the number field, the slider and range slider, the radio group and segmented
 * control, the select field, the text field, the checkbox and switch, and the monitor.
 */
import {
  addToast,
  CMP,
  createBindingScheduler,
  createButton,
  createCheckbox,
  createDropDown,
  createMonitor,
  createNumberField,
  createRadioGroup,
  createRangeSlider,
  createSegmentedControl,
  createSelectField,
  createSlider,
  createSwitch,
  createTextField,
  getSvgIcon,
  openDraggableWindow,
} from 'aekasha/ui';
import type {
  DropDownProps,
  MonitorProps,
  NumberFieldProps,
  RadioGroupProps,
  RangeSliderProps,
  SegmentedControlProps,
  SelectValue,
  SliderProps,
  TextFieldProps,
  CMPHandle,
} from 'aekasha/ui';
import {
  ID_PREFIX,
  TOASTER_ID,
  openedIds,
  addGroup,
  addButton,
  addKitRoot,
  addPanelButton,
} from './page';
import type { Demo } from './page';

// --- Drop-down ---

const COLOURS = ['Orange', 'Teal', 'Gold', 'Violet'].map((label) => ({
  value: label.toLowerCase(),
  label,
}));

/** A drop-down whose pick is its value (from `initial`), shown in a toast */
export const createDemoDropDown = (
  props: Partial<DropDownProps> = {},
  initial: string | null = 'orange'
) => {
  let value = initial;
  return createDropDown({
    options: COLOURS,
    onChange: (picked) => {
      value = picked;
      addToast({ message: `Picked: ${picked}`, toasterId: TOASTER_ID });
    },
    ...props,
    value: () => value,
  });
};

const createDropDownPanel = () => {
  const panel = CMP({ class: 'hubDemoPanel hubDemoDropDowns' });
  const row = (label: string, dropDown: { cmp: CMPHandle }) => {
    panel.add({ tag: 'p', text: label });
    panel.add(dropDown.cmp);
  };
  row('With a value', createDemoDropDown({ title: 'Colour' }));
  row('No value: the placeholder', createDemoDropDown({ placeholder: 'Pick one' }, null));
  row('With an icon', createDemoDropDown({ icon: getSvgIcon('camera', 'sm') }));
  row('Opens upward', createDemoDropDown({ placement: 'top' }));
  row('Disabled', createDemoDropDown({ disabled: true }));
  row(
    'Searchable: type to filter',
    createDemoDropDown({ searchable: true, searchPlaceholder: 'Filter colours' })
  );
  // A value changed elsewhere: the trigger shows it after `refresh()`
  let index = 0;
  const changed = createDropDown({
    options: COLOURS,
    value: () => COLOURS[index].value,
    onChange: (picked) => (index = COLOURS.findIndex((c) => c.value === picked)),
  });
  row('Changed elsewhere', changed);
  addPanelButton(panel, 'Next colour, then refresh()', () => {
    index = (index + 1) % COLOURS.length;
    changed.refresh();
  });
  // Still a tab stop (a toolbar's drop-down): its reason is its title, and it doesn't open
  const waiting = createDemoDropDown({ title: 'Colour', focusableWhenDisabled: true });
  waiting.setDisabled(true, 'Loading the colours…');
  row('Disabled but focusable (aria-disabled), its reason the title', waiting);
  return panel;
};

const initDropDownDemo: Demo = (box) => {
  const states = addGroup(box, 'States');
  addButton(states, 'Open the drop-downs', () => {
    const id = `${ID_PREFIX}DropDowns`;
    openedIds.add(id);
    openDraggableWindow({
      id,
      title: 'Drop-downs',
      size: { w: 300, h: 600 },
      removeOnClose: true,
      content: createDropDownPanel,
    });
  });
};

// --- Number field ---

const NUMBER_ID = (name: string) => `${ID_PREFIX}Number${name}`;

/** In the page: the fields draw in their rows, bound to one object, and each write shows in the
 * box's status line; a kit button changes the speed from outside, which the next refresh flashes */
const initNumberFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = NUMBER_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const settings = { speed: 1.5, heading: 90, volume: 0.8, size: 4, limit: 12 };
  const scheduler = createBindingScheduler();
  const make = (name: string, props: Partial<NumberFieldProps>) => {
    const field = createNumberField({
      id: NUMBER_ID(name),
      label: name,
      target: settings,
      key: name.toLowerCase(),
      scheduler,
      onChange: (value, { last, source }) => {
        status.textContent = `${name}: ${value} (${last ? 'last' : 'step'}, ${source})`;
      },
      ...props,
    } as NumberFieldProps);
    return field;
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };

  row(
    'A step, a minimum and a unit; a hint',
    make('Speed', { min: 0, step: 0.1, unit: 'm/s', hint: 'Drag the label, or type 3 * 0.5' }).cmp
      .elem
  );
  row(
    'An angle that wraps at ±180, typed in deg or rad',
    make('Heading', {
      min: -180,
      max: 180,
      step: 15,
      wrap: true,
      unit: '°',
      expressionUnits: { deg: 1, rad: 180 / Math.PI },
    }).cmp.elem
  );
  row(
    'Formatted as a percent, typed with %',
    make('Volume', {
      min: 0,
      max: 1,
      step: 0.01,
      format: (value) => `${Math.round(value * 100)} %`,
      expressionUnits: { '%': 0.01 },
    }).cmp.elem
  );
  row('Live: each valid keystroke writes', make('Size', { step: 1, live: true }).cmp.elem);
  const limit = make('Limit', { step: 1, max: 20 });
  limit.setError('Must be below 10');
  const disabled = make('Disabled', { target: settings, key: 'speed', disabled: true });
  row('An error, and disabled', limit.cmp.elem, disabled.cmp.elem);
  const outside = createButton({
    id: NUMBER_ID('Outside'),
    label: 'Change the speed from outside',
    onClick: () => {
      settings.speed = Math.round((settings.speed + 1) * 10) / 10;
      // What a host's refresh does: the field flashes the value it didn't write
      scheduler.refresh();
    },
  });
  row('A change from outside, then the scheduler’s refresh()', outside.cmp.elem);
  root.append(status);
};

// --- Slider ---

const SLIDER_ID = (name: string) => `${ID_PREFIX}Slider${name}`;
const QUALITY_NAMES = ['Low', 'Medium', 'High', 'Ultra', 'Max'];

/** In the page: sliders with the spin button (a format, labelled ticks), one without it (the
 * thumb is the slider) and a disabled one, bound to one object; each write in the status line */
const initSliderDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = SLIDER_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const settings = { volume: 0.8, fov: 75, quality: 2, gamma: 2.2 };
  const make = (name: string, key: keyof typeof settings, props: Partial<SliderProps>) =>
    createSlider({
      id: SLIDER_ID(name),
      label: name,
      target: settings,
      key,
      onChange: (value, { last, source }) => {
        const text = key === 'quality' ? QUALITY_NAMES[value] : value;
        status.textContent = `${name}: ${text} (${last ? 'last' : 'step'}, ${source})`;
      },
      ...props,
    } as SliderProps);
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields', 'hubDemoSliders');
    group.append(...elems);
  };

  row(
    'A step and a format, typed with %',
    make('Volume', 'volume', {
      min: 0,
      max: 1,
      step: 0.01,
      format: (value) => `${Math.round(value * 100)} %`,
      expressionUnits: { '%': 0.01 },
    }).cmp.elem
  );
  row(
    'A unit and labelled ticks',
    make('Field of view', 'fov', {
      id: SLIDER_ID('Fov'),
      min: 30,
      max: 120,
      step: 1,
      unit: '°',
      ticks: [
        { value: 30, label: '30°' },
        { value: 60, label: '60°' },
        { value: 90, label: '90°' },
        { value: 120, label: '120°' },
      ],
    }).cmp.elem
  );
  row(
    'Without the input: the thumb is the slider, five ticks',
    make('Quality', 'quality', {
      min: 0,
      max: 4,
      step: 1,
      showInput: false,
      ticks: 5,
      format: (value) => QUALITY_NAMES[value] ?? String(value),
      hint: 'Drag, or use the arrow keys',
    }).cmp.elem
  );
  row('Disabled', make('Gamma', 'gamma', { min: 1, max: 3, step: 0.1, disabled: true }).cmp.elem);
  root.append(status);
};

// --- Range slider ---

const RANGE_ID = (name: string) => `${ID_PREFIX}Range${name}`;
/** How many items each 20 € of the price range holds: the price slider's histogram */
const PRICE_COUNTS = [
  3, 6, 11, 17, 24, 28, 25, 19, 14, 12, 15, 18, 13, 8, 5, 4, 6, 7, 4, 2, 1, 2, 1, 1, 0,
];

/** In the page: a price range with a histogram and a gap, a span of years with labelled ticks,
 * an altitude band with its spin buttons, and a disabled one, bound to one object; each write in
 * the status line */
const initRangeSliderDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = RANGE_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const filters = {
    price: { min: 100, max: 350 },
    years: { min: 2000, max: 2020 },
    altitude: { min: 1500, max: 6000 },
    depth: { min: 2, max: 6 },
  };
  const make = (name: string, key: keyof typeof filters, props: Partial<RangeSliderProps>) =>
    createRangeSlider({
      id: RANGE_ID(name),
      label: name,
      target: filters,
      key,
      onChange: (value, { last, source }) => {
        status.textContent = `${name}: ${value.min}–${value.max} (${last ? 'last' : 'step'}, ${source})`;
      },
      ...props,
    } as RangeSliderProps);
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields', 'hubDemoSliders');
    group.append(...elems);
  };

  row(
    'A histogram, and a gap of 50 € the thumbs keep',
    make('Price', 'price', {
      min: 0,
      max: 500,
      step: 10,
      minGap: 50,
      unit: '€',
      histogram: PRICE_COUNTS,
      hint: 'Drag the bar between the thumbs to move both',
    }).cmp.elem
  );
  row(
    'Labelled ticks; the thumbs may meet',
    make('Years', 'years', {
      min: 1990,
      max: 2030,
      step: 1,
      ticks: [1990, 2000, 2010, 2020, 2030].map((year) => ({ value: year, label: String(year) })),
    }).cmp.elem
  );
  const altitude = make('Altitude', 'altitude', {
    min: 0,
    max: 9000,
    step: 100,
    minGap: 500,
    unit: 'm',
    showInputs: true,
    expressionUnits: { km: 1000 },
    hint: 'Type an exact value (2.5km works), or drag',
  }).cmp.elem;
  altitude.classList.add('hubDemoRangeInputs');
  row('With spin buttons: exact values typed, the track for the pointer', altitude);
  row(
    'Disabled',
    make('Depth', 'depth', { min: 0, max: 10, step: 1, unit: 'm', disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Radio group and segmented control ---

const RADIO_ID = (name: string) => `${ID_PREFIX}Radio${name}`;

/** In the page: radio groups (a column with a hint, a row with a disabled option), segmented
 * controls (text filling the width, icons alone) and disabled ones, bound to one object; each pick
 * in the box's status line */
const initRadioGroupDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = RADIO_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const settings = {
    difficulty: 'normal',
    shadows: 'low',
    camera: 'orbit',
    simulation: 'play',
    quality: 'high',
  };
  type Key = keyof typeof settings;
  const report = (label: string) => (value: string) => {
    status.textContent = `${label}: ${value}`;
  };
  const options = (...labels: string[]) =>
    labels.map((label) => ({ value: label.toLowerCase(), label }));
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields', 'hubDemoChoices');
    group.append(...elems);
  };
  const radios = (label: string, key: Key, props: Partial<RadioGroupProps<string>> = {}) =>
    createRadioGroup({
      id: RADIO_ID(label),
      label,
      target: settings,
      key,
      options: options('Easy', 'Normal', 'Hard'),
      onChange: report(label),
      ...props,
    } as RadioGroupProps<string>).cmp.elem;
  const segments = (label: string, key: Key, props: Partial<SegmentedControlProps<string>>) =>
    createSegmentedControl({
      id: RADIO_ID(label),
      label,
      target: settings,
      key,
      options: [],
      onChange: report(label),
      ...props,
    } as SegmentedControlProps<string>).cmp.elem;

  row(
    'A radio group: a column, with a hint',
    radios('Difficulty', 'difficulty', { hint: 'Changes how hard the enemies hit' })
  );
  row(
    'A row; one option disabled',
    radios('Shadows', 'shadows', {
      orientation: 'horizontal',
      options: [
        ...options('Off', 'Low', 'High'),
        { value: 'ultra', label: 'Ultra', disabled: true },
      ],
    })
  );
  row(
    'A segmented control: text, filling the width',
    segments('Camera', 'camera', { options: options('Orbit', 'Follow', 'Free'), fill: true })
  );
  row(
    'Icons alone: their names in tooltips',
    segments('Simulation', 'simulation', {
      options: [
        { value: 'play', label: 'Play', icon: getSvgIcon('playFill'), iconOnly: true },
        { value: 'pause', label: 'Pause', icon: getSvgIcon('pause'), iconOnly: true },
        { value: 'stop', label: 'Stop', icon: getSvgIcon('stop'), iconOnly: true },
      ],
    })
  );
  row(
    'Disabled',
    radios('Mode', 'difficulty', { disabled: true, orientation: 'horizontal' }),
    segments('Quality', 'quality', { options: options('Low', 'High'), disabled: true })
  );
  root.append(status);
};

// --- Select field ---

const SELECT_ID = (name: string) => `${ID_PREFIX}Select${name}`;
const SPAWN_POINTS = ['Harbour', 'Lighthouse', 'Mill', 'Quarry', 'Ridge', 'Square', 'Tower'];

/** In the page: select fields in Tweakpane's two option forms, a searchable one over a getter's
 * list that a kit button grows, the placeholder, an error and disabled, bound to one object; each
 * pick in the box's status line */
const initSelectFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = SELECT_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const settings = {
    shadowMap: 1024,
    toneMapping: 'aces',
    spawn: 'mill',
    material: 'missing',
    preset: 'medium',
  };
  const report = (label: string) => (value: SelectValue) => {
    status.textContent = `${label}: ${value}`;
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const spawnPoints = [...SPAWN_POINTS];

  row(
    'Tweakpane’s object form: number values',
    createSelectField({
      id: SELECT_ID('ShadowMap'),
      label: 'Shadow map',
      target: settings,
      key: 'shadowMap',
      options: { '512': 512, '1024': 1024, '2048': 2048, '4096': 4096 },
      onChange: report('Shadow map'),
    }).cmp.elem
  );
  row(
    'The array form, with a hint',
    createSelectField({
      id: SELECT_ID('ToneMapping'),
      label: 'Tone mapping',
      target: settings,
      key: 'toneMapping',
      options: [
        { text: 'None', value: 'none' },
        { text: 'Linear', value: 'linear' },
        { text: 'ACES Filmic', value: 'aces' },
        { text: 'AgX', value: 'agx' },
      ],
      hint: 'How the HDR image is mapped to the screen',
      onChange: report('Tone mapping'),
    }).cmp.elem
  );
  const spawn = createSelectField({
    id: SELECT_ID('Spawn'),
    label: 'Spawn point',
    target: settings,
    key: 'spawn',
    options: () => spawnPoints.map((name) => ({ text: name, value: name.toLowerCase() })),
    searchable: true,
    searchPlaceholder: 'Filter places',
    onChange: report('Spawn point'),
  });
  const add = createButton({
    id: SELECT_ID('Add'),
    label: 'Add a place, then refresh()',
    onClick: () => {
      spawnPoints.push(`Camp ${spawnPoints.length - SPAWN_POINTS.length + 1}`);
      spawn.refresh();
    },
  });
  row('Searchable, its options a getter’s', spawn.cmp.elem, add.cmp.elem);
  row(
    'A value no option has: the placeholder',
    createSelectField({
      label: 'Material',
      target: settings,
      key: 'material',
      options: { Metal: 'metal', Wood: 'wood' },
      placeholder: 'Pick a material',
      onChange: report('Material'),
    }).cmp.elem
  );
  const invalid = createSelectField({
    label: 'Preset',
    target: settings,
    key: 'preset',
    options: { Low: 'low', Medium: 'medium', High: 'high' },
  });
  invalid.setError('Not supported on this device');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createSelectField({
      label: 'Locked',
      value: 'medium',
      options: { Low: 'low', Medium: 'medium' },
      disabled: true,
    }).cmp.elem
  );
  root.append(status);
};

// --- Text field ---

const TEXT_ID = (name: string) => `${ID_PREFIX}Text${name}`;
const SEARCH_WORDS = ['Asteroid', 'Comet', 'Galaxy', 'Meteor', 'Moon', 'Nebula', 'Planet', 'Star'];

/** In the page: the fields bound to one object, each write in the box's status line; the search
 * field filters a list of words as you type */
const initTextFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = TEXT_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const profile = {
    name: 'Ada',
    title: 'Pilot',
    notes: 'Line one\nLine two',
    query: '',
    code: 'x',
  };
  const report = (label: string) => (value: string, change: { last: boolean }) => {
    status.textContent = `${label}: "${value.replace(/\n/g, ' / ')}" (${change.last ? 'last' : 'step'})`;
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
    return group;
  };
  const make = (name: string, key: keyof typeof profile, props: Partial<TextFieldProps> = {}) =>
    createTextField({
      id: TEXT_ID(name),
      label: name,
      target: profile,
      key,
      onChange: report(name),
      ...props,
    } as TextFieldProps).cmp.elem;

  row(
    'Written on Enter or a blur; a hint and a maximum length',
    make('Name', 'name', {
      hint: 'Up to 24 characters',
      maxLength: 24,
    })
  );
  row('Live: each keystroke writes', make('Title', 'title', { live: true }));
  row(
    'Multiline (4 rows): Ctrl/⌘+Enter or a blur writes',
    make('Notes', 'notes', {
      multiline: true,
      rows: 4,
    })
  );
  const results = document.createElement('p');
  results.id = TEXT_ID('Results');
  // Under the field, across the row
  results.className = 'hubDemoLine hubDemoFieldNote';
  const showResults = (query: string) => {
    const matches = SEARCH_WORDS.filter((word) => word.toLowerCase().includes(query.toLowerCase()));
    results.textContent = `${matches.length} of ${SEARCH_WORDS.length}: ${matches.join(', ') || 'none'}`;
  };
  showResults('');
  row(
    'Search: the list filters 250 ms after typing, at once on Enter or a clear',
    make('Search', 'query', {
      type: 'search',
      labelHidden: true,
      placeholder: 'Filter the words',
      onSearch: showResults,
    }),
    results
  );
  const code = createTextField({
    id: TEXT_ID('Code'),
    label: 'Code',
    target: profile,
    key: 'code',
    onChange: report('Code'),
  });
  code.setError('Codes are 6 characters');
  const disabled = createTextField({
    id: TEXT_ID('Disabled'),
    label: 'Disabled',
    value: 'Read me',
    disabled: true,
  });
  row('An error, and disabled', code.cmp.elem, disabled.cmp.elem);
  root.append(status);
};

// --- Checkbox and switch ---

const TOGGLE_ID = (name: string) => `${ID_PREFIX}Toggle${name}`;

/** In the page: checkboxes (a mixed one over three), switches and disabled ones, each write in
 * the box's status line */
const initCheckboxDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = TOGGLE_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (on: boolean) => {
    status.textContent = `${label}: ${on ? 'on' : 'off'}`;
  };
  const settings = { shadows: true, fog: false, vsync: true, music: false };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };

  row(
    'Checkboxes',
    createCheckbox({
      id: TOGGLE_ID('Shadows'),
      label: 'Shadows',
      target: settings,
      key: 'shadows',
      onChange: report('Shadows'),
    }).cmp.elem,
    createCheckbox({
      id: TOGGLE_ID('Fog'),
      label: 'Fog',
      target: settings,
      key: 'fog',
      onChange: report('Fog'),
    }).cmp.elem
  );

  // A mixed checkbox over three: it shows mixed while some are on, and sets them all
  const layers = { terrain: true, water: false, clouds: true };
  const names = Object.keys(layers) as (keyof typeof layers)[];
  const count = () => names.filter((name) => layers[name]).length;
  const children = names.map((name) =>
    createCheckbox({
      id: TOGGLE_ID(name),
      label: name[0].toUpperCase() + name.slice(1),
      target: layers,
      key: name,
      onChange: (on) => {
        report(name)(on);
        syncAll();
      },
    })
  );
  const all = createCheckbox({
    id: TOGGLE_ID('All'),
    label: 'All layers',
    get: () => count() === names.length,
    set: (on) => {
      for (const name of names) layers[name] = on;
      for (const child of children) child.refresh();
    },
    onChange: report('All layers'),
  });
  const syncAll = () => {
    all.refresh();
    all.setIndeterminate(count() > 0 && count() < names.length);
  };
  syncAll();
  const nested = document.createElement('div');
  nested.className = 'hubDemoNestedToggles';
  nested.append(...children.map((child) => child.cmp.elem));
  row('Mixed: “All layers” over three', all.cmp.elem, nested);

  row(
    'Switches: one with its state as text',
    createSwitch({
      id: TOGGLE_ID('Vsync'),
      label: 'V-sync',
      target: settings,
      key: 'vsync',
      onText: 'On',
      offText: 'Off',
      onChange: report('V-sync'),
    }).cmp.elem,
    createSwitch({
      id: TOGGLE_ID('Music'),
      label: 'Music',
      target: settings,
      key: 'music',
      onChange: report('Music'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createCheckbox({ label: 'Checked, disabled', value: true, disabled: true }).cmp.elem,
    createCheckbox({ label: 'Off, disabled', value: false, disabled: true }).cmp.elem,
    createSwitch({ label: 'Switch, disabled', value: true, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Monitor ---

const MONITOR_ID = (name: string) => `${ID_PREFIX}Monitor${name}`;

/** In the page: monitors of a small simulation's values on one scheduler, which a kit button
 * steps (the tick draws them, no flash); one read only by the scheduler's refresh (`interval:
 * 'refresh'`, p806 D4) with its Refresh button; `readonly: true` on each field; a multiline
 * block, a hint and a disabled one */
const initMonitorDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const sim = {
    frameMs: 16.4,
    bodies: 128,
    paused: false,
    state: 'Running',
    position: { x: 1.25, y: 0, z: -3.5 },
    log: 'Loaded scene “Harbour”\nSpawned 128 bodies\nPhysics on the worker thread',
  };
  let steps = 0;
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const monitor = (name: string, props: Partial<MonitorProps<unknown>>, idName = name) =>
    createMonitor({
      id: MONITOR_ID(idName),
      label: name,
      scheduler,
      ...props,
    } as MonitorProps<unknown>).cmp.elem;

  const step = createButton({
    id: MONITOR_ID('Step'),
    label: 'Step the simulation',
    onClick: () => {
      steps++;
      sim.frameMs = 16.4 + (steps % 3) * 0.8;
      sim.bodies = 128 + steps * 4;
      sim.paused = steps % 2 === 1;
      sim.state = sim.paused ? 'Paused' : 'Running';
      sim.position.y = steps * 0.5;
      sim.log += `\nStep ${steps}: ${sim.bodies} bodies`;
    },
  });
  row(
    'Read on the tick: a kit button changes the values',
    monitor('Frame time', { target: sim, key: 'frameMs', precision: 1, unit: 'ms', interval: 0 }),
    monitor('Bodies', { target: sim, key: 'bodies', precision: 0 }),
    monitor('Paused', { target: sim, key: 'paused' }),
    monitor('State', { target: sim, key: 'state' }),
    monitor('Position', { target: sim, key: 'position', precision: 2 }),
    step.cmp.elem
  );
  const refresh = createButton({
    id: MONITOR_ID('Refresh'),
    label: 'Refresh',
    onClick: () => scheduler.refresh(),
  });
  row(
    "interval: 'refresh': read only by its host's refresh, never the tick",
    monitor(
      'Bodies on refresh',
      { target: sim, key: 'bodies', precision: 0, interval: 'refresh' },
      'BodiesOnRefresh'
    ),
    refresh.cmp.elem
  );
  row(
    'Multiline: a block of lines, a tab stop',
    monitor('Log', { target: sim, key: 'log', multiline: true, rows: 4 })
  );

  const options = [
    { value: 'easy', label: 'Easy' },
    { value: 'hard', label: 'Hard' },
  ];
  row(
    'readonly: true on each field',
    createNumberField({ label: 'Speed', value: 1.5, step: 0.1, unit: 'm/s', readonly: true }).cmp
      .elem,
    createSlider({
      label: 'Volume',
      value: 0.8,
      min: 0,
      max: 1,
      format: (value) => `${Math.round(value * 100)} %`,
      readonly: true,
    }).cmp.elem,
    createRangeSlider({
      label: 'Price',
      value: { min: 40, max: 120 },
      min: 0,
      max: 200,
      step: 10,
      unit: '€',
      readonly: true,
    }).cmp.elem,
    createCheckbox({ label: 'Shadows', value: true, readonly: true }).cmp.elem,
    createSwitch({ label: 'V-sync', value: false, readonly: true }).cmp.elem,
    createSegmentedControl({ label: 'Difficulty', value: 'hard', options, readonly: true }).cmp
      .elem,
    createSelectField({
      label: 'Shadow map',
      value: 1024,
      options: { '512': 512, '1024': 1024, '2048': 2048 },
      readonly: true,
    }).cmp.elem,
    createTextField({ label: 'Name', value: 'Ada', readonly: true }).cmp.elem
  );
  row(
    'A hint, and disabled',
    monitor('Draw calls', { value: 42, precision: 0, hint: 'Counted after the last frame' }),
    monitor('Disabled', { value: 'Off', disabled: true })
  );
};

/** The fields group's demos by their box's key (`data-hub-demo`) */
export const FIELDS_DEMOS: Record<string, Demo> = {
  dropDown: initDropDownDemo,
  numberField: initNumberFieldDemo,
  slider: initSliderDemo,
  rangeSlider: initRangeSliderDemo,
  radioGroup: initRadioGroupDemo,
  selectField: initSelectFieldDemo,
  textField: initTextFieldDemo,
  checkbox: initCheckboxDemo,
  monitor: initMonitorDemo,
};
