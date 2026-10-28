import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countListeners,
  dispatchKey,
  stubKitDomAsync,
  stubResizeObserver,
  type KitKeyInit,
} from '../testing/KitDom';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createBindingScheduler } from '../forms/binding/BindingScheduler';
import { createTree } from './Tree';
import type { Tree, TreeProps } from './TreeTypes';
import { createVirtualRows } from './VirtualRows';

type Node = { id: string; name: string; children?: Node[] };

const makeNodes = (): Node[] => [
  {
    id: 'world',
    name: 'World',
    children: [
      { id: 'sun', name: 'Sun' },
      {
        id: 'props',
        name: 'Props',
        children: [
          { id: 'crate', name: 'Crate' },
          { id: 'barrel', name: 'Barrel' },
        ],
      },
      { id: 'terrain', name: 'Terrain' },
    ],
  },
  { id: 'ui', name: 'UI', children: [{ id: 'hud', name: 'HUD' }] },
  { id: 'audio', name: 'Audio' },
];

const click = (target: EventTarget, init: KitKeyInit = {}) =>
  target.dispatchEvent(
    Object.assign(new window.Event('click', { bubbles: true, cancelable: true }), {
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...init,
    })
  );

const press = (key: string, init: KitKeyInit = {}) =>
  dispatchKey(document.activeElement as HTMLElement, 'keydown', key, init);

const add = <T = Node>(props: Partial<TreeProps<T>> & Pick<TreeProps<T>, 'roots'>) => {
  const tree = createTree<T>({
    label: 'Scene',
    getChildren: (node) => (node as Node).children as readonly T[] | undefined,
    title: (node) => (node as Node).name,
    ...props,
  });
  getHUDRootCMP().add(tree.cmp);
  return tree;
};

/** A tree as the helpers read it (`Tree<T>` is invariant in `T`) */
type Shown = Pick<Tree<never>, 'cmp'>;

const getRowsElem = (tree: Shown) => tree.cmp.elem.querySelector('.aekTree__rows') as HTMLElement;
const getRows = (tree: Shown) =>
  [...tree.cmp.elem.querySelectorAll('.aekTree__row')] as HTMLElement[];
const getKeys = (tree: Shown) =>
  getRows(tree)
    .filter((row) => !row.hasAttribute('data-pinned'))
    .map((row) => row.getAttribute('data-key'));
const getRow = (tree: Shown, key: string) =>
  tree.cmp.elem.querySelector(`.aekTree__row[data-key="${key}"]`) as HTMLElement;
const getStatus = (tree: Shown) =>
  tree.cmp.elem.querySelector('.aekTree__status') as HTMLElement | null;
const focusedKey = () => (document.activeElement as HTMLElement).getAttribute('data-key');
const getAnnounced = () =>
  getHUDRootCMP().elem.querySelector(':scope > [role="status"]')?.textContent;

