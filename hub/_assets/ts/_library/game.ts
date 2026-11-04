/**
 * The component library's game HUD pieces (the Hub's `features/ui-kit/game/` page, p808): the
 * input prompt, the kit preferences, the resource bar, the cooldown and the crosshair. The game
 * page's other groups are `gameText.ts`, `gameMenus.ts`, `gameItems.ts` and `gameWorld.ts`.
 */
import {
  createButton,
  createCooldown,
  createCrosshair,
  createInputPrompt,
  createResourceBar,
  getKitPreferences,
  getSvgIcon,
  setKitPreferences,
  setPromptDevice,
} from 'aekasha/ui';
import type { CrosshairShape, InputPromptDevice, ResourceBar } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';

/** A status line (`role="status"`) under a demo's pieces, which its actions write */
export const createStatusLine = (id: string) => {
  const status = document.createElement('p');
  status.id = id;
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  return status;
};

// --- Input prompt ---

const PROMPT_ID = (name: string) => `${ID_PREFIX}Prompt${name}`;

const PROMPT_DEVICES: { label: string; device: InputPromptDevice }[] = [
  { label: 'Keyboard and mouse', device: { device: 'KEYBOARD_MOUSE' } },
  { label: 'Xbox pad', device: { device: 'GAMEPAD', family: 'XBOX' } },
  { label: 'PlayStation pad', device: { device: 'GAMEPAD', family: 'PLAYSTATION' } },
  { label: 'Nintendo pad', device: { device: 'GAMEPAD', family: 'NINTENDO' } },
  { label: 'Touch (the keyboard’s)', device: { device: 'TOUCH' } },
];

/** In the page: an action map's bindings as prompts; the Hub buttons set the prompt device, as
 * the engine's `onLastInputDeviceChange` would (every prompt on the page follows) */
const initInputPromptDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const prompts = addGroup(root, 'Each shows the binding for the prompt device');
  prompts.id = PROMPT_ID('Row');
  prompts.classList.add('hubDemoPrompts');
  const bindings = [
    {
      label: 'Interact',
      bindings: [
        { device: 'KEYBOARD', keys: ['e'] },
        { device: 'GAMEPAD', button: 'WEST' },
      ] as const,
    },
    {
      label: 'Jump',
      bindings: [
        { device: 'KEYBOARD', keys: [' '] },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ] as const,
    },
    {
      label: 'Save',
      bindings: [
        { device: 'KEYBOARD', keys: [{ key: 's', ctrl: true }] },
        { device: 'GAMEPAD', button: 'START' },
      ] as const,
    },
    {
      label: 'Move',
      bindings: [
        { device: 'KEYBOARD', up: 'w', left: 'a', down: 's', right: 'd' },
        { device: 'GAMEPAD', stick: 'LEFT' },
      ] as const,
    },
    {
      label: 'Fire',
      bindings: [
        { device: 'MOUSE', button: 'LEFT' },
        { device: 'GAMEPAD', button: 'RIGHT_TRIGGER' },
      ] as const,
    },
  ];
  for (const prompt of bindings) prompts.append(createInputPrompt(prompt).cmp.elem);
  const devices = addGroup(root, 'The prompt device (setPromptDevice)');
  for (const { label, device } of PROMPT_DEVICES) {
    addButton(devices, label, () => setPromptDevice(device));
  }
};

// --- Kit preferences ---

const PREFERENCES_ID = (name: string) => `${ID_PREFIX}Preferences${name}`;

/** In the page: a kit root of its own (not one the page's switches set) that the Hub buttons
 * write the player's preferences on, and a line reading them back */
const initKitPreferencesDemo: Demo = (box) => {
  const root = document.createElement('div');
  root.id = PREFERENCES_ID('Root');
  root.className = 'aekUi hubDemoKitRoot hubDemoPreferencesRoot';
  const sample = addGroup(root, 'A panel of the app’s, on this kit root');
  sample.append(
    createButton({ label: 'Continue', variant: 'primary' }).cmp.elem,
    createResourceBar({ label: 'Health', value: 64, showValue: 'fraction', class: 'hubDemoBar' })
      .cmp.elem,
    createInputPrompt({
      label: 'Interact',
      bindings: [{ device: 'KEYBOARD', keys: ['e'] }],
    }).cmp.elem
  );
  const status = createStatusLine(PREFERENCES_ID('Status'));
  const report = () => {
    const { theme, uiScale, reducedMotion, density } = getKitPreferences(root);
    status.textContent = `Theme ${theme}, UI scale ${uiScale}, reduced motion ${reducedMotion}, density ${density}`;
  };
  root.append(status);
  box.append(root);
  report();
  const write = (label: string, prefs: Parameters<typeof setKitPreferences>[0]) =>
    addButton(buttons, label, () => {
      setKitPreferences({ ...prefs, root });
      report();
    });
  const buttons = addGroup(box, 'setKitPreferences({ root, … })');
  write('Light theme', { theme: 'light' });
  write('Dark theme', { theme: 'dark' });
  write('UI scale 1.25', { uiScale: 1.25 });
  write('Reduced motion', { reducedMotion: true });
  write('Compact density', { density: 'compact' });
  write('Back to the defaults', {
    theme: 'system',
    uiScale: 1,
    reducedMotion: 'system',
    density: 'default',
  });
};

// --- Resource bar ---

