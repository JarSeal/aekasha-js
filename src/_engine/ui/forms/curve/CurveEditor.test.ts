import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHudRoot, getHUDRootCMP } from '../../core/HUD';
import {
  countListeners,
  dispatchKey,
  dispatchPointer,
  stubKitDomAsync,
} from '../../testing/KitDom';
import { createBindingScheduler } from '../binding/BindingScheduler';
import type { FieldChange } from '../Field';
import type { CurveKey, CurveValue } from './Curve';
import { createCurveEditor, type CurveEditorProps } from './CurveEditor';

beforeAll(async () => {
  await stubKitDomAsync();
  createHudRoot({ slot: document.getElementById('hudSlot')! });
});

type Change = { value: string; prev: string; last: boolean; source: string };

const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length) removers.pop()!();
});

/** A curve as text: keys `0,0 1,1/2:0` (x,y and the tangents when set), an easing its numbers */
const describe_ = (value: CurveValue) =>
  (value as unknown[]).every((part) => typeof part === 'number')
    ? (value as number[]).join(' ')
    : (value as CurveKey[])
        .map(({ x, y, inTangent, outTangent }) =>
          inTangent === undefined && outTangent === undefined
            ? `${x},${y}`
            : `${x},${y}/${inTangent ?? '-'}:${outTangent ?? '-'}`
        )
        .join(' ');

/** The plot's area: 200 × 100 px from (16, 16) (linkedom lays nothing out) */
const AREA = { left: 16, top: 16, width: 200, height: 100 };
const toClient = (x: number, y: number) => ({
  clientX: AREA.left + x * AREA.width,
  clientY: AREA.top + (1 - y) * AREA.height,
});