/** A promise and its settling, for a load the test ends */
const createDeferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushAsync = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tree (p805 D7): rows and ARIA', () => {
  it('is a flat tree of items with their level, place and open state; closed children aren’t rendered', () => {
    const tree = add({ roots: makeNodes(), expanded: ['world'] });
    const rowsElem = getRowsElem(tree);
    expect(rowsElem.getAttribute('role')).toBe('tree');
    expect(rowsElem.getAttribute('aria-label')).toBe('Scene');
    expect(getKeys(tree)).toEqual(['world', 'sun', 'props', 'terrain', 'ui', 'audio']);
    const world = getRow(tree, 'world');
    expect(world.getAttribute('role')).toBe('treeitem');
    expect(world.getAttribute('aria-level')).toBe('1');
    expect(world.getAttribute('aria-setsize')).toBe('3');
    expect(world.getAttribute('aria-posinset')).toBe('1');
    expect(world.getAttribute('aria-expanded')).toBe('true');
    expect(world.hasAttribute('aria-selected')).toBe(false);
    const props = getRow(tree, 'props');
    expect(props.getAttribute('aria-level')).toBe('2');
    expect(props.getAttribute('aria-posinset')).toBe('2');
    expect(props.getAttribute('aria-expanded')).toBe('false');
    expect(props.style.getPropertyValue('--aek-tree-level')).toBe('2');
    // A leaf has no open state
    expect(getRow(tree, 'sun').hasAttribute('aria-expanded')).toBe(false);
    expect(getRow(tree, 'audio').hasAttribute('aria-expanded')).toBe(false);
    // One tab stop, the first row
    expect(getRows(tree).map((row) => row.getAttribute('tabindex'))).toEqual([
      '0',
      '-1',
      '-1',
      '-1',
      '-1',
      '-1',
    ]);
    expect(getRow(tree, 'crate')).toBe(null);
    tree.cmp.remove();
  });

  it('the heading names it with the known nodes’ count; the parts are made as they have text', () => {
    const tree = add({
      roots: makeNodes(),
      heading: 'Scene',
      headingLevel: 3,
      suffix: (node) => (node.children ? String(node.children.length) : null),
      badge: (node) => (node.id === 'sun' ? 'DL' : null),
      icon: (node) => (node.children ? '<svg></svg>' : null),
      expanded: ['world'],
    });
    const heading = tree.cmp.elem.querySelector('.aekTree__heading') as HTMLElement;
    expect(heading.tagName).toBe('H3');
    expect(heading.textContent).toBe('Scene 9');
    const headingText = heading.querySelector('.aekTree__headingText') as HTMLElement;
    expect(getRowsElem(tree).getAttribute('aria-labelledby')).toBe(headingText.id);
    const content = getRow(tree, 'world').querySelector('.aekTree__content') as HTMLElement;
    expect([...content.children].map((child) => child.className)).toEqual([
      'aekTree__icon',
      'aekTree__title',
      'aekTree__suffix',
    ]);
    expect(getRow(tree, 'sun').querySelector('.aekTree__badge')?.textContent).toBe('DL');
    expect(getRow(tree, 'sun').querySelector('.aekTree__suffix, .aekTree__icon')).toBe(null);
    expect(
      getRow(tree, 'world').querySelector('.aekTree__twisty')?.getAttribute('aria-hidden')
    ).toBe('true');
    tree.cmp.remove();
  });

  it('setRoots keeps a row by key and writes only what changed; a lost selected key is reported', () => {
    const onSelectionChange = vi.fn();
    const nodes = makeNodes();
    const tree = add({
      roots: nodes,
      expanded: ['world'],
      selection: 'single',
      selected: ['terrain'],
      onSelectionChange,
      empty: 'Nothing here',
    });
    const sunRow = getRow(tree, 'sun');
    const title = sunRow.querySelector('.aekTree__title') as HTMLElement;
    const titleNode = title.firstChild;
    const world = nodes[0];
    tree.setRoots([
      {
        ...world,
        children: [
          { id: 'sun', name: 'Sun' },
          { id: 'moon', name: 'Moon' },
        ],
      },
      nodes[2],
    ]);
    expect(getKeys(tree)).toEqual(['world', 'sun', 'moon', 'audio']);
    expect(getRow(tree, 'sun')).toBe(sunRow);
    expect(title.firstChild).toBe(titleNode);
    expect(onSelectionChange).toHaveBeenCalledWith([]);
    tree.setNode('sun', { id: 'sun', name: 'Sun 2' });
    expect(title.textContent).toBe('Sun 2');
    tree.setRoots([]);
    expect(getRowsElem(tree).hasAttribute('hidden')).toBe(true);
    const empty = tree.cmp.elem.querySelector('.aekTree__empty') as HTMLElement;
    expect(empty.hasAttribute('hidden')).toBe(false);
    expect(empty.textContent).toBe('Nothing here');
    tree.cmp.remove();
  });

  it('a repeated key is passed over, so a cycle ends', () => {
    const loop: Node = { id: 'loop', name: 'Loop' };
    loop.children = [{ id: 'child', name: 'Child' }, loop];
    const tree = add({ roots: [loop], expanded: ['loop'] });
    expect(getKeys(tree)).toEqual(['loop', 'child']);
    tree.cmp.remove();
  });
});

