import type { CMPAttr, CMPHandle } from '../core/CMPTypes';
import { CMP, classes } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { announce } from '../components/Announcer';
import { getMoveTarget } from '../components/RovingFocus';
import { swallowNextKeyUp } from '../overlays/OverlayStack';
import './DialogueBox.scss';
import '../styles/kit.scss';

/** A choice of a {@link DialogueLine}. */
export type DialogueChoice = {
  /** What it says ('Ask about the gate'). */
  label: string;
  /** Shown but not pickable (a choice the player can't make yet: say why in its label). */
  disabled?: boolean;
};

/** What {@link DialogueBox}'s `setLine` shows. */
export type DialogueLine = {
  /** What's said. */
  text: string;
  /** Who says it, over the text. */
  speaker?: string;
  /** The speaker's colour (any CSS colour) on its name, which says who it is: the colour helps
   * tell them apart. Default `--aek-dialogue-box-speaker-color`. */
  speakerColor?: string;
  /** A portrait shown at the box's start (an element or a CMP the app makes and keeps; the box
   * moves it in and out, never removes it). None: no portrait. */
  portrait?: CMPHandle | HTMLElement;
  /** The player's answers, shown when the line is revealed; `onChoice` reports the pick. None:
   * the line is advanced (`onAdvance`). */
  choices?: readonly DialogueChoice[];
};

