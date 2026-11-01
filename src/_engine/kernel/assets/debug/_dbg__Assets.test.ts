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

// The tab's definition and the info windows' content, captured; the scene's data, an array's
// info, the preview's renders and the LOD chains stand-ins
const tab = vi.hoisted(() => ({ def: null as unknown, update: vi.fn() }));
vi.mock(import('../../../debug/DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  createDebuggerTab: (def: unknown) => {
    tab.def = def;
  },
  updateDebuggerTab: tab.update,
  debuggerListCMP: vi.fn() as never,
}));
const win = vi.hoisted(() => ({
  content: null as null | ((data: unknown) => unknown),
  update: vi.fn(),
}));
vi.mock(import('../../../ui/overlays/windows/DraggableWindow'), async (importOriginal) => ({
  ...(await importOriginal()),
  registerDraggableWindowKind: (_kind: string, def?: { content?: unknown }) => {
    win.content = def?.content as (data: unknown) => unknown;
  },
  updateDraggableWindow: win.update,
}));
const scene = vi.hoisted(() => ({ declared: { geometries: [] as string[] } }));
vi.mock(import('../../scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'testScene',
  getGeneratedAppData: () => ({ scenes: {} }) as never,
  getGeneratedSceneData: () => scene.declared as never,
}));
const arrays = vi.hoisted(() => ({ info: new Map<unknown, unknown>() }));
vi.mock(import('../TextureArray'), async (importOriginal) => ({
  ...(await importOriginal()),
  getTextureArrayInfo: (texture: unknown) => arrays.info.get(texture) as never,
}));
vi.mock(import('./_dbg__TexturePreview'), async (importOriginal) => ({
  ...(await importOriginal()),
  getTextureLevelCount: () => 3,
  renderTexturePreviewAsync: () => new Promise(() => {}),
}));
const lod = vi.hoisted(() => ({ pending: false, generate: vi.fn() }));
vi.mock(import('../../../features/lod/LodChains'), async (importOriginal) => ({
  ...(await importOriginal()),
  getLodChain: () => undefined,
  getLodChainOfLevel: () => undefined,
  isLodChainPending: () => lod.pending,
  generateLodChain: (...args: unknown[]) => {
    lod.generate(...args);
    lod.pending = true;
    return Promise.resolve() as never;
  },
}));

import * as THREE from 'three/webgpu';
import { stubKitDomAsync } from '../../../ui/testing/KitDom';
import type { CMPHandle } from '../../../ui/core/CMPTypes';
import type { AnyDebuggerTabDef } from '../../../debug/DebuggerGUI';
import { _buildDebuggerPane } from '../../../debug/_dbg__DebuggerPaneBuilder';
import { createBindingScheduler } from '../../../ui/forms/binding/BindingScheduler';
import { lsGetItem, lsSetItem } from '../../../utils/LocalAndSessionStorage';
import { getGeometryRegistry } from '../Geometry';
import { getTextureRegistry } from '../Texture';
import { _createAssetsDebugGUI } from './_dbg__Assets';
import { assetsUIState, ASSETS_UI_LS_KEY } from './_dbg__AssetsState';

// p806 D10, D11: the Assets tab split (its data, its state, the info window and its texture and
// geometry items), the scope a segmented control, the info window a grid of monitors with the
// tables on createTable and the buttons kit buttons

beforeAll(async () => {
  await stubKitDomAsync();
  vi.stubGlobal('requestAnimationFrame', () => 0);
  // A 5.x UI key: the tab's folders and the scope, kept as they are
  lsSetItem(ASSETS_UI_LS_KEY, { folders: { loading: true }, scope: 'ALL' });
  _createAssetsDebugGUI();
});

const built: CMPHandle[] = [];
afterEach(() => {
  for (const cmp of built.splice(0)) cmp.remove();
  tab.update.mockClear();
  win.update.mockClear();
  lod.generate.mockClear();
  lod.pending = false;
});

const mount = (cmp: CMPHandle) => {
  document.body.append(cmp.elem);
  built.push(cmp);
  return cmp.elem;
};

/** Each field's label and its monitor's text (a button row: its button's text), in order */
const readRows = (root: Element) =>
  [...root.querySelectorAll('.aekField:not([hidden])')].map((field) => [
    field.querySelector('.aekField__label')?.textContent ?? '',
    field.querySelector('.aekMonitor__value')?.textContent ?? '',
  ]);
const readRow = (root: Element, label: string) =>
  readRows(root).find(([rowLabel]) => rowLabel === label)?.[1];
