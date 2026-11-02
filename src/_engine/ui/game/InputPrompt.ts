import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { createInputGlyph, type InputGlyph, type InputGlyphInput } from '../components/InputGlyph';
import type { InputGlyphFamily } from '../components/GamepadGlyphs';
import './InputPrompt.scss';
import '../styles/kit.scss';

/** The device the prompts show their bindings for: the engine's `LastInputDevice` as it is. */
export type InputPromptDevice = {
  /** The keyboard and mouse, a gamepad, or touch (which shows the keyboard's binding). */
  readonly device: 'KEYBOARD_MOUSE' | 'GAMEPAD' | 'TOUCH';
  /** A gamepad's family, whose labels its glyphs show. Default `'GENERIC'`. */
  readonly family?: InputGlyphFamily;
};

/** A key with modifiers, in the action bindings' `KeyChord` shape */
type PromptKeyChord = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

/**
 * One of an action's bindings, in the action map's shapes (`map.getBindings(id)` as it is): a
 * glyph's input, a button's keys (the first is shown), a keyboard axis' keys, a touch gesture
 * (never shown: touch has no glyph).
 */
export type InputPromptBinding =
  | InputGlyphInput
  | { device: 'KEYBOARD'; keys: readonly (string | PromptKeyChord)[] }
  | { device: 'KEYBOARD'; negative: string; positive: string }
  | { device: 'KEYBOARD'; up: string; down: string; left: string; right: string }
  | { device: 'TOUCH'; gesture: string };

