import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../../testing/KitDom';
import { createItemDetails } from './ItemDetails';
import type { GameItem } from './ItemTypes';

const part = (elem: Element, name: string) =>
  elem.querySelector(`.aekItemDetails__${name}`) as HTMLElement;

/** Each stat row's text as a screen reader gets it: its label and its value without the hidden */
const readRows = (elem: Element) =>
  [...elem.querySelectorAll('.aekItemDetails__stat')].map((row) => {
    const clone = row.cloneNode(true) as Element;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
    return [...clone.children].map((cell) => cell.textContent).join(' ');
  });

const SWORD: GameItem = {
  id: 'sword',
  name: 'Iron sword',
  rarity: 'rare',
  description: 'A plain blade, well kept.',
  stats: [
    { id: 'damage', label: 'Damage', value: 15 },
    { id: 'speed', label: 'Attack time', value: 1.2, lowerIsBetter: true, format: (v) => `${v} s` },
    { id: 'weight', label: 'Weight', value: 4, lowerIsBetter: true },
  ],
};

const DAGGER: GameItem = {
  id: 'dagger',
  name: 'Bronze dagger',
  stats: [
    { id: 'damage', label: 'Damage', value: 12 },
    { id: 'speed', label: 'Attack time', value: 0.8, lowerIsBetter: true },
    { id: 'weight', label: 'Weight', value: 4 },
    { id: 'crit', label: 'Critical chance', value: 10, format: (v) => `${v} %` },
  ],
};

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('item details (p808 D11)', () => {
  it('shows the name, rarity, description and stats', () => {
    const details = createItemDetails({ item: SWORD });
    const elem = details.cmp.elem;
    expect(elem.getAttribute('data-rarity')).toBe('rare');
    expect(part(elem, 'name').textContent).toBe('Iron sword');
    expect(part(elem, 'rarity').textContent).toBe('Rare');
    expect(part(elem, 'description').textContent).toBe('A plain blade, well kept.');
    expect(part(elem, 'stats').tagName).toBe('DL');
    expect(part(elem, 'statLabel').tagName).toBe('DT');
    expect(part(elem, 'statValue').tagName).toBe('DD');
    expect(readRows(elem)).toEqual(['Damage 15', 'Attack time 1.2 s', 'Weight 4']);
    expect(elem.querySelector('[data-change]')).toBeNull();
    expect(part(elem, 'compare')).toBeNull();
    details.cmp.remove();
  });

  it('compares each stat by an arrow, a sign and words, lower better where it is', () => {
    const details = createItemDetails({ item: SWORD, compareTo: DAGGER });
    const elem = details.cmp.elem;
    const rows = [...elem.querySelectorAll('.aekItemDetails__stat')] as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('data-change'))).toEqual([
      'better',
      'worse',
      'same',
      'worse',
    ]);
    const diffs = rows.map((row) => part(row, 'diff')?.textContent ?? null);
    expect(diffs).toEqual(['+3', '+0.4 s', '=', '−10 %']);
    expect(part(rows[0], 'diff').getAttribute('aria-hidden')).toBe('true');
    expect(part(rows[0], 'arrow').getAttribute('data-direction')).toBe('up');
    expect(part(rows[1], 'arrow').getAttribute('data-direction')).toBe('down');
    expect(readRows(elem)).toEqual([
      'Damage 15, 3 more, better',
      'Attack time 1.2 s, 0.4 s more, worse',
      'Weight 4, the same',
      // Only the other item has it: lost by the change
      'Critical chance –, 10 % less, worse',
    ]);
    expect(rows[3].hasAttribute('data-missing')).toBe(true);
    expect(part(elem, 'compare').textContent).toBe('Compared with Bronze dagger');
    details.cmp.remove();
  });

  it('compares nothing with itself, and takes the app’s comparison line', () => {
    const details = createItemDetails({
      item: SWORD,
      compareTo: SWORD,
      compareLabel: (other) => `Equipped: ${other.name}`,
    });
    expect(details.cmp.elem.querySelector('[data-change]')).toBeNull();
    details.setItem(DAGGER, SWORD);
    expect(part(details.cmp.elem, 'compare').textContent).toBe('Equipped: Iron sword');
    expect(details.cmp.elem.hasAttribute('data-rarity')).toBe(false);
    expect(part(details.cmp.elem, 'rarity')).toBeNull();
    details.cmp.remove();
  });

  it('says the empty label with no item', () => {
    const details = createItemDetails({ item: null });
    const elem = details.cmp.elem;
    expect(elem.getAttribute('data-state')).toBe('empty');
    expect(elem.textContent).toBe('Empty slot');
    details.setItem(SWORD);
    expect(elem.hasAttribute('data-state')).toBe(false);
    expect(part(elem, 'name').textContent).toBe('Iron sword');
    details.cmp.remove();
    const named = createItemDetails({ item: null, emptyLabel: 'Nothing equipped' });
    expect(named.cmp.elem.textContent).toBe('Nothing equipped');
    named.cmp.remove();
  });
});
