import { beforeAll, describe, expect, it, vi } from 'vitest';
import { countListeners, dispatchKey, stubKitDomAsync } from '../testing/KitDom';
import { CMP } from '../core/CMP';
import { createHudRoot, getHUDRootCMP } from '../core/HUD';
import { createTabs } from '../components/Tabs';
import { pushOverlay } from '../overlays/OverlayStack';
import { createSpatialNavigation, type SpatialNavigationProps } from './SpatialNavigation';

/** Gives an element its box (linkedom lays nothing out): the module reads only this */
const place = (elem: Element, left: number, top: number, width = 40, height = 20) => {
  const box = { left, top, right: left + width, bottom: top + height, width, height };
  (elem as HTMLElement).getBoundingClientRect = () => box as DOMRect;
};

/** A root in the HUD with buttons placed at `boxes` ([left, top, width?, height?]), in order */
const addRoot = (boxes: number[][], html?: string) => {
  const root = CMP({
    html: `<div>${
      html ?? boxes.map((_, i) => `<button type="button" id="b${i}">${i}</button>`).join('')
    }</div>`,
  });
  getHUDRootCMP().add(root);
  place(root.elem, 0, 0, 1000, 1000);
  const buttons = [...root.elem.querySelectorAll('button')];
  boxes.forEach(([left, top, width, height], i) => place(buttons[i], left, top, width, height));
  return { root, buttons };
};

const addNavigation = (props: Partial<SpatialNavigationProps> & { root: HTMLElement }) =>
  createSpatialNavigation(props);

/** A 3 × 2 grid of buttons, 60 px apart */
const GRID = [
  [0, 0],
  [60, 0],
  [120, 0],
  [0, 60],
  [60, 60],
  [120, 60],
];

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot') as HTMLElement });
  // linkedom has none: what `move` sends a composite
  class TestKeyboardEvent extends window.Event {
    key: string;
    constructor(type: string, init: KeyboardEventInit) {
      super(type, init);
      this.key = init.key ?? '';
    }
  }
  vi.stubGlobal('KeyboardEvent', TestKeyboardEvent);
});