/** What {@link createInputPrompt} shows. */
export type InputPromptProps = {
  /** The action's bindings (`map.getBindings('interact')`): the prompt shows the first one for
   * the prompt device ({@link setPromptDevice}), else the first it can draw. */
  bindings: readonly InputPromptBinding[];
  /** The action's name after the glyphs ('Interact'). */
  label?: string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An input prompt {@link createInputPrompt} made: its CMP and its setters. */
export type InputPrompt = {
  /** Its element (`.aekInputPrompt`): add it where it goes. */
  cmp: CMPHandle;
  /** Shows other bindings (the player rebound the action). */
  setBindings: (bindings: readonly InputPromptBinding[]) => void;
  /** Changes its label. */
  setLabel: (label: string) => void;
};

const KEYBOARD_MOUSE: InputPromptDevice = { device: 'KEYBOARD_MOUSE' };
let promptDevice: InputPromptDevice = KEYBOARD_MOUSE;
const promptRedraws = new Set<() => void>();

/**
 * Sets the device every input prompt shows its binding for, and redraws them: wire it to the
 * engine's `onLastInputDeviceChange` and the prompts follow the player's device.
 * @param device the device, and a gamepad's family (the engine's `LastInputDevice` as it is)
 * @example
 * ```ts
 * import { onLastInputDeviceChange } from 'aekasha';
 * import { setPromptDevice } from 'aekasha/ui';
 *
 * onLastInputDeviceChange(setPromptDevice);
 * // Or fixed, a settings page's "Button prompts: PlayStation"
 * setPromptDevice({ device: 'GAMEPAD', family: 'PLAYSTATION' });
 * ```
 */
export const setPromptDevice = (device: InputPromptDevice) => {
  if (device.device === promptDevice.device && device.family === promptDevice.family) return;
  promptDevice = { device: device.device, family: device.family };
  for (const redraw of [...promptRedraws]) redraw();
};

/** The device the input prompts show their bindings for ({@link setPromptDevice}). */
export const getPromptDevice = (): InputPromptDevice => promptDevice;

const MODIFIERS = ['ctrl', 'shift', 'alt', 'meta'] as const;
const MODIFIER_KEYS = { ctrl: 'Control', shift: 'Shift', alt: 'Alt', meta: 'Meta' };

/** A binding's glyph inputs (one per key of a chord or an axis), none for one it can't draw */
const toInputs = (binding: InputPromptBinding): InputGlyphInput[] => {
  if (binding.device === 'TOUCH') return [];
  if (binding.device !== 'KEYBOARD') return [binding];
  if ('key' in binding) return [binding];
  if ('keys' in binding) {
    const first = binding.keys[0];
    if (first === undefined) return [];
    if (typeof first === 'string') return [{ device: 'KEYBOARD', key: first }];
    const inputs: InputGlyphInput[] = [];
    for (const modifier of MODIFIERS) {
      if (first[modifier]) inputs.push({ device: 'KEYBOARD', key: MODIFIER_KEYS[modifier] });
    }
    inputs.push({ device: 'KEYBOARD', key: first.key });
    return inputs;
  }
  const keys =
    'negative' in binding
      ? [binding.negative, binding.positive]
      : [binding.up, binding.left, binding.down, binding.right];
  return keys.map((key): InputGlyphInput => ({ device: 'KEYBOARD', key }));
};

const isForDevice = (binding: InputPromptBinding, device: InputPromptDevice['device']) =>
  device === 'GAMEPAD'
    ? binding.device === 'GAMEPAD'
    : binding.device === 'KEYBOARD' || binding.device === 'MOUSE';

/** The inputs of the first binding for the device that draws, else of the first that draws */
const pickInputs = (bindings: readonly InputPromptBinding[], device: InputPromptDevice) => {
  let fallback: InputGlyphInput[] | null = null;
  for (const binding of bindings) {
    const inputs = toInputs(binding);
    if (!inputs.length) continue;
    if (isForDevice(binding, device.device)) return inputs;
    fallback ??= inputs;
  }
  return fallback ?? [];
};

/**
 * Creates an input prompt (p808 D5): an action's binding for the device the player uses, as
 * glyphs, and its name ("[E] Interact", "(A) Interact"). Every prompt follows
 * {@link setPromptDevice}, so one call switches them all when the player picks up a gamepad.
 * - Parts: `.aekInputPrompt` (`data-device="keyboard_mouse" | "gamepad" | "touch"`, the prompt
 *   device), `.aekInputPrompt__glyphs` (the input glyphs: a chord's keys, an axis' keys),
 *   `.aekInputPrompt__label`.
 * - Custom properties: `--aek-input-prompt-gap` (default `--aek-space-2`), and the glyphs'
 *   `--aek-input-glyph-size`.
 * - Assistive tech: each glyph is a `role="img"` named by its input, then the label's text
 *   ("Cross button Interact").
 * @example
 * ```ts
 * import { createActionMap } from 'aekasha';
 * import { createInputPrompt, getHUDRootCMP } from 'aekasha/ui';
 *
 * const map = createActionMap({
 *   id: 'play',
 *   actions: { interact: { type: 'BUTTON', name: 'Interact' } },
 *   bindings: {
 *     interact: [
 *       { device: 'KEYBOARD', keys: ['e'] },
 *       { device: 'GAMEPAD', button: 'WEST' },
 *     ],
 *   },
 * });
 * const prompt = createInputPrompt({ bindings: map.getBindings('interact'), label: 'Interact' });
 * getHUDRootCMP().add(prompt.cmp);
 * ```
 */
export const createInputPrompt = (props: InputPromptProps): InputPrompt => {
  let bindings = props.bindings;
  const glyphs: InputGlyph[] = [];

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekInputPrompt', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      promptRedraws.delete(redraw);
    },
  });
  // The glyphs are CMPs (the registry's): removed with the prompt
  const glyphsCmp = cmp.add({ tag: 'span', class: 'aekInputPrompt__glyphs' });
  const labelElem = document.createElement('span');
  labelElem.className = 'aekInputPrompt__label';
  labelElem.textContent = props.label ?? '';
  labelElem.hidden = !props.label;
  cmp.elem.append(labelElem);

  /** Redraws the glyphs in place: one glyph per input, kept and redrawn, the extra ones removed */
  function redraw() {
    const device = promptDevice;
    cmp.elem.setAttribute('data-device', device.device.toLowerCase());
    const inputs = pickInputs(bindings, device);
    const family = device.family ?? 'GENERIC';
    for (let i = 0; i < inputs.length; i++) {
      const glyph = glyphs[i];
      if (glyph) {
        glyph.setFamily(family);
        glyph.setInput(inputs[i]);
        continue;
      }
      const created = createInputGlyph({ input: inputs[i], family });
      glyphs.push(created);
      glyphsCmp.add(created.cmp);
    }
    while (glyphs.length > inputs.length) glyphs.pop()?.cmp.remove();
  }

  redraw();
  promptRedraws.add(redraw);

  return {
    cmp,
    setBindings: (next) => {
      bindings = next;
      redraw();
    },
    setLabel: (label) => {
      labelElem.textContent = label;
      labelElem.hidden = !label;
    },
  };
};
