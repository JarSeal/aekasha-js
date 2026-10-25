import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getKeyName, getKeyPlatform, type KeyPlatform } from './KeyNames';
import './InputGlyph.scss';
import '../styles/kit.scss';

/**
 * The input an input glyph draws, in an action binding's shape (`createActionMap`'s `KEYBOARD`
 * and `MOUSE` bindings), so a map's binding can be passed as it is: one key, a mouse button, or
 * the mouse's movement or wheel.
 */
export type InputGlyphInput =
  /** One key, a `KeyboardEvent.key` value (`'e'`, `'Shift'`, `' '`) */
  | { device: 'KEYBOARD'; key: string }
  /** A mouse button */
  | { device: 'MOUSE'; button: 'LEFT' | 'MIDDLE' | 'RIGHT' }
  /** The mouse's movement or its wheel */
  | { device: 'MOUSE'; delta: 'MOVE' | 'WHEEL' };

/** What {@link createInputGlyph} draws. */
export type InputGlyphProps = {
  /** The key, mouse button or mouse movement. */
  input: InputGlyphInput;
  /** Whose key names it shows: `'mac'` draws the modifiers as symbols (⌘). Default: the platform
   * the page runs on. */
  platform?: 'mac' | 'other';
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** An input glyph {@link createInputGlyph} made: its CMP and its setter. */
export type InputGlyph = {
  /** Its element (`.aekInputGlyph`): add it where it goes. */
  cmp: CMPHandle;
  /** Draws another input in place (a binding changed). */
  setInput: (input: InputGlyphInput) => void;
};

/** The mouse in a 24 × 24 box: the body and the buttons' line (broken around the wheel when the
 * wheel is the part), then the part filled */
const MOUSE_BODY =
  '<rect x="6.5" y="2" width="11" height="20" rx="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const MOUSE_LINE = (isWheel: boolean) =>
  `<path d="${isWheel ? 'M12 2V4M12 9V10' : 'M12 2V10'}M6.5 10H17.5" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
const MOUSE_PARTS = {
  LEFT: '<path class="aekInputGlyph__active" d="M12 2A5.5 5.5 0 0 0 6.5 7.5V10H12Z"/>',
  RIGHT: '<path class="aekInputGlyph__active" d="M12 2A5.5 5.5 0 0 1 17.5 7.5V10H12Z"/>',
  MIDDLE:
    '<rect class="aekInputGlyph__active" x="10.75" y="4.5" width="2.5" height="4" rx="1.25"/>',
  WHEEL:
    '<rect class="aekInputGlyph__active" x="10.75" y="4.5" width="2.5" height="4" rx="1.25"/><path d="M19.5 5.5L21 4L22.5 5.5M19.5 7.5L21 9L22.5 7.5" fill="none" stroke="currentColor" stroke-width="1.25"/>',
  MOVE: '<path d="M4.5 12L2.5 14L4.5 16M19.5 12L21.5 14L19.5 16" fill="none" stroke="currentColor" stroke-width="1.5"/>',
};
const MOUSE_NAMES = {
  LEFT: 'Left mouse button',
  RIGHT: 'Right mouse button',
  MIDDLE: 'Middle mouse button',
  WHEEL: 'Mouse wheel',
  MOVE: 'Mouse movement',
};

/** Writes the glyph: a key cap's text, or the mouse's SVG with its part in the accent; its name
 * is the element's `aria-label` (`role="img"`) */
const writeGlyph = (elem: HTMLElement, input: InputGlyphInput, platform: KeyPlatform) => {
  if (input.device === 'KEYBOARD') {
    const { shown, spoken } = getKeyName(input.key, platform);
    elem.setAttribute('data-device', 'keyboard');
    elem.setAttribute('aria-label', spoken);
    elem.textContent = shown;
    return;
  }
  const part = 'button' in input ? input.button : input.delta;
  elem.setAttribute('data-device', 'mouse');
  elem.setAttribute('aria-label', MOUSE_NAMES[part]);
  // The kit's own markup: a production app may not register the built-in icons
  elem.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${MOUSE_BODY}${MOUSE_LINE(part === 'MIDDLE' || part === 'WHEEL')}${MOUSE_PARTS[part]}</svg>`;
};

/**
 * Creates an input glyph (p803 D10): one key as a key cap, or a mouse button, the wheel or the
 * mouse's movement as a mouse with that part in the accent, for a prompt ("Press [E] to open").
 * Static, keyboard and mouse: p808 makes it follow the device in use and adds the gamepads.
 * - Parts: `.aekInputGlyph` (`data-device="keyboard" | "mouse"`), `.aekInputGlyph__active` (the
 *   mouse's part, filled with the accent).
 * - Custom properties: `--aek-input-glyph-size` (its height, default `1.6em`: it follows its text).
 * - Assistive tech: `role="img"` named by the input ("E", "Left mouse button").
 * @example
 * ```ts
 * const prompt = panel.add({ tag: 'p', text: 'Press ' });
 * prompt.add(createInputGlyph({ input: { device: 'KEYBOARD', key: 'e' } }).cmp);
 * prompt.add({ tag: 'span', text: ' or ' });
 * prompt.add(createInputGlyph({ input: { device: 'MOUSE', button: 'LEFT' } }).cmp);
 * ```
 */
export const createInputGlyph = (props: InputGlyphProps): InputGlyph => {
  const platform = props.platform ?? getKeyPlatform();
  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekInputGlyph', props.class),
    attr: { ...props.attr, role: 'img' },
  });
  writeGlyph(cmp.elem, props.input, platform);
  return { cmp, setInput: (input) => writeGlyph(cmp.elem, input, platform) };
};
