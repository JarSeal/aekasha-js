// The UI kit's component types: a CMP (CMPHandle) and the props it is made from (CMPProps), with the
// types they name. Apart from CMP.ts so the component code stays under the size limit.

/** A CMP listener prop's function (`onClick`, …): the DOM event and the CMP it's on. */
export type CMPListener = (e: Event | InputEvent, cmp: CMPHandle) => void;

/** A listener of any event type (`CMPProps.listeners`). */
export type CMPListenerCreator = {
  /** The event type, eg. 'pointerdown', 'keydown' */
  type: string;
  /** Runs for the event, with the CMP; null adds nothing. */
  fn: ((e: Event, cmp: CMPHandle) => void) | null;
  /** `addEventListener`'s options; `capture` defaults to true, as the listener props' do. */
  options?: AddEventListenerOptions;
};

/** A listener as a CMP holds it (`CMPHandle.listeners`), so a rebuild or a removal can remove it. */
export type CMPListenerCache = {
  /** The event type */
  type: string;
  /** The function added to the element (null: removed) */
  fn: ((e: Event) => void) | null;
  /** The options it was added with */
  options?: AddEventListenerOptions;
};

/** How `CMPHandle.updateClass` applies its classes: add them, remove them, toggle each, or replace
 * the element's classes with them. */
export type CMPClassAction = 'add' | 'remove' | 'replace' | 'toggle';

/** Inline styles by property: camelCase (`backgroundColor`), kebab-case or a custom property
 * (`--accent`). A number is written without a unit (right for `zIndex` or `opacity`, not for
 * `width`); null removes the property. */
export type CMPStyle = { [key: string]: string | number | null };

/** Element attributes by name; each value is written as a string. */
export type CMPAttr = { [key: string]: unknown };

/** An animation chain's own state, shared by its phase functions while it runs. */
export type CMPAnimState = {
  /** Sets a value */
  setState: (key: string, value: unknown) => void;
  /** Removes a value */
  removeState: (key: string) => void;
  /** The values */
  state: { [key: string]: unknown };
};

/** One phase of an animation chain (`CMPProps.anim`, `CMPHandle.updateAnim`): its class and style are
 * applied when it starts, and the next phase starts after its `duration`. */
export type CMPAnimChain = {
  /** How long the phase lasts, in ms */
  duration: number;
  /** The phase that comes next (by index), instead of the one after this; a function decides at
   * the phase's start. Pointing back makes a loop. */
  gotoIndex?: number | ((cmp: CMPHandle, animState?: CMPAnimState) => number);
  /** Styles applied at the phase's start */
  style?: CMPStyle;
  /** Classes applied at the phase's start, by `classAction` */
  class?: string | string[];
  /** How `class` is applied (default 'replace') */
  classAction?: CMPClassAction;
  /** Runs at the phase's start; a returned index is the phase that comes next. */
  phaseStartFn?: (cmp: CMPHandle, animState: CMPAnimState) => void | number;
  /** Runs when the phase ends; a returned index jumps to that phase right away. */
  phaseEndFn?: (cmp: CMPHandle, animState: CMPAnimState) => void | number;
};

/** The kit's settings, read from the root CMP's props (the one made with `attach`) only. */
export type CMPSettings = {
  /** Cleans the HTML of a CMP made with `sanitize` (or of every one, with `sanitizeAll`). Without
   * one, no HTML is sanitized. */
  sanitizer?: ((html: string) => string) | null;
  /** Sanitizes every CMP's `html`, not only the ones with `sanitize` (default false) */
  sanitizeAll?: boolean;
  /**
   * Not read by the kit.
   * @deprecated No effect. Removed in engine 6.0.0.
   */
  doCheckIsInDom?: boolean;
  /** The root replaces its `attach` element (default true); false adds it into the element. */
  replaceRootDom?: boolean;
};

/**
 * What a CMP is made from (`CMP(props)`, `CMPHandle.add(props)`, `CMPHandle.update(props)`): its element,
 * its content and its listeners. The CMP keeps a copy (`style` and `attr` copied too), so a props
 * object or a style constant can be shared.
 * @remarks Every listener prop is added in the capture phase, and so is a `listeners` entry unless
 * its options say otherwise: a parent's `onClick` runs before its child's, and a child's
 * `stopPropagation()` doesn't stop it.
 */
