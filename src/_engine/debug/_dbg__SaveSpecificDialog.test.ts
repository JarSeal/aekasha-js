import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../ui/testing/KitDom';

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
  getDraggableWindow: () =>
    ({}) as ReturnType<typeof import('../ui/overlays/windows/DraggableWindow').getDraggableWindow>,
}));
vi.mock(import('../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'sceneA',
  getGeneratedAppData: () =>
    ({
      scenes: { sceneA: { name: 'Scene A' }, sceneB: { name: 'Scene B' }, sceneC: {} },
    }) as unknown as ReturnType<typeof import('../kernel/scene/Scene').getGeneratedAppData>,
}));
const toasts = vi.hoisted(() => [] as { title?: unknown; message?: unknown }[]);
vi.mock(import('./DebuggerGUI'), async (importOriginal) => ({
  ...(await importOriginal()),
  addDebugToast: (props: { title?: unknown; message?: unknown }) => {
    toasts.push(props);
    return null;
  },
}));
// The changes and the save are this test's (`_dbg__SaveData.test.ts` has the save)
const saves = vi.hoisted(() => ({
  changes: [] as unknown[],
  calls: [] as { filter: (change: never, source: never) => boolean; opts: unknown }[],
  result: null as Promise<unknown> | null,
}));
vi.mock(import('./_dbg__SaveData'), async (importOriginal) => ({
  ...(await importOriginal()),
  _collectSaveChanges: () =>
    saves.changes as ReturnType<typeof import('./_dbg__SaveData')._collectSaveChanges>,
  _saveChangesAsync: (filter: (change: never, source: never) => boolean, opts?: unknown) => {
    saves.calls.push({ filter, opts });
    return saves.result as ReturnType<typeof import('./_dbg__SaveData')._saveChangesAsync>;
  },
}));

import type { CMPHandle } from '../ui/core/CMPTypes';
import { CMP } from '../ui/core/CMP';
import { registerBuiltInIcons } from '../ui/core/icons/SvgIcon';
import { DevFilesError } from './DevFiles';
import type { SaveChange, SaveSource } from './SaveData';
import { openSaveSpecificDialog, SAVE_SPECIFIC_DIALOG_ID } from './_dbg__SaveSpecificDialog';

const SKY: SaveSource = { id: 'skyBox', label: 'Sky boxes', collect: () => [], onSaved: () => {} };
const POSTFX: SaveSource = { id: 'postFx', label: 'PostFX', collect: () => [], onSaved: () => {} };

const change = (props: Partial<SaveChange> & { id: string }): SaveChange => ({
  label: `Change ${props.id}`,
  scope: 'SCENE',
  sceneId: 'sceneA',
  path: `src/app/${props.id}.skybox.json`,
  summary: ['turbidity'],
  build: () => null,
  ...props,
});

let hudRoot: CMPHandle;
let root: CMPHandle | null = null;

const open = () => {
  openSaveSpecificDialog();
  root = (dialog.props as { content: () => CMPHandle }).content();
  hudRoot.add(root);
  return root.elem;
};
/** A checkbox by the start of its label */
const getBox = (elem: HTMLElement, label: string) => {
  const field = [...elem.querySelectorAll<HTMLElement>('.aekField')].find((f) =>
    f.querySelector('.aekField__label')?.textContent?.startsWith(label)
  );
  return field?.querySelector('input') as HTMLInputElement;
};
const getButton = (elem: HTMLElement, label: string) =>
  [...elem.querySelectorAll<HTMLButtonElement>('button.aekButton')].find((b) =>
    b.textContent?.startsWith(label)
  ) as HTMLButtonElement;
const submit = (elem: HTMLElement) =>
  elem
    .querySelector('form')!
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeAll(async () => {
  await stubKitDomAsync();
  registerBuiltInIcons();
  hudRoot = CMP({ id: 'hudRoot', idAttr: true, class: 'aekUi' });
  document.body.appendChild(hudRoot.elem);
});

beforeEach(() => {
  saves.changes = [
    { source: SKY, change: change({ id: 'a1' }) },
    {
      source: POSTFX,
      change: change({
        id: 'a2',
        summary: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
      }),
    },
    { source: SKY, change: change({ id: 'b1', sceneId: 'sceneB' }) },
    { source: SKY, change: change({ id: 'c1', sceneId: 'sceneC' }) },
    {
      source: POSTFX,
      change: change({ id: 'gone', sceneId: 'sceneD', path: null, unsaveable: 'scene not found' }),
    },
  ];
  saves.calls = [];
  saves.result = null;
  closed.ids = [];
  toasts.length = 0;
});

afterEach(() => {
  root?.remove();
  root = null;
});

