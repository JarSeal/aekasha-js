import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, stubKitDomAsync } from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import { createFolder, type FolderProps } from './Folder';
import { createNumberField } from './NumberField';

beforeAll(async () => {
  await stubKitDomAsync();
});

afterEach(() => {
  vi.useRealTimers();
});

const makeFolder = (props: Partial<FolderProps> = {}) => {
  const changes: boolean[] = [];
  const folder = createFolder({
    title: 'Shadows',
    onExpandedChange: (open) => changes.push(open),
    ...props,
  });
  document.body.append(folder.cmp.elem);
  const root = folder.cmp.elem;
  const button = root.querySelector<HTMLButtonElement>('.aekFolder__toggle')!;
  const region = root.querySelector<HTMLElement>('.aekFolder__region')!;
  return { folder, root, button, region, changes };
};

describe('the folder (p804 D9)', () => {
  it('is a disclosure: a button controlling a group it names, open by default', () => {
    const { folder, root, button, region } = makeFolder();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(region.id);
    expect(region.getAttribute('role')).toBe('group');
    expect(region.getAttribute('aria-labelledby')).toBe(button.id);
    expect(button.querySelector('.aekFolder__title')!.textContent).toBe('Shadows');
    expect(button.querySelector('.aekFolder__chevron')!.getAttribute('aria-hidden')).toBe('true');
    expect(root.hasAttribute('data-expanded')).toBe(true);
    expect(region.hasAttribute('hidden')).toBe(false);
    expect(folder.isExpanded()).toBe(true);
    folder.cmp.remove();
  });

  it('starts shut with expanded: false, drawn before the first paint (no animation)', () => {
    const { folder, root, button, region } = makeFolder({ expanded: false, id: 'shadowsToggle' });
    expect(button.id).toBe('shadowsToggle');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(root.hasAttribute('data-expanded')).toBe(false);
    expect(root.hasAttribute('data-animating')).toBe(false);
    expect(region.hasAttribute('hidden')).toBe(true);
    folder.cmp.remove();
  });

  it('a click shuts it animated, the region hidden at the end; another opens it at once', () => {
    vi.useFakeTimers();
    const { folder, root, button, region, changes } = makeFolder();
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(root.hasAttribute('data-expanded')).toBe(false);
    expect(root.hasAttribute('data-animating')).toBe(true);
    // Still shown while its height eases out
    expect(region.hasAttribute('hidden')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(region.hasAttribute('hidden')).toBe(true);
    expect(root.hasAttribute('data-animating')).toBe(false);
    button.click();
    expect(region.hasAttribute('hidden')).toBe(false);
    expect(root.hasAttribute('data-expanded')).toBe(true);
    expect(changes).toEqual([false, true]);
    folder.cmp.remove();
  });

  it('under reduced motion opens and shuts at once', () => {
    // getMotionFactor reads the kit root's `--aek-motion`: 0 under reduced motion
    const page = window as unknown as { getComputedStyle?: unknown };
    page.getComputedStyle = () => ({ getPropertyValue: () => '0' });
    const { folder, root, region } = makeFolder();
    folder.setExpanded(false);
    expect(root.hasAttribute('data-animating')).toBe(false);
    expect(region.hasAttribute('hidden')).toBe(true);
    folder.cmp.remove();
    delete page.getComputedStyle;
  });

  it('a field it hid isn’t read; opening reads it once, without a flash', () => {
    const settings = { speed: 1 };
    const scheduler = createBindingScheduler();
    const speed = createNumberField({ label: 'Speed', target: settings, key: 'speed', scheduler });
    const { folder } = makeFolder({ expanded: false, scheduler, children: [speed] });
    const input = speed.cmp.elem.querySelector('input')!;
    settings.speed = 2;
    scheduler.refresh();
    expect(input.value).toBe('1.00');
    folder.setExpanded(true);
    expect(input.value).toBe('2.00');
    expect(speed.cmp.elem.querySelector('[data-flash]')).toBeNull();
    folder.cmp.remove();
    scheduler.dispose();
  });

  it('re-reads a hidden function on its scheduler’s refresh, and on its own', () => {
    let isHidden = true;
    const scheduler = createBindingScheduler();
    const { folder, root } = makeFolder({ hidden: () => isHidden, scheduler });
    expect(root.hasAttribute('hidden')).toBe(true);
    isHidden = false;
    scheduler.refresh();
    expect(root.hasAttribute('hidden')).toBe(false);
    isHidden = true;
    folder.refresh();
    expect(root.hasAttribute('hidden')).toBe(true);
    folder.setHidden(false);
    expect(root.hasAttribute('hidden')).toBe(false);
    folder.cmp.remove();
    scheduler.dispose();
  });

  it('shut from code with the focus inside, gives the focus to its button', () => {
    const speed = createNumberField({ label: 'Speed', value: 1 });
    const { folder, button } = makeFolder({ children: [speed] });
    speed.focus();
    folder.setExpanded(false);
    expect(document.activeElement).toBe(button);
    folder.cmp.remove();
  });

  it('holds its children in order, nested folders too; setTitle and toggle', () => {
    const inner = createFolder({ title: 'Cascades' });
    const speed = createNumberField({ label: 'Speed', value: 1 });
    const { folder, button } = makeFolder({ children: [speed] });
    folder.add(inner);
    const content = folder.content.elem;
    expect([...content.children]).toEqual([speed.cmp.elem, inner.cmp.elem]);
    folder.setTitle('Lights');
    expect(button.textContent).toBe('Lights');
    folder.toggle();
    expect(folder.isExpanded()).toBe(false);
    folder.cmp.remove();
  });

  it('leaves no listener or timer after it’s removed, mid-animation too', () => {
    vi.useFakeTimers();
    const { folder, button } = makeFolder();
    button.click();
    folder.cmp.remove();
    expect(countListeners(button)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