export type CMPProps = {
  /** The kit's settings: only the root CMP's (the one with `attach`) are read. */
  settings?: CMPSettings;

  /** The CMP's id, unique among the live CMPs (a taken one throws). Default: a generated one. */
  id?: string;

  /** Writes the id as the element's `id` attribute (default false). */
  idAttr?: boolean;

  /** Makes this the root CMP, put in place of (or into, see `CMPSettings.replaceRootDom`) this
   * element. There is one root (a second throws), and the engine's HUD root is it: an app adds its
   * UI to `getHUDRootCMP()`. */
  attach?: HTMLElement;

  /** The element's text content. Only a CMP made with `text` (an empty string too) can
   * `updateText`. */
  text?: string;

  /** Adds the element before its parent's other children instead of after them. */
  prepend?: boolean;

  /** The element's tag (default 'div'; with `html`, its root element's). */
  tag?: string;

  /** The element as HTML: one root element. A function's result can hold other CMPs in a template
   * string (`` () => `<p>${icon}</p>` ``): they're put in place of their placeholders, as the
   * CMP's template children. A string with a CMP in it throws (it must be a function). */
  html?: string | ((cmp: CMPHandle) => string);

  /** Runs the root's `settings.sanitizer` over `html`. */
  sanitize?: boolean;

  /** The element's classes: a space-separated string or a list. */
  class?: string | string[];

  /** The element's attributes. */
  attr?: CMPAttr;

  /** The element's inline styles. */
  style?: CMPStyle;

  /** An animation chain, started when the CMP is added (see {@link CMPAnimChain}). */
  anim?: CMPAnimChain[];

  /** The element's 'click' listener. */
  onClick?: CMPListener;

  /** A click anywhere outside the element (one document listener serves every CMP). */
  onClickOutside?: CMPListener;

  /** The element's 'mousemove' listener. */
  onHover?: CMPListener;

  /** The element's 'mouseleave' listener. */
  onHoverOutside?: CMPListener;

  /** The element's 'focus' listener. */
  onFocus?: CMPListener;

  /** The element's 'blur' listener. */
  onBlur?: CMPListener;

  /** The element's 'input' listener. */
  onInput?: CMPListener;

  /** The element's 'change' listener. */
  onChange?: CMPListener;

  /** Runs when the CMP is mounted (added to a parent, or put in place of its placeholder in its
   * parent's `html`) and after each `update()`. */
  onCreateCmp?: (cmp: CMPHandle) => void;

  /** Runs when the CMP is removed, after its children and its element. */
  onRemoveCmp?: (cmp: CMPHandle) => void;

  /** Listeners of any event type (see {@link CMPListenerCreator}). */
  listeners?: CMPListenerCreator[];

  /** Focuses the element when it's added (a template child's on the next task). Focusing the CMP
   * after it's in the DOM (`CMPHandle.focus`) is more reliable. */
  focus?: boolean;
};

/**
 * A UI kit component: an element, its props and its children, with the methods that change them.
 * Each method returns the CMP (`add` the child), so calls chain. Its `toString()` is a placeholder
 * that a parent's `html` function puts it in place of.
 */
