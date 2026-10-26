// The colour picker (p804 D8, Phase 0 step 4's pick): vanilla-colorful's HSVA picker, loaded with
// `import()` on a colour field's first open (the field works without it: the text and the
// swatches), and defined as `aek-color-picker` from its base class, which registers nothing, so a
// host page's own `hsva-color-picker` never collides with an embed's. The library is wrapped here
// alone: swapping it touches this module. Its styles (`::part`) are ColorField.scss'.
import { lwarn } from '../../../utils/Logger';
import type { Hsva } from './ColorValue';

const TAG = 'aek-color-picker';

/** The picker's element: the library's `color` is its HSVA, rounded to whole units on a move */
type PickerElement = HTMLElement & { color: Hsva };

let loading: Promise<boolean> | null = null;
let isLoaded = false;

/**
 * Whether the picker is defined: a field's panel shows it at once, else after `loadColorPickerAsync`.
 * @internal
 */
export const isColorPickerLoaded = () => isLoaded;

/**
 * Loads the library and defines the picker, once for the page; resolves false when it couldn't (a
 * warning: the panel shows without it, and the next open tries again).
 * @internal
 */
export const loadColorPickerAsync = () => {
  loading ??= import('vanilla-colorful/lib/entrypoints/hsva').then(
    ({ HsvaBase }) => {
      // `window`'s: the same registry in a browser, and the one the tests' DOM has
      const registry = window.customElements;
      if (!registry.get(TAG)) registry.define(TAG, class extends HsvaBase {});
      isLoaded = true;
      return true;
    },
    (error: unknown) => {
      lwarn('The colour picker didn’t load; the colour field works without it.', error);
      loading = null;
      return false;
    }
  );
  return loading;
};

/**
 * What a picker reports: each move of a drag or a key (`onStep`), and the gesture's end
 * (`onEnd`: the release, the key's keyup).
 * @internal
 */
export type ColorPickerProps = {
  /** Shows the alpha slider */
  alpha: boolean;
  onStep: (color: Hsva) => void;
  onEnd: () => void;
};

/**
 * A picker `createColorPicker` made.
 * @internal
 */
export type ColorPicker = {
  elem: HTMLElement;
  /** The colour it holds (the library's: whole units after a move) */
  getColor: () => Hsva;
  /** Shows a colour (no event) */
  setColor: (color: Hsva) => void;
  /** Focuses the plane */
  focus: () => void;
  /** Removes its listeners; a drag in progress ends without `onEnd` */
  dispose: () => void;
};

/**
 * Makes a picker (`loadColorPickerAsync` resolved true first): the plane, the hue and, with
 * `alpha`, the alpha, each the library's `role="slider"` (named "Color", "Hue", "Alpha" in its
 * template, with `aria-valuetext`; the arrows, and PageUp / PageDown, Home / End on the two
 * sliders). It fires only a change, so the gesture's end is found here: a primary press's release
 * (or cancel) anywhere, or the keyup of a key it used. A key it used goes no further.
 * @internal
 */
export const createColorPicker = (props: ColorPickerProps): ColorPicker => {
  const elem = document.createElement(TAG) as PickerElement;
  elem.className = 'aekColorPicker';
  if (!props.alpha) elem.setAttribute('data-alpha', 'off');
  let isPressed = false;
  /** The key whose keyup ends its gesture */
  let usedKey: string | null = null;

  const onChanged = (e: Event) => props.onStep((e as CustomEvent<{ value: Hsva }>).detail.value);

  const stopRelease = () => {
    isPressed = false;
    document.removeEventListener('pointerup', onRelease, true);
    document.removeEventListener('pointercancel', onRelease, true);
  };

  function onRelease() {
    if (!isPressed) return;
    stopRelease();
    props.onEnd();
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || isPressed) return;
    isPressed = true;
    // On the document: the library drags on it too, so the release may be anywhere
    document.addEventListener('pointerup', onRelease, true);
    document.addEventListener('pointercancel', onRelease, true);
  };

  /** The library's own listener (on its slider, before this one) prevents a key it used */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.defaultPrevented) return;
    e.stopPropagation();
    usedKey = e.key;
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key !== usedKey) return;
    e.stopPropagation();
    usedKey = null;
    props.onEnd();
  };

  const listeners: [string, (e: never) => void][] = [
    ['color-changed', onChanged],
    ['pointerdown', onPointerDown],
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
  ];
  for (const [type, fn] of listeners) elem.addEventListener(type, fn as EventListener);

  return {
    elem,
    getColor: () => elem.color,
    setColor: (color) => {
      elem.color = color;
    },
    // The library's shadow root is open
    focus: () =>
      (elem.shadowRoot?.querySelector<HTMLElement>('[part="saturation"]') ?? elem).focus({
        preventScroll: true,
      }),
    dispose: () => {
      stopRelease();
      for (const [type, fn] of listeners) elem.removeEventListener(type, fn as EventListener);
    },
  };
};