describe('the "Save specific data…" dialog (p355 §2.3)', () => {
  it('groups the changes: this scene checked, each other scene unchecked, the unsaveable apart', () => {
    const elem = open();
    const headings = [...elem.querySelectorAll('.aekField__label')].map((l) => l.textContent);
    expect(headings).toEqual([
      'This scene: Scene A (2)',
      'Change a1',
      'Change a2',
      'Other scenes (2)',
      'Scene B (1)',
      'Change b1',
      'sceneC (1)',
      'Change c1',
    ]);
    expect(getBox(elem, 'This scene').checked).toBe(true);
    expect(getBox(elem, 'Change a1').checked).toBe(true);
    expect(getBox(elem, 'Other scenes').checked).toBe(false);
    expect(getBox(elem, 'Change b1').checked).toBe(false);
    // Each group a fieldset named by its title
    expect(
      [...elem.querySelectorAll('fieldset legend')].map((legend) => legend.textContent)
    ).toEqual(expect.arrayContaining(['This scene: Scene A', 'Other scenes', 'Scene B', 'sceneC']));
    // A row's file and changed keys, folded after five
    const hints = [...elem.querySelectorAll('.aekField__message')].map((m) => m.textContent);
    expect(hints).toContain('src/app/a1.skybox.json: turbidity');
    expect(hints).toContain('src/app/a2.skybox.json: p1, p2, p3, p4, p5 and 2 more');
    // Not saveable: no checkbox, its scene and why
    expect(elem.textContent).toContain('Not saveable (1)');
    expect(elem.textContent).toContain('sceneD: scene not found');
    expect(getBox(elem, 'Change gone')).toBeUndefined();
    expect(getButton(elem, 'Save').textContent).toBe('Save (2)');
  });

  it('a heading box is mixed while some of its rows are checked, and checks or unchecks them all', () => {
    const elem = open();
    getBox(elem, 'Change b1').click();
    expect(getBox(elem, 'Other scenes').indeterminate).toBe(true);
    expect(getBox(elem, 'Scene B').checked).toBe(true);
    expect(getButton(elem, 'Save').textContent).toBe('Save (3)');
    getBox(elem, 'Other scenes').click();
    expect(getBox(elem, 'Change c1').checked).toBe(true);
    expect(getBox(elem, 'Other scenes').indeterminate).toBe(false);
    getBox(elem, 'This scene').click();
    expect(getBox(elem, 'Change a1').checked).toBe(false);
    expect(getButton(elem, 'Save').textContent).toBe('Save (2)');
  });

  it('Check all, Uncheck all; Save is off at 0', () => {
    const elem = open();
    getButton(elem, 'Check all').click();
    expect(getButton(elem, 'Save').textContent).toBe('Save (4)');
    expect(getBox(elem, 'Change c1').checked).toBe(true);
    getButton(elem, 'Uncheck all').click();
    expect(getButton(elem, 'Save').textContent).toBe('Save (0)');
    expect(getButton(elem, 'Save').disabled).toBe(true);
    expect(getBox(elem, 'This scene').checked).toBe(false);
  });

  it('saves the checked changes with no "Confirm writes" dialog, everything off meanwhile, then closes', async () => {
    const elem = open();
    getBox(elem, 'Change b1').click();
    getBox(elem, 'Change a2').click();
    let resolve: (result: unknown) => void = () => {};
    saves.result = new Promise((done) => (resolve = done));
    submit(elem);
    expect(saves.calls).toHaveLength(1);
    const { filter, opts } = saves.calls[0];
    expect(opts).toEqual({ skipConfirm: true });
    const picked = (saves.changes as { source: SaveSource; change: SaveChange }[])
      .filter(({ source, change: c }) => filter(c as never, source as never))
      .map(({ change: c }) => c.id);
    expect(picked).toEqual(['a1', 'b1']);
    // Busy: the boxes and the buttons off, Save loading
    expect(getBox(elem, 'Change a1').disabled).toBe(true);
    expect(getButton(elem, 'Check all').disabled).toBe(true);
    expect(getButton(elem, 'Save').getAttribute('aria-busy')).toBe('true');
    resolve({ status: 'SAVED' });
    await flush();
    expect(closed.ids).toEqual([SAVE_SPECIFIC_DIALOG_ID]);
  });

  it('a failed save keeps it open with the error in the form’s summary, everything on again', async () => {
    const elem = open();
    saves.result = Promise.resolve({
      status: 'FAILED',
      error: new DevFilesError('CONFLICT', 'src/app/a1.skybox.json changed on disk'),
    });
    submit(elem);
    await flush();
    expect(closed.ids).toEqual([]);
    expect(elem.querySelector('.aekForm__summaryMessage')?.textContent).toBe(
      'Not saved: CONFLICT: src/app/a1.skybox.json changed on disk'
    );
    expect(document.activeElement).toBe(elem.querySelector('.aekForm__summary'));
    expect(getBox(elem, 'Change a1').disabled).toBe(false);
    expect(getButton(elem, 'Save').disabled).toBe(false);
    expect(getButton(elem, 'Save').hasAttribute('aria-busy')).toBe(false);
  });

  it('nothing written closes it with a toast; Cancel closes it', async () => {
    let elem = open();
    saves.result = Promise.resolve({
      status: 'NOTHING',
      message: 'The files have these changes already',
    });
    submit(elem);
    await flush();
    expect(closed.ids).toEqual([SAVE_SPECIFIC_DIALOG_ID]);
    expect(toasts.at(-1)).toMatchObject({ title: 'Nothing to save' });
    root?.remove();
    elem = open();
    getButton(elem, 'Cancel').click();
    expect(closed.ids).toHaveLength(2);
  });
});
