import { afterEach, describe, expect, it, vi } from 'vitest';

// CMP builds DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);
vi.stubGlobal('HTMLInputElement', (await dom).window.HTMLInputElement);

import { classes, CMP } from './CMP';

afterEach(() => {
  vi.useRealTimers();
});

describe('CMP: the latent bugs (p617 §1.4)', () => {
  // U1: the parent's onCreateCmp ran once per template child, at creation and at every update
  it('runs onCreateCmp once when mounted and once per update (U1)', () => {
    const onCreateCmp = vi.fn();
    // Template children are made in the html function: an update makes them again
    const parent = CMP({
      html: () => `<div>${CMP({ text: 'a' })}${CMP({ text: 'b' })}</div>`,
      onCreateCmp,
    });
    expect(onCreateCmp).toHaveBeenCalledTimes(0);
    CMP().add(parent);
    expect(onCreateCmp).toHaveBeenCalledTimes(1);
    parent.update({});
    expect(onCreateCmp).toHaveBeenCalledTimes(2);
  });

  it("calls a template child's own onCreateCmp when its parent adopts it (U1)", () => {
    const onCreateCmp = vi.fn();
    const child = CMP({ text: 'child', onCreateCmp });
    CMP({ html: () => `<div>${child}</div>` });
    expect(onCreateCmp).toHaveBeenCalledTimes(1);
  });

  // U2: a custom listener's options were stored but never passed
  it("passes a custom listener's options (U2)", () => {
    const fn = vi.fn();
    const cmp = CMP({ listeners: [{ type: 'ping', fn, options: { once: true } }] });
    cmp.elem.dispatchEvent(new window.Event('ping'));
    cmp.elem.dispatchEvent(new window.Event('ping'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // U3: a phaseEndFn that jumps ran the chain twice, with two timers
  it('keeps one timer when a phase end jumps, and clears it on remove (U3)', () => {
    vi.useFakeTimers();
    const cmp = CMP({
      anim: [
        { duration: 10, class: 'first', phaseEndFn: () => 0 },
        { duration: 10, class: 'second' },
      ],
    });
    // A chain starts when the CMP is added (or attached as the root)
    CMP().add(cmp);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10);
    expect(vi.getTimerCount()).toBe(1);
    cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  // U4: focus called setSelectionRange on inputs that have no selection (number, checkbox, ...)
  it("doesn't throw when focusing an input without a selection (U4)", () => {
    const cmp = CMP({ tag: 'input', attr: { type: 'number' } });
    // A browser's number input: no selection, and setSelectionRange throws
    Object.defineProperty(cmp.elem, 'selectionStart', { value: null });
    Object.defineProperty(cmp.elem, 'setSelectionRange', {
      value: () => {
        throw new Error('InvalidStateError');
      },
    });
    expect(() => cmp.focus()).not.toThrow();
  });

  // U5: updateAttr recorded the attributes only when the CMP had `attr` already
  it('keeps updateAttr attributes through an update (U5)', () => {
    const cmp = CMP({ tag: 'div', text: 'x' });
    cmp.updateAttr({ 'data-x': '1' });
    cmp.update({ text: 'y' });
    expect(cmp.elem.getAttribute('data-x')).toBe('1');
  });
});

describe('CMP: building and updating', () => {
  it('adds children, and keeps the added ones through an update', () => {
    const parent = CMP({ tag: 'section', class: 'panel' });
    const child = parent.add({ tag: 'p', text: 'kept' });
    parent.update({ class: 'panel open' });
    expect(parent.elem.tagName).toBe('SECTION');
    expect(parent.elem.className).toBe('panel open');
    expect(parent.children).toEqual([child]);
    expect(child.elem.parentElement).toBe(parent.elem);
  });

  it('rebuilds template children from the html function on an update', () => {
    let label = 'first';
    const parent = CMP({ html: () => `<div>${CMP({ tag: 'span', text: label })}</div>` });
    expect(parent.elem.textContent).toBe('first');
    label = 'second';
    parent.update({});
    expect(parent.elem.textContent).toBe('second');
    expect(parent.children).toHaveLength(1);
  });

  it('removes its children, listeners and timers with it, and frees its id', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const onRemoveCmp = vi.fn();
    const host = CMP();
    const cmp = host.add({ id: 'removable', onClick, onRemoveCmp });
    cmp.add({ text: 'child' });
    cmp.updateAnim([{ duration: 10, class: 'pulse' }]);
    const elem = cmp.elem;
    cmp.remove();
    elem.dispatchEvent(new window.Event('click'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onRemoveCmp).toHaveBeenCalledTimes(1);
    expect(host.children).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => CMP({ id: 'removable' })).not.toThrow();
  });

  it('updates classes, styles and text in place', () => {
    const cmp = CMP({ text: 'a', class: 'one two', style: { color: 'red' } });
    cmp.updateClass('two', 'remove').updateClass('three', 'add').updateClass('one', 'toggle');
    expect(cmp.elem.className).toBe('three');
    cmp.updateStyle({ color: null, opacity: 0.5, '--accent': '#fff' });
    expect(cmp.elem.style.getPropertyValue('opacity')).toBe('0.5');
    expect(cmp.elem.style.getPropertyValue('--accent')).toBe('#fff');
    expect(cmp.elem.style.getPropertyValue('color')).toBe('');
    cmp.updateText('b');
    expect(cmp.elem.textContent).toBe('b');
    expect(cmp.props).toMatchObject({ text: 'b', style: { opacity: '0.5' } });
  });

  it("writes its own props in place, never the caller's objects (U7)", () => {
    const SHARED_STYLE = { color: 'red' };
    const a = CMP({ text: 'a', style: SHARED_STYLE });
    const b = CMP({ text: 'b', style: SHARED_STYLE });
    const props = a.props;
    a.updateStyle({ color: 'blue' }).updateText('a2').updateAttr({ 'data-x': '1' });
    expect(a.props).toBe(props); // no copy per update
    expect(a.props).toMatchObject({
      text: 'a2',
      style: { color: 'blue' },
      attr: { 'data-x': '1' },
    });
    expect(SHARED_STYLE).toEqual({ color: 'red' });
    expect(b.props?.style).toEqual({ color: 'red' });
  });

  it('joins classes from strings, arrays and empty values', () => {
    expect(classes('a', ['b', 'c'], null, undefined, '')).toEqual(['a', 'b', 'c']);
  });
});
