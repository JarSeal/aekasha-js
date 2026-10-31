import { beforeAll, describe, expect, it, vi } from 'vitest';
import { stubKitDomAsync } from '../../testing/KitDom';
import { createFieldset } from '../Fieldset';
import { createFolder } from '../Folder';
import { createMonitor } from '../Monitor';
import { createNumberField } from '../NumberField';
import {
  beginAncestorPass,
  clearAncestorReads,
  endAncestorPass,
  isInDisabledFieldset,
  isInHiddenAncestor,
} from './AncestorReads';
import { createBindingScheduler } from './BindingScheduler';

beforeAll(async () => {
  await stubKitDomAsync();
});

/** A parent with two children, under a grandparent */
const makeTree = () => {
  const outer = document.createElement('div');
  const parent = document.createElement('div');
  const a = document.createElement('span');
  const b = document.createElement('span');
  parent.append(a, b);
  outer.append(parent);
  document.body.append(outer);
  return { outer, parent, a, b };
};

describe('AncestorReads', () => {
  it('walks every time outside a pass', () => {
    const { outer, a } = makeTree();
    expect(isInHiddenAncestor(a)).toBe(false);
    outer.setAttribute('hidden', '');
    expect(isInHiddenAncestor(a)).toBe(true);
    outer.remove();
  });

  it("shares a parent's answer within a pass, until a write clears it", () => {
    const { outer, parent, a, b } = makeTree();
    const closest = vi.spyOn(parent, 'closest');
    const pass = beginAncestorPass();
    expect(isInHiddenAncestor(a)).toBe(false);
    expect(isInHiddenAncestor(b)).toBe(false);
    expect(closest).toHaveBeenCalledTimes(1);
    // A write the kit doesn't make isn't seen mid-pass
    outer.setAttribute('hidden', '');
    expect(isInHiddenAncestor(b)).toBe(false);
    clearAncestorReads();
    expect(isInHiddenAncestor(b)).toBe(true);
    endAncestorPass(pass);
    // The next pass walks again
    outer.removeAttribute('hidden');
    const next = beginAncestorPass();
    expect(isInHiddenAncestor(a)).toBe(false);
    endAncestorPass(next);
    expect(closest).toHaveBeenCalledTimes(3);
    outer.remove();
  });

  it('keeps the fieldset answer apart, and a nested pass its own', () => {
    const { parent, a, outer } = makeTree();
    const fieldset = document.createElement('fieldset');
    fieldset.setAttribute('disabled', '');
    fieldset.append(parent);
    outer.append(fieldset);
    const pass = beginAncestorPass();
    expect(isInDisabledFieldset(a)).toBe(true);
    expect(isInHiddenAncestor(a)).toBe(false);
    const inner = beginAncestorPass();
    fieldset.removeAttribute('disabled');
    expect(isInDisabledFieldset(a)).toBe(false);
    endAncestorPass(inner);
    expect(isInDisabledFieldset(a)).toBe(false);
    endAncestorPass(pass);
    outer.remove();
  });
});

describe("the scheduler's passes", () => {
  it("read a folder's fields with one walk, and a hidden function's change in the same pass", () => {
    const scheduler = createBindingScheduler();
    const state = { a: 1, b: 2, hideB: false };
    const a = createNumberField({ label: 'A', target: state, key: 'a', scheduler });
    const b = createNumberField({
      label: 'B',
      target: state,
      key: 'b',
      scheduler,
      hidden: () => state.hideB,
    });
    const folder = createFolder({ title: 'Values', scheduler, children: [a, b] });
    document.body.append(folder.cmp.elem);

    const content = folder.content.elem;
    const closest = vi.spyOn(content, 'closest');
    state.a = 5;
    scheduler.refresh();
    expect(a.cmp.elem.querySelector('input')!.value).toContain('5');
    // Two fields, one parent: its walk shared (the fieldset's and the hidden one)
    expect(closest.mock.calls.filter(([s]) => s === '[hidden]')).toHaveLength(1);
    expect(closest.mock.calls.filter(([s]) => s === 'fieldset[disabled]')).toHaveLength(1);

    // B hides itself in the pass: its own attribute, read before the ancestors, so it isn't read
    const bInput = b.cmp.elem.querySelector('input')!;
    const shownB = bInput.value;
    state.hideB = true;
    state.b = 9;
    scheduler.refresh();
    expect(b.cmp.elem.hasAttribute('hidden')).toBe(true);
    expect(bInput.value).toBe(shownB);

    // A shut folder hides both (its region, at the animation's end); the fields' answers come
    // from the walk the shut cleared
    const aInput = a.cmp.elem.querySelector('input')!;
    const shownA = aInput.value;
    vi.useFakeTimers();
    folder.setExpanded(false);
    vi.runAllTimers();
    vi.useRealTimers();
    state.a = 7;
    scheduler.refresh();
    expect(aInput.value).toBe(shownA);
    // Shown again: read once by the reveal
    folder.setExpanded(true);
    expect(aInput.value).not.toBe(shownA);
    folder.cmp.remove();
    scheduler.dispose();
  });

  it("follows a fieldset's disabling", () => {
    const scheduler = createBindingScheduler();
    const state = { v: 1 };
    const monitor = createMonitor({ label: 'V', target: state, key: 'v', scheduler });
    const field = createNumberField({ label: 'W', target: state, key: 'v', scheduler });
    const fieldset = createFieldset({ legend: 'Group', children: [monitor, field] });
    document.body.append(fieldset.cmp.elem);
    scheduler.refresh();
    fieldset.setDisabled(true);
    scheduler.refresh();
    expect(field.cmp.elem.hasAttribute('data-disabled')).toBe(true);
    fieldset.setDisabled(false);
    scheduler.refresh();
    expect(field.cmp.elem.hasAttribute('data-disabled')).toBe(false);
    fieldset.cmp.remove();
    scheduler.dispose();
  });
});
