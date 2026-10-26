/**
 * The component library's demos (p802 D9; public since p803 Phase 8): a chunk `hub.ts` imports on
 * a page with a `[data-hub-demo]` box, in both modes: the public library page
 * (`features/ui-kit/library/`), the dev one (`project/aekasha/components/`, the same boxes with
 * the notes for developing Ækasha) and the UI kit section's `::: demo` boxes. It uses
 * `aekasha/ui` without the engine: the Hub's script build resolves the kit's storage to its own
 * stand-in (`_kit/`, `devTools/hub/kitStandIns.ts`), and this makes the HUD root
 * (`createHudRoot`, which brings the kit's global styles), as the boot would.
 *
 * The root sits over the viewport, as in an app: each `[data-hub-demo]` box gets buttons that
 * open its piece's states there, and a library page's theme and density switches set its
 * attributes (elsewhere it follows the Hub's theme toggle, the page's `data-aek-theme`). A
 * piece drawn in the page (a key hint, an input glyph, a spinner) draws in a kit root of its own in its box
 * (`addKitRoot`, as an app's UI outside the HUD), which the switches set too.
 * The buttons and the windows' content are the page's (`.hubButton`, `.hubDemoPanel`), as an
 * app's content is the app's; everything else is the kit's.
 */
import {
  addPropertyGridItems,
  addToast,
  closeDraggableWindow,
  CMP,
  createBadge,
  createBindingScheduler,
  createButton,
  createButtonGroup,
  createCheckbox,
  createColorField,
  createDivider,
  createAngleDial,
  createDropDown,
  createEmptyState,
  createFieldset,
  createFolder,
  createForm,
  createGradientEditor,
  createHudRoot,
  createInputGlyph,
  createKbd,
  createLink,
  createLoadingOverlay,
  createMenu,
  createMonitor,
  createNumberField,
  createPad2D,
  createPopover,
  createProgressBar,
  createQuaternionField,
  createPropertyGrid,
  createRadioGroup,
  createRangeSlider,
  createRotationField,
  createSegmentedControl,
  createSelectField,
  createSkeleton,
  createSlider,
  createSpinner,
  createSplitButton,
  createSwitch,
  createTag,
  createTextField,
  createToaster,
  createTooltip,
  createVectorField,
  fitAllDraggableWindowsToScreen,
  getDraggableWindowsOfKind,
  getHUDRootCMP,
  getKindWindowId,
  getSvgIcon,
  openDialog,
  openDraggableWindow,
  registerBuiltInIcons,
  registerDraggableWindowKind,
  removeDraggableWindow,
  setRecentColors,
  toggleDraggableWindow,
  evaluateGradient,
} from 'aekasha/ui';
import type {
  BindingScheduler,
  BuiltInIconName,
  Button,
  ButtonProps,
  DialogProps,
  DropDownProps,
  Field,
  InputGlyphInput,
  MonitorProps,
  NumberFieldProps,
  RadioGroupProps,
  RangeSliderProps,
  SegmentedControlProps,
  SelectValue,
  SliderProps,
  TextFieldProps,
  OpenDraggableWindowProps,
  PropertyGridItem,
  ProgressBarProps,
  CMPHandle,
  Tooltip,
  TooltipProps,
} from 'aekasha/ui';

/** A demo: fills its box (`data-hub-demo="<key>"`) with the controls that open its states */
type Demo = (box: HTMLElement) => void;

/** Every id the demos give starts with it, so a demo never takes an id the kit uses */
const ID_PREFIX = 'hubDemo';
const DEFAULT_WINDOW_ID = `${ID_PREFIX}Window`;
/** The window the "Over a window" dialog opens over */
const BEHIND_DIALOG_ID = `${ID_PREFIX}BehindDialog`;
const KIND = `${ID_PREFIX}Kind`;
const TOASTER_ID = `${ID_PREFIX}Toaster`;
const TOP_TOASTER_ID = `${ID_PREFIX}TopToaster`;

/** The single windows and dialogs the demos opened, for "Close all" */
const openedIds = new Set<string>();
/** The kit roots the static demos draw in, which the page's switches set as they set the HUD root */
const kitRoots: HTMLElement[] = [];

// --- The page's parts ---

/** A labelled row of buttons in a demo box */
const addGroup = (box: HTMLElement, label: string) => {
  const group = document.createElement('div');
  group.className = 'hubComponentDemoGroup';
  const heading = document.createElement('p');
  heading.textContent = label;
  group.append(heading);
  box.append(group);
  return group;
};

/** A Hub button (the controls are the page's; what they open is the kit's) */
const addButton = (parent: HTMLElement, label: string, onClick: () => void) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hubButton';
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
};

/** A kit root in a demo box (`aekUi`, as an app's own UI outside the HUD), for a piece drawn in
 * the page rather than opened over it */
const addKitRoot = (box: HTMLElement) => {
  const root = document.createElement('div');
  root.className = 'aekUi hubDemoKitRoot';
  box.append(root);
  kitRoots.push(root);
  return root;
};

/** A window's content: paragraphs in the page's padding */
const createPanel = (...texts: string[]) => {
  const panel = CMP({ class: 'hubDemoPanel' });
  for (const text of texts) panel.add({ tag: 'p', text });
  return panel;
};

/** A button inside a window's content (a CMP: it goes under the window) */
const addPanelButton = (panel: CMPHandle, text: string, onClick: () => void) =>
  panel.add({ tag: 'button', class: 'hubButton', text, attr: { type: 'button' }, onClick });

// --- Draggable window ---

const DEFAULT_WINDOW: OpenDraggableWindowProps = {
  id: DEFAULT_WINDOW_ID,
  title: 'A window',
  content: () =>
    createPanel(
      'Opened with the defaults: 320 × 320 px at the screen’s centre. Drag it by its header, resize it from an edge or its corner, collapse or close it; a double-click on the header fits it to the screen.',
      'Closed, it keeps its place and size: open it again and it comes back where you left it.'
    ),
};

/** Each a new window on every open (`removeOnClose`), so a state always starts as its props say */
const WINDOW_STATES: { label: string; props: Omit<OpenDraggableWindowProps, 'id'> }[] = [
  {
    label: 'With an icon',
    props: {
      title: 'Settings',
      icon: 'gear',
      content: () => createPanel('A registered icon’s name before the title (icon).'),
    },
  },
  {
    label: 'Opens collapsed',
    props: {
      title: 'Collapsed',
      isCollapsed: true,
      content: () => createPanel('Opened collapsed (isCollapsed): its header only.'),
    },
  },
  {
    label: 'Fixed',
    props: {
      title: 'Fixed',
      size: { w: 280, h: 160 },
      disableDragging: true,
      disableVertResize: true,
      disableHoriResize: true,
      disableCollapseBtn: true,
      content: () =>
        createPanel('No drag, no resize and no collapse button: only its close button.'),
    },
  },
  {
    label: 'Long content',
    props: {
      title: 'Long content',
      size: { w: 320, h: 220 },
      content: () =>
        createPanel(
          ...Array.from(
            { length: 8 },
            (_, i) => `Paragraph ${i + 1}: the content scrolls inside the window.`
          )
        ),
    },
  },
  {
    label: 'With a backdrop',
    props: {
      title: 'Over a backdrop',
      size: { w: 320, h: 180 },
      hasBackDrop: true,
      backDropClickClosesWindow: true,
      content: () =>
        createPanel(
          'A backdrop covers the screen and takes its clicks (hasBackDrop); a click on it closes the window (backDropClickClosesWindow).'
        ),
    },
  },
];

let kindCount = 0;

const openWindowState = (index: number) => {
  const id = `${ID_PREFIX}WindowState${index}`;
  openedIds.add(id);
  openDraggableWindow({ id, removeOnClose: true, ...WINDOW_STATES[index].props });
};

/** The next window of the demo kind: it starts where the kind's last one was, cascaded */
const openKindWindow = () => {
  const n = ++kindCount;
  openDraggableWindow({
    id: getKindWindowId(KIND, String(n)),
    kind: KIND,
    data: { n },
    title: `Kind window ${n}`,
    size: { w: 280, h: 160 },
  });
};