const getButton = (root: Element, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

const buildTabPane = () => {
  const def = tab.def as AnyDebuggerTabDef;
  const [section] = def.content({ scheduler: createBindingScheduler() }) as Parameters<
    typeof _buildDebuggerPane
  >[1][];
  const pane = _buildDebuggerPane(def, section);
  return { pane, elem: mount(pane.cmp) };
};

const addGeometry = (id: string, geometry: THREE.BufferGeometry) => {
  getGeometryRegistry()[id] = { resource: geometry, count: 1, persistent: false } as never;
};

describe('the tab', () => {
  it('reads the saved scope, writes a picked one beside the folders, and notes what it leaves out', () => {
    expect(assetsUIState.scope).toBe('ALL');
    addGeometry('inScene', new THREE.BoxGeometry());
    addGeometry('leftOver', new THREE.BoxGeometry());
    scene.declared = { geometries: ['inScene'] };
    const { pane, elem } = buildTabPane();
    // The note is the paragraph outside the fields
    const note = () =>
      [...elem.querySelectorAll('p')].find((p) => !p.closest('.aekField')) as HTMLElement;
    // "All loaded" lists them: no note
    expect(note().hidden).toBe(true);
    const thisScene = elem.querySelector('input[value="0"]') as HTMLInputElement;
    expect(thisScene.closest('.aekSegmented__segment')?.textContent).toBe('This scene');
    thisScene.click();
    expect(assetsUIState.scope).toBe('SCENE');
    expect(lsGetItem(ASSETS_UI_LS_KEY, {})).toEqual({ folders: { loading: true }, scope: 'SCENE' });
    expect(tab.update).toHaveBeenCalled();
    pane.refresh();
    expect(note().hidden).toBe(false);
    expect(note().textContent).toMatch(/^1 loaded asset not in this scene/);
    delete getGeometryRegistry().inScene;
    delete getGeometryRegistry().leftOver;
  });
});

describe('the info window', () => {
  const open = (kind: string, id: string) =>
    mount(win.content!({ key: `${kind}:${id}`, kind, id }) as CMPHandle);

  it('shows a geometry as info rows, its unique edges on a press, and its LOD chain buttons', () => {
    addGeometry('box', new THREE.BoxGeometry());
    const elem = open('geometry', 'box');
    expect(readRow(elem, 'Type')).toBe('BoxGeometry');
    expect(readRow(elem, 'Triangles')).toBe('12');
    expect(readRow(elem, 'Chain')).toBe('none');
    // Unique edges: a button in the row until pressed, then the count in its place
    expect(readRow(elem, 'Unique edges')).toBeUndefined();
    getButton(elem, 'Compute').click();
    // A box's faces have their own vertices: 6 × 5 edges
    expect(readRow(elem, 'Unique edges')).toBe('30');
    // Generate: the window rebuilt when it starts (its buttons disabled) and when it ends
    getButton(elem, 'Generate LOD chain').click();
    expect(lod.generate).toHaveBeenCalledWith('box', { permissive: false });
    expect(win.update).toHaveBeenCalledWith('assetsInfoWindow_geometry:box');
    delete getGeometryRegistry().box;
  });

  it("shows an array's layers as a table and its preview's levels as a select", () => {
    const texture = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2), 4, 4, 2);
    arrays.info.set(texture, {
      origin: 'RUNTIME',
      members: ['red', 'green'],
      kind: 'UNCOMPRESSED',
      width: 4,
      height: 4,
      levels: 1,
      layerBytes: 64,
      swappable: true,
      cpuDataReleased: false,
    });
    getTextureRegistry().layers = { resource: texture, persistent: false } as never;
    const elem = open('texture', 'layers');
    expect(readRow(elem, 'Type')).toBe('Data array texture');
    expect(readRow(elem, 'Origin')).toBe('runtime (buildTextureArray)');
    const table = elem.querySelector('table') as HTMLTableElement;
    expect(table.querySelector('caption')?.textContent).toBe('Layers');
    const cells = [...table.querySelectorAll('tbody tr')].map((row) =>
      [...row.children].map((cell) => cell.textContent)
    );
    // No JSON sources for a runtime array: no source column
    expect(cells).toEqual([
      ['0', 'red'],
      ['1', 'green'],
    ]);
    // The preview's level is a field of the grid, its options each level's size
    const level = [...elem.querySelectorAll('.aekField')].find(
      (field) => field.querySelector('.aekField__label')?.textContent === 'Level'
    );
    expect(level?.querySelector('.aekDropDownLabel')?.textContent).toBe('0: 4 × 4 px');
    expect(elem.textContent).toContain('Rendering level 0…');
    delete getTextureRegistry().layers;
  });

  it('says when its asset is no longer loaded', () => {
    const elem = open('geometry', 'gone');
    expect(elem.textContent).toBe('The geometry "gone" is not loaded (any more).');
  });
});
