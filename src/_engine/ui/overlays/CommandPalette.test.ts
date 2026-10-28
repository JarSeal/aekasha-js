import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createCommandPalette } from './CommandPalette';
import type { CommandPaletteProps, PaletteCommand } from './CommandPaletteTypes';

let opener: HTMLButtonElement;
let sibling: HTMLElement;
const ran: string[] = [];

const COMMANDS: PaletteCommand[] = [
  { id: 'reset', label: 'Reset the camera', group: 'View', run: () => ran.push('reset') },
  {
    id: 'grid',
    label: 'Toggle the grid',
    group: 'View',
    kbd: 'G',
    description: 'Shows the floor grid',
    run: () => ran.push('grid'),
  },
  {
    id: 'save',
    label: 'Save the level',
    group: 'File',
    kbd: 'Ctrl+S',
    run: () => ran.push('save'),
  },
  { id: 'export', label: 'Export', group: 'File', disabled: true, run: () => ran.push('export') },
  { id: 'help', label: 'Help', keywords: ['manual'], run: () => ran.push('help') },
];

const query = (selector: string) =>
  getHUDRootCMP().elem.querySelector<HTMLElement>(`.aekCommandPalette${selector}`);
const getInput = () => query(' .aekCommandPalette__input') as HTMLInputElement;
const getOptions = () => [
  ...getHUDRootCMP().elem.querySelectorAll<HTMLElement>('.aekCommandPalette__option'),
];
const getLabels = () => getOptions().map((option) => option.textContent);
const getGroups = () =>
  [...getHUDRootCMP().elem.querySelectorAll('.aekCommandPalette__groupLabel')].map(
    (label) => label.textContent
  );
const getStatus = () => query(' .aekCommandPalette__status')?.textContent;
const getActive = () => {
  const id = getInput().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent : null;
};