const BAR_ID = (name: string) => `${ID_PREFIX}Bar${name}`;

/** In the page: a health bar with thresholds, a segmented stamina bar and a bar of crates' hits;
 * the Hub buttons change their values as a game's events would */
const initResourceBarDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const bars = addGroup(root, 'Health with thresholds, segmented stamina, a percent');
  bars.classList.add('hubDemoBars');
  const health = createResourceBar({
    id: BAR_ID('Health'),
    label: 'Health',
    value: 72,
    showValue: 'fraction',
    thresholds: [
      { below: 0.25, state: 'danger', text: 'Low' },
      { below: 0.5, state: 'warning', text: 'Hurt' },
    ],
  });
  const stamina = createResourceBar({
    id: BAR_ID('Stamina'),
    label: 'Stamina',
    value: 75,
    segments: 4,
    thresholds: [{ below: 0.2, state: 'warning', text: 'Tired' }],
  });
  const shield = createResourceBar({
    id: BAR_ID('Shield'),
    label: 'Shield',
    max: 50,
    value: 50,
    showValue: 'percent',
  });
  for (const bar of [health, stamina, shield]) bars.append(bar.cmp.elem);
  const change = (bar: ResourceBar, by: number) => bar.setValue(bar.getValue() + by);
  const hits = addGroup(root, 'A game’s events');
  addButton(hits, 'Take 30 damage', () => change(health, -30));
  addButton(hits, 'Heal 40', () => change(health, 40));
  addButton(hits, 'Low health', () => health.setValue(18));
  addButton(hits, 'Run (stamina −30)', () => change(stamina, -30));
  addButton(hits, 'Max health 150', () => health.setMax(150));
  addButton(hits, 'Shield broken', () => shield.setValue(0));
};

// --- Cooldown ---

const COOLDOWN_ID = (name: string) => `${ID_PREFIX}Cooldown${name}`;

/** In the page: two ability buttons, each with a cooldown its click starts (the action checks
 * `isRunning` itself: the cooldown only marks the button); the Hub buttons start runs that end
 * before the screenshot, and one already half over */
const initCooldownDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(COOLDOWN_ID('Status'));
  const row = addGroup(root, 'Ability buttons: a click uses one and starts its cooldown');
  const makeAbility = (name: string, icon: string, durationMs: number) => {
    const button = createButton({
      id: COOLDOWN_ID(name),
      label: name,
      icon: getSvgIcon(icon),
      iconOnly: true,
      size: 'lg',
      class: 'hubDemoAbility',
      onClick: () => {
        if (cooldown.isRunning()) {
          status.textContent = `${name} isn’t ready`;
          return;
        }
        status.textContent = `${name} used`;
        cooldown.start(durationMs);
      },
    });
    const cooldown = createCooldown({
      target: button.cmp,
      onReady: () => (status.textContent = `${name} ready`),
    });
    button.cmp.add(cooldown.cmp);
    row.append(button.cmp.elem);
    return cooldown;
  };
  const dash = makeAbility('Dash', 'rocketTakeoff', 4000);
  const shield = makeAbility('Shield', 'lock', 10000);
  root.append(status);
  const runs = addGroup(root, 'Runs');
  addButton(runs, 'Start a 1 s cooldown on Dash', () => dash.start(1000));
  addButton(runs, 'Shield: 2 s, half over', () => shield.start(2000, 1000));
};

// --- Crosshair ---

const CROSSHAIR_ID = (name: string) => `${ID_PREFIX}Crosshair${name}`;

const SHAPES: CrosshairShape[] = ['cross', 'dot', 'circle', 'chevron'];

/** In the page: a stage (`contain: layout`, so the crosshair's fixed centre is the stage's, as a
 * mounted engine's container); the Hub buttons set its shape, spread and state, and flash hit
 * markers */
const initCrosshairDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const stage = document.createElement('div');
  stage.id = CROSSHAIR_ID('Stage');
  stage.className = 'hubDemoStage';
  const crosshair = createCrosshair({ id: CROSSHAIR_ID('Reticle') });
  stage.append(crosshair.cmp.elem);
  root.append(stage);
  const shapes = addGroup(root, 'Shapes');
  for (const shape of SHAPES) {
    addButton(shapes, `Shape: ${shape}`, () => crosshair.setShape(shape));
  }
  const states = addGroup(
    root,
    'The spread and what it’s over (a ring, a slash: not colour alone)'
  );
  addButton(states, 'Spread 8 px (moving)', () => crosshair.setSpread(8));
  addButton(states, 'Over a target', () => crosshair.setState('target'));
  addButton(states, 'Blocked', () => crosshair.setState('blocked'));
  const hits = addGroup(root, 'Hit markers (250 ms: gone before the screenshot)');
  addButton(hits, 'Hit', () => crosshair.showHitMarker('hit'));
  addButton(hits, 'Critical', () => crosshair.showHitMarker('critical'));
  addButton(hits, 'Kill', () => crosshair.showHitMarker('kill'));
};

/** The game HUD group's demos by their box's key (`data-hub-demo`) */
export const GAME_DEMOS: Record<string, Demo> = {
  inputPrompt: initInputPromptDemo,
  kitPreferences: initKitPreferencesDemo,
  resourceBar: initResourceBarDemo,
  cooldown: initCooldownDemo,
  crosshair: initCrosshairDemo,
};