export type CMPHandle = {
  /** Its id, unique among the live CMPs */
  id: string;
  /** Its child CMPs: the added ones and its template children */
  children: CMPHandle[];
  /** Its own copy of the props, which the update methods write */
  props?: CMPProps;
  /** Its element */
  elem: HTMLElement;
  /** Its parent (null for the root and a CMP not added yet) */
  parent: CMPHandle | null;
  /** Its parent's element (the root's: the element it was attached in) */
  parentElem: HTMLElement | null;
  /** A child its parent's `html` placed, which the parent's `update()` makes again */
  isTemplateCmp?: boolean;
  /** The root CMP (made with `attach`) */
  isRoot?: boolean;
  /** Always true: tells a CMP from a props object */
  isCmp: boolean;
  /** Its listeners, by event (see {@link CMPListenerCache}) */
  listeners: { [key: string]: CMPListenerCache | null };
  /** Its timers: the animation chain's and `scrollIntoView`'s */
  timers: { [key: string]: { fn: unknown; curIndex?: number; animState?: CMPAnimState } };
  /** Adds a child: a CMP, or props to make one (none: an empty div). Returns the child. */
  add: (child?: CMPHandle | CMPProps) => CMPHandle;
  /** Removes the CMP: its children, listeners, timers and element, then runs its `onRemoveCmp`.
   * Its id is free again. */
  remove: () => CMPHandle;
  /** Removes every child */
  removeChildren: () => CMPHandle;
  /** Merges `newProps` into its props and rebuilds its element: the added children are kept, the
   * template children made again. A wrapped CMP is made again by its wrapper. `callback` runs
   * after. */
  update: <WrapP extends CMPProps>(
    newProps?: WrapP,
    callback?: (cmp: CMPHandle) => void
  ) => CMPHandle;
  /** Changes its classes by `action` (default 'replace') */
  updateClass: (newClass: string | string[], action?: CMPClassAction) => CMPHandle;
  /** Sets attributes (kept for the next `update()`) */
  updateAttr: (newAttr: CMPAttr) => CMPHandle;
  /** Removes attributes */
  removeAttr: (attrKey: string | string[]) => CMPHandle;
  /** Sets inline styles (null removes one), kept for the next `update()` */
  updateStyle: (newStyle: CMPStyle) => CMPHandle;
  /** Sets its text; throws for a CMP not made with `text` */
  updateText: (newText: string) => CMPHandle;
  /** Replaces its animation chain (an empty one stops it) */
  updateAnim: (animChain: CMPAnimChain[]) => CMPHandle;
  /** Focuses its element (an input's caret goes to the end); `focusValueToProps` sets its `focus`
   * prop too */
  focus: (focusValueToProps?: boolean) => CMPHandle;
  /** Blurs its element; `focusValueToProps` sets its `focus` prop too */
  blur: (focusValueToProps?: boolean) => CMPHandle;
  /** Scrolls its element into view, after `timeout` ms when given (a later call replaces it) */
  scrollIntoView: (params?: boolean | ScrollIntoViewOptions, timeout?: number) => CMPHandle;
  /** The props its wrapper was given (`CMP(props, wrapper, wrapperProps)`), or null */
  getWrapperProps: <WrapP = undefined>() => WrapP | null;
  /** Free for its maker: handles the CMP's own code keeps on it */
  controls: { [key: string]: unknown };
};

// The old `T`-prefixed names (p803 D3), until engine 6.0.0 (p622)

/**
 * The old name of {@link CMPHandle}.
 * @deprecated Use {@link CMPHandle}. Removed in engine 6.0.0.
 */
export type TCMP = CMPHandle;

/**
 * The old name of {@link CMPProps}.
 * @deprecated Use {@link CMPProps}. Removed in engine 6.0.0.
 */
export type TProps = CMPProps;

/**
 * The old name of {@link CMPSettings}.
 * @deprecated Use {@link CMPSettings}. Removed in engine 6.0.0.
 */
export type TSettings = CMPSettings;

/**
 * The old name of {@link CMPListener}.
 * @deprecated Use {@link CMPListener}. Removed in engine 6.0.0.
 */
export type TListener = CMPListener;

/**
 * The old name of {@link CMPListenerCache}.
 * @deprecated Use {@link CMPListenerCache}. Removed in engine 6.0.0.
 */
export type TListenerCache = CMPListenerCache;

/**
 * The old name of {@link CMPListenerCreator}.
 * @deprecated Use {@link CMPListenerCreator}. Removed in engine 6.0.0.
 */
export type TListenerCreator = CMPListenerCreator;

/**
 * The old name of {@link CMPStyle}.
 * @deprecated Use {@link CMPStyle}. Removed in engine 6.0.0.
 */
export type TStyle = CMPStyle;

/**
 * The old name of {@link CMPAttr}.
 * @deprecated Use {@link CMPAttr}. Removed in engine 6.0.0.
 */
export type TAttr = CMPAttr;

/**
 * The old name of {@link CMPClassAction}.
 * @deprecated Use {@link CMPClassAction}. Removed in engine 6.0.0.
 */
export type TClassAction = CMPClassAction;

/**
 * The old name of {@link CMPAnimChain}.
 * @deprecated Use {@link CMPAnimChain}. Removed in engine 6.0.0.
 */
export type TAnimChain = CMPAnimChain;

/**
 * The old name of {@link CMPAnimState}.
 * @deprecated Use {@link CMPAnimState}. Removed in engine 6.0.0.
 */
export type TAnimState = CMPAnimState;
