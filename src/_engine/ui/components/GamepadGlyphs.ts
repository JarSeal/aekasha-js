// A gamepad input's glyph (p808 D5): what the input glyph draws for a gamepad's button, stick or
// axis, by the pad's family, and what it says for it. The standard mapping names a button by its
// position (SOUTH is A on an Xbox pad, Cross on a PlayStation pad, B on a Nintendo pad), so the
// family picks the label. Neutral in colour (p800 D6): the brands' button colours would be colour
// as decoration; an app restyles `.aekInputGlyph[data-button]`. The kit's own markup: a production
// app may not register the built-in icons.

/**
 * A gamepad's family, the labels on its face buttons: the kit's copy of the engine's
 * `GamepadFamily` (`getGamepadFamily`, `getLastInputDevice`), so an app passes it as it is.
 */
export type InputGlyphFamily = 'XBOX' | 'PLAYSTATION' | 'NINTENDO' | 'GENERIC';

/**
 * A gamepad button by its position in the standard mapping: the kit's copy of the engine's
 * `GamepadButtonName`.
 */
export type InputGlyphGamepadButton =
  | 'SOUTH'
  | 'EAST'
  | 'WEST'
  | 'NORTH'
  | 'LEFT_SHOULDER'
  | 'RIGHT_SHOULDER'
  | 'LEFT_TRIGGER'
  | 'RIGHT_TRIGGER'
  | 'SELECT'
  | 'START'
  | 'LEFT_STICK'
  | 'RIGHT_STICK'
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT'
  | 'HOME';

/** A gamepad input, in the action bindings' shapes (`GAMEPAD` button, stick and axis bindings). */
export type InputGlyphGamepadInput =
  /** A button */
  | { device: 'GAMEPAD'; button: InputGlyphGamepadButton }
  /** A stick, or the d-pad read as one */
  | { device: 'GAMEPAD'; stick: 'LEFT' | 'RIGHT' | 'DPAD' }
  /** One axis of a stick */
  | { device: 'GAMEPAD'; axis: 'LEFT_X' | 'LEFT_Y' | 'RIGHT_X' | 'RIGHT_Y' };

type Shape = 'circle' | 'pill' | 'trigger' | 'plain';
type FamilyLabels = [shown: string, spoken: string];

/** Per family, by button: [shown, spoken]. The face buttons' PlayStation labels are shapes (SVG) */
const LABELS: Record<
  Exclude<InputGlyphGamepadButton, `DPAD_${string}`>,
  Record<InputGlyphFamily, FamilyLabels>
> = {
  SOUTH: {
    XBOX: ['A', 'A button'],
    PLAYSTATION: ['', 'Cross button'],
    NINTENDO: ['B', 'B button'],
    GENERIC: ['', 'Bottom face button'],
  },
  EAST: {
    XBOX: ['B', 'B button'],
    PLAYSTATION: ['', 'Circle button'],
    NINTENDO: ['A', 'A button'],
    GENERIC: ['', 'Right face button'],
  },
  WEST: {
    XBOX: ['X', 'X button'],
    PLAYSTATION: ['', 'Square button'],
    NINTENDO: ['Y', 'Y button'],
    GENERIC: ['', 'Left face button'],
  },
  NORTH: {
    XBOX: ['Y', 'Y button'],
    PLAYSTATION: ['', 'Triangle button'],
    NINTENDO: ['X', 'X button'],
    GENERIC: ['', 'Top face button'],
  },
  LEFT_SHOULDER: {
    XBOX: ['LB', 'Left bumper'],
    PLAYSTATION: ['L1', 'L1 button'],
    NINTENDO: ['L', 'L button'],
    GENERIC: ['L1', 'Left shoulder button'],
  },
  RIGHT_SHOULDER: {
    XBOX: ['RB', 'Right bumper'],
    PLAYSTATION: ['R1', 'R1 button'],
    NINTENDO: ['R', 'R button'],
    GENERIC: ['R1', 'Right shoulder button'],
  },
  LEFT_TRIGGER: {
    XBOX: ['LT', 'Left trigger'],
    PLAYSTATION: ['L2', 'L2 button'],
    NINTENDO: ['ZL', 'ZL button'],
    GENERIC: ['L2', 'Left trigger'],
  },
  RIGHT_TRIGGER: {
    XBOX: ['RT', 'Right trigger'],
    PLAYSTATION: ['R2', 'R2 button'],
    NINTENDO: ['ZR', 'ZR button'],
    GENERIC: ['R2', 'Right trigger'],
  },
  SELECT: {
    XBOX: ['View', 'View button'],
    PLAYSTATION: ['Share', 'Share button'],
    NINTENDO: ['−', 'Minus button'],
    GENERIC: ['Select', 'Select button'],
  },
  START: {
    XBOX: ['Menu', 'Menu button'],
    PLAYSTATION: ['Options', 'Options button'],
    NINTENDO: ['+', 'Plus button'],
    GENERIC: ['Start', 'Start button'],
  },
  LEFT_STICK: {
    XBOX: ['LS', 'Left stick press'],
    PLAYSTATION: ['L3', 'L3 button'],
    NINTENDO: ['LS', 'Left stick press'],
    GENERIC: ['L3', 'Left stick press'],
  },
  RIGHT_STICK: {
    XBOX: ['RS', 'Right stick press'],
    PLAYSTATION: ['R3', 'R3 button'],
    NINTENDO: ['RS', 'Right stick press'],
    GENERIC: ['R3', 'Right stick press'],
  },
  HOME: {
    XBOX: ['Xbox', 'Xbox button'],
    PLAYSTATION: ['PS', 'PS button'],
    NINTENDO: ['Home', 'Home button'],
    GENERIC: ['Home', 'Home button'],
  },
};

