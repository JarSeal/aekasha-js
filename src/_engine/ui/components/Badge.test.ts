import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createBadge } from './Badge';

const getSpoken = (elem: HTMLElement) => elem.querySelectorAll('.aekVisuallyHidden');

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('badge (p803 D10)', () => {
  it('shows its label in its tone, neutral by default', () => {
    const { cmp } = createBadge({ label: 'Beta' });
    expect(cmp.elem.tagName).toBe('SPAN');
    expect(cmp.elem.className).toBe('aekBadge');
    expect(cmp.elem.getAttribute('data-tone')).toBe('neutral');
    expect(cmp.elem.textContent).toBe('Beta');
    expect(getSpoken(cmp.elem)).toHaveLength(0);
    cmp.remove();
  });

  it('says a spoken label in place of a count, and setLabel keeps one copy', () => {
    const badge = createBadge({ label: 3, tone: 'accent', spokenLabel: '3 unread' });
    const elem = badge.cmp.elem;
    expect(elem.getAttribute('data-tone')).toBe('accent');
    expect(elem.querySelector('.aekBadge__label')?.getAttribute('aria-hidden')).toBe('true');
    expect(getSpoken(elem)[0]?.textContent).toBe('3 unread');
    badge.setLabel(4, '4 unread');
    expect(elem.querySelector('.aekBadge__label')?.textContent).toBe('4');
    expect(getSpoken(elem)).toHaveLength(1);
    expect(getSpoken(elem)[0]?.textContent).toBe('4 unread');
    badge.setLabel('New');
    expect(elem.querySelector('.aekBadge__label')?.hasAttribute('aria-hidden')).toBe(false);
    expect(getSpoken(elem)).toHaveLength(0);
    badge.setTone('danger');
    expect(elem.getAttribute('data-tone')).toBe('danger');
    badge.cmp.remove();
  });
});
