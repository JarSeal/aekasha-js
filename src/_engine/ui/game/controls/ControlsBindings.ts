// The controls page's binding logic (p808 D9), pure: which parts of an action's bindings a cell
// can rebind (its slots), what a captured input makes of them, and where it's bound already. The
// bindings are the action map's plain data in the input prompt's shapes; a new list is made for
// every change (the app hands it to `map.setBindings`), never written in place.
import type { InputGlyphInput } from '../../components/InputGlyph';
import type { InputGlyphGamepadButton } from '../../components/GamepadGlyphs';
import {
  getBindingInputs,
  getKeyInputs,
  type InputPromptBinding,
  type PromptKeyChord,
  type PromptKeys,
} from '../InputPrompt';

/** A column of the controls page: the keyboard with the mouse, or the gamepad. */
export type ControlsColumn = 'KEYBOARD_MOUSE' | 'GAMEPAD';

/** An action's type, as the action map's (`ActionDef.type`): what an empty cell may bind. */
export type ControlsActionType = 'BUTTON' | 'AXIS_1D' | 'AXIS_2D' | 'DELTA_2D';

/**
 * A keyboard binding's part a slot rebinds: a button's `keys`, an axis' `negative` / `positive`,
 * a composite's `up` / `down` / `left` / `right`.
 * @internal
 */
export type KeyPart = 'keys' | 'negative' | 'positive' | 'up' | 'down' | 'left' | 'right';

/**
 * One thing a cell rebinds: a binding's index in the action's list (-1: none yet, a capture adds
 * one) and, for a keyboard binding, its part.
 * @internal
 */
export type BindSlot = { index: number; part: KeyPart | null };

/**
 * What a capture took: a key (`KeyboardEvent.key`, a letter lowercased), a mouse button or a
 * gamepad button.
 * @internal
 */
export type CapturedInput =
  | { device: 'KEYBOARD'; key: string }
  | { device: 'MOUSE'; button: 'LEFT' | 'MIDDLE' | 'RIGHT' }
  | { device: 'GAMEPAD'; button: InputGlyphGamepadButton };

/** The parts of a keyboard binding with parts, in the order a cell shows them (W A S D) */
const COMPOSITE_PARTS: readonly KeyPart[] = ['up', 'left', 'down', 'right'];
const AXIS_PARTS: readonly KeyPart[] = ['negative', 'positive'];

/** A binding's column, null for touch (no column) */
export const getBindingColumn = (binding: InputPromptBinding): ControlsColumn | null => {
  if (binding.device === 'GAMEPAD') return 'GAMEPAD';
  return binding.device === 'TOUCH' ? null : 'KEYBOARD_MOUSE';
};

/** Whether a binding is one button (a key list, one key, a mouse or gamepad button): one slot */
const isButtonBinding = (binding: InputPromptBinding) =>
  'keys' in binding || 'key' in binding || 'button' in binding;

/** A keyboard binding's parts, null for one without (a button's keys are one part) */
const getKeyParts = (binding: InputPromptBinding): readonly KeyPart[] | null => {
  if (binding.device !== 'KEYBOARD') return null;
  if ('up' in binding) return COMPOSITE_PARTS;
  if ('negative' in binding) return AXIS_PARTS;
  return null;
};

/**
 * A cell's slots: the parts of the action's first binding in the column that a capture can set (a
 * button's one, an axis' two, a composite's four), else one empty slot for a button action with
 * none there; and that binding's index when it can't be rebound (a stick, the mouse's movement),
 * which the cell shows as it is.
 * @internal
 */
export const getCellSlots = (
  bindings: readonly InputPromptBinding[],
  column: ControlsColumn,
  type: ControlsActionType = 'BUTTON'
): { slots: BindSlot[]; fixed: number } => {
  const index = bindings.findIndex((binding) => getBindingColumn(binding) === column);
  if (index === -1) {
    return { slots: type === 'BUTTON' ? [{ index: -1, part: null }] : [], fixed: -1 };
  }
  const binding = bindings[index];
  if (isButtonBinding(binding)) {
    return { slots: [{ index, part: binding.device === 'KEYBOARD' ? 'keys' : null }], fixed: -1 };
  }
  const parts = getKeyParts(binding);
  if (!parts) return { slots: [], fixed: index };
  return { slots: parts.map((part) => ({ index, part })), fixed: -1 };
};

