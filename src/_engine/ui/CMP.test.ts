import { afterEach, describe, expect, it, vi } from 'vitest';

// CMP builds DOM: linkedom's document and window, stubbed in this file only
const dom = vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  return parseHTML('<!doctype html><html><head></head><body></body></html>');
});
vi.stubGlobal('document', (await dom).document);
vi.stubGlobal('window', (await dom).window);
vi.stubGlobal('HTMLInputElement', (await dom).window.HTMLInputElement);

import { CMP } from './CMP';

afterEach(() => {
  vi.useRealTimers();
});

describe('CMP: the latent bugs (p617 §1.4)', () => {
  // U1: the parent's onCreateCmp ran once per template child, at creation and at every update
  it.fails('runs onCreateCmp once when mounted and once per update (U1)', () => {
    const onCreateCmp = vi.fn();
    const a = CMP({ text: 'a' });
    const b = CMP({ text: 'b' });
    const parent = CMP({ html: () => `<div>${a}${b}</div>`, onCreateCmp });
    expect(onCreateCmp).toHaveBeenCalledTimes(0);
    CMP().add(parent);
    expect(onCreateCmp).toHaveBeenCalledTimes(1);
    parent.update({});
    expect(onCreateCmp).toHaveBeenCalledTimes(2);
  });

  it.fails("calls a template child's own onCreateCmp when its parent adopts it (U1)", () => {
    const onCreateCmp = vi.fn();
    const child = CMP({ text: 'child', onCreateCmp });
    CMP({ html: () => `<div>${child}</div>` });
    expect(onCreateCmp).toHaveBeenCalledTimes(1);
  });

  // U2: a custom listener's options were stored but never passed
  it.fails("passes a custom listener's options (U2)", () => {
    const fn = vi.fn();
    const cmp = CMP({ listeners: [{ type: 'ping', fn, options: { once: true } }] });
    cmp.elem.dispatchEvent(new window.Event('ping'));
    cmp.elem.dispatchEvent(new window.Event('ping'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // U3: a phaseEndFn that jumps ran the chain twice, with two timers
  it.fails('keeps one timer when a phase end jumps, and clears it on remove (U3)', () => {
    vi.useFakeTimers();
    const cmp = CMP({
      anim: [
        { duration: 10, class: 'first', phaseEndFn: () => 0 },
        { duration: 10, class: 'second' },
      ],
    });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10);
    expect(vi.getTimerCount()).toBe(1);
    cmp.remove();
    expect(vi.getTimerCount()).toBe(0);
  });

  // U4: focus called setSelectionRange on inputs that have no selection (number, checkbox, ...)
  it.fails("doesn't throw when focusing an input without a selection (U4)", () => {
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
  it.fails('keeps updateAttr attributes through an update (U5)', () => {
    const cmp = CMP({ tag: 'div', text: 'x' });
    cmp.updateAttr({ 'data-x': '1' });
    cmp.update({ text: 'y' });
    expect(cmp.elem.getAttribute('data-x')).toBe('1');
  });
});