describe('tree: keys', () => {
  it('Up / Down without wrapping, Right opens and enters, Left closes and leaves, Home / End', () => {
    const onExpandedChange = vi.fn();
    const tree = add({ roots: makeNodes(), onExpandedChange });
    getRow(tree, 'world').focus();
    press('ArrowUp');
    expect(focusedKey()).toBe('world');
    press('ArrowDown');
    press('ArrowDown');
    expect(focusedKey()).toBe('audio');
    press('ArrowDown');
    expect(focusedKey()).toBe('audio');
    press('Home');
    // Right: opens (the focus stays), then into the first child
    press('ArrowRight');
    expect(focusedKey()).toBe('world');
    expect(onExpandedChange).toHaveBeenLastCalledWith(['world']);
    expect(getRow(tree, 'world').getAttribute('aria-expanded')).toBe('true');
    press('ArrowRight');
    expect(focusedKey()).toBe('sun');
    // On a leaf Right does nothing
    press('ArrowRight');
    expect(focusedKey()).toBe('sun');
    press('ArrowDown');
    press('ArrowRight');
    press('ArrowRight');
    expect(focusedKey()).toBe('crate');
    expect(onExpandedChange).toHaveBeenLastCalledWith(['world', 'props']);
    // Left: to the parent, then closes it, then to its parent
    press('ArrowLeft');
    expect(focusedKey()).toBe('props');
    press('ArrowLeft');
    expect(getRow(tree, 'crate')).toBe(null);
    expect(focusedKey()).toBe('props');
    press('ArrowLeft');
    expect(focusedKey()).toBe('world');
    press('End');
    expect(focusedKey()).toBe('audio');
    expect(getRow(tree, 'audio').getAttribute('tabindex')).toBe('0');
    expect(getRow(tree, 'world').getAttribute('tabindex')).toBe('-1');
    tree.cmp.remove();
  });

  it('* opens the siblings; a letter goes to the next title; the keys used go no further', () => {
    vi.useFakeTimers();
    const onExpandedChange = vi.fn();
    const tree = add({ roots: makeNodes(), onExpandedChange });
    getRow(tree, 'world').focus();
    const event = press('*');
    expect(event.defaultPrevented).toBe(true);
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenLastCalledWith(['world', 'ui']);
    press('ArrowDown');
    press('*');
    expect(onExpandedChange).toHaveBeenLastCalledWith(['world', 'props', 'ui']);
    expect(focusedKey()).toBe('sun');
    press('b');
    expect(focusedKey()).toBe('barrel');
    vi.advanceTimersByTime(600);
    press('h');
    expect(focusedKey()).toBe('hud');
    tree.cmp.remove();
  });

  it('Enter activates (and selects in a single selection), or opens and closes without onActivate', () => {
    const onActivate = vi.fn();
    const tree = add({ roots: makeNodes(), selection: 'single', onActivate });
    getRow(tree, 'world').focus();
    press('Enter');
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'world' }), 'world');
    expect(getRow(tree, 'world').getAttribute('aria-selected')).toBe('true');
    expect(getRow(tree, 'world').getAttribute('aria-expanded')).toBe('false');
    tree.cmp.remove();

    const plain = add({ roots: makeNodes() });
    getRow(plain, 'world').focus();
    press('Enter');
    expect(getRow(plain, 'world').getAttribute('aria-expanded')).toBe('true');
    press('Enter');
    expect(getRow(plain, 'world').getAttribute('aria-expanded')).toBe('false');
    plain.cmp.remove();
  });

  it('multiple: Space toggles, Shift + a move a range across levels, Ctrl + A the shown nodes', () => {
    const onSelectionChange = vi.fn();
    const tree = add({
      roots: makeNodes(),
      expanded: ['world'],
      selection: 'multiple',
      disabled: (node) => node.id === 'terrain',
      onSelectionChange,
    });
    expect(getRowsElem(tree).getAttribute('aria-multiselectable')).toBe('true');
    getRow(tree, 'world').focus();
    press(' ');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['world']);
    press('ArrowDown', { shiftKey: true });
    press('ArrowDown', { shiftKey: true });
    expect(tree.getSelected()).toEqual(['world', 'sun', 'props']);
    // A disabled node is focusable, never selected
    press('ArrowDown', { shiftKey: true });
    expect(focusedKey()).toBe('terrain');
    expect(tree.getSelected()).toEqual(['world', 'sun', 'props']);
    press(' ');
    expect(getRow(tree, 'terrain').getAttribute('aria-disabled')).toBe('true');
    expect(getRow(tree, 'terrain').getAttribute('aria-selected')).toBe('false');
    press('a', { ctrlKey: true });
    expect(tree.getSelected()).toEqual(['world', 'sun', 'props', 'ui', 'audio']);
    press('a', { ctrlKey: true });
    expect(tree.getSelected()).toEqual([]);
    tree.cmp.remove();
  });

  it('expand and collapse from code aren’t reported; a collapse takes the focus from under it', () => {
    const onExpandedChange = vi.fn();
    const tree = add({ roots: makeNodes(), onExpandedChange });
    tree.expand('world');
    tree.expand('props');
    expect(tree.isExpanded('props')).toBe(true);
    expect(tree.getExpanded()).toEqual(['world', 'props']);
    getRow(tree, 'crate').focus();
    tree.collapse('world');
    expect(focusedKey()).toBe('world');
    expect(getRow(tree, 'world').getAttribute('tabindex')).toBe('0');
    // Its children keep their open state
    tree.expand('world');
    expect(getKeys(tree)).toContain('crate');
    expect(onExpandedChange).not.toHaveBeenCalled();
    tree.cmp.remove();
  });
});