const FACE_BUTTONS = ['SOUTH', 'EAST', 'WEST', 'NORTH'];

/** PlayStation's face buttons' shapes, in a 24 × 24 box drawn on the circle */
const PLAYSTATION_SHAPES: Record<string, string> = {
  SOUTH: '<path d="M8 8L16 16M16 8L8 16"/>',
  EAST: '<circle cx="12" cy="12" r="4.5"/>',
  WEST: '<rect x="7.75" y="7.75" width="8.5" height="8.5"/>',
  NORTH: '<path d="M12 7L17 15.5H7Z"/>',
};

/** A generic pad's face buttons: four dots in a diamond, the one at the button's place filled */
const DIAMOND = { NORTH: [12, 5], EAST: [19, 12], SOUTH: [12, 19], WEST: [5, 12] };

/** The d-pad: a cross whose arm for the direction is filled */
const DPAD_ARMS = {
  UP: 'M9.5 2.5H14.5V9.5H9.5Z',
  DOWN: 'M9.5 14.5H14.5V21.5H9.5Z',
  LEFT: 'M2.5 9.5H9.5V14.5H2.5Z',
  RIGHT: 'M14.5 9.5H21.5V14.5H14.5Z',
};
const DPAD_OUTLINE =
  '<path d="M9.5 2.5H14.5V9.5H21.5V14.5H14.5V21.5H9.5V14.5H2.5V9.5H9.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>';

const STICK = (letter: string) =>
  `<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="12" dy="0.35em" text-anchor="middle" font-size="7" font-weight="600" fill="currentColor">${letter}</text>`;
const AXIS_ARROWS = {
  X: '<path class="aekInputGlyph__active" d="M1 12L3.5 9.5V14.5ZM23 12L20.5 9.5V14.5Z"/>',
  Y: '<path class="aekInputGlyph__active" d="M12 1L9.5 3.5H14.5ZM12 23L9.5 20.5H14.5Z"/>',
};

const svg = (content: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;

const label = (text: string) => `<span class="aekInputGlyph__label">${text}</span>`;

const write = (elem: HTMLElement, shape: Shape, spoken: string, html: string) => {
  elem.setAttribute('data-device', 'gamepad');
  elem.setAttribute('data-shape', shape);
  elem.setAttribute('aria-label', spoken);
  elem.innerHTML = html;
};

/**
 * Writes a gamepad input's glyph into the input glyph's element: its shape, its label or SVG, and
 * its spoken name as the `aria-label`.
 * @internal
 */
export const writeGamepadGlyph = (
  elem: HTMLElement,
  input: InputGlyphGamepadInput,
  family: InputGlyphFamily
) => {
  elem.setAttribute('data-family', family.toLowerCase());
  if ('stick' in input) {
    elem.setAttribute('data-button', `STICK_${input.stick}`);
    if (input.stick === 'DPAD') return write(elem, 'plain', 'D-pad', svg(DPAD_OUTLINE));
    const side = input.stick === 'LEFT' ? 'Left' : 'Right';
    return write(elem, 'plain', `${side} stick`, svg(STICK(side[0])));
  }
  if ('axis' in input) {
    elem.setAttribute('data-button', input.axis);
    const side = input.axis.startsWith('LEFT') ? 'Left' : 'Right';
    const isX = input.axis.endsWith('X');
    const spoken = `${side} stick, ${isX ? 'left and right' : 'up and down'}`;
    return write(elem, 'plain', spoken, svg(STICK(side[0]) + AXIS_ARROWS[isX ? 'X' : 'Y']));
  }
  const button = input.button;
  elem.setAttribute('data-button', button);
  if (button.startsWith('DPAD_')) {
    const dir = button.slice(5) as keyof typeof DPAD_ARMS;
    const spoken = `D-pad ${dir.toLowerCase()}`;
    const arm = `<path class="aekInputGlyph__active" d="${DPAD_ARMS[dir]}"/>`;
    return write(elem, 'plain', spoken, svg(DPAD_OUTLINE + arm));
  }
  const [shown, spoken] = LABELS[button as keyof typeof LABELS][family];
  if (FACE_BUTTONS.includes(button)) {
    if (family === 'PLAYSTATION') {
      const shape = `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round">${PLAYSTATION_SHAPES[button]}</g>`;
      return write(elem, 'circle', spoken, svg(shape));
    }
    if (family === 'GENERIC') {
      let dots = '';
      for (const [name, [x, y]] of Object.entries(DIAMOND)) {
        const cls = name === button ? ' class="aekInputGlyph__active"' : '';
        dots += `<circle${cls} cx="${x}" cy="${y}" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
      }
      return write(elem, 'plain', spoken, svg(dots));
    }
    return write(elem, 'circle', spoken, label(shown));
  }
  const shape = button === 'LEFT_TRIGGER' || button === 'RIGHT_TRIGGER' ? 'trigger' : 'pill';
  return write(elem, shape, spoken, label(shown));
};