const LINEAR: CurveKey[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

/** An editor bound to `target.curve` (a copy of `start`), its area laid out as AREA, with its
 * onChange calls as text */
const makeEditor = (props: Partial<CurveEditorProps> = {}, start: CurveValue = LINEAR) => {
  const target = { curve: structuredClone(start) };
  const calls: Change[] = [];
  const field = createCurveEditor({
    label: 'Falloff',
    target,
    key: 'curve',
    onChange: (value: CurveValue, { prev, last, source }: FieldChange<CurveValue>) =>
      calls.push({ value: describe_(value), prev: describe_(prev), last, source }),
    ...props,
  } as CurveEditorProps);
  getHUDRootCMP().add(field.cmp);
  removers.push(() => field.cmp.remove());
  const root = field.cmp.elem;
  const q = <E extends Element = HTMLElement>(selector: string) =>
    root.querySelector<E & Element>(selector)!;
  const area = q('.aekCurveEditor__area');
  if (area) {
    area.getBoundingClientRect = () =>
      ({
        ...AREA,
        right: AREA.left + AREA.width,
        bottom: AREA.top + AREA.height,
      }) as DOMRect;
  }
  /** The points as they are now, each with its box where it's drawn */
  const getPoints = () =>
    [...root.querySelectorAll<HTMLElement>('.aekCurveEditor__point')].map((point) => {
      const left = AREA.left + (parseFloat(point.style.left) / 100) * AREA.width - 12;
      const top = AREA.top + (parseFloat(point.style.top) / 100) * AREA.height - 12;
      point.getBoundingClientRect = () =>
        ({ left, top, width: 24, height: 24, right: left + 24, bottom: top + 24 }) as DOMRect;
      return point;
    });
  return {
    field,
    target,
    calls,
    root,
    plot: q('.aekCurveEditor__plot'),
    area,
    curve: q<SVGPathElement>('.aekCurveEditor__curve'),
    arms: q<SVGPathElement>('.aekCurveEditor__arms'),
    tangentIn: q('.aekCurveEditor__tangent[data-side="in"]'),
    tangentOut: q('.aekCurveEditor__tangent[data-side="out"]'),
    getPoints,
    xInput: q<HTMLInputElement>('input[aria-label$=" X"]'),
    yInput: q<HTMLInputElement>('input[aria-label$=" Y"]'),
    inInput: q<HTMLInputElement>('input[aria-label="In tangent"]'),
    outInput: q<HTMLInputElement>('input[aria-label="Out tangent"]'),
    addButton: q<HTMLButtonElement>('.aekCurveEditor__add'),
    removeButton: q<HTMLButtonElement>('.aekCurveEditor__remove'),
    presetsButton: q<HTMLButtonElement>('.aekCurveEditor__presets'),
  };
};

const typeInto = (input: HTMLInputElement, text: string) => {
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  dispatchKey(input, 'keydown', 'Enter');
};

const click = (target: EventTarget) =>
  target.dispatchEvent(new window.Event('click', { bubbles: true }));

/** Opens the presets menu and picks the item labelled `label` */
const pickPreset = (button: HTMLElement, label: string) => {
  click(button);
  const items = [...getHUDRootCMP().elem.querySelectorAll<HTMLElement>('.aekMenu__item')];
  const item = items.find((elem) => elem.textContent?.includes(label));
  expect(item).toBeDefined();
  click(item!);
};

describe('the curve editor (p804 D8)', () => {
  it('keys: a group with the plot, a slider per key and the selected key’s row', () => {
    const { root, curve, getPoints, xInput, inInput, outInput, tangentIn, tangentOut } =
      makeEditor();
    expect(root.getAttribute('data-kind')).toBe('curve');
    const group = root.querySelector('.aekCurveEditor')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('data-mode')).toBe('keys');
    expect(root.querySelector('.aekCurveEditor__svg')!.getAttribute('aria-hidden')).toBe('true');
    // Flat to the first key, a straight segment as a cubic, flat after the last
    expect(curve.getAttribute('d')).toBe('M0 100L0 100C33.333 66.667 66.667 33.333 100 0H100');
    const points = getPoints();
    expect(points.map((point) => point.getAttribute('role'))).toEqual(['slider', 'slider']);
    expect(points.map((point) => point.getAttribute('aria-label'))).toEqual(['Key 1', 'Key 2']);
    expect(points[1].getAttribute('aria-valuenow')).toBe('1');
    expect(points[1].getAttribute('aria-valuetext')).toBe('X 1.00, Y 1.00');
    expect(points[1].style.left).toBe('100%');
    expect(points[1].style.top).toBe('0%');
    expect(points[0].hasAttribute('data-selected')).toBe(true);
    expect(xInput.getAttribute('role')).toBe('spinbutton');
    // A missing tangent shows its straight slope; the first key's in acts on nothing
    expect(parseFloat(inInput.value)).toBe(0);
    expect(parseFloat(outInput.value)).toBe(1);
    expect(tangentIn.hasAttribute('hidden')).toBe(true);
    expect(tangentOut.hasAttribute('hidden')).toBe(false);
    expect(tangentOut.getAttribute('aria-hidden')).toBe('true');
  });

  it('an easing: two handles, their arms, no tangents and no add or remove', () => {
    const { root, curve, arms, getPoints, xInput, inInput, addButton } = makeEditor(
      {},
      [0.42, 0, 0.58, 1]
    );
    expect(root.querySelector('.aekCurveEditor')!.getAttribute('data-mode')).toBe('bezier');
    expect(getPoints().map((point) => point.getAttribute('aria-label'))).toEqual([
      'Handle 1',
      'Handle 2',
    ]);
    expect(curve.getAttribute('d')).toBe('M0 100C42 100 58 0 100 0');
    expect(arms.getAttribute('d')).toBe('M0 100L42 100M100 0L58 0');
    expect(xInput.getAttribute('aria-label')).toBe('Handle X');
    expect(xInput.getAttribute('aria-valuemax')).toBe('1');
    expect(inInput).toBe(null);
    expect(addButton).toBe(null);
  });

  it('a point’s arrows move it in place along x and y, in D3’s order; focusing selects it', () => {
    const { target, calls, getPoints, xInput } = makeEditor();
    const curve = target.curve as CurveKey[];
    const key = curve[1];
    const point = getPoints()[1];
    point.focus();
    expect(point.hasAttribute('data-selected')).toBe(true);
    expect(xInput.value).toBe('1.00');
    dispatchKey(point, 'keydown', 'ArrowLeft', { shiftKey: true });
    dispatchKey(point, 'keyup', 'ArrowLeft');
    dispatchKey(point, 'keydown', 'ArrowDown');
    dispatchKey(point, 'keyup', 'ArrowDown');
    expect(target.curve).toBe(curve);
    expect(curve[1]).toBe(key);
    expect(calls).toEqual([
      { value: '0,0 0.9,1', prev: '0,0 1,1', last: false, source: 'user' },
      { value: '0,0 0.9,1', prev: '0,0 1,1', last: true, source: 'user' },
      { value: '0,0 0.9,0.99', prev: '0,0 0.9,1', last: false, source: 'user' },
      { value: '0,0 0.9,0.99', prev: '0,0 0.9,1', last: true, source: 'user' },
    ]);
  });

  it('Insert adds a key after one on the curve; Delete removes it, not below minKeys', () => {
    const { target, getPoints, removeButton } = makeEditor();
    const first = getPoints()[0];
    first.focus();
    dispatchKey(first, 'keydown', 'Insert');
    // A straight segment stays straight: no tangents
    expect(describe_(target.curve)).toBe('0,0 0.5,0.5 1,1');
    expect(document.activeElement).toBe(getPoints()[1]);
    expect(removeButton.hasAttribute('disabled')).toBe(false);
    dispatchKey(getPoints()[1], 'keydown', 'Delete');
    expect(describe_(target.curve)).toBe('0,0 1,1');
    expect(document.activeElement).toBe(getPoints()[1]);
    dispatchKey(getPoints()[1], 'keydown', 'Backspace');
    expect(describe_(target.curve)).toBe('0,0 1,1');
  });

  it('a key added on a curved segment takes the curve’s slope there', () => {
    const { target, getPoints } = makeEditor({}, [
      { x: 0, y: 0, outTangent: 0 },
      { x: 1, y: 1, inTangent: 0 },
    ]);
    const first = getPoints()[0];
    first.focus();
    dispatchKey(first, 'keydown', '+');
    // Smoothstep's slope at the middle is 1.5
    expect(describe_(target.curve)).toBe('0,0/-:0 0.5,0.5/1.5:1.5 1,1/0:-');
  });

  it('a drag moves a key from where it was grabbed, past another, keeping its index', () => {
    const { target, calls, plot, getPoints } = makeEditor();
    const point = getPoints()[0];
    const at = toClient(0, 0);
    // Grabbed 4 px right of its centre
    dispatchPointer(point, 'pointerdown', { clientX: at.clientX + 4, clientY: at.clientY });
    expect(plot.hasAttribute('data-dragging')).toBe(true);
    expect(document.activeElement).toBe(point);
    const middle = toClient(0.5, 0.5);
    dispatchPointer(plot, 'pointermove', { clientX: middle.clientX + 4, clientY: middle.clientY });
    expect(describe_(target.curve)).toBe('0.5,0.5 1,1');
    dispatchPointer(plot, 'pointermove', { clientX: 400, clientY: 0 });
    dispatchPointer(plot, 'pointerup', { clientX: 400, clientY: 0 });
    expect(describe_(target.curve)).toBe('1,1 1,1');
    expect(getPoints()[0].hasAttribute('data-selected')).toBe(true);
    expect(calls.map((call) => call.last)).toEqual([false, false, true]);
  });

  it('a press on the plot adds a key there and drags it; none past maxKeys', () => {
    const { target, calls, plot, area, getPoints, xInput } = makeEditor({ maxKeys: 3 });
    dispatchPointer(area, 'pointerdown', toClient(0.25, 0.75));
    expect(describe_(target.curve)).toBe('0,0 1,1 0.25,0.75');
    expect(document.activeElement).toBe(getPoints()[2]);
    expect(xInput.value).toBe('0.25');
    dispatchPointer(plot, 'pointermove', { ...toClient(0.35, 0.75), altKey: true });
    dispatchPointer(plot, 'pointerup', toClient(0.35, 0.75));
    expect(describe_(target.curve)).toBe('0,0 1,1 0.35,0.75');
    expect(calls.map((call) => call.last)).toEqual([false, false, true]);
    dispatchPointer(area, 'pointerdown', toClient(0.6, 0.2));
    dispatchPointer(plot, 'pointerup', toClient(0.6, 0.2));
    expect(target.curve).toHaveLength(3);
    expect(calls).toHaveLength(3);
  });

  it('an easing: a press on the plot brings the nearer handle there', () => {
    const { target, area, plot, curve, arms } = makeEditor({}, [0.42, 0, 0.58, 1]);
    dispatchPointer(area, 'pointerdown', toClient(0.9, 0.9));
    dispatchPointer(plot, 'pointerup', toClient(0.9, 0.9));
    expect(describe_(target.curve)).toBe('0.42 0 0.9 0.9');
    expect(curve.getAttribute('d')).toBe('M0 100C42 100 90 10 100 0');
    expect(arms.getAttribute('d')).toBe('M0 100L42 100M100 0L90 10');
  });

  it('the selected key’s tangent handle drags its slope', () => {
    const { target, plot, tangentOut, arms } = makeEditor({}, [
      { x: 0, y: 0, outTangent: 0 },
      { x: 1, y: 1, inTangent: 0 },
    ]);
    // Flat: the handle a share of 0.15 to the right of the key
    expect(tangentOut.style.left).toBe('15%');
    expect(tangentOut.style.top).toBe('100%');
    expect(arms.getAttribute('d')).toBe('M0 100L15 100');
    dispatchPointer(tangentOut, 'pointerdown', toClient(0.15, 0));
    dispatchPointer(plot, 'pointermove', toClient(0.15, 0.15));
    dispatchPointer(plot, 'pointerup', toClient(0.15, 0.15));
    expect(describe_(target.curve)).toBe('0,0/-:1 1,1/0:-');
    // Past the key's x: kept on its side (a steep slope), not flipped
    dispatchPointer(tangentOut, 'pointerdown', toClient(0.1, 0.1));
    dispatchPointer(plot, 'pointermove', toClient(-0.1, 0.1));
    dispatchPointer(plot, 'pointerup', toClient(-0.1, 0.1));
    expect((target.curve as CurveKey[])[0].outTangent).toBe(100);
  });

  it('the row writes the selected key: a typed x, y and tangent, the buttons', () => {
    const { target, getPoints, xInput, yInput, inInput, addButton, removeButton } = makeEditor();
    getPoints()[1].focus();
    typeInto(xInput, '0.75');
    typeInto(yInput, '0.5');
    expect(describe_(target.curve)).toBe('0,0 0.75,0.5');
    typeInto(inInput, '2');
    expect(describe_(target.curve)).toBe('0,0 0.75,0.5/2:-');
    addButton.click();
    expect(describe_(target.curve)).toBe('0,0 0.75,0.5/2:- 0.88,0.5');
    removeButton.click();
    expect(describe_(target.curve)).toBe('0,0 0.75,0.5/2:-');
  });

  it('the presets menu writes a preset in the axes’ ranges (keys) or as CSS’s (an easing)', () => {
    const keys = makeEditor({
      axes: { x: { min: 0, max: 2, step: 0.1 }, y: { min: 0, max: 10, step: 0.1 } },
    });
    pickPreset(keys.presetsButton, 'Ease in');
    expect(describe_(keys.target.curve)).toBe('0,0/-:0 2,10/10:-');
    expect(keys.calls.map((call) => call.last)).toEqual([true]);
    const easing = makeEditor({}, [0, 0, 1, 1]);
    pickPreset(easing.presetsButton, 'Smoothstep');
    expect(easing.target.curve).toEqual([1 / 3, 0, 2 / 3, 1]);
  });

  it('a change from outside redraws the points and flashes the plot', () => {
    const scheduler = createBindingScheduler();
    removers.push(() => scheduler.dispose());
    const { target, plot, getPoints } = makeEditor({ scheduler });
    (target.curve as CurveKey[]).push({ x: 0.5, y: 0.2 });
    scheduler.refresh();
    expect(getPoints()).toHaveLength(3);
    expect(plot.hasAttribute('data-flash')).toBe(true);
  });

  it('disabled: the points are out of the tab order, nothing writes', () => {
    const { field, target, getPoints, area, addButton, presetsButton } = makeEditor();
    field.setDisabled(true);
    const points = getPoints();
    expect(points[0].getAttribute('aria-disabled')).toBe('true');
    expect(points[0].hasAttribute('tabindex')).toBe(false);
    expect(addButton.hasAttribute('disabled')).toBe(true);
    expect(presetsButton.hasAttribute('disabled')).toBe(true);
    dispatchKey(points[0], 'keydown', 'ArrowRight');
    dispatchKey(points[0], 'keydown', 'Insert');
    dispatchPointer(area, 'pointerdown', toClient(0.5, 0.5));
    expect(describe_(target.curve)).toBe('0,0 1,1');
    field.setDisabled(false);
    expect(getPoints()[0].getAttribute('tabindex')).toBe('0');
    expect(addButton.hasAttribute('disabled')).toBe(false);
  });

  it('readonly is a monitor of the curve', () => {
    expect(makeEditor({ readonly: true }).root.textContent).toContain('(0.00, 0.00), (1.00, 1.00)');
    const easing = makeEditor({ readonly: true }, [0.42, 0, 0.58, 1]);
    expect(easing.root.getAttribute('data-kind')).toBe('monitor');
    expect(easing.root.textContent).toContain('cubic-bezier(0.42, 0.00, 0.58, 1.00)');
  });

  it('removed mid-drag, it leaves no listener and writes nothing more', () => {
    const { field, plot, getPoints, xInput, inInput, calls } = makeEditor();
    const points = getPoints();
    dispatchPointer(points[0], 'pointerdown', toClient(0, 0));
    dispatchPointer(plot, 'pointermove', toClient(0.3, 0.3));
    field.cmp.remove();
    expect(countListeners(plot)).toBe(0);
    for (const point of points) expect(countListeners(point)).toBe(0);
    expect(countListeners(xInput)).toBe(0);
    expect(countListeners(inInput)).toBe(0);
    expect(calls.map((call) => call.last)).toEqual([false]);
  });
});