describe('tree: the pointer', () => {
  it('the open mark opens and closes; a click selects and activates; a disabled node neither', () => {
    const onExpandedChange = vi.fn();
    const onActivate = vi.fn();
    const tree = add({
      roots: makeNodes(),
      selection: 'single',
      disabled: (node) => node.id === 'audio',
      onExpandedChange,
      onActivate,
    });
    click(getRow(tree, 'world').querySelector('.aekTree__twisty') as HTMLElement);
    expect(onExpandedChange).toHaveBeenLastCalledWith(['world']);
    expect(onActivate).not.toHaveBeenCalled();
    expect(tree.getSelected()).toEqual([]);
    click(getRow(tree, 'sun').querySelector('.aekTree__title') as HTMLElement);
    expect(tree.getSelected()).toEqual(['sun']);
    expect(onActivate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'sun' }), 'sun');
    click(getRow(tree, 'audio'));
    expect(tree.getSelected()).toEqual(['sun']);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(tree.getKeyAt(getRow(tree, 'sun').querySelector('.aekTree__title') as HTMLElement)).toBe(
      'sun'
    );
    expect(tree.getKeyAt(getRowsElem(tree))).toBe(null);
    tree.cmp.remove();
  });

  it('without a selection or onActivate, a click on a row opens and closes it', () => {
    const tree = add({ roots: makeNodes() });
    click(getRow(tree, 'ui'));
    expect(getKeys(tree)).toEqual(['world', 'ui', 'hud', 'audio']);
    click(getRow(tree, 'ui'));
    expect(getKeys(tree)).toEqual(['world', 'ui', 'audio']);
    tree.cmp.remove();
  });
});

