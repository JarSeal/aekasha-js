/**
 * The component library (p802 D9, the dev page `project/aekasha/components/`): a chunk `hub.ts`
 * imports on a page with `[data-hub-components]`, only in the dev Hub. It uses `aekasha/ui`
 * without the engine: the Hub's script build resolves the kit's main loop and storage to its own
 * stand-ins (`_kit/`, `devTools/hub/kitStandIns.ts`), and this makes the HUD root (`createHudRoot`,
 * which brings the kit's global styles), as the boot would.
 *
 * The root sits over the viewport, as in an app: each `[data-hub-demo]` box gets buttons that
 * open its piece's states there, and the page's theme and density switches set its attributes. A
 * piece drawn in the page (a key hint, an input glyph) draws in a kit root of its own in its box
 * (`addKitRoot`, as an app's UI outside the HUD), which the switches set too.
 * The buttons and the windows' content are the page's (`.hubButton`, `.hubDemoPanel`), as an
 * app's content is the app's; everything else is the kit's.
 */
import {
  addToast,
  closeDraggableWindow,
  CMP,
  createBadge,
  createButton,
  createButtonGroup,
  createDropDown,
  createHudRoot,
  createInputGlyph,
  createKbd,
  createLink,
  createMenu,
  createPopover,
  createSplitButton,
  createTag,
  createToaster,
  createTooltip,
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
  toggleDraggableWindow,
} from 'aekasha/ui';
import type {
  BuiltInIconName,
  Button,
  ButtonProps,
  DialogProps,
  DropDownProps,
  InputGlyphInput,
  OpenDraggableWindowProps,
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
    kbd: 'Ctrl+S',
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
      { label: 'New', kbd: 'Ctrl+N', onSelect: report('File: New') },
      { label: 'Open…', kbd: 'Ctrl+O', onSelect: report('File: Open…') },
      {
        label: 'Save',
        icon: getSvgIcon('fileCode'),
        kbd: 'Ctrl+S',
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
/** The UI kit's feature page, from this page (project/aekasha/components/) */
const GUIDE_HREF = '../../../features/ui-kit/';

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

const initSettings = (root: HTMLElement, hud: HTMLElement) => {
  root.querySelector('[data-hub-component-settings]')?.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const attribute = SETTING_ATTRIBUTES[input.name];
    if (!attribute) return;
    for (const elem of [hud, ...kitRoots]) {
      if (input.value) elem.setAttribute(attribute, input.value);
      else elem.removeAttribute(attribute);
    }
  });
};

/**
 * Makes the HUD root and mounts each demo into its box
 * @param root the page's `[data-hub-components]` element
 */
export const initComponents = (root: HTMLElement) => {
  // The windows' buttons and the toasts are icons; the boot registers them in the debug env
  registerBuiltInIcons();
  // The root takes the place of its slot (as of the page's `#hudRoot` in an app)
  const slot = document.createElement('div');
  document.body.append(slot);
  initSettings(root, createHudRoot({ slot }).elem);
  for (const box of root.querySelectorAll<HTMLElement>('[data-hub-demo]')) {
    DEMOS[box.dataset.hubDemo ?? '']?.(box);
  }
};