/** Types the query as the user does: the value, then an `input` event */
const type = (text: string) => {
  const input = getInput();
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const press = (key: string) => dispatchKey(document.activeElement ?? document.body, 'keydown', key);
const click = (elem: Element, init: { ctrlKey?: boolean } = {}) =>
  elem.dispatchEvent(
    Object.assign(new window.Event('click', { bubbles: true, cancelable: true }), {
      ctrlKey: Boolean(init.ctrlKey),
      metaKey: false,
      shiftKey: false,
      altKey: false,
    })
  );

/** Every palette a test made, removed after it (a failed test's too) */
const palettes: { cmp: { remove: () => void } }[] = [];

const addPalette = (props: Partial<CommandPaletteProps> = {}) => {
  const palette = createCommandPalette({ label: 'Commands', commands: COMMANDS, ...props });
  palettes.push(palette);
  return palette;
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

beforeEach(() => {
  vi.useFakeTimers();
  ran.length = 0;
  sibling = document.createElement('div');
  opener = document.createElement('button');
  opener.textContent = 'Commands';
  sibling.append(opener);
  getHUDRootCMP().elem.appendChild(sibling);
  opener.focus();
});

afterEach(() => {
  for (const palette of palettes.splice(0)) palette.cmp.remove();
  sibling.remove();
  vi.useRealTimers();
});

describe('command palette (p805 D12)', () => {
  it('draws nothing until it opens; open, it’s a modal dialog over the HUD with the input focused', () => {
    const onOpen = vi.fn();
    const palette = addPalette({ onOpen });
    expect(palette.cmp.elem.isConnected).toBe(false);
    palette.open();
    expect(palette.isOpen()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    const panel = query(' .aekCommandPalette__panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('Commands');
    const input = getInput();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = document.getElementById(input.getAttribute('aria-controls') ?? '');
    expect(listbox?.getAttribute('role')).toBe('listbox');
    expect(sibling.hasAttribute('inert')).toBe(true);
    palette.cmp.remove();
  });

  it('lists every command on an empty query, the groups (and no group) in order of first appearance', () => {
    const palette = addPalette({ hint: 'Type a command' });
    palette.open();
    expect(getGroups()).toEqual(['View', 'File']);
    const options = getOptions();
    expect(
      options.map((option) => option.querySelector('.aekCommandPalette__optionLabel')?.textContent)
    ).toEqual(['Reset the camera', 'Toggle the grid', 'Save the level', 'Export', 'Help']);
    expect(getStatus()).toBe('Type a command');
    palette.cmp.remove();
  });

  it('draws a row’s parts: its description, its key hint and shortcut, disabled', () => {
    const palette = addPalette();
    palette.open();
    const grid = getOptions()[1];
    expect(grid.getAttribute('role')).toBe('option');
    expect(grid.querySelector('.aekCommandPalette__optionDescription')?.textContent).toBe(
      'Shows the floor grid'
    );
    expect(grid.querySelector('.aekCommandPalette__optionKbd')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(grid.getAttribute('aria-keyshortcuts')).toBe('G');
    expect(getOptions()[3].getAttribute('aria-disabled')).toBe('true');
    palette.cmp.remove();
  });

  it('fixes the groups’ order with `groups`', () => {
    const palette = addPalette({ groups: ['File'] });
    palette.open();
    expect(getGroups()).toEqual(['File', 'View']);
    palette.cmp.remove();
  });

  it('ranks the commands by the query, marks the letters and counts the results', () => {
    const onQueryChange = vi.fn();
    const palette = addPalette({ onQueryChange });
    palette.open();
    type('tg');
    expect(onQueryChange).toHaveBeenLastCalledWith('tg');
    expect(getLabels()[0]).toContain('Toggle the grid');
    const label = getOptions()[0].querySelector('.aekCommandPalette__optionLabel') as HTMLElement;
    expect([...label.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['T', 'g']);
    expect(getStatus()).toBe('1 result');
    type('the');
    expect(getStatus()).toBe('3 results');
    // The label before the keywords: `manual` finds Help, unmarked
    type('manual');
    expect(getLabels()).toEqual(['Help']);
    expect(getOptions()[0].querySelector('mark')).toBeNull();
    palette.cmp.remove();
  });

  it('says when nothing matches: the default, a text, or a function’s CMP', () => {
    const palette = addPalette();
    palette.open();
    type('zzz');
    expect(getOptions()).toHaveLength(0);
    expect(getInput().getAttribute('aria-expanded')).toBe('false');
    expect(query(' .aekCommandPalette__results')?.hidden).toBe(true);
    expect(getStatus()).toBe('No results for “zzz”.');
    palette.cmp.remove();

    const link = CMP({ tag: 'a', text: 'Search the manual' });
    const withCmp = addPalette({ emptyText: () => link });
    withCmp.open();
    type('zzz');
    expect(query(' .aekCommandPalette__status a')).toBe(link.elem);
    type('save');
    expect(link.elem.isConnected).toBe(false);
    withCmp.cmp.remove();
  });

  it('moves the active row with the arrows (wrapping) and the page keys; Home / End are the input’s', () => {
    const palette = addPalette();
    palette.open();
    expect(getActive()).toContain('Reset the camera');
    press('ArrowDown');
    expect(getActive()).toContain('Toggle the grid');
    expect(getOptions()[1].getAttribute('aria-selected')).toBe('true');
    expect(getOptions()[0].getAttribute('aria-selected')).toBe('false');
    press('ArrowUp');
    press('ArrowUp');
    expect(getActive()).toContain('Help');
    press('PageUp');
    expect(getActive()).toContain('Reset the camera');
    press('PageDown');
    expect(getActive()).toContain('Help');
    expect(dispatchKey(getInput(), 'keydown', 'Home').defaultPrevented).toBe(false);
    expect(dispatchKey(getInput(), 'keydown', 'End').defaultPrevented).toBe(false);
    palette.cmp.remove();
  });

  it('Enter closes, then runs the active command, the focus back on the opener; a disabled one does nothing', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const palette = addPalette({ onSelect, onClose });
    palette.open();
    type('export');
    press('Enter');
    expect(ran).toEqual([]);
    expect(palette.isOpen()).toBe(true);
    type('save');
    press('Enter');
    expect(ran).toEqual(['save']);
    expect(onSelect).toHaveBeenCalledWith(COMMANDS[2]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(palette.isOpen()).toBe(false);
    expect(palette.cmp.elem.isConnected).toBe(false);
    expect(sibling.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    palette.cmp.remove();
  });

  it('runs onClose before the focus goes back: a page outside the HUD made inert in onOpen gets it', () => {
    // The Hub's case: the opener is in the page, which the app makes inert while it's open
    const page = document.createElement('div');
    const pageButton = document.createElement('button');
    page.append(pageButton);
    document.body.append(page);
    pageButton.focus();
    const palette = addPalette({
      onOpen: () => page.setAttribute('inert', ''),
      onClose: () => page.removeAttribute('inert'),
    });
    palette.open();
    expect(page.hasAttribute('inert')).toBe(true);
    press('Escape');
    expect(page.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(pageButton);
    page.remove();
  });

  it('Escape closes it through the overlay stack and keeps the query, selected on the next open', () => {
    const palette = addPalette();
    palette.open();
    type('grid');
    expect(dispatchKey(getInput(), 'keydown', 'Escape').defaultPrevented).toBe(true);
    expect(palette.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    palette.open();
    expect(getInput().value).toBe('grid');
    expect(getInput().selectionStart).toBe(0);
    expect(getInput().selectionEnd).toBe(4);
    expect(getLabels()[0]).toContain('Toggle the grid');
    palette.open({ query: 'save' });
    expect(getLabels()[0]).toContain('Save the level');
    palette.cmp.remove();
  });

  it('keeps the recent commands, first on an empty query, and reports them', () => {
    const onRecentChange = vi.fn();
    const palette = addPalette({ recent: ['help', 'gone'], onRecentChange });
    palette.open();
    expect(getGroups()).toEqual(['Recent', 'View', 'File']);
    expect(getLabels()[0]).toBe('Help');
    // Not listed twice
    expect(getLabels().filter((text) => text === 'Help')).toHaveLength(1);
    type('grid');
    press('Enter');
    expect(onRecentChange).toHaveBeenCalledWith(['grid', 'help', 'gone']);
    palette.open({ query: '' });
    expect(
      getLabels()
        .slice(0, 2)
        .map((text) => text?.slice(0, 6))
    ).toEqual(['Toggle', 'Help']);
    palette.setRecent([]);
    expect(getGroups()).toEqual(['View', 'File']);
    palette.cmp.remove();
  });

  it('the pointer: a hover makes a row active, a click chooses it, the backdrop and Close close', () => {
    const palette = addPalette();
    palette.open();
    const options = getOptions();
    options[2].dispatchEvent(new window.Event('pointermove', { bubbles: true }));
    expect(getActive()).toContain('Save the level');
    const press = new window.Event('mousedown', { bubbles: true, cancelable: true });
    options[2].dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    click(options[2]);
    expect(ran).toEqual(['save']);
    palette.open();
    click(query(' .aekCommandPalette__panel') as HTMLElement);
    expect(palette.isOpen()).toBe(true);
    click(palette.cmp.elem);
    expect(palette.isOpen()).toBe(false);
    palette.open();
    click(query(' .aekCommandPalette__close') as HTMLElement);
    expect(palette.isOpen()).toBe(false);
    palette.cmp.remove();
  });

  it('a link row: an <a>; Enter clicks it, a plain click closes, a modified one keeps it open', () => {
    const palette = addPalette({
      commands: [{ id: 'docs', label: 'Read the docs', href: '#docs' }],
    });
    palette.open();
    const [link] = getOptions();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#docs');
    click(link, { ctrlKey: true });
    expect(palette.isOpen()).toBe(true);
    const onClick = vi.fn();
    link.addEventListener('click', onClick);
    press('Enter');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(palette.isOpen()).toBe(false);
    palette.cmp.remove();
  });

  it('a source’s answer keeps its order and total, its rows marked by `matchTerms`', () => {
    const source = vi.fn((text: string) => ({
      commands: text
        ? [
            { id: 'b', label: 'Meshes', matchTerms: ['mes'] },
            { id: 'a', label: 'Materials' },
          ]
        : [],
      total: 214,
    }));
    const palette = addPalette({ commands: undefined, source, hint: 'Search the pages' });
    palette.open();
    expect(source).toHaveBeenLastCalledWith('');
    expect(getStatus()).toBe('Search the pages');
    type('ma');
    expect(getLabels()).toEqual(['Meshes', 'Materials']);
    expect(getStatus()).toBe('2 of 214 results');
    expect(getOptions()[0].querySelector('mark')?.textContent).toBe('Mes');
    expect(getOptions()[1].querySelector('mark')?.textContent).toBe('Ma');
    palette.cmp.remove();
  });

  it('a promised answer: loading, then shown; a stale one dropped; the next query waits for a pause', async () => {
    const answers: ((value: PaletteCommand[]) => void)[] = [];
    const source = vi.fn(() => new Promise<PaletteCommand[]>((resolve) => answers.push(resolve)));
    const palette = addPalette({ commands: undefined, source, loadingText: 'Loading the pages' });
    palette.open();
    expect(getStatus()).toBe('Loading the pages');
    expect(query(' .aekCommandPalette__status .aekSpinner')).not.toBeNull();
    expect(query(' .aekCommandPalette__results')?.getAttribute('aria-busy')).toBe('true');
    // While answers are promises, typing waits 150 ms before asking
    type('m');
    type('me');
    expect(source).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(source).toHaveBeenCalledTimes(2);
    expect(source).toHaveBeenLastCalledWith('me');
    // The first (for '') comes after: dropped
    answers[0]([{ id: 'x', label: 'Old' }]);
    await Promise.resolve();
    expect(getOptions()).toHaveLength(0);
    answers[1]([{ id: 'm', label: 'Meshes' }]);
    await Promise.resolve();
    expect(getLabels()).toEqual(['Meshes']);
    expect(query(' .aekCommandPalette__results')?.hasAttribute('aria-busy')).toBe(false);
    palette.cmp.remove();
  });

  it('a failed source shows the error text; the next query asks again', async () => {
    let fails = true;
    const source = vi.fn((text: string) =>
      fails ? Promise.reject(new Error('offline')) : [{ id: text, label: text }]
    );
    const palette = addPalette({
      commands: undefined,
      source,
      errorText: (error) => `Failed: ${(error as Error).message}`,
    });
    palette.open();
    await Promise.resolve();
    await Promise.resolve();
    expect(getStatus()).toBe('Failed: offline');
    fails = false;
    type('ok');
    vi.advanceTimersByTime(150);
    expect(getLabels()).toEqual(['ok']);
    palette.cmp.remove();
  });

  it('renderRow draws a row’s content, marked with what it’s given, removed with the row', () => {
    const rendered: ReturnType<typeof CMP>[] = [];
    const palette = addPalette({
      renderRow: (command, { appendMarked, terms }) => {
        const row = CMP({ class: 'customRow', attr: { 'data-terms': terms.join(',') } });
        appendMarked(row.elem, command.label);
        rendered.push(row);
        return row;
      },
    });
    palette.open();
    type('save');
    const row = getOptions()[0].querySelector('.customRow') as HTMLElement;
    expect(row.dataset.terms).toBe('save');
    expect(row.querySelector('mark')?.textContent).toBe('Save');
    type('grid');
    expect(rendered[rendered.length - 2].elem.isConnected).toBe(false);
    palette.cmp.remove();
  });

  it('setCommands shows the new commands at once while open', () => {
    const palette = addPalette();
    palette.open();
    palette.setCommands([{ id: 'one', label: 'Only one' }]);
    expect(getLabels()).toEqual(['Only one']);
    palette.cmp.remove();
  });

  it('removed while open: closed, the rest of the HUD live again, nothing left', () => {
    const onClose = vi.fn();
    const palette = addPalette({ onClose });
    palette.open();
    palette.cmp.remove();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(palette.isOpen()).toBe(false);
    expect(query('')).toBeNull();
    expect(sibling.hasAttribute('inert')).toBe(false);
  });
});