describe('tree: lazy children', () => {
  type Folder = { id: string; name: string; isFile?: boolean };
  const FOLDERS: Folder[] = [
    { id: 'a', name: 'Assets' },
    { id: 'readme', name: 'Readme', isFile: true },
  ];

  const addLazy = (load: (node: Folder) => Promise<readonly Folder[]>, props = {}) =>
    add<Folder>({
      roots: FOLDERS,
      getChildren: () => undefined,
      title: (node) => node.name,
      loadChildrenAsync: load,
      hasChildren: (node) => !node.isFile,
      ...props,
    });

  it('a loading row and aria-busy while it runs; the children, kept, and the end announced', async () => {
    vi.useFakeTimers();
    const deferred = createDeferred<Folder[]>();
    const load = vi.fn(() => deferred.promise);
    const tree = addLazy(load);
    expect(getRow(tree, 'a').getAttribute('aria-expanded')).toBe('false');
    expect(getRow(tree, 'readme').hasAttribute('aria-expanded')).toBe(false);
    getRow(tree, 'a').focus();
    press('ArrowRight');
    expect(load).toHaveBeenCalledWith(FOLDERS[0]);
    expect(getRow(tree, 'a').getAttribute('aria-busy')).toBe('true');
    const status = getStatus(tree) as HTMLElement;
    expect(status.getAttribute('data-status')).toBe('loading');
    expect(status.getAttribute('aria-hidden')).toBe('true');
    expect(status.textContent).toContain('Loading…');
    expect(status.previousElementSibling).toBe(getRow(tree, 'a'));
    // Down passes over the loading row
    press('ArrowDown');
    expect(focusedKey()).toBe('readme');
    press('ArrowUp');
    deferred.resolve([
      { id: 'a/tex', name: 'Textures' },
      { id: 'a/logo', name: 'Logo', isFile: true },
    ]);
    await flushAsync();
    expect(getStatus(tree)).toBe(null);
    expect(getRow(tree, 'a').hasAttribute('aria-busy')).toBe(false);
    expect(getKeys(tree)).toEqual(['a', 'a/tex', 'a/logo', 'readme']);
    expect(getRow(tree, 'a/tex').getAttribute('aria-level')).toBe('2');
    expect(focusedKey()).toBe('a');
    vi.advanceTimersByTime(50);
    expect(getAnnounced()).toBe('Assets: 2 items');
    // Closed and opened again: the children kept, no second load
    press('ArrowLeft');
    press('ArrowRight');
    expect(getKeys(tree)).toEqual(['a', 'a/tex', 'a/logo', 'readme']);
    expect(load).toHaveBeenCalledTimes(1);
    tree.cmp.remove();
  });

  it('a failure shows an error row, a tree item whose Enter retries', async () => {
    let attempt = 0;
    const load = vi.fn(async (node: Folder) => {
      attempt++;
      if (attempt === 1) throw new Error('offline');
      return [{ id: `${node.id}/x`, name: 'X' }];
    });
    const tree = addLazy(load, {
      errorText: (error: unknown) => `Failed: ${(error as Error).message}.`,
    });
    getRow(tree, 'a').focus();
    press('ArrowRight');
    await flushAsync();
    const status = getStatus(tree) as HTMLElement;
    expect(status.getAttribute('data-status')).toBe('error');
    expect(status.getAttribute('role')).toBe('treeitem');
    expect(status.getAttribute('aria-level')).toBe('2');
    expect(status.hasAttribute('aria-hidden')).toBe(false);
    expect(status.textContent).toBe('Failed: offline.Retry');
    expect(getRow(tree, 'a').hasAttribute('aria-busy')).toBe(false);
    // Right goes to it, Left back
    press('ArrowRight');
    expect(document.activeElement).toBe(status);
    press('ArrowLeft');
    expect(focusedKey()).toBe('a');
    press('ArrowDown');
    expect(document.activeElement).toBe(status);
    press('Enter');
    // Loading again: not focusable, so the focus went to its node
    expect(focusedKey()).toBe('a');
    expect(status.getAttribute('data-status')).toBe('loading');
    await flushAsync();
    expect(getKeys(tree)).toEqual(['a', 'a/x', 'readme']);
    expect(load).toHaveBeenCalledTimes(2);
    tree.cmp.remove();
  });

  it('a node closed or removed before its load ends drops the result', async () => {
    const loads: ReturnType<typeof createDeferred<Folder[]>>[] = [];
    const load = vi.fn(() => {
      const deferred = createDeferred<Folder[]>();
      loads.push(deferred);
      return deferred.promise;
    });
    const tree = addLazy(load);
    tree.expand('a');
    tree.collapse('a');
    expect(getStatus(tree)).toBe(null);
    loads[0].resolve([{ id: 'a/old', name: 'Old' }]);
    await flushAsync();
    tree.expand('a');
    expect(load).toHaveBeenCalledTimes(2);
    expect(getRow(tree, 'a/old')).toBe(null);
    loads[1].resolve([{ id: 'a/new', name: 'New' }]);
    await flushAsync();
    expect(getKeys(tree)).toEqual(['a', 'a/new', 'readme']);
    // Removed mid-load
    tree.reloadChildren('a');
    expect(load).toHaveBeenCalledTimes(3);
    expect(getRow(tree, 'a/new')).toBe(null);
    tree.setRoots([FOLDERS[1]]);
    loads[2].resolve([{ id: 'a/late', name: 'Late' }]);
    await flushAsync();
    expect(getKeys(tree)).toEqual(['readme']);
    tree.cmp.remove();
  });

  it('expanded keys restore a lazy subtree level by level; an empty result has no open state', async () => {
    const load = vi.fn(async (node: Folder) =>
      node.id === 'a' ? [{ id: 'a/b', name: 'B' }] : node.id === 'a/b' ? [] : []
    );
    const tree = addLazy(load, { expanded: ['a', 'a/b'] });
    await flushAsync();
    await flushAsync();
    expect(load.mock.calls.map(([node]) => node.id)).toEqual(['a', 'a/b']);
    expect(getKeys(tree)).toEqual(['a', 'a/b', 'readme']);
    expect(getRow(tree, 'a/b').hasAttribute('aria-expanded')).toBe(false);
    expect(tree.getExpanded()).toEqual(['a', 'a/b']);
    tree.cmp.remove();
  });
});

