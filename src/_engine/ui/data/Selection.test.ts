import { describe, expect, it } from 'vitest';
import { createSelection, getSelectionGesture, type SelectionMode } from './Selection';

const make = (mode: SelectionMode, order = ['a', 'b', 'c', 'd', 'e']) =>
  createSelection({ mode, getOrder: () => order });

describe('selection (p805 D3)', () => {
  it('none selects nothing', () => {
    const selection = make('none');
    expect(selection.pick('a', 'replace')).toBe(false);
    expect(selection.set(['a'])).toBe(false);
    expect(selection.all()).toBe(false);
    expect(selection.get()).toEqual([]);
  });

  it('single: every gesture replaces, and `set` keeps the first key', () => {
    const selection = make('single');
    expect(selection.pick('b', 'replace')).toBe(true);
    expect(selection.pick('b', 'replace')).toBe(false);
    expect(selection.pick('d', 'toggle')).toBe(true);
    expect(selection.get()).toEqual(['d']);
    expect(selection.pick('a', 'range')).toBe(true);
    expect(selection.get()).toEqual(['a']);
    expect(selection.all()).toBe(false);
    selection.set(['c', 'e']);
    expect(selection.get()).toEqual(['c']);
  });

  it('multiple: toggle, a range from the anchor in place of the selection, all and none', () => {
    const selection = make('multiple');
    selection.pick('b', 'replace');
    expect(selection.pick('d', 'range')).toBe(true);
    expect(selection.get()).toEqual(['b', 'c', 'd']);
    // The anchor stays: a range the other way replaces the first
    selection.pick('a', 'range');
    expect(selection.get()).toEqual(['a', 'b']);
    selection.pick('e', 'toggle');
    expect(selection.get()).toEqual(['a', 'b', 'e']);
    selection.pick('b', 'toggle');
    expect(selection.has('b')).toBe(false);
    // The toggled key is the anchor now
    selection.pick('c', 'range');
    expect(selection.get()).toEqual(['b', 'c']);
    expect(selection.all()).toBe(true);
    expect(selection.get()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(selection.all()).toBe(true);
    expect(selection.get()).toEqual([]);
  });

  it('a range with no anchor, or to a key not in the order', () => {
    const order = ['a', 'b', 'c'];
    const selection = createSelection({ mode: 'multiple', getOrder: () => order });
    expect(selection.pick('b', 'range')).toBe(true);
    expect(selection.get()).toEqual(['b']);
    expect(selection.pick('x', 'range')).toBe(false);
  });

  it('`get` is in the order, a key out of it after; `retain` drops the gone keys', () => {
    let order = ['a', 'b', 'c', 'd'];
    const selection = createSelection({ mode: 'multiple', getOrder: () => order });
    selection.set(['d', 'a', 'c']);
    expect(selection.get()).toEqual(['a', 'c', 'd']);
    // A hidden row keeps its selection, after the shown ones in the order it was selected in
    order = ['a', 'b'];
    expect(selection.get()).toEqual(['a', 'd', 'c']);
    expect(selection.retain((key) => key !== 'c')).toBe(true);
    expect(selection.get()).toEqual(['a', 'd']);
    expect(selection.retain(() => true)).toBe(false);
  });

  it('the gesture from the modifiers', () => {
    const none = { shiftKey: false, ctrlKey: false, metaKey: false };
    expect(getSelectionGesture(none)).toBe('replace');
    expect(getSelectionGesture(none, true)).toBe('toggle');
    expect(getSelectionGesture({ ...none, ctrlKey: true })).toBe('toggle');
    expect(getSelectionGesture({ ...none, metaKey: true })).toBe('toggle');
    expect(getSelectionGesture({ ...none, shiftKey: true, ctrlKey: true })).toBe('range');
  });
});
