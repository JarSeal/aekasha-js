import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createTag, type TagProps } from './Tag';

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

/** Tags in a row, added to the HUD root (so they're in the document) */
const addTags = (labels: string[], props: Partial<TagProps> = {}) => {
  const row = getHUDRootCMP().add({ class: 'row' });
  for (const label of labels) row.add(createTag({ label, ...props }).cmp);
  return { row };
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

describe('tag (p803 D10)', () => {
  it('is a label in its tone; no button unless it does something', () => {
    const { cmp } = createTag({ label: 'Rock', tone: 'info' });
    expect(cmp.elem.className).toBe('aekTag');
    expect(cmp.elem.getAttribute('data-tone')).toBe('info');
    expect(cmp.elem.querySelector('.aekTag__label')?.tagName).toBe('SPAN');
    expect(cmp.elem.querySelector('button')).toBeNull();
    cmp.remove();
  });

  it('selectable: a toggle button whose press flips it; setSelected only writes it', () => {
    const onSelectedChange = vi.fn();
    const tag = createTag({ label: 'Trees', selectable: true, onSelectedChange });
    const button = tag.cmp.elem.querySelector('button.aekTag__label') as HTMLElement;
    expect(tag.cmp.elem.hasAttribute('data-selectable')).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(tag.cmp.elem.hasAttribute('data-selected')).toBe(true);
    expect(onSelectedChange).toHaveBeenCalledWith(true);
    tag.setSelected(false);
    expect(tag.isSelected()).toBe(false);
    expect(tag.cmp.elem.hasAttribute('data-selected')).toBe(false);
    expect(onSelectedChange).toHaveBeenCalledTimes(1);
    tag.cmp.remove();
  });

  it('removable: its labelled button removes it and reports it', () => {
    const onRemove = vi.fn();
    const tag = createTag({ label: 'level1', removable: true, onRemove });
    getHUDRootCMP().add(tag.cmp);
    const remove = tag.cmp.elem.querySelector('.aekTag__remove') as HTMLElement;
    expect(remove.getAttribute('aria-label')).toBe('Remove level1');
    tag.setLabel('level2');
    expect(remove.getAttribute('aria-label')).toBe('Remove level2');
    click(remove);
    expect(tag.cmp.elem.isConnected).toBe(false);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('removable: Backspace or Delete removes a focused tag, the focus to the next, else the previous', () => {
    const { row } = addTags(['A', 'B', 'C'], { removable: true });
    const getRemove = (i: number) =>
      row.elem.querySelectorAll<HTMLElement>('.aekTag__remove')[i] ?? null;
    getRemove(1)?.focus();
    expect(dispatchKey(getRemove(1) as HTMLElement, 'keydown', 'Delete').defaultPrevented).toBe(
      true
    );
    expect([...row.elem.children].map((c) => c.textContent)).toEqual(['A', 'C']);
    expect(document.activeElement).toBe(getRemove(1));
    dispatchKey(getRemove(1) as HTMLElement, 'keydown', 'Backspace');
    expect(document.activeElement).toBe(getRemove(0));
    expect(dispatchKey(getRemove(0) as HTMLElement, 'keydown', 'a').defaultPrevented).toBe(false);
    row.remove();
  });

  it('selectable and removable: Delete on its toggle removes it too; disabled, neither acts', () => {
    const onRemove = vi.fn();
    const { row } = addTags(['A'], { selectable: true, removable: true, onRemove });
    const toggle = row.elem.querySelector('button.aekTag__label') as HTMLElement;
    dispatchKey(toggle, 'keydown', 'Delete');
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(row.elem.children).toHaveLength(0);
    const disabled = createTag({ label: 'B', removable: true, disabled: true, onRemove });
    row.add(disabled.cmp);
    expect(disabled.cmp.elem.querySelector('.aekTag__remove')?.hasAttribute('disabled')).toBe(true);
    dispatchKey(disabled.cmp.elem, 'keydown', 'Delete');
    expect(onRemove).toHaveBeenCalledTimes(1);
    row.remove();
  });
});