describe('tree: the filter', () => {
  it('shows the matches with their ancestors, opened and marked; the expanded keys come back after', () => {
    const onExpandedChange = vi.fn();
    const tree = add({ roots: makeNodes(), heading: 'Scene', filter: {}, onExpandedChange });
    tree.setQuery('rr');
    expect(getKeys(tree)).toEqual(['world', 'props', 'barrel', 'terrain']);
    expect(getRow(tree, 'world').getAttribute('aria-expanded')).toBe('true');
    // The place among the shown siblings
    expect(getRow(tree, 'props').getAttribute('aria-setsize')).toBe('2');
    expect(getRow(tree, 'terrain').getAttribute('aria-posinset')).toBe('2');
    expect(getRow(tree, 'barrel').querySelector('.aekTree__title mark')?.textContent).toBe('rr');
    expect(getRow(tree, 'world').querySelector('mark')).toBe(null);
    expect(tree.cmp.elem.querySelector('.aekTree__count')?.textContent).toBe('2 of 9');
    // The user's close while filtering is the filter's, not reported
    getRow(tree, 'props').focus();
    press('ArrowLeft');
    expect(getKeys(tree)).toEqual(['world', 'props', 'terrain']);
    expect(onExpandedChange).not.toHaveBeenCalled();
    // Cleared: the expanded keys again (props closed), the tab stop's ancestors opened so it
    // stays shown (code's clear: unreported)
    tree.setQuery('');
    expect(getKeys(tree)).toEqual(['world', 'sun', 'props', 'terrain', 'ui', 'audio']);
    expect(focusedKey()).toBe('props');
    expect(tree.getExpanded()).toEqual(['world']);
    expect(onExpandedChange).not.toHaveBeenCalled();
    expect(tree.cmp.elem.querySelector('.aekTree__count')?.textContent).toBe('9');
    tree.cmp.remove();
  });

  it('the field: typing filters and is announced, ArrowDown enters, a cleared query keeps the focused node shown', () => {
    vi.useFakeTimers();
    const onExpandedChange = vi.fn();
    const onQueryChange = vi.fn();
    const tree = add({
      roots: makeNodes(),
      filter: { field: true, onQueryChange },
      onExpandedChange,
    });
    const search = tree.cmp.elem.querySelector('.aekTree__search') as HTMLInputElement;
    expect(search.getAttribute('aria-controls')).toBe(getRowsElem(tree).id);
    search.focus();
    search.value = 'crate';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(onQueryChange).toHaveBeenLastCalledWith('crate');
    expect(getKeys(tree)).toEqual(['world', 'props', 'crate']);
    vi.advanceTimersByTime(50);
    expect(getAnnounced()).toBe('1 of 9');
    press('ArrowDown');
    expect(focusedKey()).toBe('world');
    press('End');
    expect(focusedKey()).toBe('crate');
    search.focus();
    press('Escape');
    expect(search.value).toBe('');
    // The focused node stays shown: its ancestors opened, reported
    expect(getKeys(tree)).toEqual([
      'world',
      'sun',
      'props',
      'crate',
      'barrel',
      'terrain',
      'ui',
      'audio',
    ]);
    expect(onExpandedChange).toHaveBeenLastCalledWith(['world', 'props']);
    expect(getRow(tree, 'crate').getAttribute('tabindex')).toBe('0');
    tree.cmp.remove();
  });

  it('no match: the line and its clear button', () => {
    const tree = add({ roots: makeNodes(), filter: {} });
    tree.setQuery('zz');
    expect(getRowsElem(tree).hasAttribute('hidden')).toBe(true);
    const noMatch = tree.cmp.elem.querySelector('.aekTree__noMatch') as HTMLElement;
    expect(noMatch.querySelector('p')?.textContent).toBe('No matches for “zz”');
    click(noMatch.querySelector('.aekTree__clear') as HTMLElement);
    expect(tree.getQuery()).toBe('');
    expect(getKeys(tree)).toEqual(['world', 'ui', 'audio']);
    tree.cmp.remove();
  });
});

