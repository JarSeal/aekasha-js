/**
 * The component library's core pieces and components (the Hub's `features/ui-kit/core/` page):
 * the icons, the button and button group, the link, the badge, the tag, the spinner, the
 * progress bar, the skeleton, the divider, the empty state, the loading overlay, the key hint
 * and the input glyph.
 */
import {
  createBadge,
  createButton,
  createButtonGroup,
  createDivider,
  createDropDown,
  createEmptyState,
  createInputGlyph,
  createKbd,
  createLink,
  createLoadingOverlay,
  createProgressBar,
  createSkeleton,
  createSpinner,
  createTag,
  getHUDRootCMP,
  getSvgIcon,
} from 'aekasha/ui';
import type {
  BuiltInIconName,
  Button,
  ButtonProps,
  InputGlyphInput,
  ProgressBarProps,
  CMPHandle,
} from 'aekasha/ui';
import { ID_PREFIX, addGroup, addButton, addKitRoot } from './page';
import type { Demo } from './page';

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
  // Still a tab stop: its reason is its tooltip, and its clicks do nothing
  const exportButton = make('Export', { label: 'Export', focusableWhenDisabled: true });
  exportButton.setDisabled(true, 'Nothing to export yet');
  row('Disabled but focusable (aria-disabled), its reason the tooltip', exportButton);
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
  // A toolbar of independent buttons: a toggle, an action disabled with its reason, a drop-down
  const snap = createButton({
    id: GROUP_ID('ButtonSnap'),
    label: 'Snap',
    icon: getSvgIcon('spatialGrid'),
    iconOnly: true,
    pressed: false,
    onPressedChange: (on) => (status.textContent = `Snap: ${on ? 'on' : 'off'}`),
  });
  const duplicate = createButton({
    id: GROUP_ID('ButtonDuplicate'),
    label: 'Duplicate',
    focusableWhenDisabled: true,
  });
  duplicate.setDisabled(true, 'Nothing selected');
  const cameras = ['Main', 'Top', 'Side'];
  const camera = createDropDown({
    options: cameras.map((label) => ({ value: label, label })),
    value: 'Main',
    title: 'Camera',
    onChange: (picked) => (status.textContent = `Camera: ${picked}`),
  });
  camera.cmp.elem.querySelector('button')?.setAttribute('id', GROUP_ID('ButtonCamera'));
  row(
    'A toolbar (toolbar): toggles, buttons and a drop-down acting alone; one tab stop, the arrows stop on a disabled but focusable one',
    createButtonGroup({
      id: GROUP_ID('Viewport'),
      label: 'Viewport',
      toolbar: true,
      buttons: [...makeButtons(['Frame']), snap, duplicate, camera],
    })
  );
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

/** The core group's demos by their box's key (`data-hub-demo`) */
export const CORE_DEMOS: Record<string, Demo> = {
  icons: initIconsDemo,
  button: initButtonDemo,
  buttonGroup: initButtonGroupDemo,
  link: initLinkDemo,
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
