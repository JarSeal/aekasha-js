import { beforeAll, describe, expect, it } from 'vitest';
import { stubKitDomAsync } from '../testing/KitDom';
import { createSpinner } from './Spinner';

beforeAll(async () => {
  await stubKitDomAsync();
});

describe('spinner (p803 D10)', () => {
  it('is a status with its label, Loading by default, and setLabel changes it', () => {
    const spinner = createSpinner();
    const elem = spinner.cmp.elem;
    expect(elem.tagName).toBe('SPAN');
    expect(elem.className).toBe('aekSpinner');
    expect(elem.getAttribute('role')).toBe('status');
    expect(elem.hasAttribute('data-size')).toBe(false);
    expect(elem.querySelector('.aekVisuallyHidden')?.textContent).toBe('Loading');
    spinner.setLabel('Loading the save');
    expect(elem.textContent).toBe('Loading the save');
    spinner.cmp.remove();
  });

  it('takes an icon size, and a decorative one is hidden with nothing to say', () => {
    const spinner = createSpinner({ size: 'lg', decorative: true, label: 'Ignored' });
    const elem = spinner.cmp.elem;
    expect(elem.getAttribute('data-size')).toBe('lg');
    expect(elem.getAttribute('aria-hidden')).toBe('true');
    expect(elem.hasAttribute('role')).toBe(false);
    expect(elem.childNodes).toHaveLength(0);
    spinner.setLabel('Still nothing');
    expect(elem.textContent).toBe('');
    spinner.cmp.remove();
  });
});