/** What {@link createDialogueBox} draws. */
export type DialogueBoxProps = {
  /** The player asks for the next line (a line without choices, once revealed): set it with
   * `setLine`, or remove the box. */
  onAdvance?: () => void;
  /** The player picks a choice, by its index: set the next line. */
  onChoice?: (index: number) => void;
  /** The typewriter's speed (default 40); 0 shows each line at once. */
  charsPerSecond?: number;
  /** Its name for assistive tech (default 'Dialogue'). */
  label?: string;
  /** Where it places itself (default `'bottom'`): across the bottom of the HUD's bounds, fixed
   * there, or `'inline'`, in the flow of what it's added to (a panel). */
  placement?: 'bottom' | 'inline';
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A dialogue box {@link createDialogueBox} made: its CMP and its controls. */
export type DialogueBox = {
  /** Its element (`.aekDialogueBox`): add it to the HUD root, or into a panel for `'inline'`.
   * `cmp.remove()` ends the reveal. */
  cmp: CMPHandle;
  /** Shows a line, revealed by the typewriter and read at once; `null` empties the box. The focus
   * inside the box stays inside it (on the first choice, else on Continue). */
  setLine: (line: DialogueLine | null) => void;
  /** What Enter, Space and a click do (a gamepad's `SOUTH` calls it): shows the whole line while
   * it's revealed, else advances a line without choices. */
  confirm: () => void;
  /** Picks a choice by its index (a gamepad's own choice keys), as a click on it does; nothing for
   * a disabled one, or before the choices show. */
  choose: (index: number) => void;
  /** Whether the typewriter is still revealing the line */
  isRevealing: () => boolean;
  /** Moves the focus into the box: its first enabled choice, else Continue. Do it when a
   * conversation starts, so Enter and Space reach it. */
  focus: () => void;
};

/** The box's states: no line, the typewriter on, the line shown, the choices shown */
type DialogueState = 'empty' | 'revealing' | 'waiting' | 'choosing';

const CHARS_PER_SECOND = 40;
/** The typewriter's shortest step: a frame */
const MIN_TICK_MS = 16;

const createPart = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

/** The code unit offset of each character's end (a surrogate pair is one character), from 0 */
const getCharOffsets = (text: string) => {
  const offsets = [0];
  let offset = 0;
  for (const char of text) {
    offset += char.length;
    offsets.push(offset);
  }
  return offsets;
};

/**
 * Creates a dialogue box (p808 D10): a conversation's line at the bottom of the screen, its
 * speaker over it and an optional portrait beside it, revealed by a typewriter. Enter, Space or a
 * click shows the whole line, then advances; a line with choices shows them as buttons. The
 * conversation is the game's: it sets each line and reacts to `onAdvance` and `onChoice`.
 * - Parts: `.aekDialogueBox` (`data-placement`, `data-state="empty" | "revealing" | "waiting" |
 *   "choosing"`), `.aekDialogueBox__portrait` (`hidden` without one), `.aekDialogueBox__body`,
 *   `.aekDialogueBox__speaker`, `.aekDialogueBox__line` (the reveal: `__shown` and the hidden
 *   `__rest` that keeps the box from reflowing), `.aekDialogueBox__spoken` (the whole line for
 *   assistive tech), `.aekDialogueBox__choices` with an `.aekDialogueBox__choice` button per
 *   choice (`data-index`, its `__choiceKey` number), and `.aekDialogueBox__next` (Continue, its
 *   mark bobbing while the line waits).
 * - Custom properties (read on any ancestor): `--aek-dialogue-box-bg` (default the raised surface
 *   at 94 %), `--aek-dialogue-box-width` (its maximum width), `--aek-dialogue-box-font-size`
 *   (default `--aek-font-size-lg`), `--aek-dialogue-box-speaker-color` (default `--aek-accent`; a
 *   line's `speakerColor` sets it on the name), `--aek-dialogue-box-portrait-size`,
 *   `--aek-dialogue-box-inset`, `--aek-dialogue-box-z` (default `--aek-z-window`).
 * - Keys (with the focus in the box): Enter / Space on Continue shows the line, then advances;
 *   on a choice picks it; the arrows move between the choices (round), Home / End to the ends;
 *   1-9 pick a choice by its number. A key it uses goes no further (an action map's Enter doesn't
 *   advance twice).
 * - Assistive tech: a `role="group"` named by `label`. The reveal and the speaker are
 *   `aria-hidden`; the whole line ('Mara: Over here!') is in `__spoken` and read politely when the
 *   line starts, not per character. The choices are a group ('Choices'), each a button with
 *   `aria-keyshortcuts` (its number); a disabled one stays readable.
 * - Motion: the typewriter's characters per second; under reduced motion (a factor of 0 at the
 *   line's start) the whole line at once and Continue's mark still.
 * @example
 * ```ts
 * import { createDialogueBox, getHUDRootCMP } from 'aekasha/ui';
 *
 * const lines = ['Over here!', 'The gate opens at dusk.'];
 * let at = 0;
 * const dialogue = createDialogueBox({
 *   onAdvance: () => {
 *     at += 1;
 *     if (at < lines.length) dialogue.setLine({ speaker: 'Mara', text: lines[at] });
 *     else dialogue.cmp.remove();
 *   },
 * });
 * getHUDRootCMP().add(dialogue.cmp);
 * dialogue.setLine({ speaker: 'Mara', text: lines[0] });
 * dialogue.focus();
 * ```
 */
export const createDialogueBox = (props: DialogueBoxProps = {}): DialogueBox => {
  const charsPerSecond = props.charsPerSecond ?? CHARS_PER_SECOND;
  let state: DialogueState = 'empty';
  let line: DialogueLine | null = null;
  let offsets: number[] = [0];
  let shownCount = 0;
  let startedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let choiceElems: HTMLButtonElement[] = [];
  let portrait: HTMLElement | null = null;
  // A pick is reported once, until the next line
  let isChosen = false;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekDialogueBox', props.class),
    attr: {
      ...props.attr,
      role: 'group',
      'aria-label': props.label ?? 'Dialogue',
      'data-placement': props.placement ?? 'bottom',
      'data-state': 'empty',
    },
    onRemoveCmp: () => {
      stopReveal();
      elem.removeEventListener('click', onClick);
      elem.removeEventListener('keydown', onKeyDown);
    },
  });
  const elem = cmp.elem;

  const portraitElem = createPart('div', 'aekDialogueBox__portrait');
  portraitElem.hidden = true;
  const body = createPart('div', 'aekDialogueBox__body');
  const speakerElem = createPart('p', 'aekDialogueBox__speaker');
  speakerElem.setAttribute('aria-hidden', 'true');
  speakerElem.hidden = true;
  const lineElem = createPart('p', 'aekDialogueBox__line');
  lineElem.setAttribute('aria-hidden', 'true');
  const shownElem = createPart('span', 'aekDialogueBox__shown');
  const restElem = createPart('span', 'aekDialogueBox__rest');
  const shownText = document.createTextNode('');
  const restText = document.createTextNode('');
  shownElem.append(shownText);
  restElem.append(restText);
  lineElem.append(shownElem, restElem);
  const spokenElem = createPart('p', 'aekDialogueBox__spoken aekVisuallyHidden');
  const choicesElem = createPart('div', 'aekDialogueBox__choices');
  choicesElem.setAttribute('role', 'group');
  choicesElem.setAttribute('aria-label', 'Choices');
  choicesElem.hidden = true;
  const nextButton = createPart('button', 'aekDialogueBox__next');
  nextButton.type = 'button';
  nextButton.setAttribute('aria-label', 'Continue');
  const nextMark = createPart('span', 'aekDialogueBox__nextMark');
  nextMark.setAttribute('aria-hidden', 'true');
  nextButton.append(nextMark);
  nextButton.hidden = true;
  body.append(speakerElem, lineElem, spokenElem, choicesElem, nextButton);
  elem.append(portraitElem, body);

  const isFocusInside = () => elem.contains(document.activeElement);

  const isChoiceDisabled = (index: number) => choiceElems[index]?.disabled !== false;

  /** The first enabled choice while they show, else Continue while it shows */
  const getFocusTarget = () => {
    if (state === 'choosing') {
      const index = choiceElems.findIndex((choice) => !choice.disabled);
      if (index >= 0) return choiceElems[index];
    }
    return nextButton.hidden ? null : nextButton;
  };

  /** Moves the focus that was inside the box, and lost its element, to where it goes now */
  const keepFocus = (wasInside: boolean) => {
    if (!wasInside) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && elem.contains(active) && !active.closest('[hidden]')) return;
    getFocusTarget()?.focus();
  };

  const setState = (next: DialogueState) => {
    state = next;
    elem.setAttribute('data-state', next);
  };

  const writeReveal = (count: number) => {
    shownCount = count;
    const text = line?.text ?? '';
    const at = offsets[count];
    shownText.data = text.slice(0, at);
    restText.data = text.slice(at);
  };

  function stopReveal() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  const buildChoices = (choices: readonly DialogueChoice[]) => {
    choiceElems = choices.map((choice, index) => {
      const button = createPart('button', 'aekDialogueBox__choice');
      button.type = 'button';
      button.setAttribute('data-index', String(index));
      button.disabled = choice.disabled === true;
      const label = createPart('span', 'aekDialogueBox__choiceLabel');
      label.textContent = choice.label;
      if (index < 9) {
        const key = createPart('span', 'aekDialogueBox__choiceKey');
        key.setAttribute('aria-hidden', 'true');
        key.textContent = String(index + 1);
        button.setAttribute('aria-keyshortcuts', String(index + 1));
        button.append(key);
      }
      button.append(label);
      return button;
    });
    choicesElem.replaceChildren(...choiceElems);
  };

  /** The line is all shown: its choices, or Continue */
  const endReveal = () => {
    const wasInside = isFocusInside();
    stopReveal();
    writeReveal(offsets.length - 1);
    const choices = line?.choices ?? [];
    if (choices.length) {
      buildChoices(choices);
      choicesElem.hidden = false;
      nextButton.hidden = true;
      setState('choosing');
    } else setState('waiting');
    keepFocus(wasInside);
  };

  /** Writes the characters due by now, then waits for the next one */
  const tick = () => {
    timer = null;
    const due = Math.floor(((performance.now() - startedAt) * charsPerSecond) / 1000);
    const count = Math.min(offsets.length - 1, due);
    if (count >= offsets.length - 1) {
      endReveal();
      return;
    }
    if (count !== shownCount) writeReveal(count);
    timer = setTimeout(tick, Math.max(MIN_TICK_MS, 1000 / charsPerSecond));
  };

  const setPortrait = (next: HTMLElement | null) => {
    if (next === portrait) return;
    portrait?.remove();
    portrait = next;
    if (next) portraitElem.append(next);
    portraitElem.hidden = !next;
  };

  const setLine = (next: DialogueLine | null) => {
    const wasInside = isFocusInside();
    stopReveal();
    line = next;
    isChosen = false;
    choiceElems = [];
    choicesElem.replaceChildren();
    choicesElem.hidden = true;
    if (!next) {
      offsets = [0];
      writeReveal(0);
      speakerElem.hidden = true;
      spokenElem.textContent = '';
      nextButton.hidden = true;
      setPortrait(null);
      setState('empty');
      return;
    }
    setPortrait(
      next.portrait ? ('elem' in next.portrait ? next.portrait.elem : next.portrait) : null
    );
    speakerElem.textContent = next.speaker ?? '';
    speakerElem.hidden = !next.speaker;
    if (next.speakerColor) {
      speakerElem.style.setProperty('--aek-dialogue-box-speaker-color', next.speakerColor);
    } else speakerElem.style.removeProperty('--aek-dialogue-box-speaker-color');
    const spoken = next.speaker ? `${next.speaker}: ${next.text}` : next.text;
    spokenElem.textContent = spoken;
    // Continue shows during the reveal too: Enter on it shows the whole line
    nextButton.hidden = false;
    offsets = getCharOffsets(next.text);
    writeReveal(0);
    setState('revealing');
    announce(elem, spoken, { append: true });
    if (charsPerSecond <= 0 || getMotionFactor(elem) === 0 || offsets.length === 1) endReveal();
    else {
      startedAt = performance.now();
      timer = setTimeout(tick, Math.max(MIN_TICK_MS, 1000 / charsPerSecond));
    }
    keepFocus(wasInside);
  };

  const confirm = () => {
    if (state === 'revealing') endReveal();
    else if (state === 'waiting') props.onAdvance?.();
  };

  const choose = (index: number) => {
    if (state !== 'choosing' || isChosen || isChoiceDisabled(index)) return;
    isChosen = true;
    props.onChoice?.(index);
  };

  /** A choice's click picks it; any other click in the box confirms (a disabled choice's none) */
  const onClick = (e: Event) => {
    const choice = (e.target as Element).closest('.aekDialogueBox__choice');
    if (choice && elem.contains(choice)) {
      choose(Number(choice.getAttribute('data-index')));
      return;
    }
    confirm();
  };

  const useKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    swallowNextKeyUp(e.key);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { key } = e;
    // Enter and Space click the focused button themselves: kept from the action maps only
    if (key === 'Enter' || key === ' ') {
      if (e.target === nextButton || choiceElems.includes(e.target as HTMLButtonElement)) {
        e.stopPropagation();
        swallowNextKeyUp(key);
      }
      return;
    }
    if (state !== 'choosing') return;
    if (key.length === 1 && key >= '1' && key <= '9') {
      const index = Number(key) - 1;
      if (index >= choiceElems.length) return;
      useKey(e);
      choose(index);
      return;
    }
    const from = choiceElems.indexOf(e.target as HTMLButtonElement);
    if (from === -1) return;
    // The choices are a column or a row: either arrows move
    const moveKey = key === 'ArrowLeft' ? 'ArrowUp' : key === 'ArrowRight' ? 'ArrowDown' : key;
    const to = getMoveTarget(moveKey, from, {
      count: choiceElems.length,
      wrap: true,
      isSkipped: isChoiceDisabled,
    });
    if (to === null) return;
    useKey(e);
    if (to >= 0) choiceElems[to].focus();
  };

  elem.addEventListener('click', onClick);
  elem.addEventListener('keydown', onKeyDown);

  return {
    cmp,
    setLine,
    confirm,
    choose,
    isRevealing: () => state === 'revealing',
    focus: () => getFocusTarget()?.focus(),
  };
};