describe('tree: virtual rows, revealing a node', () => {
  let observers: ReturnType<typeof stubResizeObserver>;

  beforeEach(() => {
    observers = stubResizeObserver();
  });

  afterEach(() => {
    observers.restore();
  });

  it('renders only the window of the shown lines; End renders and focuses the last', () => {
    const roots: Node[] = [
      {
        id: 'root',
        name: 'Root',
        children: Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, name: `Node ${i}` })),
      },
    ];
    const tree = add({
      roots,
      expanded: ['root'],
      virtual: createVirtualRows({ rowHeight: 20 }),
    });
    const box = getRowsElem(tree);
    observers.resize(box, { height: 100 });
    expect(box.hasAttribute('data-virtual')).toBe(true);
    expect(getKeys(tree)).toEqual(['root', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']);
    expect(box.querySelectorAll('.aekTree__spacer')).toHaveLength(2);
    getRow(tree, 'root').focus();
    press('End');
    expect(focusedKey()).toBe('n999');
    expect(getRow(tree, 'n999').getAttribute('aria-posinset')).toBe('1000');
    expect(box.scrollTop).toBe(1001 * 20 - 100);
    expect(getRow(tree, 'n500')).toBe(null);
    tree.cmp.remove();
    expect(observers.observerCount()).toBe(0);
  });

  it('focusKey and scrollToKey open the node’s ancestors (unreported)', () => {
    const onExpandedChange = vi.fn();
    const tree = add({ roots: makeNodes(), onExpandedChange });
    tree.focusKey('barrel');
    expect(focusedKey()).toBe('barrel');
    expect(tree.getExpanded()).toEqual(['world', 'props']);
    tree.collapse('world');
    tree.scrollToKey('hud');
    expect(getRow(tree, 'hud')).not.toBe(null);
    expect(onExpandedChange).not.toHaveBeenCalled();
    // While filtering a node the filter hides stays hidden
    tree.setQuery('sun');
    tree.focusKey('audio');
    expect(getRow(tree, 'audio')).toBe(null);
    tree.cmp.remove();
  });
});

describe('tree: live data and removal', () => {
  it('a function’s roots are read on refresh and on the scheduler', () => {
    let nodes = makeNodes().slice(0, 1);
    const scheduler = createBindingScheduler();
    const tree = add({ roots: () => nodes, scheduler });
    nodes = makeNodes();
    tree.refresh();
    expect(getKeys(tree)).toEqual(['world', 'ui', 'audio']);
    nodes = makeNodes().slice(2);
    scheduler.refresh();
    expect(getKeys(tree)).toEqual(['audio']);
    tree.cmp.remove();
    scheduler.dispose();
  });

  it('removal leaves no listener or scheduler entry, mid-typeahead and mid-load too', async () => {
    vi.useFakeTimers();
    const scheduler = createBindingScheduler();
    const read = vi.fn(makeNodes);
    const deferred = createDeferred<Node[]>();
    const tree = add({
      roots: read,
      getChildren: (node) => (node.id === 'audio' ? undefined : node.children),
      loadChildrenAsync: () => deferred.promise,
      tooltip: (node) => node.name,
      selection: 'single',
      filter: { field: true },
      scheduler,
    });
    const rowsElem = getRowsElem(tree);
    const search = tree.cmp.elem.querySelector('.aekTree__search') as HTMLElement;
    const audio = getRow(tree, 'audio');
    expect(countListeners(rowsElem)).toBe(3);
    expect(countListeners(audio)).toBeGreaterThan(0);
    tree.expand('audio');
    audio.focus();
    press('w');
    tree.cmp.remove();
    expect(countListeners(rowsElem)).toBe(0);
    expect(countListeners(search)).toBe(0);
    expect(countListeners(audio)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    deferred.resolve([{ id: 'late', name: 'Late' }]);
    vi.useRealTimers();
    await flushAsync();
    read.mockClear();
    scheduler.refresh();
    expect(read).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