describe('spatial navigation (p808 D8)', () => {
  it('moves by position with the arrow keys, using them up, and stays at an edge', () => {
    const { root, buttons } = addRoot(GRID);
    const navigation = addNavigation({ root: root.elem });
    buttons[0].focus();
    const event = dispatchKey(buttons[0], 'keydown', 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
    dispatchKey(buttons[1], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(buttons[4]);
    dispatchKey(buttons[4], 'keydown', 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[3]);
    // An edge: nothing ahead, the key still used
    expect(dispatchKey(buttons[3], 'keydown', 'ArrowLeft').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[3]);
    expect(navigation.move('down')).toBe(false);
    expect(navigation.move('up')).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    // A modified arrow isn't its
    expect(
      dispatchKey(buttons[0], 'keydown', 'ArrowRight', { shiftKey: true }).defaultPrevented
    ).toBe(false);
    navigation.dispose();
    root.remove();
  });

  it('goes round with wrap', () => {
    const { root, buttons } = addRoot(GRID);
    const navigation = addNavigation({ root: root.elem, wrap: true });
    buttons[2].focus();
    navigation.move('right');
    expect(document.activeElement).toBe(buttons[0]);
    navigation.move('up');
    expect(document.activeElement).toBe(buttons[3]);
    navigation.dispose();
    root.remove();
  });

  it('weighs the gap across the direction twice the distance along it', () => {
    // From 0: 1 is 10 px ahead but 30 px off the row (10 + 60), 2 is 50 px ahead in the row
    const { root, buttons } = addRoot([
      [0, 0],
      [50, 50],
      [90, 0],
    ]);
    const navigation = addNavigation({ root: root.elem });
    buttons[0].focus();
    navigation.move('right');
    expect(document.activeElement).toBe(buttons[2]);
    navigation.dispose();
    root.remove();
  });

  it('takes a box overlapping ahead when none is wholly ahead', () => {
    // A wide button over a narrow one that starts inside its width
    const { root, buttons } = addRoot([
      [0, 0, 200, 40],
      [150, 10, 100, 20],
    ]);
    const navigation = addNavigation({ root: root.elem });
    buttons[0].focus();
    navigation.move('right');
    expect(document.activeElement).toBe(buttons[1]);
    navigation.dispose();
    root.remove();
  });

  it('leaves out what is inert, unrendered or a roving item, and a radio group but its stop', () => {
    const { root, buttons } = addRoot(
      [
        [0, 0],
        [0, 40],
        [0, 80],
      ],
      '<button id="a">A</button><div inert><button>B</button></div>' +
        '<button tabindex="-1">C</button>' +
        '<input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2" checked>'
    );
    const [first] = buttons;
    const radios = [...root.elem.querySelectorAll('input')];
    place(radios[0], 0, 120);
    place(radios[1], 0, 160);
    // The shim's state isn't the attribute's
    radios[1].checked = true;
    const navigation = addNavigation({ root: root.elem });
    first.focus();
    navigation.move('down');
    expect(document.activeElement).toBe(radios[1]);
    navigation.dispose();
    root.remove();
  });

  it('tries the focused group first, then the nearest group on its last focused element', () => {
    const { root, buttons } = addRoot(
      [
        [0, 0],
        [0, 60],
        [0, 120],
        [200, 0],
        [260, 0],
        [200, 60],
      ],
      '<div data-aek-focus-group id="side"><button>0</button><button>1</button><button>2</button></div>' +
        '<div data-aek-focus-group id="panel"><button>3</button><button>4</button><button>5</button></div>'
    );
    place(root.elem.querySelector('#side') as Element, 0, 0, 40, 140);
    place(root.elem.querySelector('#panel') as Element, 200, 0, 100, 80);
    const navigation = addNavigation({ root: root.elem });
    // The panel's last focused element is 4
    buttons[4].focus();
    buttons[1].focus();
    navigation.move('right');
    expect(document.activeElement).toBe(buttons[4]);
    navigation.move('left');
    expect(document.activeElement).toBe(buttons[3]);
    navigation.move('left');
    // Back into the side on its last focused element, not its nearest (0)
    expect(document.activeElement).toBe(buttons[1]);
    navigation.move('down');
    expect(document.activeElement).toBe(buttons[2]);
    // Round the groups, each on its last focused element
    expect(navigation.nextGroup()).toBe(true);
    expect(document.activeElement).toBe(buttons[3]);
    navigation.nextGroup();
    expect(document.activeElement).toBe(buttons[2]);
    navigation.previousGroup();
    expect(document.activeElement).toBe(buttons[3]);
    navigation.dispose();
    root.remove();
  });

  it('wraps inside the focused group', () => {
    const { root, buttons } = addRoot(
      [
        [0, 0],
        [0, 60],
        [200, 0],
      ],
      '<div data-aek-focus-group><button>0</button><button>1</button></div><button>2</button>'
    );
    const navigation = addNavigation({ root: root.elem, wrap: true });
    buttons[1].focus();
    navigation.move('down');
    expect(document.activeElement).toBe(buttons[0]);
    navigation.dispose();
    root.remove();
  });

  it('follows an element’s override', () => {
    const { root, buttons } = addRoot(GRID);
    buttons[0].setAttribute('data-aek-nav-down', 'b5');
    const navigation = addNavigation({ root: root.elem });
    buttons[0].focus();
    dispatchKey(buttons[0], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(buttons[5]);
    buttons[5].setAttribute('data-aek-nav-up', 'missing');
    navigation.move('up');
    expect(document.activeElement).toBe(buttons[2]);
    navigation.dispose();
    root.remove();
  });

  it('leaves the arrows to a text field, and to a composite that used them', () => {
    const { root, buttons } = addRoot(
      [[0, 0]],
      '<button>0</button><input type="text"><div role="listbox" tabindex="0"></div>'
    );
    const input = root.elem.querySelector('input') as HTMLInputElement;
    const listbox = root.elem.querySelector('[role="listbox"]') as HTMLElement;
    place(input, 0, 60);
    place(listbox, 0, 120);
    listbox.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    const navigation = addNavigation({ root: root.elem });
    input.focus();
    expect(dispatchKey(input, 'keydown', 'ArrowUp').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    listbox.focus();
    dispatchKey(listbox, 'keydown', 'ArrowUp');
    expect(document.activeElement).toBe(listbox);
    // The gamepad leaves a text field
    input.focus();
    navigation.move('up');
    expect(document.activeElement).toBe(buttons[0]);
    navigation.dispose();
    root.remove();
  });

  it('walks a composite with move while it has an item ahead, and leaves it from its edge', () => {
    const tabs = createTabs({
      label: 'Settings',
      tabs: ['Video', 'Audio'].map((label) => ({
        key: label,
        label,
        content: CMP({ html: `<button>${label} option</button>` }),
      })),
    });
    const root = CMP();
    getHUDRootCMP().add(root);
    root.add(tabs.cmp);
    const tabElems = [...root.elem.querySelectorAll('[role="tab"]')];
    place(tabElems[0], 0, 0);
    place(tabElems[1], 60, 0);
    const option = root.elem.querySelector('.aekTabs__panel:not([hidden]) button') as HTMLElement;
    place(option, 0, 60);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const navigation = addNavigation({ root: root.elem });
    (tabElems[0] as HTMLElement).focus();
    expect(navigation.move('right')).toBe(true);
    expect(document.activeElement).toBe(tabElems[1]);
    expect(tabs.getSelected()).toBe('Audio');
    // At its edge the move leaves it (the tabs would go round)
    expect(navigation.move('right')).toBe(false);
    expect(document.activeElement).toBe(tabElems[1]);
    // An arrow the list doesn't use leaves it for the panel, the other tab no candidate
    // linkedom renders a hidden panel's content: the browser wouldn't
    place(option, 500, 500);
    const audioOption = root.elem.querySelector(
      '.aekTabs__panel:not([hidden]) button'
    ) as HTMLElement;
    place(audioOption, 0, 60);
    dispatchKey(tabElems[1], 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(audioOption);
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
    navigation.dispose();
    root.remove();
  });

  it('gives a slider the moves along its axis, kept from the window, and leaves it across', () => {
    const { root, buttons } = addRoot(
      [[0, 60]],
      '<div role="slider" tabindex="0" aria-valuenow="5"></div><button>0</button>'
    );
    const slider = root.elem.querySelector('[role="slider"]') as HTMLElement;
    place(slider, 0, 0, 200, 20);
    const keys: string[] = [];
    // A slider that doesn't stop its keys (another library's): the sent one stays in the root
    slider.addEventListener('keydown', (e) => {
      keys.push((e as KeyboardEvent).key);
      e.preventDefault();
    });
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    const navigation = addNavigation({ root: root.elem, handleKeys: false });
    slider.focus();
    expect(navigation.move('right')).toBe(true);
    expect(keys).toEqual(['ArrowRight']);
    expect(document.activeElement).toBe(slider);
    expect(onWindowKey).not.toHaveBeenCalled();
    navigation.move('down');
    expect(document.activeElement).toBe(buttons[0]);
    window.removeEventListener('keydown', onWindowKey);
    navigation.dispose();
    root.remove();
  });

  it('checks the next native radio with move', () => {
    const { root } = addRoot(
      [],
      '<input type="radio" name="q" checked><input type="radio" name="q"><input type="radio" name="q" disabled>'
    );
    const radios = [...root.elem.querySelectorAll('input')] as HTMLInputElement[];
    radios.forEach((radio, i) => place(radio, i * 60, 0));
    const navigation = addNavigation({ root: root.elem });
    radios[0].focus();
    expect(navigation.move('right')).toBe(true);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].checked).toBe(true);
    // Past the disabled one: nothing ahead
    expect(navigation.move('right')).toBe(false);
    navigation.dispose();
    root.remove();
  });

  it('goes into the root on focus and on a move from outside, its last focused element first', () => {
    const { root, buttons } = addRoot(GRID);
    const outside = document.createElement('button');
    document.body.append(outside);
    const navigation = addNavigation({ root: root.elem });
    expect(navigation.focus()).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    buttons[4].focus();
    outside.focus();
    expect(navigation.move('left')).toBe(true);
    expect(document.activeElement).toBe(buttons[4]);
    outside.remove();
    navigation.dispose();
    root.remove();
  });

  it('goes back by onBack, by Escape with it, and else by the overlay stack’s Escape', () => {
    const { root, buttons } = addRoot([[0, 0]]);
    const onBack = vi.fn();
    const navigation = addNavigation({ root: root.elem, onBack });
    buttons[0].focus();
    navigation.back();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(dispatchKey(buttons[0], 'keydown', 'Escape').defaultPrevented).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(2);
    navigation.dispose();

    const close = vi.fn();
    const removeOverlay = pushOverlay({ elem: root.elem, close });
    const plain = addNavigation({ root: root.elem });
    plain.back();
    expect(close).toHaveBeenCalledTimes(1);
    // Without onBack, Escape is the stack's alone
    dispatchKey(buttons[0], 'keydown', 'Escape');
    expect(close).toHaveBeenCalledTimes(2);
    removeOverlay(false);
    plain.dispose();
    root.remove();
  });

  it('leaves no listener after dispose', () => {
    const { root } = addRoot(GRID);
    const navigation = addNavigation({ root: root.elem });
    navigation.dispose();
    expect(countListeners(root.elem)).toBe(0);
    root.remove();
  });
});