/** A part's keys as a list */
const toKeyList = (keys: PromptKeys | undefined): readonly (string | PromptKeyChord)[] =>
  keys === undefined ? [] : typeof keys === 'string' ? [keys] : keys;

/** A key or a chord's key, lowercased for comparing (the maps' keys are case-insensitive) */
const toLowerKey = (key: string | PromptKeyChord) =>
  (typeof key === 'string' ? key : key.key).toLowerCase();

/** A slot's keys (a keyboard binding's part, or its one key) */
const getSlotKeys = (binding: InputPromptBinding, part: KeyPart | null) => {
  if (binding.device !== 'KEYBOARD') return [];
  if ('key' in binding) return [binding.key];
  if (part === null) return [];
  return toKeyList((binding as unknown as Record<KeyPart, PromptKeys | undefined>)[part]);
};

/**
 * What a slot shows: its part's first key (a chord's modifiers with it), the mouse or gamepad
 * button; none for an empty slot.
 * @internal
 */
export const getSlotInputs = (
  bindings: readonly InputPromptBinding[],
  slot: BindSlot
): InputGlyphInput[] => {
  const binding = bindings[slot.index];
  if (!binding) return [];
  if (binding.device === 'KEYBOARD') return getKeyInputs(getSlotKeys(binding, slot.part));
  return getBindingInputs(binding);
};

/**
 * A slot's first input as a captured one (what a swap gives the other action), null for an empty
 * slot. A chord gives its key: a swap moves the key, not the modifiers.
 * @internal
 */
export const getSlotInput = (
  bindings: readonly InputPromptBinding[],
  slot: BindSlot
): CapturedInput | null => {
  const binding = bindings[slot.index];
  if (!binding) return null;
  if (binding.device === 'KEYBOARD') {
    const first = getSlotKeys(binding, slot.part)[0];
    if (first === undefined) return null;
    return { device: 'KEYBOARD', key: typeof first === 'string' ? first : first.key };
  }
  if (binding.device === 'MOUSE' && 'button' in binding) {
    return { device: 'MOUSE', button: binding.button };
  }
  if (binding.device === 'GAMEPAD' && 'button' in binding) {
    return { device: 'GAMEPAD', button: binding.button };
  }
  return null;
};

/**
 * Whether a slot is bound to an input: any of its part's keys (a chord by its key), its mouse or
 * gamepad button.
 * @internal
 */
export const isSlotBoundTo = (
  bindings: readonly InputPromptBinding[],
  slot: BindSlot,
  input: CapturedInput
) => {
  const binding = bindings[slot.index];
  if (!binding || binding.device !== input.device) return false;
  if (input.device === 'KEYBOARD') {
    const key = input.key.toLowerCase();
    return getSlotKeys(binding, slot.part).some((candidate) => toLowerKey(candidate) === key);
  }
  return 'button' in binding && binding.button === input.button;
};

/**
 * Whether a slot can take an input: a part of an axis or a composite only a key, a button's slot
 * any input of its column.
 * @internal
 */
export const canSlotTake = (slot: BindSlot, column: ControlsColumn, input: CapturedInput) => {
  if (column === 'GAMEPAD') return input.device === 'GAMEPAD';
  if (input.device === 'GAMEPAD') return false;
  return slot.part === null || slot.part === 'keys' || input.device === 'KEYBOARD';
};

/** A button binding for an input, keeping a keyboard binding's `ignoreModifiers` */
const toButtonBinding = (
  input: CapturedInput,
  old: InputPromptBinding | undefined
): InputPromptBinding => {
  if (input.device !== 'KEYBOARD') return { ...input };
  const ignoreModifiers =
    old && old.device === 'KEYBOARD' && 'ignoreModifiers' in old
      ? (old as { ignoreModifiers?: boolean }).ignoreModifiers
      : undefined;
  return ignoreModifiers === undefined
    ? { device: 'KEYBOARD', keys: [input.key] }
    : ({ device: 'KEYBOARD', keys: [input.key], ignoreModifiers } as InputPromptBinding);
};

