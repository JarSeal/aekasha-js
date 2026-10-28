/**
 * The component library's overlays (the Hub's `features/ui-kit/overlays/` page): the draggable
 * window, the dialog, the tooltip, the popover, the toaster and the menu.
 */
import {
  addToast,
  closeDraggableWindow,
  CMP,
  createButton,
  createContextMenu,
  createKbd,
  createMenu,
  createPopover,
  createSplitButton,
  createToaster,
  createTooltip,
  fitAllDraggableWindowsToScreen,
  getDraggableWindowsOfKind,
  getHUDRootCMP,
  getKindWindowId,
  getSvgIcon,
  openDialog,
  openDraggableWindow,
  registerDraggableWindowKind,
  removeDraggableWindow,
  toggleDraggableWindow,
} from 'aekasha/ui';
import type { DialogProps, OpenDraggableWindowProps, Tooltip, TooltipProps } from 'aekasha/ui';
import {
  ID_PREFIX,
  TOASTER_ID,
  openedIds,
  addGroup,
  addButton,
  addKitRoot,
  createPanel,
  addPanelButton,
} from './page';
import type { Demo } from './page';
import { createDemoDropDown } from './fields';

const DEFAULT_WINDOW_ID = `${ID_PREFIX}Window`;
/** The window the "Over a window" dialog opens over */
const BEHIND_DIALOG_ID = `${ID_PREFIX}BehindDialog`;
const KIND = `${ID_PREFIX}Kind`;
const TOP_TOASTER_ID = `${ID_PREFIX}TopToaster`;

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
    text: 'A drop-down in a dialog, as the uiKit embed’s form has one. Open its list and press Escape: the first press closes the list, the next the dialog.',
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

  // Submenus (p805 D11), two levels deep
  let isOutlineShown = true;
  let layout = 'default';
  const view = createButton({ id: MENU_ID('View'), label: 'View' });
  createMenu({
    anchor: view.cmp.elem,
    items: () => [
      {
        type: 'submenu',
        label: 'Zoom',
        items: [
          {
            label: 'Zoom in',
            kbd: createKbd({ keys: 'Ctrl++' }),
            onSelect: report('View: Zoom in'),
          },
          {
            label: 'Zoom out',
            kbd: createKbd({ keys: 'Ctrl+-' }),
            onSelect: report('View: Zoom out'),
          },
          { label: 'Fit to screen', onSelect: report('View: Fit to screen') },
        ],
      },
      {
        type: 'submenu',
        label: 'Panels',
        items: [
          {
            type: 'checkbox',
            label: 'Outline',
            checked: isOutlineShown,
            onCheckedChange: (on) => {
              isOutlineShown = on;
              status.textContent = `Outline: ${on ? 'shown' : 'hidden'}`;
            },
          },
          { type: 'separator' },
          {
            type: 'submenu',
            label: 'Layout',
            items: [
              {
                type: 'radio',
                label: 'Layout',
                value: layout,
                options: [
                  { value: 'default', label: 'Default' },
                  { value: 'compact', label: 'Compact' },
                ],
                onValueChange: (value) => {
                  layout = value;
                  status.textContent = `Layout: ${value}`;
                },
              },
            ],
          },
        ],
      },
      { type: 'submenu', label: 'Recent views', disabled: true, items: [] },
      { type: 'separator' },
      { label: 'Full screen', onSelect: report('View: Full screen') },
    ],
  });
  addGroup(root, 'A menu button with submenus, two levels deep').append(view.cmp.elem);
  root.append(status);
};

/** The overlays group's demos by their box's key (`data-hub-demo`) */
// --- Context menu ---

const CONTEXT_ID = (name: string) => `${ID_PREFIX}Context${name}`;

/** In the page: a scene's objects as rows, one context menu for them all (the row found from the
 * element); what an item does in the status line */
const initContextMenuDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = CONTEXT_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const objects = [
    { name: 'Lamp', isVisible: true },
    { name: 'Crate', isVisible: true },
    { name: 'Door', isVisible: false },
  ];
  const group = addGroup(
    root,
    'Right-click a row, or focus it and press the ContextMenu key or Shift+F10'
  );
  objects.forEach((object, index) => {
    const row = createButton({ id: CONTEXT_ID(`Row${index}`), label: object.name });
    row.cmp.elem.setAttribute('data-object', String(index));
    group.append(row.cmp.elem);
  });
  const getObject = (elem: Element) => {
    const row = elem.closest<HTMLElement>('[data-object]');
    return row ? objects[Number(row.dataset.object)] : null;
  };
  createContextMenu({
    target: group,
    label: (elem) => `${getObject(elem)?.name ?? 'Object'} actions`,
    items: (elem) => {
      const object = getObject(elem);
      if (!object) return [];
      return [
        { label: 'Focus', onSelect: () => (status.textContent = `Focus: ${object.name}`) },
        {
          type: 'checkbox',
          label: 'Visible',
          checked: object.isVisible,
          onCheckedChange: (on) => {
            object.isVisible = on;
            status.textContent = `${object.name}: ${on ? 'shown' : 'hidden'}`;
          },
        },
        {
          type: 'submenu',
          label: 'Move to',
          items: ['Front', 'Back', 'Origin'].map((place) => ({
            label: place,
            onSelect: () =>
              (status.textContent = `${object.name} moved to the ${place.toLowerCase()}`),
          })),
        },
        { type: 'separator' },
        { label: 'Delete', disabled: true },
      ];
    },
  });
  root.append(status);
};

export const OVERLAYS_DEMOS: Record<string, Demo> = {
  window: initWindowDemo,
  dialog: initDialogDemo,
  tooltip: initTooltipDemo,
  popover: initPopoverDemo,
  toaster: initToasterDemo,
  menu: initMenuDemo,
  contextMenu: initContextMenuDemo,
};
