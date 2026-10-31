import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
vi.hoisted(() => {
  type Items = { [key: string]: string };
  const storage = Object.create({
    getItem(this: Items, key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    },
    setItem(this: Items, key: string, value: string) {
      this[key] = String(value);
    },
    removeItem(this: Items, key: string) {
      delete this[key];
    },
  }) as Storage & Items;
  vi.stubGlobal('localStorage', storage);
});

// The windows' content, captured; the scene, the helpers' setting, the canvas and the mouse
// binding a pick makes, and the fire (its results set by the test)
const win = vi.hoisted(() => ({ contents: {} as Record<string, () => unknown> }));
vi.mock(import('../../../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  registerDraggableWindow: (id: string, def: { content?: unknown }) => {
    win.contents[id] = def.content as () => unknown;
  },
  updateDraggableWindow: vi.fn(),
}));
vi.mock(import('../../scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'testScene',
  registerOnAllSceneEnters: vi.fn(),
}));
const helpers = vi.hoisted(() => ({ show: false, setShown: vi.fn() }));
vi.mock(import('./_dbg__RayHelpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRayHelperSettings: () => ({ show: helpers.show }) as never,
}));
vi.mock(import('./_dbg__Raycast'), () => ({
  _setRayHelpersShown: helpers.setShown,
}));
const canvas = vi.hoisted(() => ({ elem: null as unknown }));
vi.mock(import('../Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCanvasElem: () => canvas.elem as never,
}));
const mouse = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock(import('../../input/MouseInput'), async (importOriginal) => ({
  ...(await importOriginal()),
  createMouseBinding: mouse.create as never,
  deleteMouseBinding: vi.fn() as never,
}));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock(import('../../../ui/overlays/Toaster'), async (importOriginal) => ({
  ...(await importOriginal()),
  addToast: toasts.add as never,
}));
const fire = vi.hoisted(() => ({ hits: [] as unknown[] }));
vi.mock(import('./_dbg__RayTesterFire'), async (importOriginal) => {
  const { testerResults } = await import('./_dbg__RayTesterState');
  return {
    ...(await importOriginal()),
    fireThreeRays: () => {
      testerResults.three = [
        { ray: { origin: { x: 0, y: 5, z: 0 }, dir: { x: 0, y: -1, z: 0 } }, hits: fire.hits },
      ] as never;
    },
  };
});

import { dispatchKey, stubClipboard, stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { _refreshRayTesterHelperNotices } from './_dbg__RayTester';
import { getThreeState, RAY_TESTER_LS_KEY } from './_dbg__RayTesterState';

// p806 D10, D11: the ray tester split (its state, fire, pick and items), its notice, toolbar and
// copy buttons kit pieces, its results a list per ray

beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  canvas.elem = document.createElement('canvas');
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  helpers.show = false;
  helpers.setShown.mockClear();
});

const openThree = () => {
  const cmp = win.contents.debugRayTesterThree() as CMPHandle;
  document.body.append(cmp.elem);
  built.push(cmp);
  return cmp.elem;
};
const getButton = (root: Element, text: string) =>
  [...root.querySelectorAll('button')].find(
    (b) => b.textContent === text || b.getAttribute('aria-label') === text
  ) as HTMLButtonElement;

const hit = (i: number) => ({
  distance: 1 + i,
  point: { x: 0, y: 4 - i, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  objectName: '',
  objectType: 'Mesh',
  instanceId: null,
  entityId: 9,
  appId: 'box',
  appIdIsFixed: false,
});

describe('the state', () => {
  it("merges a scene's saved params over the defaults", () => {
    lsSetItem(RAY_TESTER_LS_KEY, {
      testScene: { three: { version: 1, rays: [{ far: 50, near: 'x', gone: 1 }], activeIndex: 3 } },
    });
    // Read once per scene: before any window reads it
    const state = getThreeState();
    const ray = state.rays[0];
    // A saved value of the default's type is kept, another type and an unknown key dropped
    expect(ray.far).toBe(50);
    expect(ray.near).toBe(0);
    expect('gone' in ray).toBe(false);
    expect(state.activeIndex).toBe(0);
  });
});

describe('the window', () => {
  it("says which scene's params it shows, and the helpers' notice while they're off", () => {
    const elem = openThree();
    expect(elem.textContent).toContain('Saved per scene (testScene)');
    const notice = getButton(elem, 'Show helpers').parentElement as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain(
      "Three.js ray helpers are off, so fired rays aren't drawn."
    );
    getButton(elem, 'Show helpers').click();
    expect(helpers.setShown).toHaveBeenCalledWith('THREE', true);
    // The tab turned them on: it refreshes the notices
    helpers.show = true;
    _refreshRayTesterHelperNotices();
    expect(notice.hidden).toBe(true);
  });

  it('lists the hits after a fire, each with its fields and its copy button, at most 20', async () => {
    const clipboard = stubClipboard();
    fire.hits = Array.from({ length: 23 }, (_, i) => hit(i));
    const elem = openThree();
    expect(elem.textContent).toContain('Fire to see the hits.');
    getButton(elem, 'Fire').click();
    const list = elem.querySelector('.aekList') as HTMLElement;
    expect(list.querySelector('.aekList__count')?.textContent).toBe('20');
    const rows = list.querySelectorAll('.aekList__row');
    expect(rows).toHaveLength(20);
    const fields = [...rows[0].querySelectorAll('dt, dd')].map((cell) => cell.textContent);
    expect(fields).toEqual([
      'Point',
      '(0.000, 4.000, 0.000)',
      'Normal',
      '(0.000, 1.000, 0.000)',
      'Object',
      '(unnamed) · Mesh',
      'Entity',
      '9',
      'App id',
      'box (generated)',
    ]);
    expect(rows[0].textContent).toContain('#1 · distance 1.000');
    expect(elem.textContent).toContain('+3 more hits not listed');
    getButton(rows[1] as HTMLElement, 'Copy this hit as JSON').click();
    await vi.waitFor(() => expect(JSON.parse(clipboard.getText())).toEqual(hit(1)));
    await vi.waitFor(() =>
      expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Copied' }))
    );
    clipboard.restore();
  });

  it("shows an armed pick's status until a click on the scene, which saves, or Escape", () => {
    const elem = openThree();
    const status = elem.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toBe('');
    getButton(elem, 'Pick origin (click the scene)').click();
    expect(status.textContent).toBe('Click the scene to pick the origin (Esc cancels)');
    expect((canvas.elem as HTMLCanvasElement).style.cursor).toBe('crosshair');
    // The click on the scene: the mouse binding's hit
    const { fn } = mouse.create.mock.calls.at(-1)![0] as {
      fn: (e: unknown, hit: { point: { x: number; y: number; z: number } }) => void;
    };
    fn(null, { point: { x: 1, y: 2, z: 3 } });
    expect(status.textContent).toBe('');
    expect(getThreeState().rays[0].origin).toEqual({ x: 1, y: 2, z: 3 });
    const saved = lsGetItem(RAY_TESTER_LS_KEY, {}) as {
      testScene: { three: { rays: { origin: unknown }[] } };
    };
    expect(saved.testScene.three.rays[0].origin).toEqual({ x: 1, y: 2, z: 3 });
    getButton(elem, 'Pick origin (click the scene)').click();
    dispatchKey(window, 'keydown', 'Escape');
    expect(status.textContent).toBe('');
    expect((canvas.elem as HTMLCanvasElement).style.cursor).toBe('');
  });
});
