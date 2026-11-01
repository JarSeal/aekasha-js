import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stubClipboard, stubKitDomAsync } from '../ui/testing/KitDom';

// The dialog's content is captured from openDialog
const dialog = vi.hoisted(() => ({ props: null as { content: () => unknown } | null }));
vi.mock(import('../ui/overlays/windows/DialogWindow'), () => ({
  openDialog: (props: unknown) => {
    dialog.props = props as { content: () => unknown };
  },
}));
const closed = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock(import('../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  closeDraggableWindow: (id: string) => {
    closed.ids.push(id);
  },
}));

import type { CMPHandle } from '../ui/core/CMPTypes';
import { CMP } from '../ui/core/CMP';
import { registerBuiltInIcons } from '../ui/core/icons/SvgIcon';
import { openAboutDialog } from './_dbg__About';

let root: CMPHandle | null = null;

const open = () => {
  openAboutDialog();
  root = (dialog.props as { content: () => CMPHandle }).content();
  hudRoot.add(root);
  return root.elem;
};
const getButton = (elem: HTMLElement, label: string) =>
  [...elem.querySelectorAll<HTMLElement>('button.aekButton')].find(
    (b) => b.textContent === label
  ) as HTMLElement;
/** The `<dd>` after a `<dt>` with the text */
const getValue = (elem: HTMLElement, label: string) =>
  [...elem.querySelectorAll('dt')].find((dt) => dt.textContent === label)?.nextElementSibling
    ?.textContent;

let hudRoot: CMPHandle;

beforeAll(async () => {
  await stubKitDomAsync();
  registerBuiltInIcons();
  hudRoot = CMP({ id: 'hudRoot', idAttr: true, class: 'aekUi' });
  document.body.appendChild(hudRoot.elem);
});

afterEach(() => {
  root?.remove();
  root = null;
  vi.useRealTimers();
});

describe('the About Ækasha dialog (p806 D10)', () => {
  it('lists its sections as description lists set as text, with external kit links', () => {
    const elem = open();
    expect([...elem.querySelectorAll('section > h4')].map((h) => h.textContent)).toEqual([
      'Versions',
      'Packages',
      'Runtime',
      'Physics',
    ]);
    // The scene runner masks the build line by this selector
    expect(getValue(elem, 'Build')).toBeTruthy();
    expect(getValue(elem, 'Browser')).toBe(navigator.userAgent);
    expect(getValue(elem, 'Renderer')).toBe('Not created');
    // The window's title is the heading: the name isn't another one
    expect(elem.querySelector('h1, h2, h3')).toBeNull();
    // The symbol is decorative
    expect(elem.querySelector('.aekIcon')?.closest('[aria-hidden="true"]')).toBeTruthy();
    for (const link of elem.querySelectorAll('a')) {
      expect(link.classList.contains('aekLink')).toBe(true);
      expect(link.getAttribute('target')).toBe('_blank');
    }
  });

  it('copies the information as text, the result its label for a while and announced', async () => {
    vi.useFakeTimers();
    const clipboard = stubClipboard();
    const elem = open();
    const copy = getButton(elem, 'Copy info');
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(clipboard.getText()).toContain('Versions:');
    expect(clipboard.getText()).toContain(`  Browser: ${navigator.userAgent}`);
    expect(copy.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(50);
    const region = document.querySelector('[role="status"]');
    expect(region?.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.textContent).toBe('Copy info');
    clipboard.restore();
  });

  it('writes nothing once closed while a copy is pending, and its Close closes it', async () => {
    let resolve = () => {};
    const clipboard = stubClipboard();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const elem = open();
    const copy = getButton(elem, 'Copy info');
    copy.click();
    getButton(elem, 'Close').click();
    expect(closed.ids).toEqual(['aekAboutDialog']);
    root?.remove();
    resolve();
    await Promise.resolve();
    expect(copy.textContent).toBe('Copy info');
    writeText.mockRestore();
    clipboard.restore();
  });
});
