// The controls page's capture (p808 D9): the next key, mouse button or gamepad button, taken in
// the capture phase on the window, before anything else on the page sees it (the overlay stack's
// Escape, the action maps' listeners, the canvas'), and stopped there. Every listener, the gamepad
// poll and the timer exist only while a capture runs.
import type { InputGlyphGamepadButton } from '../../components/GamepadGlyphs';
import { swallowNextKeyUp } from '../../overlays/OverlayStack';
import type { CapturedInput, ControlsColumn } from './ControlsBindings';

/** The standard mapping's buttons by index: the engine's `GAMEPAD_BUTTON_NAMES` in the kit */
const GAMEPAD_BUTTONS: readonly InputGlyphGamepadButton[] = [
  'SOUTH',
  'EAST',
  'WEST',
  'NORTH',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_TRIGGER',
  'RIGHT_TRIGGER',
  'SELECT',
  'START',
  'LEFT_STICK',
  'RIGHT_STICK',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
  'HOME',
];

const MOUSE_BUTTONS = ['LEFT', 'MIDDLE', 'RIGHT'] as const;

/** How long the events a captured mouse press makes are dropped for at most */
const CLICK_DROP_MS = 1000;

/** Why a capture ended without an input */
export type CaptureCancel = 'escape' | 'timeout' | 'pointer' | 'gamepad' | 'blur';

/** What {@link startCapture} listens for */
type CaptureProps = {
  column: ControlsColumn;
  /** Whether the slot takes an input: one it doesn't is dropped and the capture goes on */
  accepts: (input: CapturedInput) => boolean;
  onInput: (input: CapturedInput) => void;
  onCancel: (reason: CaptureCancel) => void;
  /** Cancels after this long without an input (0: never) */
  timeoutMs: number;
};

/** A key as the maps compare it: a letter lowercased (Shift+W is W) */
const normalizeKey = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

/** The gamepad API, where the page has it */
const readPads = (): readonly (Gamepad | null)[] =>
  typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
    ? navigator.getGamepads()
    : [];

/**
 * Drops what follows a captured mouse press (it would act on what's under the pointer): its
 * compatibility `mousedown` where the browser sends one, the click, auxclick and context menu, up
 * to the task after its release (a second at most)
 */
const dropClicksAfterPress = () => {
  const types = ['mousedown', 'click', 'auxclick', 'contextmenu'];
  const drop = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const end = () => {
    clearTimeout(timer);
    window.removeEventListener('pointerup', onRelease, true);
    for (const type of types) window.removeEventListener(type, drop, true);
  };
  // The click comes in the release's task: gone in the next one
  const onRelease = () => setTimeout(end, 0);
  const timer = setTimeout(end, CLICK_DROP_MS);
  window.addEventListener('pointerup', onRelease, true);
  for (const type of types) window.addEventListener(type, drop, true);
};

/**
 * Starts a capture: the next key (Escape cancels), mouse button (the keyboard column's) or gamepad
 * button (its press after the capture began: one held at the start counts once released) goes to
 * `onInput`. In the keyboard column a gamepad button cancels, in the gamepad column a pointer
 * press does (the player turned to the other device); the window losing focus and the timeout
 * cancel too. Every key is stopped while it runs (no game action, no Back), its keyup with it.
 * @internal
 * @returns stops it without a call
 */
export const startCapture = (props: CaptureProps) => {
  const { column } = props;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Each pad's pressed buttons at the last read, by its index */
  const held = new Map<number, boolean[]>();

  const stop = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', onBlur);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const take = (input: CapturedInput) => {
    if (!props.accepts(input)) return false;
    stop();
    props.onInput(input);
    return true;
  };

  const cancel = (reason: CaptureCancel) => {
    stop();
    props.onCancel(reason);
  };

  function onKeyDown(e: KeyboardEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowNextKeyUp(e.key);
    if (e.repeat) return;
    if (e.key === 'Escape') {
      cancel('escape');
      return;
    }
    if (column === 'KEYBOARD_MOUSE') take({ device: 'KEYBOARD', key: normalizeKey(e.key) });
  }

  function onPointerDown(e: PointerEvent) {
    const button = MOUSE_BUTTONS[e.button];
    if (column === 'GAMEPAD' || e.pointerType === 'touch' || !button) {
      cancel('pointer');
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (take({ device: 'MOUSE', button })) dropClicksAfterPress();
    else cancel('pointer');
  }

  function onBlur() {
    cancel('blur');
  }

  /** A button pressed since the last read (a held one counts once released) */
  const poll = () => {
    frame = null;
    for (const pad of readPads()) {
      if (!pad) continue;
      const last = held.get(pad.index);
      const now = pad.buttons.map((button) => button.pressed);
      held.set(pad.index, now);
      if (!last) continue;
      for (let i = 0; i < now.length; i++) {
        const name = GAMEPAD_BUTTONS[i];
        if (!now[i] || last[i] || !name) continue;
        if (column === 'KEYBOARD_MOUSE') {
          cancel('gamepad');
          return;
        }
        if (take({ device: 'GAMEPAD', button: name })) return;
      }
    }
    frame = requestAnimationFrame(poll);
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', onBlur);
  if (props.timeoutMs > 0) timer = setTimeout(() => cancel('timeout'), props.timeoutMs);
  // The first read only records what's held (the SOUTH that started the capture)
  if (readPads().length) poll();
  return stop;
};
