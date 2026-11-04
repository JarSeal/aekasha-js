import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createObjectiveTracker, type ObjectiveTrackerProps } from './ObjectiveTracker';

/** A tracker added to the HUD root */
const addTracker = (props: ObjectiveTrackerProps = {}) => {
  const tracker = createObjectiveTracker(props);
  getHUDRootCMP().add(tracker.cmp);
  return tracker;
};

const getRow = (elem: HTMLElement, id: string) =>
  elem.querySelector(`.aekObjectiveTracker__objective[data-key='${id}']`) as HTMLElement | null;

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekObjectiveTracker__${name}`) as HTMLElement;

/** What the HUD's announcer reads after its delay */
const readAnnouncement = () => {
  vi.advanceTimersByTime(50);
  return [...getHUDRootCMP().elem.children].find((child) => child.getAttribute('role') === 'status')
    ?.textContent;
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

describe('objective tracker (p808 D10)', () => {
  it('is a list named by its title, hidden while empty', () => {
    const tracker = addTracker();
    const elem = tracker.cmp.elem;
    expect(elem.hidden).toBe(true);
    expect(elem.getAttribute('data-placement')).toBe('top-left');
    const title = part(elem, 'title');
    expect(title.tagName).toBe('P');
    expect(title.textContent).toBe('Objectives');
    const list = part(elem, 'list');
    expect(list.tagName).toBe('UL');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-labelledby')).toBe(title.id);
    tracker.setObjective('scout', { text: 'Find the scout' });
    expect(elem.hidden).toBe(false);
    tracker.setTitle('The lost scout');
    expect(title.textContent).toBe('The lost scout');
    tracker.removeObjective('scout');
    expect(elem.hidden).toBe(true);
    expect(tracker.hasObjective('scout')).toBe(false);
    tracker.cmp.remove();
  });

  it('shows a count in words for assistive tech, and reads a new objective and a new count', () => {
    const tracker = addTracker({ headingLevel: 2, hideTitle: true });
    const elem = tracker.cmp.elem;
    expect(part(elem, 'title').tagName).toBe('H2');
    expect(part(elem, 'title').classList.contains('aekVisuallyHidden')).toBe(true);
    tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 0, total: 5 } });
    tracker.setObjective('cave', { text: 'Find the cave' });
    const row = getRow(elem, 'crystals') as HTMLElement;
    expect(row.getAttribute('data-state')).toBe('active');
    expect(part(row, 'check').getAttribute('aria-hidden')).toBe('true');
    expect(part(row, 'count').textContent).toBe('0 / 5');
    expect(part(row, 'count').getAttribute('aria-hidden')).toBe('true');
    expect(part(row, 'spoken').textContent).toBe(', 0 of 5');
    expect(part(getRow(elem, 'cave') as HTMLElement, 'count').hidden).toBe(true);
    // Added together, read together
    expect(readAnnouncement()).toBe(
      'New objective: Collect crystals, 0 of 5. New objective: Find the cave'
    );
    tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 1, total: 5 } });
    expect(part(row, 'count').textContent).toBe('1 / 5');
    expect(readAnnouncement()).toBe('Collect crystals, 1 of 5');
    // The same again: nothing new to read
    tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 1, total: 5 } });
    expect(vi.getTimerCount()).toBe(0);
    // In the order they were added
    expect(
      [...elem.querySelectorAll('.aekObjectiveTracker__objective')].map((li) =>
        li.getAttribute('data-key')
      )
    ).toEqual(['crystals', 'cave']);
    tracker.cmp.remove();
  });

  it('writes the steps in place and reads a step done', () => {
    const tracker = addTracker();
    const elem = tracker.cmp.elem;
    tracker.setObjective('scout', {
      text: 'Rescue the scout',
      steps: [{ text: 'Find the cave', done: true }, { text: 'Light the torch' }],
    });
    readAnnouncement();
    const row = getRow(elem, 'scout') as HTMLElement;
    const steps = [...row.querySelectorAll('.aekObjectiveTracker__step')] as HTMLElement[];
    expect(part(row, 'steps').getAttribute('role')).toBe('list');
    expect(steps).toHaveLength(2);
    expect(steps[0].hasAttribute('data-done')).toBe(true);
    expect(part(steps[0], 'spoken').textContent).toBe(', done');
    expect(steps[1].hasAttribute('data-done')).toBe(false);
    tracker.setObjective('scout', {
      text: 'Rescue the scout',
      steps: [
        { text: 'Find the cave', done: true },
        { text: 'Light the torch', done: true },
      ],
    });
    expect([...row.querySelectorAll('.aekObjectiveTracker__step')]).toEqual(steps);
    expect(steps[1].hasAttribute('data-done')).toBe(true);
    expect(readAnnouncement()).toBe('Light the torch, done');
    tracker.setObjective('scout', { text: 'Rescue the scout', steps: [{ text: 'Go home' }] });
    expect(row.querySelectorAll('.aekObjectiveTracker__step')).toHaveLength(1);
    expect(part(steps[0], 'text').textContent).toBe('Go home');
    expect(steps[0].hasAttribute('data-done')).toBe(false);
    tracker.setObjective('scout', { text: 'Rescue the scout' });
    expect(part(row, 'steps')).toBeNull();
    tracker.cmp.remove();
  });

  it('completes an objective: checked and read, held, faded out, then removed', () => {
    const tracker = addTracker({ completeHoldMs: 1000 });
    const elem = tracker.cmp.elem;
    tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 5, total: 5 } });
    readAnnouncement();
    tracker.complete('crystals');
    const row = getRow(elem, 'crystals') as HTMLElement;
    expect(row.getAttribute('data-state')).toBe('complete');
    expect(part(row, 'spoken').textContent).toBe(', 5 of 5, done');
    expect(readAnnouncement()).toBe('Objective complete: Collect crystals');
    tracker.complete('crystals');
    // Only the hold's timer: nothing read
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(950);
    expect(row.getAttribute('data-state')).toBe('leaving');
    expect(tracker.hasObjective('crystals')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(getRow(elem, 'crystals')).toBeNull();
    expect(tracker.hasObjective('crystals')).toBe(false);
    expect(elem.hidden).toBe(true);
    tracker.cmp.remove();
  });

  it('makes a completed objective active again when it is set, and drops its timers on removal', () => {
    const tracker = addTracker({ completeHoldMs: 1000 });
    const elem = tracker.cmp.elem;
    tracker.setObjective('boss', { text: 'Defeat the guardian' });
    tracker.complete('boss');
    tracker.setObjective('boss', { text: 'Defeat the guardian, again' });
    const row = getRow(elem, 'boss') as HTMLElement;
    expect(row.getAttribute('data-state')).toBe('active');
    expect(part(row, 'spoken').textContent).toBe('');
    vi.advanceTimersByTime(5000);
    expect(getRow(elem, 'boss')).toBe(row);
    tracker.complete('boss');
    readAnnouncement();
    tracker.cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
  });
});