const removeAllWindows = () => {
  for (const id of [DEFAULT_WINDOW_ID, ...openedIds]) removeDraggableWindow(id);
  openedIds.clear();
  for (const { id } of getDraggableWindowsOfKind(KIND)) removeDraggableWindow(id);
};

const initWindowDemo: Demo = (box) => {
  registerDraggableWindowKind(KIND, {
    content: (data) =>
      createPanel(
        `Window ${String(data?.n)} of a kind: each is built from its data by the content function the kind registered. Closing it removes it.`
      ),
  });
  const states = addGroup(box, 'States');
  addButton(states, 'Default', () => openDraggableWindow(DEFAULT_WINDOW));
  WINDOW_STATES.forEach(({ label }, i) => addButton(states, label, () => openWindowState(i)));
  const behaviour = addGroup(box, 'Behaviour');
  addButton(behaviour, 'Toggle the default', () => toggleDraggableWindow(DEFAULT_WINDOW));
  addButton(behaviour, 'Open a window of a kind', openKindWindow);
  addButton(behaviour, 'Fit all to the screen', () => fitAllDraggableWindowsToScreen());
  addButton(behaviour, 'Close all', removeAllWindows);
};

// --- Dialog ---

type DialogState = {
  label: string;
  props: Pick<
    DialogProps,
    'closeOnEscape' | 'backDropClickClosesWindow' | 'alert' | 'initialFocus'
  >;
  text: string;
  hasDropDown?: boolean;
  /** Its buttons (default one: OK), each closing it */
  buttons?: string[];
  /** Opens a window first, which the dialog makes inert */
  overWindow?: boolean;
};

const DIALOG_STATES: DialogState[] = [
  {
    label: 'Default',
    props: {},
    text: 'Centred over a backdrop: it doesn’t move, resize or collapse, and every open resets it. Its close button or the content’s own button closes it.',
  },
  {
    label: 'Closes on Escape',
    props: { closeOnEscape: true },
    text: 'closeOnEscape: Escape pressed in it closes it, and nothing else on the page gets that press. Escape pressed outside the HUD is the page’s.',
  },
  {
    label: 'Backdrop click closes it',
    props: { backDropClickClosesWindow: true },
    text: 'backDropClickClosesWindow: a click outside it closes it.',
  },
  {
    label: 'With a drop-down',
    props: { closeOnEscape: true },
    text: 'A drop-down in a dialog, as the uiKit embed opens it. Open its list and press Escape: the first press closes the list, the next the dialog.',
    hasDropDown: true,
  },
  {
    label: 'Alert',
    props: { alert: true, initialFocus: '.hubDemoCancel' },
    text: 'alert: a question that needs an answer (role="alertdialog"). initialFocus puts the focus on Cancel, the safe choice; Tab and Shift+Tab stay inside the dialog.',
    buttons: ['Cancel', 'Delete'],
  },
  {
    label: 'Over a window',
    props: { closeOnEscape: true },
    text: 'While a dialog is open the rest of the HUD is inert: the window behind it takes no click or focus until it closes.',
    overWindow: true,
  },
];

const openDialogState = (index: number) => {
  const { label, props, text, hasDropDown, buttons = ['OK'], overWindow } = DIALOG_STATES[index];
  const id = `${ID_PREFIX}Dialog${index}`;
  openedIds.add(id);
  if (overWindow) {
    openedIds.add(BEHIND_DIALOG_ID);
    openDraggableWindow({
      id: BEHIND_DIALOG_ID,
      title: 'Behind the dialog',
      position: { x: 48, y: 48 },
      size: { w: 280, h: 160 },
      removeOnClose: true,
      focusFirstElement: false,
      content: () => createPanel('Inert while the dialog is open: try a click or Tab.'),
    });
  }
  openDialog({
    id,
    title: label === 'Default' ? 'A dialog' : label,
    size: { w: 360, h: hasDropDown ? 260 : 220 },
    ...props,
    content: () => {
      const panel = createPanel(text);
      if (hasDropDown) panel.add(createDemoDropDown({ title: 'Colour' }).cmp);
      for (const text of buttons) {
        addPanelButton(panel, text, () => closeDraggableWindow(id)).updateClass(
          `hubDemo${text}`,
          'add'
        );
      }
      return panel;
    },
  });
};

const initDialogDemo: Demo = (box) => {
  const states = addGroup(box, 'States');
  DIALOG_STATES.forEach(({ label }, i) => addButton(states, label, () => openDialogState(i)));
};

// --- Drop-down ---

const COLOURS = ['Orange', 'Teal', 'Gold', 'Violet'].map((label) => ({
  value: label.toLowerCase(),
  label,
}));

/** A drop-down whose pick is its value (from `initial`), shown in a toast */
const createDemoDropDown = (
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

// --- Number field stress (the dev page's: p804 D14's perf pass) ---

const STRESS_COUNT = 200;
/** The frames the readout averages: about 2 s at 60 Hz */
const STRESS_FRAMES = 120;

/** A field the stress boxes make: the `index`th, bound to `target.value`, with `interval: 0` */
type StressField = (
  index: number,
  target: { value: number },
  scheduler: BindingScheduler
) => Field<number>;

/** 200 fields of one kind with `interval: 0` in one scheduler, bound to values that change every
 * frame or stay: the tick's cost, read from the frame times in the readout or a profile */
const createStressDemo =
  (name: string, makeField: StressField): Demo =>
  (box) => {
    const controls = addGroup(box, 'Run');
    const root = addKitRoot(box);
    const readout = document.createElement('p');
    readout.id = `${ID_PREFIX}${name}Readout`;
    readout.className = 'hubDemoLine';
    readout.textContent = 'Stopped';
    root.append(readout);
    const values = Array.from({ length: STRESS_COUNT }, (_, i) => ({ value: i / 100 }));
    const scheduler = createBindingScheduler({ visible: false });
    const grid = document.createElement('div');
    grid.className = 'hubDemoStressGrid';
    for (let i = 0; i < STRESS_COUNT; i++) {
      grid.append(makeField(i, values[i], scheduler).cmp.elem);
    }
    root.append(grid);

    let isChanging = false;
    let frame: number | null = null;
    const deltas = new Float64Array(STRESS_FRAMES);
    let count = 0;
    let last = 0;
    let lastReadout = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (isChanging) {
        for (let i = 0; i < STRESS_COUNT; i++) {
          values[i].value = Math.round(Math.sin(now / 500 + i) * 10000) / 100;
        }
      }
      if (last) deltas[count++ % STRESS_FRAMES] = now - last;
      last = now;
      if (now - lastReadout < 500 || count < STRESS_FRAMES) return;
      lastReadout = now;
      let sum = 0;
      let worst = 0;
      for (let i = 0; i < STRESS_FRAMES; i++) {
        sum += deltas[i];
        worst = Math.max(worst, deltas[i]);
      }
      readout.textContent = `${isChanging ? 'Changing' : 'Steady'}: frames ${(sum / STRESS_FRAMES).toFixed(1)} ms on average, ${worst.toFixed(1)} ms at worst (last ${STRESS_FRAMES})`;
    };
    const run = (changing: boolean) => {
      isChanging = changing;
      count = 0;
      last = 0;
      scheduler.setVisible(true);
      if (frame === null) frame = requestAnimationFrame(loop);
    };
    addButton(controls, 'Values change every frame', () => run(true));
    addButton(controls, 'Values stay', () => run(false));
    addButton(controls, 'Stop', () => {
      scheduler.setVisible(false);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      readout.textContent = 'Stopped';
    });
  };

const initNumberFieldStressDemo = createStressDemo('Stress', (i, target, scheduler) =>
  createNumberField({
    label: `Value ${i + 1}`,
    target,
    key: 'value',
    step: 0.01,
    interval: 0,
    scheduler,
  })
);

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

// --- Colour field ---

const COLOR_ID = (name: string) => `${ID_PREFIX}Color${name}`;
const COLOR_PALETTE = ['#9fb4c7', '#d7c4a3', '#3a4a5c', '#e07a5f', '#81b29a', '#f2cc8f'];

/** In the page: colour fields in each of the three forms, each write in the box's status line; a
 * kit button changes the sun from outside and refreshes (the flash); the recent colours seeded as
 * an owner would restore them */
const initColorFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = COLOR_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  /** A value as the status line says it: a number in hex, an object's floats to 3 decimals */
  const sayColor = (value: unknown) => {
    if (typeof value === 'number') return `0x${value.toString(16).padStart(6, '0')}`;
    if (typeof value === 'object' && value) {
      return Object.values(value as Record<string, number>)
        .map((channel) => channel.toFixed(3))
        .join(', ');
    }
    return String(value);
  };
  const report = (label: string) => (value: unknown, change: { last: boolean }) => {
    status.textContent = `${label}: ${sayColor(value)} (${change.last ? 'last' : 'step'})`;
  };
  setRecentColors(['#ffd166', '#06d6a0', '#118ab2']);
  // A THREE.Color's shape: linear floats, written in place
  const scene = { fog: 0x9fb4c7, tint: '#3fd8f280', sun: { r: 1, g: 0.6, b: 0.3 }, intensity: 3 };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
    return group;
  };
  const fog = createColorField({
    id: COLOR_ID('Fog'),
    label: 'Fog',
    target: scene,
    key: 'fog',
    palette: COLOR_PALETTE,
    hint: 'A 24-bit number, as getHex() gives',
    scheduler,
    onChange: report('Fog'),
  });
  const fogRow = row('A number, with a palette and the recent colours', fog.cmp.elem);
  addButton(fogRow, 'The fog’s panel open', () =>
    fog.cmp.elem.querySelector<HTMLElement>('.aekColorField__swatch')?.click()
  );
  const tint = createColorField({
    id: COLOR_ID('Tint'),
    label: 'Tint',
    target: scene,
    key: 'tint',
    scheduler,
    onChange: report('Tint'),
  });
  const tintRow = row('A hex string with alpha', tint.cmp.elem);
  addButton(tintRow, 'The tint’s panel open', () =>
    tint.cmp.elem.querySelector<HTMLElement>('.aekColorField__swatch')?.click()
  );
  const sun = createColorField({
    id: COLOR_ID('Sun'),
    label: 'Sun',
    target: scene,
    key: 'sun',
    colorSpace: 'linear',
    intensity: {
      target: scene,
      key: 'intensity',
      min: 0,
      step: 0.1,
      onChange: (value, { last }) => {
        status.textContent = `Intensity: ${value} (${last ? 'last' : 'step'})`;
      },
    },
    scheduler,
    onChange: report('Sun'),
  });
  const change = createButton({
    id: COLOR_ID('Change'),
    label: 'Change the sun from outside',
    size: 'sm',
    onClick: () => {
      scene.sun = { r: 0.2, g: 0.4, b: 1 };
      scene.intensity = 1.5;
      scheduler.refresh();
    },
  });
  row('Linear floats (a THREE.Color) with an intensity', sun.cmp.elem, change.cmp.elem);
  const invalid = createColorField({ id: COLOR_ID('Invalid'), label: 'Accent', value: '#e07a5f' });
  invalid.setError('Too close to the background');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createColorField({ label: 'Locked', value: 0x3a4a5c, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Vector field ---

const VECTOR_ID = (name: string) => `${ID_PREFIX}Vector${name}`;

/** In the page: vector fields bound to one object, each write in the box's status line; a kit
 * button moves the position from outside and refreshes (the flash) */
const initVectorFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = VECTOR_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (value: unknown, change: { last: boolean }) => {
    const axes = Array.isArray(value) ? value : Object.values(value as Record<string, number>);
    status.textContent = `${label}: ${axes.join(', ')} (${change.last ? 'last' : 'step'})`;
  };
  // A mesh's shape: its position and scale, objects written in place
  const mesh = {
    position: { x: 1, y: 2, z: 3 },
    scale: { x: 1, y: 1, z: 1 },
    size: [1920, 1080],
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const move = createButton({
    id: VECTOR_ID('Move'),
    label: 'Move it from outside',
    size: 'sm',
    onClick: () => {
      mesh.position.x = -4;
      mesh.position.z = 0.5;
      scheduler.refresh();
    },
  });
  row(
    'An { x, y, z } object, step 0.1',
    createVectorField({
      id: VECTOR_ID('Position'),
      label: 'Position',
      target: mesh,
      key: 'position',
      step: 0.1,
      scheduler,
      onChange: report('Position'),
    }).cmp.elem,
    move.cmp.elem
  );
  row(
    'Linked: one axis scales the others',
    createVectorField({
      id: VECTOR_ID('Scale'),
      label: 'Scale',
      target: mesh,
      key: 'scale',
      min: 0.1,
      step: 0.1,
      linkable: true,
      linked: true,
      hint: 'The link toggle after the axes',
      onChange: report('Scale'),
    }).cmp.elem
  );
  row(
    'An array, each axis named, with its own rules',
    createVectorField({
      id: VECTOR_ID('Size'),
      label: 'Size',
      target: mesh,
      key: 'size',
      step: 1,
      unit: 'px',
      axes: { x: { label: 'W', min: 1 }, y: { label: 'H', min: 1 } },
      onChange: report('Size'),
    }).cmp.elem
  );
  row(
    'Four axes',
    createVectorField({
      id: VECTOR_ID('Raw'),
      label: 'Raw quaternion',
      target: mesh,
      key: 'quaternion',
      min: -1,
      max: 1,
      step: 0.01,
      onChange: report('Raw quaternion'),
    }).cmp.elem
  );
  const invalid = createVectorField({ id: VECTOR_ID('Invalid'), label: 'Spawn', value: [0, -50] });
  invalid.setError('Below the level');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createVectorField({ label: 'Locked', value: { x: 1, y: 1 }, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Rotation and quaternion fields ---

const ROTATION_ID = (name: string) => `${ID_PREFIX}Rotation${name}`;

/** In the page: an Euler and quaternions in degrees, each write in the box's status line (the
 * radians and components to 3 decimals); a kit button turns the facing from outside (the flash) */
const initRotationFieldDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = ROTATION_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (value: unknown, change: { last: boolean }) => {
    const parts = Object.values(value as Record<string, number | string>).map((part) =>
      typeof part === 'number' ? part.toFixed(3) : part
    );
    status.textContent = `${label}: ${parts.join(', ')} (${change.last ? 'last' : 'step'})`;
  };
  // A mesh's shape: a THREE.Euler's and a THREE.Quaternion's, written in place
  const body = {
    rotation: { x: 0, y: Math.PI / 4, z: 0, order: 'XYZ' },
    facing: { x: 0, y: 0, z: 0, w: 1 },
    spin: { x: 0, y: 0, z: 0, w: 1 },
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  row(
    'An Euler in degrees, its step π / 8 (Tweakpane’s), with its order',
    createRotationField({
      id: ROTATION_ID('Rotation'),
      label: 'Rotation',
      target: body,
      key: 'rotation',
      step: Math.PI / 8,
      showOrder: true,
      onChange: report('Rotation'),
    }).cmp.elem
  );
  const turn = createButton({
    id: ROTATION_ID('Turn'),
    label: 'Turn it from outside',
    size: 'sm',
    onClick: () => {
      // Half a turn about Y
      body.facing = { x: 0, y: 1, z: 0, w: 0 };
      scheduler.refresh();
    },
  });
  row(
    'A quaternion as Euler angles, its raw components under them',
    createQuaternionField({
      id: ROTATION_ID('Facing'),
      label: 'Facing',
      target: body,
      key: 'facing',
      showRaw: true,
      scheduler,
      onChange: report('Facing'),
    }).cmp.elem,
    turn.cmp.elem
  );
  row(
    'A quaternion as an axis and an angle',
    createQuaternionField({
      id: ROTATION_ID('Spin'),
      label: 'Spin',
      target: body,
      key: 'spin',
      edit: 'axisAngle',
      onChange: report('Spin'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createRotationField({
      label: 'Locked',
      value: { x: 0, y: Math.PI / 2, z: 0 },
      disabled: true,
    }).cmp.elem
  );
  root.append(status);
};

// --- Angle dial ---

const ANGLE_ID = (name: string) => `${ID_PREFIX}Angle${name}`;

/** In the page: dials in radians and in degrees, each write in the box's status line (to 3
 * decimals); a kit button turns the heading from outside (the flash) */
const initAngleDialDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = ANGLE_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (label: string) => (value: number, change: { last: boolean }) => {
    status.textContent = `${label}: ${Number(value.toFixed(3))} (${change.last ? 'last' : 'step'})`;
  };
  // A body's yaw in radians, a sun's azimuth in degrees
  const scene = { heading: Math.PI / 4, azimuth: 160, spin: 0, hatch: Math.PI / 6 };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const turn = createButton({
    id: ANGLE_ID('Turn'),
    label: 'Turn it from outside',
    size: 'sm',
    onClick: () => {
      scene.heading = -Math.PI / 2;
      scheduler.refresh();
    },
  });
  row(
    'Radians, its step π / 8 (Tweakpane’s): 0 at the right, anticlockwise',
    createAngleDial({
      id: ANGLE_ID('Heading'),
      label: 'Heading',
      target: scene,
      key: 'heading',
      step: Math.PI / 8,
      scheduler,
      onChange: report('Heading'),
    }).cmp.elem,
    turn.cmp.elem
  );
  row(
    'A compass in degrees, 0 to 360: 0 at the top, clockwise',
    createAngleDial({
      id: ANGLE_ID('Azimuth'),
      label: 'Sun azimuth',
      target: scene,
      key: 'azimuth',
      angleUnit: 'degrees',
      min: 0,
      max: 360,
      convention: 'compass',
      hint: 'Shift snaps a drag to 15°',
      onChange: report('Sun azimuth'),
    }).cmp.elem
  );
  row(
    'Without the spin button: the dial is the slider',
    createAngleDial({
      id: ANGLE_ID('Spin'),
      label: 'Spin',
      target: scene,
      key: 'spin',
      showInput: false,
      onChange: report('Spin'),
    }).cmp.elem
  );
  row(
    'Clamped to a quarter turn (no wrap)',
    createAngleDial({
      id: ANGLE_ID('Hatch'),
      label: 'Hatch angle',
      target: scene,
      key: 'hatch',
      min: 0,
      max: Math.PI / 2,
      wrap: false,
      onChange: report('Hatch angle'),
    }).cmp.elem
  );
  const invalid = createAngleDial({ label: 'Tilt', value: Math.PI / 3 });
  invalid.setError('Steeper than the slope allows');
  row(
    'An error, and disabled',
    invalid.cmp.elem,
    createAngleDial({ label: 'Locked', value: -Math.PI / 4, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- 2D pad ---

const PAD_ID = (name: string) => `${ID_PREFIX}Pad${name}`;

/** In the page: an offset with y up and a screen anchor with y down, each write in the box's
 * status line; a kit button moves the offset from outside (the flash) */
const initPad2DDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = PAD_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report =
    (label: string) => (value: { x: number; y: number }, change: { last: boolean }) => {
      const axes = [value.x, value.y].map((axis) => Number(axis.toFixed(3)));
      status.textContent = `${label}: ${axes.join(', ')} (${change.last ? 'last' : 'step'})`;
    };
  // A THREE.Vector2's shape, written in place
  const layout = { offset: { x: 0.25, y: -0.5 }, anchor: { x: 50, y: 25 } };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const move = createButton({
    id: PAD_ID('Move'),
    label: 'Move it from outside',
    size: 'sm',
    onClick: () => {
      layout.offset.x = -0.75;
      layout.offset.y = 0.75;
      scheduler.refresh();
    },
  });
  row(
    'An offset, -1 to 1 by 0.01, y up (the defaults)',
    createPad2D({
      id: PAD_ID('Offset'),
      label: 'Offset',
      target: layout,
      key: 'offset',
      scheduler,
      onChange: report('Offset'),
    }).cmp.elem,
    move.cmp.elem
  );
  row(
    'Screen coordinates: 0 to 100 px, y down',
    createPad2D({
      id: PAD_ID('Anchor'),
      label: 'Anchor',
      target: layout,
      key: 'anchor',
      min: 0,
      max: 100,
      step: 1,
      unit: 'px',
      invertY: true,
      hint: 'The arrows move the point; the axes type it',
      onChange: report('Anchor'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createPad2D({ label: 'Locked', value: { x: -0.5, y: 0.5 }, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Gradient editor ---

const GRADIENT_ID = (name: string) => `${ID_PREFIX}Gradient${name}`;

/** In the page: a sky ramp and a fade, each write in the box's status line (the stops), and the
 * ramp's colour at a quarter through `evaluateGradient`; a kit button shifts it from outside */
const initGradientEditorDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const status = document.createElement('p');
  status.id = GRADIENT_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const sample = document.createElement('p');
  sample.id = GRADIENT_ID('Sample');
  sample.className = 'hubDemoLine';
  const sampled = { r: 0, g: 0, b: 0, a: 1 };
  const byte = (channel: number) =>
    Math.round(channel * 255)
      .toString(16)
      .padStart(2, '0');
  const showSample = () => {
    evaluateGradient(sky.ramp, 0.25, sampled);
    sample.textContent = `evaluateGradient(ramp, 0.25): #${byte(sampled.r)}${byte(sampled.g)}${byte(sampled.b)}`;
  };
  const report =
    (label: string) =>
    (value: { stops: { t: number; color: string }[] }, change: { last: boolean }) => {
      const stops = value.stops.map((stop) => `${stop.color} ${Number(stop.t.toFixed(3))}`);
      status.textContent = `${label}: ${stops.join(', ')} (${change.last ? 'last' : 'step'})`;
      showSample();
    };
  // A sky's colours through the day, and a fade's alpha
  const sky = {
    ramp: {
      stops: [
        { t: 0, color: '#0b1d3a' },
        { t: 0.5, color: '#f2a65a' },
        { t: 1, color: '#9fd3ff' },
      ],
    },
    fade: {
      stops: [
        { t: 0, color: '#3fd8f200' },
        { t: 1, color: '#3fd8f2ff' },
      ],
    },
  };
  const row = (label: string, ...elems: HTMLElement[]) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoFields');
    group.append(...elems);
  };
  const shift = createButton({
    id: GRADIENT_ID('Shift'),
    label: 'Shift it from outside',
    size: 'sm',
    onClick: () => {
      sky.ramp.stops[1].t = 0.3;
      scheduler.refresh();
      showSample();
    },
  });
  row(
    'A sky ramp, three stops, with a palette',
    createGradientEditor({
      id: GRADIENT_ID('Sky'),
      label: 'Sky ramp',
      target: sky,
      key: 'ramp',
      palette: ['#0b1d3a', '#f2a65a', '#9fd3ff', '#ffffff'],
      scheduler,
      onChange: report('Sky ramp'),
    }).cmp.elem,
    shift.cmp.elem
  );
  row(
    'With alpha: a fade',
    createGradientEditor({
      id: GRADIENT_ID('Fade'),
      label: 'Fade',
      target: sky,
      key: 'fade',
      alpha: true,
      hint: 'A press on the bar adds a stop; Delete removes the focused one',
      onChange: report('Fade'),
    }).cmp.elem
  );
  row(
    'Disabled',
    createGradientEditor({
      label: 'Locked',
      value: {
        stops: [
          { t: 0, color: '#000000' },
          { t: 1, color: '#ffffff' },
        ],
      },
      disabled: true,
    }).cmp.elem
  );
  showSample();
  root.append(status, sample);
};

// --- Monitor ---

const MONITOR_ID = (name: string) => `${ID_PREFIX}Monitor${name}`;

/** In the page: monitors of a small simulation's values on one scheduler, which a kit button
 * steps (the tick draws them, no flash); `readonly: true` on each field; a multiline block, a
 * hint and a disabled one */
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
  const monitor = (name: string, props: Partial<MonitorProps<unknown>>) =>
    createMonitor({
      id: MONITOR_ID(name),
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

const initMonitorStressDemo = createStressDemo('MonitorStress', (i, target, scheduler) =>
  createMonitor({
    label: `Value ${i + 1}`,
    target,
    key: 'value',
    precision: 2,
    interval: 0,
    scheduler,
  })
);

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

// --- Tooltip ---

const TOOLTIPS_WINDOW_ID = `${ID_PREFIX}Tooltips`;
const TOOLTIP_ANCHORS: { label: string; side: NonNullable<TooltipProps['side']>; text: string }[] =
  [
    { label: 'Top', side: 'top', text: 'Above' },
    { label: 'Left', side: 'left', text: 'Left' },
    { label: 'Right', side: 'right', text: 'Right' },
    { label: 'Bottom', side: 'bottom', text: 'Below' },
    {
      label: 'Long text',
      side: 'bottom',
      text: 'A long tooltip wraps at about 32 characters a line and stays inside the HUD’s bounds: keep it to a sentence.',
    },
  ];
/** The open window's tooltips, by their anchor's label */
const tooltips = new Map<string, Tooltip>();

/** A window of buttons, each with a tooltip; `shown` are shown at once (no hover) */
const openTooltips = (shown: string[] = []) => {
  openedIds.add(TOOLTIPS_WINDOW_ID);
  openDraggableWindow({
    id: TOOLTIPS_WINDOW_ID,
    title: 'Tooltips',
    size: { w: 420, h: 300 },
    removeOnClose: true,
    content: () => {
      const panel = CMP({
        class: 'hubDemoPanel hubDemoTooltips',
        // Each tooltip goes with its anchor
        onRemoveCmp: () => {
          for (const tooltip of tooltips.values()) tooltip.cmp.remove();
          tooltips.clear();
        },
      });
      panel.add({ tag: 'p', text: 'Hover a button, or Tab to it. Escape hides the tooltip.' });
      // A compass: each side's tooltip has room there
      const compass = panel.add({ class: 'hubDemoTooltipCompass' });
      for (const { label, side, text } of TOOLTIP_ANCHORS) {
        const button = addPanelButton(compass, label, () => {});
        button.elem.dataset.area = label.toLowerCase().replace(/\s+/g, '');
        tooltips.set(label, createTooltip({ anchor: button.elem, text, side }));
      }
      return panel;
    },
  });
  for (const label of shown) tooltips.get(label)?.show();
};

const initTooltipDemo: Demo = (box) => {
  const states = addGroup(box, 'States');
  addButton(states, 'Open the tooltips', () => openTooltips());
  addButton(states, 'Shown on every side', () => openTooltips(['Top', 'Right', 'Bottom', 'Left']));
  addButton(states, 'A long text', () => openTooltips(['Long text']));
};

// --- Popover ---

const POPOVER_WINDOW_ID = `${ID_PREFIX}Popovers`;
const POPOVER_TRIGGER_ID = `${ID_PREFIX}PopoverTrigger`;

const initPopoverDemo: Demo = (box) => {
  const states = addGroup(box, 'States');
  addButton(states, 'Open the popover window', () => {
    openedIds.add(POPOVER_WINDOW_ID);
    openDraggableWindow({
      id: POPOVER_WINDOW_ID,
      title: 'Popover',
      size: { w: 340, h: 300 },
      removeOnClose: true,
      content: () => {
        let removePopover = () => {};
        const panel = CMP({
          class: 'hubDemoPanel',
          onRemoveCmp: () => removePopover(),
        });
        panel.add({
          tag: 'p',
          text: 'Its trigger opens and closes it. The focus moves in; Escape, a press outside or Tab past its end closes it.',
        });
        const trigger = addPanelButton(panel, 'Filters', () => {});
        trigger.elem.id = POPOVER_TRIGGER_ID;
        const popover = createPopover({
          anchor: trigger.elem,
          label: 'Filters',
          content: () => {
            const content = createPanel('Interactive content: buttons, fields, links.');
            content.updateClass('hubDemoPopover', 'add');
            addPanelButton(content, 'Apply', () => popover.close());
            addPanelButton(content, 'Reset', () => {});
            return content;
          },
        });
        removePopover = () => popover.cmp.remove();
        return panel;
      },
    });
  });
};

// --- Toaster ---

const TOASTS: { label: string; toast: Parameters<typeof addToast>[0] }[] = [
  { label: 'Info', toast: { message: 'Just so you know.' } },
  { label: 'Success', toast: { type: 'success', message: 'Done.' } },
  { label: 'Warning', toast: { type: 'warning', message: 'Careful now.' } },
  { label: 'Alert', toast: { type: 'alert', message: 'That didn’t work. Alerts stay closable.' } },
  { label: 'With a title', toast: { title: 'Saved', message: 'The scene was written to disk.' } },
  {
    label: 'Until closed',
    toast: {
      message: 'Shows until its close button (showingTime: 0).',
      showingTime: 0,
      isClosable: true,
    },
  },
  {
    label: 'Long message',
    toast: {
      type: 'warning',
      message:
        'A long message wraps inside the toast’s width (200 px by default) and scrolls inside its maximum height, 100 px, its close button in a column of its own: write a toast as one short sentence.',
      isClosable: true,
    },
  },
];

const initToasterDemo: Demo = (box) => {
  const hud = getHUDRootCMP();
  hud.add(createToaster({ id: TOASTER_ID }));
  hud.add(
    createToaster({
      id: TOP_TOASTER_ID,
      settings: {
        verticalPosition: 'top',
        horizontalPosition: 'right',
        toastDirection: 'down',
        toastAppearFromDirection: 'right',
        offset: { x: '-16px', y: '80px' },
      },
    })
  );
  const states = addGroup(box, 'The default toaster (bottom left)');
  for (const { label, toast } of TOASTS) {
    addButton(states, label, () => addToast({ ...toast, toasterId: TOASTER_ID }));
  }
  const top = addGroup(box, 'Another toaster (top right)');
  addButton(top, 'Info', () =>
    addToast({ message: 'Its own settings: down from the top right.', toasterId: TOP_TOASTER_ID })
  );
};

// --- Icons ---

const ICON_SAMPLES: BuiltInIconName[] = ['gear', 'info', 'warning', 'alert', 'undo', 'x'];

/** HTML into the page itself (`<html>` is a kit root): an icon needs no HUD root */
const initIconsDemo: Demo = (box) => {
  const icons = addGroup(box, 'At 1em: they follow their text');
  for (const name of ICON_SAMPLES) {
    const cell = document.createElement('span');
    cell.className = 'hubDemoIcon';
    cell.title = name;
    cell.innerHTML = getSvgIcon(name);
    icons.append(cell);
  }
  const sizes = addGroup(box, 'The sizes: sm, md and lg (--aek-icon-size-*)');
  for (const size of ['sm', 'md', 'lg'] as const) {
    const cell = document.createElement('span');
    cell.className = 'hubDemoIcon';
    cell.title = size;
    cell.innerHTML = getSvgIcon('gear', size);
    sizes.append(cell);
  }
  const inText = addGroup(box, 'In a button, 1em with its text');
  const button = addButton(inText, '', () => {});
  button.classList.add('hubDemoIconButton');
  button.innerHTML = `${getSvgIcon('undo')}Undo`;
  const missing = addGroup(box, 'Not registered (a warning in the console, once)');
  const cell = document.createElement('span');
  cell.className = 'hubDemoIcon';
  cell.innerHTML = getSvgIcon('notRegistered');
  missing.append(cell);
};

// --- Button ---

const BUTTON_ID = (name: string) => `${ID_PREFIX}Button${name}`;
/** How long the Save button loads after a click */
const SAVE_LOADING_MS = 1500;

/** In the page: the buttons draw in their rows, and what they do shows in the box's status line */
const initButtonDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = BUTTON_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (text: string) => (status.textContent = text);
  const counts = new Map<string, number>();
  /** A button whose click (a toggle's change aside) is counted in the status line */
  const make = (name: string, props: ButtonProps) =>
    createButton({
      id: BUTTON_ID(name),
      onClick:
        props.pressed === undefined
          ? () => {
              const n = (counts.get(props.label) ?? 0) + 1;
              counts.set(props.label, n);
              report(`${props.label} clicked (${n})`);
            }
          : undefined,
      ...props,
    });
  const row = (label: string, ...buttons: Button[]) => {
    const group = addGroup(root, label);
    for (const button of buttons) group.append(button.cmp.elem);
  };
  const toggled = (label: string) => (pressed: boolean) =>
    report(`${label}: ${pressed ? 'on' : 'off'}`);

  row(
    'Variants',
    make('Primary', { label: 'Primary', variant: 'primary' }),
    make('Secondary', { label: 'Secondary' }),
    make('Ghost', { label: 'Ghost', variant: 'ghost' }),
    make('Danger', { label: 'Danger', variant: 'danger' }),
    make('Link', { label: 'Link', variant: 'link' })
  );
  row(
    'Sizes: sm, md and lg',
    make('Small', { label: 'Small', size: 'sm' }),
    make('Medium', { label: 'Medium' }),
    make('Large', { label: 'Large', size: 'lg' })
  );
  row(
    'With an icon: at the start, at the end, and only an icon (its label the name and tooltip)',
    make('Undo', { label: 'Undo', icon: getSvgIcon('undo') }),
    make('Redo', { label: 'Redo', icon: getSvgIcon('redo'), iconPosition: 'end' }),
    make('Settings', { label: 'Settings', icon: getSvgIcon('gear'), iconOnly: true })
  );
  const save: Button = make('Save', {
    label: 'Save',
    variant: 'primary',
    kbd: createKbd({ keys: 'Ctrl+S' }),
    onClick: () => {
      save.setLoading(true);
      report('Saving…');
      setTimeout(() => {
        save.setLoading(false);
        report('Saved');
      }, SAVE_LOADING_MS);
    },
  });
  row('A shortcut’s hint; a click loads for 1.5 s', save);
  const uploading = make('Uploading', { label: 'Uploading' });
  uploading.setLoading(true);
  row('Disabled, and loading', make('Disabled', { label: 'Disabled', disabled: true }), uploading);
  row(
    'Toggles (aria-pressed)',
    make('Mute', { label: 'Mute', pressed: false, onPressedChange: toggled('Mute') }),
    make('Grid', {
      label: 'Grid',
      icon: getSvgIcon('spatialGrid'),
      pressed: true,
      onPressedChange: toggled('Grid'),
    })
  );
  row(
    'Hold to confirm (800 ms)',
    make('Delete', {
      label: 'Delete save',
      variant: 'danger',
      holdToConfirmMs: 800,
      onClick: () => report('Deleted (held)'),
      // A screen reader's browse mode clicks with no press: the app confirms another way
      onUnheldClick: () => report('A click with no hold: the app asks to confirm'),
    })
  );
  root.append(status);
};

// --- Button group ---

const GROUP_ID = (name: string) => `${ID_PREFIX}Group${name}`;

/** In the page: a group of each kind, and what an exclusive one picks in the status line */
const initButtonGroupDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = GROUP_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  /** Buttons with ids from their labels; toggles with `pressed`, the first one pressed */
  const makeButtons = (labels: string[], isToggle = false) =>
    labels.map((label, i) =>
      createButton({
        id: GROUP_ID(`Button${label}`),
        label,
        ...(isToggle ? { pressed: i === 0 } : {}),
      })
    );
  const row = (label: string, group: { cmp: CMPHandle }) =>
    addGroup(root, label).append(group.cmp.elem);

  row(
    'A group (role="group"): joined, each button a tab stop',
    createButtonGroup({
      id: GROUP_ID('Clipboard'),
      label: 'Clipboard',
      buttons: makeButtons(['Cut', 'Copy', 'Paste']),
    })
  );
  const views = ['Lit', 'Wireframe', 'Normals'];
  row(
    'Exclusive: a toolbar of toggles, one pressed; one tab stop, the arrows move, Space presses',
    createButtonGroup({
      id: GROUP_ID('View'),
      label: 'View mode',
      buttons: makeButtons(views, true),
      exclusive: true,
      onChange: (index) => (status.textContent = `View: ${views[index]}`),
    })
  );
  const tools = ['Move', 'Rotate', 'Scale'];
  row(
    'Exclusive and vertical: Up and Down move',
    createButtonGroup({
      id: GROUP_ID('Tools'),
      label: 'Tool',
      buttons: makeButtons(tools, true),
      exclusive: true,
      orientation: 'vertical',
      onChange: (index) => (status.textContent = `Tool: ${tools[index]}`),
    })
  );
  root.append(status);
};

// --- Menu ---

const MENU_ID = (name: string) => `${ID_PREFIX}Menu${name}`;

/** In the page: a menu button and a split button; what their items do in the status line */
const initMenuDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = MENU_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (text: string) => () => (status.textContent = text);
  // The app's state the menu reads on every open (its items are a getter)
  let isAutosaveOn = false;
  let sortBy = 'name';

  const file = createButton({ id: MENU_ID('File'), label: 'File' });
  createMenu({
    anchor: file.cmp.elem,
    items: () => [
      { label: 'New', kbd: createKbd({ keys: 'Ctrl+N' }), onSelect: report('File: New') },
      { label: 'Open…', kbd: createKbd({ keys: 'Ctrl+O' }), onSelect: report('File: Open…') },
      {
        label: 'Save',
        icon: getSvgIcon('fileCode'),
        kbd: createKbd({ keys: 'Ctrl+S' }),
        onSelect: report('File: Save'),
      },
      { type: 'separator' },
      {
        type: 'checkbox',
        label: 'Autosave',
        checked: isAutosaveOn,
        onCheckedChange: (on) => {
          isAutosaveOn = on;
          status.textContent = `Autosave: ${on ? 'on' : 'off'}`;
        },
      },
      {
        type: 'radio',
        label: 'Sort by',
        value: sortBy,
        options: [
          { value: 'name', label: 'Name' },
          { value: 'date', label: 'Date' },
        ],
        onValueChange: (value) => {
          sortBy = value;
          status.textContent = `Sort by: ${value}`;
        },
      },
      { type: 'separator' },
      { label: 'Revert', disabled: true },
    ],
  });
  addGroup(
    root,
    'A menu button: actions, an on / off item, a one-of choice, a disabled item'
  ).append(file.cmp.elem);

  const split = createSplitButton({
    id: MENU_ID('Split'),
    label: 'Save',
    variant: 'primary',
    onClick: report('Saved'),
    items: [
      { label: 'Save as…', onSelect: report('Save as…') },
      { label: 'Save a copy', onSelect: report('Save a copy') },
      { type: 'separator' },
      { label: 'Export…', disabled: true },
    ],
  });
  addGroup(root, 'A split button: the action, and its variants in a menu').append(split.cmp.elem);
  root.append(status);
};

// --- Link ---

const LINK_ID = (name: string) => `${ID_PREFIX}Link${name}`;
/** The UI kit's feature page, from this chunk (`_assets/chunks/`): the demo is on pages at
 * several depths */
const GUIDE_HREF = new URL(/* @vite-ignore */ '../../features/ui-kit/', import.meta.url).href;

/** In the page: links in text and as buttons; the first one's click is an app's (its status line) */
const initLinkDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = LINK_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const row = (label: string, ...links: { cmp: CMPHandle }[]) => {
    const group = addGroup(root, label);
    for (const link of links) group.append(link.cmp.elem);
  };

  row(
    'A link, and one to another origin (a new tab, marked)',
    createLink({
      id: LINK_ID('Credits'),
      href: '#credits',
      label: 'Credits',
      // A router's: the page doesn't follow it
      onClick: (e) => {
        e.preventDefault();
        status.textContent = 'Credits: followed by the app’s handler';
      },
    }),
    createLink({ id: LINK_ID('Manual'), href: 'https://example.com/', label: 'The manual' })
  );
  const inText = addGroup(root, 'In text');
  const line = document.createElement('p');
  line.className = 'hubDemoLine';
  line.append(
    'Read the ',
    createLink({ href: GUIDE_HREF, label: 'UI kit guide' }).cmp.elem,
    ' before you start.'
  );
  inText.append(line);
  row(
    'As buttons: navigations that look like buttons',
    createLink({
      href: GUIDE_HREF,
      label: 'Open the guide',
      appearance: 'button',
      variant: 'primary',
    }),
    createLink({ href: 'https://example.com/', label: 'Example', appearance: 'button' })
  );
  root.append(status);
};

// --- Badge ---

const BADGE_ID = (name: string) => `${ID_PREFIX}Badge${name}`;
const TONES = ['neutral', 'accent', 'info', 'success', 'warning', 'danger'] as const;

/** In the page: the tones, a count with its spoken label (a Hub button adds one), a badge in a
 * button */
const initBadgeDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const tones = addGroup(root, 'The tones: a status colour on its soft background');
  for (const tone of TONES) tones.append(createBadge({ label: tone, tone }).cmp.elem);

  let unread = 3;
  const count = createBadge({ label: unread, tone: 'accent', spokenLabel: `${unread} unread` });
  const inbox = document.createElement('p');
  inbox.id = BADGE_ID('Inbox');
  inbox.className = 'hubDemoLine';
  inbox.append('Inbox ', count.cmp.elem);
  const counts = addGroup(root, 'A count, with what assistive tech hears: "3 unread"');
  counts.append(inbox);
  addButton(counts, 'Add a message', () => {
    unread++;
    count.setLabel(unread, `${unread} unread`);
  });

  const messages = createButton({ id: BADGE_ID('Button'), label: 'Messages' });
  messages.cmp.elem.append(
    createBadge({ label: 2, tone: 'danger', spokenLabel: '2 new' }).cmp.elem
  );
  addGroup(root, 'In a button: part of its name ("Messages, 2 new")').append(messages.cmp.elem);
};

// --- Tag ---

const TAG_ID = (name: string) => `${ID_PREFIX}Tag${name}`;

/** In the page: the tones, filter chips, removable tags and one with an icon */
const initTagDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = TAG_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');

  const tones = addGroup(root, 'The tones');
  for (const tone of TONES) tones.append(createTag({ label: tone, tone }).cmp.elem);

  const filters = new Set(['Rocks']);
  const chips = addGroup(root, 'Selectable: filter chips (aria-pressed)');
  for (const kind of ['Rocks', 'Trees', 'Water']) {
    const chip = createTag({
      id: TAG_ID(kind),
      label: kind,
      selectable: true,
      selected: filters.has(kind),
      onSelectedChange: (on) => {
        if (on) filters.add(kind);
        else filters.delete(kind);
        status.textContent = `Filters: ${[...filters].join(', ') || 'none'}`;
      },
    });
    chips.append(chip.cmp.elem);
  }

  const removable = addGroup(root, 'Removable: its button, or Backspace or Delete');
  for (const n of [1, 2, 3]) {
    const label = `level${n}.scene`;
    removable.append(
      createTag({
        id: TAG_ID(`Level${n}`),
        label,
        removable: true,
        onRemove: () => (status.textContent = `Removed: ${label}`),
      }).cmp.elem
    );
  }

  addGroup(root, 'With an icon, and disabled').append(
    createTag({ label: 'Pinned', tone: 'accent', icon: getSvgIcon('pin') }).cmp.elem,
    createTag({ label: 'Locked', removable: true, disabled: true }).cmp.elem
  );
  root.append(status);
};

// --- Spinner ---

const SPINNER_ID = (name: string) => `${ID_PREFIX}Spinner${name}`;

/** In the page: the sizes, one in text, and its two custom properties */
const initSpinnerDemo: Demo = (box) => {
  const root = addKitRoot(box);
  addGroup(root, 'At 1em, and the icon sizes: sm, md and lg').append(
    createSpinner({ id: SPINNER_ID('Default') }).cmp.elem,
    ...(['sm', 'md', 'lg'] as const).map((size) => createSpinner({ size }).cmp.elem)
  );
  const line = document.createElement('p');
  line.className = 'hubDemoLine';
  line.append(createSpinner({ decorative: true }).cmp.elem, ' Saving the scene…');
  addGroup(root, 'In text, decorative: the text says it').append(line);
  const accent = createSpinner({ label: 'Connecting' });
  accent.cmp.elem.style.setProperty('--aek-spinner-color', 'var(--aek-accent)');
  const large = createSpinner({ label: 'Loading the level' });
  large.cmp.elem.style.setProperty('--aek-spinner-size', 'calc(var(--aek-space-7) * 1.5)');
  addGroup(root, 'Its colour and size (--aek-spinner-color, --aek-spinner-size)').append(
    accent.cmp.elem,
    large.cmp.elem
  );
};

// --- Progress bar ---

const PROGRESS_ID = (name: string) => `${ID_PREFIX}Progress${name}`;

/** In the page: determinate, indeterminate and segmented bars; a Hub button adds to the first */
const initProgressBarDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const make = (props: ProgressBarProps) =>
    createProgressBar({ class: 'hubDemoProgress', ...props });
  const download = make({
    id: PROGRESS_ID('Download'),
    label: 'Downloading the level',
    value: 40,
    showValue: true,
  });
  const determinate = addGroup(root, 'Determinate, its value shown');
  determinate.append(download.cmp.elem);
  addButton(determinate, 'Add 10 %', () => download.setValue((download.getValue() ?? 0) + 10));
  addGroup(root, 'Indeterminate: no known end').append(
    make({ id: PROGRESS_ID('Connecting'), label: 'Connecting' }).cmp.elem
  );
  const health = make({
    id: PROGRESS_ID('Health'),
    label: 'Health',
    hideLabel: true,
    max: 5,
    segments: 5,
    value: 2.5,
  });
  health.cmp.elem.style.setProperty('--aek-progress-color', 'var(--aek-danger)');
  addGroup(root, 'Segmented: health at 2.5 of 5, its label hidden, in the danger colour').append(
    health.cmp.elem
  );
  addGroup(root, 'Segmented and indeterminate: still stripes').append(
    make({ label: 'Waiting for players', segments: 4 }).cmp.elem
  );
};

// --- Skeleton ---

const SKELETON_ID = (name: string) => `${ID_PREFIX}Skeleton${name}`;

/** In the page: the shapes, and a card loading (`aria-busy`) whose Hub button puts its content in */
const initSkeletonDemo: Demo = (box) => {
  const root = addKitRoot(box);
  addGroup(root, 'Text lines: three, the last shorter').append(
    createSkeleton({ class: 'hubDemoSkeleton' }).cmp.elem
  );
  addGroup(root, 'A block (an image) and a circle (an avatar)').append(
    createSkeleton({ shape: 'block', width: '10rem', height: '6rem' }).cmp.elem,
    createSkeleton({ shape: 'circle' }).cmp.elem
  );

  const card = document.createElement('div');
  card.id = SKELETON_ID('Card');
  card.className = 'hubDemoSkeletonCard';
  card.setAttribute('aria-busy', 'true');
  const avatar = createSkeleton({ shape: 'circle' });
  const text = createSkeleton({ lines: 2, class: 'hubDemoSkeleton' });
  card.append(avatar.cmp.elem, text.cmp.elem);
  const loading = addGroup(root, 'A card loading: aria-busy on it until its content is there');
  loading.append(card);
  addButton(loading, 'Load the content', () => {
    avatar.cmp.remove();
    text.cmp.remove();
    card.removeAttribute('aria-busy');
    const line = document.createElement('p');
    line.className = 'hubDemoLine';
    line.textContent = 'Best lap: 1:42.3, by Ada';
    card.append(line);
  });
};

// --- Divider ---

/** In the page: a divider across a column, and down a row between a toolbar's groups */
const initDividerDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const column = document.createElement('div');
  column.className = 'hubDemoDividerColumn';
  const resume = createButton({ label: 'Resume', variant: 'primary' });
  const settings = createButton({ label: 'Settings' });
  const quit = createButton({ label: 'Quit', variant: 'danger' });
  column.append(resume.cmp.elem, settings.cmp.elem, createDivider().cmp.elem, quit.cmp.elem);
  addGroup(root, 'Across a column: an hr between two groups').append(column);

  const row = addGroup(root, 'Down a row: role="separator", aria-orientation="vertical"');
  row.classList.add('hubDemoDividerRow');
  row.append(
    createButton({ label: 'Undo', icon: getSvgIcon('undo'), iconOnly: true }).cmp.elem,
    createButton({ label: 'Redo', icon: getSvgIcon('redo'), iconOnly: true }).cmp.elem,
    createDivider({ orientation: 'vertical' }).cmp.elem,
    createButton({ label: 'Settings', icon: getSvgIcon('gear'), iconOnly: true }).cmp.elem
  );
};

// --- Empty state ---

const EMPTY_ID = (name: string) => `${ID_PREFIX}Empty${name}`;

/** In the page: one with an icon and an action (its click in the status line), one with text only */
const initEmptyStateDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = EMPTY_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const saves = createEmptyState({
    id: EMPTY_ID('Saves'),
    icon: getSvgIcon('databaseX'),
    title: 'No saved games',
    text: 'Your saves show here after your first checkpoint.',
    action: {
      label: 'New game',
      variant: 'primary',
      onClick: () => (status.textContent = 'New game started'),
    },
  });
  addGroup(root, 'An icon, a title, a text and an action').append(saves.cmp.elem);
  addGroup(root, 'A title and a text: a search with no matches').append(
    createEmptyState({ title: 'No matches', text: 'Try a shorter word, or clear the filters.' }).cmp
      .elem
  );
  root.append(status);
};

// --- Loading overlay ---

const OVERLAY_ID = (name: string) => `${ID_PREFIX}Overlay${name}`;

/** In the page: one over a panel of the box, shown at once (its Hub buttons swap in a bar or hide
 * it); another over the HUD's bounds, as a scene loader's, which a click on it closes (the demo's
 * own listener: the overlay itself takes no input) */
const initLoadingOverlayDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const panel = document.createElement('div');
  panel.id = OVERLAY_ID('Panel');
  panel.className = 'hubDemoOverlayPanel';
  const line = document.createElement('p');
  line.className = 'hubDemoLine';
  line.textContent = 'Leaderboard: Ada 1:42.3, Grace 1:44.0, Alan 1:45.9';
  panel.append(line);
  const overlay = createLoadingOverlay({ text: 'Loading the scores', cover: 'parent' });
  panel.append(overlay.cmp.elem);
  void overlay.showAsync();
  const inPanel = addGroup(root, 'Over a panel (cover: parent): a spinner, or a progress bar');
  inPanel.append(panel);
  addButton(inPanel, 'Show the progress', () => overlay.setProgress(60));
  addButton(inPanel, 'Hide it', () => void overlay.hideAsync());

  const bounds = addGroup(root, 'Over the HUD’s bounds, as a scene loader’s (a click closes it)');
  addButton(bounds, 'Over the HUD’s bounds', () => {
    const loader = createLoadingOverlay({
      id: OVERLAY_ID('Bounds'),
      text: 'Loading the level',
      progress: 35,
    });
    getHUDRootCMP().add(loader.cmp);
    loader.cmp.elem.addEventListener('click', () =>
      loader.hideAsync().then((isHidden) => isHidden && loader.cmp.remove())
    );
    void loader.showAsync();
  });
};

// --- Kbd ---

const KBD_ROWS: { label: string; keys: string[]; platform?: 'mac' | 'other' }[] = [
  { label: 'Chords', keys: ['Ctrl+S', 'Ctrl+Shift+P', 'Shift+F6', 'Ctrl++'], platform: 'other' },
  {
    label: 'macOS: the modifiers as symbols',
    keys: ['Meta+S', 'Meta+Shift+P', 'Alt+ArrowUp'],
    platform: 'mac',
  },
  { label: 'This platform’s names (no platform prop)', keys: ['Meta+Shift+P', 'Alt+ArrowUp'] },
  { label: 'Alternatives', keys: ['F7 / Shift+F7', 'ArrowLeft / A'], platform: 'other' },
];

/** In the page: a key hint draws where its text is */
const initKbdDemo: Demo = (box) => {
  const root = addKitRoot(box);
  for (const { label, keys, platform } of KBD_ROWS) {
    const group = addGroup(root, label);
    for (const chord of keys) group.append(createKbd({ keys: chord, platform }).cmp.elem);
  }
  const inText = addGroup(root, 'In text, following its size');
  const line = document.createElement('p');
  line.className = 'hubDemoLine';
  line.append('Save with ', createKbd({ keys: 'Ctrl+S', platform: 'other' }).cmp.elem, '.');
  inText.append(line);
};

// --- Input glyph ---

const GLYPH_ROWS: { label: string; inputs: InputGlyphInput[] }[] = [
  {
    label: 'Keys',
    inputs: ['e', 'Shift', ' ', 'ArrowUp', 'Escape'].map((key) => ({ device: 'KEYBOARD', key })),
  },
  {
    label: 'The mouse',
    inputs: [
      { device: 'MOUSE', button: 'LEFT' },
      { device: 'MOUSE', button: 'RIGHT' },
      { device: 'MOUSE', button: 'MIDDLE' },
      { device: 'MOUSE', delta: 'WHEEL' },
      { device: 'MOUSE', delta: 'MOVE' },
    ],
  },
];

/** In the page: a glyph draws where its text is */
const initInputGlyphDemo: Demo = (box) => {
  const root = addKitRoot(box);
  for (const { label, inputs } of GLYPH_ROWS) {
    const group = addGroup(root, label);
    for (const input of inputs) group.append(createInputGlyph({ input }).cmp.elem);
  }
  const prompt = addGroup(root, 'In a prompt, following its text');
  const line = document.createElement('p');
  line.className = 'hubDemoLine';
  line.append(
    'Press ',
    createInputGlyph({ input: { device: 'KEYBOARD', key: 'e' } }).cmp.elem,
    ' or ',
    createInputGlyph({ input: { device: 'MOUSE', button: 'LEFT' } }).cmp.elem,
    ' to open the door.'
  );
  prompt.append(line);
};

const DEMOS: Record<string, Demo> = {
  window: initWindowDemo,
  dialog: initDialogDemo,
  dropDown: initDropDownDemo,
  numberField: initNumberFieldDemo,
  numberFieldStress: initNumberFieldStressDemo,
  slider: initSliderDemo,
  rangeSlider: initRangeSliderDemo,
  radioGroup: initRadioGroupDemo,
  selectField: initSelectFieldDemo,
  textField: initTextFieldDemo,
  checkbox: initCheckboxDemo,
  colorField: initColorFieldDemo,
  vectorField: initVectorFieldDemo,
  rotationField: initRotationFieldDemo,
  angleDial: initAngleDialDemo,
  pad2d: initPad2DDemo,
  gradientEditor: initGradientEditorDemo,
  monitor: initMonitorDemo,
  monitorStress: initMonitorStressDemo,
  folder: initFolderDemo,
  fieldset: initFieldsetDemo,
  propertyGrid: initPropertyGridDemo,
  propertyGridParity: initPropertyGridParityDemo,
  form: initFormDemo,
  tooltip: initTooltipDemo,
  popover: initPopoverDemo,
  toaster: initToasterDemo,
  icons: initIconsDemo,
  button: initButtonDemo,
  buttonGroup: initButtonGroupDemo,
  link: initLinkDemo,
  menu: initMenuDemo,
  badge: initBadgeDemo,
  tag: initTagDemo,
  spinner: initSpinnerDemo,
  progressBar: initProgressBarDemo,
  skeleton: initSkeletonDemo,
  divider: initDividerDemo,
  emptyState: initEmptyStateDemo,
  loadingOverlay: initLoadingOverlayDemo,
  kbd: initKbdDemo,
  inputGlyph: initInputGlyphDemo,
};

// --- The page ---

/** The page's switches: each radio group sets (or, for '', removes) its attribute on the HUD root
 * and the demos' kit roots */
const SETTING_ATTRIBUTES: Record<string, string> = {
  theme: 'data-aek-theme',
  density: 'data-aek-density',
};

const initSettings = (hud: HTMLElement) => {
  document.querySelector('[data-hub-component-settings]')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const attribute = SETTING_ATTRIBUTES[input.name];
    if (!attribute) return;
    for (const elem of [hud, ...kitRoots]) {
      if (input.value) elem.setAttribute(attribute, input.value);
      else elem.removeAttribute(attribute);
    }
  });
};

/** Makes the HUD root and mounts each demo into its box (every `[data-hub-demo]` of the page) */
export const initComponents = () => {
  // The windows' buttons and the toasts are icons; the boot registers them in the debug env
  registerBuiltInIcons();
  // The root takes the place of its slot (as of the page's `#hudRoot` in an app)
  const slot = document.createElement('div');
  document.body.append(slot);
  initSettings(createHudRoot({ slot }).elem);
  for (const box of document.querySelectorAll<HTMLElement>('[data-hub-demo]')) {
    DEMOS[box.dataset.hubDemo ?? '']?.(box);
  }
};