/**
 * The action's bindings with a slot set to an input (a rebind: the slot's keys become that one
 * key), a new list; null when the slot can't take it.
 * @internal
 */
export const applySlotInput = (
  bindings: readonly InputPromptBinding[],
  slot: BindSlot,
  input: CapturedInput
): InputPromptBinding[] | null => {
  const next = [...bindings];
  const old = bindings[slot.index];
  if (slot.part === null || slot.part === 'keys') {
    const binding = toButtonBinding(input, old);
    if (slot.index === -1) next.push(binding);
    else next[slot.index] = binding;
    return next;
  }
  if (!old || input.device !== 'KEYBOARD') return null;
  next[slot.index] = { ...old, [slot.part]: [input.key] } as InputPromptBinding;
  return next;
};

/**
 * The action's bindings with an input taken off a slot, `replacement` in its place (a swap gives
 * the other action the rebound one's old input there): the matching key replaced in the part's
 * list, the others kept. Without a replacement the key is dropped, and a button binding left with
 * no key goes; null when a part would be left empty or the slot can't take the replacement.
 * @internal
 */
export const replaceSlotInput = (
  bindings: readonly InputPromptBinding[],
  slot: BindSlot,
  input: CapturedInput,
  replacement: CapturedInput | null
): InputPromptBinding[] | null => {
  const binding = bindings[slot.index];
  if (!binding) return null;
  const next = [...bindings];
  if (input.device !== 'KEYBOARD' || replacement?.device !== 'KEYBOARD') {
    // A whole binding changes: a mouse or gamepad button, or a key to a button or back
    if (replacement === null) {
      if (slot.part !== null && slot.part !== 'keys') return null;
      const keys = getSlotKeys(binding, slot.part);
      if (input.device === 'KEYBOARD' && keys.length > 1) {
        const key = input.key.toLowerCase();
        const rest = keys.filter((candidate) => toLowerKey(candidate) !== key);
        next[slot.index] = { ...binding, keys: rest } as InputPromptBinding;
        return next;
      }
      next.splice(slot.index, 1);
      return next;
    }
    return applySlotInput(bindings, slot, replacement);
  }
  // A key for a key, in place in the part's list
  const key = input.key.toLowerCase();
  const keys = getSlotKeys(binding, slot.part).map((candidate) =>
    toLowerKey(candidate) === key ? replacement.key : candidate
  );
  if ('key' in binding) {
    next[slot.index] = { ...binding, key: replacement.key };
    return next;
  }
  next[slot.index] = { ...binding, [slot.part ?? 'keys']: keys } as InputPromptBinding;
  return next;
};

/**
 * A conflict a capture found: another slot (another action's, or another part of the same one)
 * bound to the input already.
 * @internal
 */
export type SlotConflict = { actionIndex: number; slot: BindSlot };

/**
 * The first other slot bound to an input among `candidates` (the actions of the rebound one's
 * group), skipping the rebound slot itself; null when it's free.
 * @internal
 */
export const findSlotConflict = (
  candidates: readonly { index: number; bindings: readonly InputPromptBinding[] }[],
  column: ControlsColumn,
  rebound: { actionIndex: number; slot: BindSlot },
  input: CapturedInput
): SlotConflict | null => {
  for (const { index: actionIndex, bindings } of candidates) {
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      if (getBindingColumn(binding) !== column) continue;
      const parts = getKeyParts(binding) ?? [binding.device === 'KEYBOARD' ? 'keys' : null];
      for (const part of parts) {
        const slot: BindSlot = { index: i, part };
        const isRebound =
          actionIndex === rebound.actionIndex &&
          i === rebound.slot.index &&
          part === rebound.slot.part;
        if (!isRebound && isSlotBoundTo(bindings, slot, input)) return { actionIndex, slot };
      }
    }
  }
  return null;
};

/**
 * Whether two binding lists are the same data (a reset changes only the actions that differ).
 * @internal
 */
export const isSameBindings = (
  a: readonly InputPromptBinding[],
  b: readonly InputPromptBinding[]
) => a === b || JSON.stringify(a) === JSON.stringify(b);
