import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createDialogueBox, type DialogueBoxProps } from './DialogueBox';

/** A dialogue box added to the HUD root */
const addBox = (props: DialogueBoxProps = {}) => {
  const box = createDialogueBox(props);
  getHUDRootCMP().add(box.cmp);
  return box;
};

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekDialogueBox__${name}`) as HTMLElement;

const getChoices = (elem: Element) =>
  [...elem.querySelectorAll('.aekDialogueBox__choice')] as HTMLButtonElement[];

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

/** What the HUD's announcer reads after its delay */
const readAnnouncement = () => {
  vi.advanceTimersByTime(50);
  return [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status')
    ?.textContent;
};

/** `--aek-motion: 0` on every element, as a reduced motion setting gives */
const stubReducedMotion = () => {
  const original = window.getComputedStyle;
  window.getComputedStyle = (() => ({ getPropertyValue: () => '0' })) as never;
  return () => {
    window.getComputedStyle = original;
  };
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // The announcer's region outlives a test: its pending text is written before the fake clock goes
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('dialogue box (p808 D10)', () => {
  it('is a named group, empty until a line, the whole line read at its start', () => {
    const box = addBox();
    const elem = box.cmp.elem;
    expect(elem.getAttribute('role')).toBe('group');
    expect(elem.getAttribute('aria-label')).toBe('Dialogue');
    expect(elem.getAttribute('data-state')).toBe('empty');
    box.setLine({ speaker: 'Mara', speakerColor: '#e8a33d', text: 'Over here!' });
    expect(elem.getAttribute('data-state')).toBe('revealing');
    const speaker = part(elem, 'speaker');
    expect(speaker.textContent).toBe('Mara');
    expect(speaker.getAttribute('aria-hidden')).toBe('true');
    expect(speaker.style.getPropertyValue('--aek-dialogue-box-speaker-color')).toBe('#e8a33d');
    expect(part(elem, 'line').getAttribute('aria-hidden')).toBe('true');
    expect(part(elem, 'spoken').textContent).toBe('Mara: Over here!');
    expect(readAnnouncement()).toBe('Mara: Over here!');
    const next = part(elem, 'next');
    expect(next.tagName).toBe('BUTTON');
    expect(next.getAttribute('aria-label')).toBe('Continue');
    expect(next.hidden).toBe(false);
    box.setLine({ text: 'The gate is shut.' });
    expect(speaker.hidden).toBe(true);
    expect(speaker.style.getPropertyValue('--aek-dialogue-box-speaker-color')).toBe('');
    box.setLine(null);
    expect(elem.getAttribute('data-state')).toBe('empty');
    expect(next.hidden).toBe(true);
    box.cmp.remove();
  });

  it('reveals the line at its speed, the rest kept in place, a character a surrogate pair', () => {
    const box = addBox({ charsPerSecond: 10 });
    const elem = box.cmp.elem;
    box.setLine({ text: 'Hi 👋 there' });
    expect(part(elem, 'shown').textContent).toBe('');
    expect(part(elem, 'rest').textContent).toBe('Hi 👋 there');
    vi.advanceTimersByTime(300);
    expect(part(elem, 'shown').textContent).toBe('Hi ');
    vi.advanceTimersByTime(100);
    expect(part(elem, 'shown').textContent).toBe('Hi 👋');
    expect(part(elem, 'rest').textContent).toBe(' there');
    expect(box.isRevealing()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(part(elem, 'shown').textContent).toBe('Hi 👋 there');
    expect(part(elem, 'rest').textContent).toBe('');
    expect(box.isRevealing()).toBe(false);
    expect(elem.getAttribute('data-state')).toBe('waiting');
    box.cmp.remove();
  });

  it('shows the whole line on the first confirm and advances on the second, by click too', () => {
    const onAdvance = vi.fn();
    const box = addBox({ onAdvance });
    const elem = box.cmp.elem;
    box.setLine({ text: 'A long line that takes a while to type out.' });
    box.confirm();
    expect(box.isRevealing()).toBe(false);
    expect(part(elem, 'rest').textContent).toBe('');
    expect(onAdvance).not.toHaveBeenCalled();
    box.confirm();
    expect(onAdvance).toHaveBeenCalledTimes(1);
    box.setLine({ text: 'Next.' });
    click(part(elem, 'line'));
    expect(box.isRevealing()).toBe(false);
    click(part(elem, 'next'));
    expect(onAdvance).toHaveBeenCalledTimes(2);
    box.cmp.remove();
  });

  it('keeps Enter and Space on its buttons from the action maps', () => {
    const box = addBox();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    box.setLine({ text: 'Over here!' });
    box.focus();
    expect(document.activeElement).toBe(part(box.cmp.elem, 'next'));
    const event = dispatchKey(part(box.cmp.elem, 'next'), 'keydown', 'Enter');
    // Its click is the button's own: not prevented, only stopped
    expect(event.defaultPrevented).toBe(false);
    expect(onWindowKey).not.toHaveBeenCalled();
    dispatchKey(box.cmp.elem, 'keydown', 'Enter');
    expect(onWindowKey).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', onWindowKey);
    box.cmp.remove();
  });

  it('shows the choices once revealed, the focus on the first, and moves and picks by keys', () => {
    const onChoice = vi.fn();
    const box = addBox({ onChoice, charsPerSecond: 100 });
    const elem = box.cmp.elem;
    box.setLine({
      speaker: 'Mara',
      text: 'Well?',
      choices: [
        { label: 'Ask about the gate' },
        { label: 'Leave', disabled: true },
        { label: 'Bribe' },
      ],
    });
    box.focus();
    const choicesElem = part(elem, 'choices');
    expect(choicesElem.hidden).toBe(true);
    vi.advanceTimersByTime(100);
    expect(elem.getAttribute('data-state')).toBe('choosing');
    expect(choicesElem.hidden).toBe(false);
    expect(choicesElem.getAttribute('role')).toBe('group');
    expect(choicesElem.getAttribute('aria-label')).toBe('Choices');
    expect(part(elem, 'next').hidden).toBe(true);
    const choices = getChoices(elem);
    expect(choices.map((choice) => choice.textContent)).toEqual([
      '1Ask about the gate',
      '2Leave',
      '3Bribe',
    ]);
    expect(choices[0].getAttribute('aria-keyshortcuts')).toBe('1');
    expect(part(choices[0], 'choiceKey').getAttribute('aria-hidden')).toBe('true');
    expect(choices[1].disabled).toBe(true);
    // Continue had the focus and went: the first choice has it
    expect(document.activeElement).toBe(choices[0]);
    // Past the disabled one, and round
    expect(dispatchKey(choices[0], 'keydown', 'ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(choices[2]);
    dispatchKey(choices[2], 'keydown', 'ArrowRight');
    expect(document.activeElement).toBe(choices[0]);
    dispatchKey(choices[0], 'keydown', 'End');
    expect(document.activeElement).toBe(choices[2]);
    // A disabled one's number does nothing; a confirm neither
    dispatchKey(choices[2], 'keydown', '2');
    box.confirm();
    expect(onChoice).not.toHaveBeenCalled();
    dispatchKey(choices[2], 'keydown', '3');
    expect(onChoice).toHaveBeenCalledWith(2);
    // Once a line
    click(choices[0]);
    expect(onChoice).toHaveBeenCalledTimes(1);
    box.setLine({ text: 'Fine.' });
    // The choices went with the focus in them: Continue has it
    expect(getChoices(elem)).toHaveLength(0);
    expect(document.activeElement).toBe(part(elem, 'next'));
    box.cmp.remove();
  });

  it('picks by click and by choose, and shows the line at once under reduced motion', () => {
    const onChoice = vi.fn();
    const box = addBox({ onChoice });
    const elem = box.cmp.elem;
    const restore = stubReducedMotion();
    box.setLine({ text: 'Which way?', choices: [{ label: 'Left' }, { label: 'Right' }] });
    restore();
    expect(elem.getAttribute('data-state')).toBe('choosing');
    expect(part(elem, 'shown').textContent).toBe('Which way?');
    box.choose(5);
    expect(onChoice).not.toHaveBeenCalled();
    click(part(getChoices(elem)[1], 'choiceLabel'));
    expect(onChoice).toHaveBeenCalledWith(1);
    box.setLine({ text: 'Again?', choices: [{ label: 'Yes' }] });
    box.choose(0);
    // Not before the choices show
    expect(onChoice).toHaveBeenCalledTimes(1);
    box.confirm();
    box.choose(0);
    expect(onChoice).toHaveBeenLastCalledWith(0);
    box.cmp.remove();
  });

  it('moves a portrait in and out without removing it', () => {
    const box = addBox();
    const elem = box.cmp.elem;
    const face = document.createElement('img');
    const portraitElem = part(elem, 'portrait');
    expect(portraitElem.hidden).toBe(true);
    box.setLine({ text: 'Hello', portrait: face });
    expect(portraitElem.hidden).toBe(false);
    expect(face.parentElement).toBe(portraitElem);
    box.setLine({ text: 'Hello again', portrait: face });
    expect(face.parentElement).toBe(portraitElem);
    box.setLine({ text: 'Narration' });
    expect(portraitElem.hidden).toBe(true);
    expect(face.parentElement).toBeNull();
    box.cmp.remove();
  });

  it('leaves no timer or listener after its removal mid-reveal', () => {
    const box = addBox();
    const elem = box.cmp.elem;
    box.setLine({ text: 'A line cut short' });
    vi.advanceTimersByTime(50);
    box.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
    expect(countListeners(elem)).toBe(0);
  });
});
