import type { CMPHandle, CMPStyle } from '../core/CMPTypes';
import { CMP } from '../core/CMP';
import { getMotionFactor } from '../core/Motion';
import { pushOverlay } from './OverlayStack';
import './Toaster.scss';
import '../styles/kit.scss';

/**
 * A toast's kind: its status colour and icon, the live region that announces it (`alert` is
 * assertive, the others polite), and the settings that can differ per kind (showing time,
 * closable, icon) are keyed by it.
 */
export type ToastType = 'info' | 'success' | 'warning' | 'alert';
/** Which way a toaster's toasts line up, or which side a new toast comes in from. */
export type ToastDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Where a toaster sits on the screen and how its toasts line up, appear and close (defaults: {@link
 * DEFAULT_TOASTER_SETTINGS}).
 */
export type ToasterSettings = {
  /** Where is the toast positioned (fixed) vertically on the screen? */
  verticalPosition: 'top' | 'center' | 'bottom';

  /** Where is the toast positioned (fixed) horizontally on the screen? */
  horizontalPosition: 'left' | 'center' | 'right';

  /** Translate offset of the vertical and horizontal position. */
  offset: { x: string; y: string };

  /** Which way is the toast line forming from the toaster? */
  toastDirection: ToastDirection;

  /** From which direction is a new toast appearing from to its position?
   * If the toastDirection is vertical then this should be horizontal and
   * vice versa (for the best effect).
   */
  toastAppearFromDirection: ToastDirection;

  /** Minimum width for a single toast (a CSS length; `--aek-toast-min-width` on the toaster). */
  toastMinWidth: string;

  /** Maximum width for a single toast (a CSS length; `--aek-toast-max-width`). */
  toastMaxWidth: string;

  /** Minimum height for a single toast (a CSS length; `--aek-toast-min-height`). */
  toastMinHeight: string;

  /** Maximum height for a single toast (a CSS length; `--aek-toast-max-height`): a longer text
   * scrolls inside the toast, its close button in a column of its own. */
  toastMaxHeight: string;

  /** Animation time of the toast appearing and disappearing.
   * This is also the animation time for the queue to move to create
   * the space for the new appearing toast. Multiplied by the kit root's
   * `--aek-motion` when a toast starts; under `prefers-reduced-motion: reduce` (or
   * `--aek-motion: 0`) a toast doesn't slide or push the queue: it fades in place in this time.
   */
  animationTimeMs: number;

  /** How long should the toast be shown? If the value is 0 then it
   * won't disappear with a timer. This can either be a number or an
   * object defining the showing time for each toast type. The time
   * pauses while the toast is hovered or holds the focus, and while
   * the page is hidden.
   */
  showingTimeMs: number | { [key in ToastType]?: number };

  /** Whether the toasts are closable or not. This can either be a
   * boolean or an object defining each toast type.
   */
  isClosable: boolean | { [key in ToastType]?: boolean };

  /** Icons to be used for a toast, as HTML. This can either be a single
   * string and then all the icons will have the same icon or an object
   * defininig each toast type icon. An empty string ("") will omit
   * the icon (it will not be shown then). Without one, a toast shows
   * its kind's glyph (i, ✓, !, ×) in its status colour. A CMPHandle icon
   * is moved into the toast, so it can only be used by one toast.
   */
  icons?: string | { [key in ToastType]?: string | CMPHandle };

  /** The close button's icon, as HTML (default: a cross drawn in CSS). */
  closeBtnIcon?: string;
};

/**
 * {@link createToaster}'s options: its id and class, its settings over {@link
 * DEFAULT_TOASTER_SETTINGS}, and whether it becomes the default toaster.
 */
export type ToasterProps = {
  /** The toaster's id, which `addToast`'s `toasterId` names (default: a generated one) */
  id?: string;
  /** An extra class for the toaster's element */
  className?: string;
  /** Its settings, over {@link DEFAULT_TOASTER_SETTINGS} */
  settings?: Partial<ToasterSettings>;
  /** Makes it the default toaster, which a toast without a `toasterId` goes to (the first toaster
   * made is the default until another takes it) */
  setAsDefaultToaster?: boolean;
};

/** What {@link addToast} makes a toast from. */
export type ToastProps = {
  /** Its kind, which picks its status colour, its icon and the toaster's per-kind settings
   * (default 'info') */
  type?: ToastType;
  /** Its title: text, or a CMP (moved into the toast) */
  title?: string | CMPHandle;
  /** Its message: text, or a CMP (moved into the toast) */
  message?: string | CMPHandle;
  /** Overrides the toaster's icon for this toast. An empty string ("") omits the icon. */
  icon?: string | CMPHandle;
  /** How long it shows, in ms, over the toaster's (0: until it's closed) */
  showingTime?: number;
  /** How long it slides in and fades out, in ms, over the toaster's */
  animationTime?: number;
  /** An extra class for the toast's element */
  className?: string;
  /** The toaster it goes to (default: the default toaster) */
  toasterId?: string;
  /** Gives it a close button, over the toaster's setting */
  isClosable?: boolean;
};

/** A toast {@link addToast} added: its id, what it resolved from its toaster, and its remover. */
export type AddToastResponse = {
  /** The toast's id, for {@link removeToast} */
  id: string;
  /** The toaster it went to */
  toasterId: string;
  /** Its size in px, measured when it was added */
  dimensions: { x: number; y: number };
  /** `performance.now()` when it was added */
  startedTime: number;
  /** How long it slides in and fades out, in ms, after the kit root's `--aek-motion` (under
   * reduced motion: how long it fades in place, the setting's time) */
  animationTime: number;
  /** How long it shows, in ms (0: until it's closed), not counting its pauses */
  showingTime: number;
  /** Its whole life in ms without a pause: the showing time and both animations */
  totalTime: number;
  /** The toast's CMP */
  toastCmp: CMPHandle;
  /** Whether it has a close button */
  hasCloseButton: boolean;
  /**
   * The toast's first lifecycle timer (later phases replace it internally).
   * @deprecated Use `removeToast` to remove the toast early, not `clearTimeout`. Removed in engine
   * 6.0.0.
   */
  timeout: ReturnType<typeof setTimeout>;
  /** Its kind */
  type: ToastType;
  /** Its title, as given */
  title: CMPHandle | string | undefined;
  /** Its message, as given */
  message: CMPHandle | string | undefined;
  /** Its own icon, as given */
  icon: CMPHandle | string | undefined;
  /** Fades it out and disposes it (as {@link removeToast}) */
  removeToast: () => void;
};

type Toaster = {
  id: string;
  cmp: CMPHandle;
  settings: ToasterSettings;
  /** The polite (`status`) and the assertive (`alert`) live regions the toasts are read through */
  politeRegion: HTMLElement;
  alertRegion: HTMLElement;
  /** The pending announcement (a region is emptied first, so a repeated text is read again) */
  announceTimer: ReturnType<typeof setTimeout> | null;
};

/** A toast's lifecycle: ENTERING (measured off-screen) → APPEARING (sliding in, the queue
 * making room) → SHOWING → REMOVING (fading out) → disposed. Its element's `data-phase`. */
type ToastPhase = 'ENTERING' | 'APPEARING' | 'SHOWING' | 'REMOVING';

type Toast = {
  id: string;
  toaster: Toaster;
  cmp: CMPHandle;
  animationTime: number;
  phase: ToastPhase;
  /** The one pending timer of the current phase, so removing a toast (or its toaster) clears
   * everything still scheduled for it. */
  timer: ReturnType<typeof setTimeout> | null;
  /** The showing time left (0: until closed), counted down only while the timer runs */
  showLeft: number;
  /** When the running showing timer ends (`performance.now()`), to count a pause */
  showEndsAt: number;
  isHovered: boolean;
  isFocused: boolean;
  /** Its overlay stack entry while it holds the focus (Escape closes it) */
  removeOverlay: ((returnFocus?: boolean) => void) | null;
};

const DEFAULT_ANIM_TIME = 200;
const DEFAULT_SHOW_TIME = 3200;
const DEFAULT_SHOW_TIMES: { [key in ToastType]: number } = {
  info: DEFAULT_SHOW_TIME,
  success: DEFAULT_SHOW_TIME,
  warning: DEFAULT_SHOW_TIME,
  alert: 0,
};
/** A toaster's settings where {@link ToasterProps}' don't say: bottom left, toasts 200 px wide
 * lining up upwards and coming in from the left, info, success and warning toasts showing 3.2 s,
 * alerts until closed (with a close button). */
export const DEFAULT_TOASTER_SETTINGS: ToasterSettings = {
  verticalPosition: 'bottom',
  horizontalPosition: 'left',
  offset: { x: '0', y: '0' },
  toastDirection: 'up',
  toastAppearFromDirection: 'left',
  toastMinWidth: '200px',
  toastMaxWidth: '200px',
  toastMinHeight: '0',
  toastMaxHeight: '100px',
  animationTimeMs: DEFAULT_ANIM_TIME,
  showingTimeMs: DEFAULT_SHOW_TIMES,
  isClosable: { alert: true },
};

/** Lets a new toast render (off-screen) once before its transition starts. */
const ENTER_DELAY_MS = 10;
/** A live region is emptied this long before its new text, so a repeated text is read again */
const ANNOUNCE_DELAY_MS = 50;
const TOASTER_CLASS = 'aekToaster';
const TOAST_CLASS = 'aekToast';
const VISUALLY_HIDDEN_CLASS = 'aekVisuallyHidden';
const PHASE_ATTR = 'data-phase';
const UPDATING_ATTR = 'data-updating';
const NO_PADDING: CMPStyle = { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 };
const SETTLED_TOAST_STYLE: CMPStyle = {
  position: 'relative',
  left: 'auto',
  right: 'auto',
  top: 'auto',
  bottom: 'auto',
};

/** Where a new toast starts its slide from, by `toastAppearFromDirection`. */
const APPEAR_START_TRANSFORM: Record<ToastDirection, (w: number, h: number) => string> = {
  down: (_, h) => `translate(0, -${h}px)`,
  up: (_, h) => `translate(0, ${h}px)`,
  left: (w) => `translate(-${w}px, 0)`,
  right: (w) => `translate(${w}px, 0)`,
};

/** How a new toast pushes the queue, by `toastDirection`: where it is anchored while it
 * appears, and the toaster padding (animated) that makes room for it. */
const QUEUE_PUSH: Record<
  ToastDirection,
  { anchor: CMPStyle; padding: (w: number, h: number) => CMPStyle }
> = {
  down: {
    anchor: { top: 0, left: 0, bottom: 'auto', right: 'auto' },
    padding: (_, h) => ({ paddingTop: `${h}px` }),
  },
  up: {
    anchor: { top: 'auto', left: 0, bottom: 0, right: 'auto' },
    padding: (_, h) => ({ paddingBottom: `${h}px` }),
  },
  left: {
    anchor: { top: 0, left: 'auto', bottom: 'auto', right: 0 },
    padding: (w) => ({ paddingRight: `${w}px` }),
  },
  right: {
    anchor: { top: 0, left: 0, bottom: 'auto', right: 'auto' },
    padding: (w) => ({ paddingLeft: `${w}px` }),
  },
};

const toasters = new Map<string, Toaster>();
const toasts = new Map<string, Toast>();
let defaultToaster: Toaster | null = null;
// Counters, not timestamps: two toasts in the same timer tick would share an id (and CMP
// throws on a taken id)
let toasterCount = 0;
let toastCount = 0;
let isVisibilityListenerAdded = false;

/** A setting that is either one value for all toast types or a per-type object. */
const resolvePerType = <T>(
  value: T | { [key in ToastType]?: T } | undefined,
  type: ToastType,
  fallback: T
): T => {
  if (value === undefined) return fallback;
  if (typeof value !== 'object' || value === null) return value as T;
  return (value as { [key in ToastType]?: T })[type] ?? fallback;
};

/** The toaster's place (fixed) and its settings' sizes as custom properties (`Toaster.scss`) */
const getToasterStyle = (config: ToasterSettings): CMPStyle => {
  const style: CMPStyle = {
    position: 'fixed',
    '--aek-toast-min-width': config.toastMinWidth,
    '--aek-toast-max-width': config.toastMaxWidth,
    '--aek-toast-min-height': config.toastMinHeight,
    '--aek-toast-max-height': config.toastMaxHeight,
  };
  const { x, y } = config.offset;

  if (config.verticalPosition === 'top') style.top = 0;
  else if (config.verticalPosition === 'center') style.bottom = '50%';
  else style.bottom = 0;

  if (config.horizontalPosition === 'right') {
    style.right = 0;
    style.transform = `translate(${x}, ${y})`;
  } else if (config.horizontalPosition === 'center') {
    style.left = '50%';
    style.transform = `translate(calc(-50% + ${x}), ${y})`;
  } else {
    style.left = 0;
    style.transform = `translate(${x}, ${y})`;
  }
  return style;
};

// Pauses: a toast's showing time stops while it's hovered or holds the focus, and while the page
// is hidden (p803 D9)

const isPaused = (toast: Toast) =>
  toast.isHovered || toast.isFocused || (typeof document !== 'undefined' && document.hidden);

/** Starts (or resumes) a showing toast's timer for the time it has left, unless it's paused or
 * shows until closed */
const runShowTimer = (toast: Toast) => {
  if (toast.phase !== 'SHOWING' || toast.timer || !toast.showLeft || isPaused(toast)) return;
  toast.showEndsAt = performance.now() + toast.showLeft;
  toast.timer = setTimeout(() => removeToast(toast.id), toast.showLeft);
};

/** Stops a showing toast's timer, keeping the time it has left */
const pauseShowTimer = (toast: Toast) => {
  if (toast.phase !== 'SHOWING' || !toast.timer) return;
  clearTimeout(toast.timer);
  toast.timer = null;
  toast.showLeft = Math.max(0, toast.showEndsAt - performance.now());
};

const syncShowTimer = (toast: Toast) => {
  if (isPaused(toast)) pauseShowTimer(toast);
  else runShowTimer(toast);
};

const onVisibilityChange = () => {
  for (const toast of toasts.values()) syncShowTimer(toast);
};

/** The page's visibility listener: added with the first toaster, removed with the last */
const syncVisibilityListener = () => {
  const shouldListen = toasters.size > 0;
  if (shouldListen === isVisibilityListenerAdded) return;
  isVisibilityListenerAdded = shouldListen;
  if (shouldListen) document.addEventListener('visibilitychange', onVisibilityChange);
  else document.removeEventListener('visibilitychange', onVisibilityChange);
};

/** Reads a toast through its toaster's live region: `alert` assertively, the others politely */
const announce = (toaster: Toaster, type: ToastType, { title, message }: ToastProps) => {
  const text = [title, message]
    .map((part) => (typeof part === 'string' ? part : part?.elem.textContent ?? '').trim())
    .filter(Boolean)
    .join('. ');
  if (!text) return;
  const region = type === 'alert' ? toaster.alertRegion : toaster.politeRegion;
  region.textContent = '';
  if (toaster.announceTimer) clearTimeout(toaster.announceTimer);
  toaster.announceTimer = setTimeout(() => {
    toaster.announceTimer = null;
    region.textContent = text;
  }, ANNOUNCE_DELAY_MS);
};

const createLiveRegion = (role: 'status' | 'alert') => {
  const region = document.createElement('div');
  region.className = VISUALLY_HIDDEN_CLASS;
  region.setAttribute('role', role);
  region.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
  return region;
};

/**
 * Makes a toaster (p803 D9): a fixed element that lines up toasts. It isn't added anywhere: add
 * the returned CMP under the HUD root. The first toaster made is the default one (see
 * {@link ToasterProps.setAsDefaultToaster}). The engine makes one only in the debug env (the debug
 * toaster), so an app that shows toasts makes its own.
 * - Parts: `.aekToaster` (its settings' sizes in `--aek-toast-min-width`, `-max-width`,
 *   `-min-height` and `-max-height`, at `--aek-z-toast`) holding `.aekToast`s (`data-type`,
 *   `data-phase`), each an `.aekToast__icon`, an `.aekToast__content` (`__title`, `__message`;
 *   it scrolls when the text runs past the maximum height) and an `.aekToast__close`.
 * - Assistive tech: two live regions per toaster read each toast's title and message once
 *   (`role="status"` for info, success and warning, `role="alert"` for an alert), so a screen
 *   reader doesn't read the whole toaster again on a change.
 * - Keys: the close button is a tab stop (`aria-label="Close"`), and Escape with the focus in a
 *   toast closes it (the kit's overlay stack) and gives the focus back.
 * - A toast's showing time pauses while it's hovered or holds the focus, and while the page is
 *   hidden. Each kind has its status colour and its icon (never the colour alone).
 * @returns the toaster's CMP
 * @example
 * ```ts
 * getHUDRootCMP().add(
 *   createToaster({
 *     id: 'gameToasts',
 *     settings: { verticalPosition: 'top', horizontalPosition: 'right', toastDirection: 'down' },
 *     setAsDefaultToaster: true,
 *   })
 * );
 * addToast({ title: 'Checkpoint', message: 'Progress saved' });
 * addToast({ type: 'warning', message: 'Low fuel', toasterId: 'gameToasts' });
 * ```
 */
export const createToaster = ({ id, className, settings, setAsDefaultToaster }: ToasterProps) => {
  const toasterId = id || `toaster-${++toasterCount}`;
  const config: ToasterSettings = { ...DEFAULT_TOASTER_SETTINGS, ...settings };

  const cmp = CMP({
    id: toasterId,
    idAttr: true,
    class: className ? [TOASTER_CLASS, className] : TOASTER_CLASS,
    style: getToasterStyle(config),
  });
  const politeRegion = createLiveRegion('status');
  const alertRegion = createLiveRegion('alert');
  cmp.elem.append(politeRegion, alertRegion);

  const toaster: Toaster = {
    id: toasterId,
    cmp,
    settings: config,
    politeRegion,
    alertRegion,
    announceTimer: null,
  };
  toasters.set(toasterId, toaster);
  syncVisibilityListener();
  if (!defaultToaster || setAsDefaultToaster) defaultToaster = toaster;

  return cmp;
};

/** Whether a toaster with this id exists (eg. to skip a toast before the toaster is created). */
export const hasToaster = (toasterId: string) => toasters.has(toasterId);

/** Removes a toaster, its toasts (with their pending timers) and its listeners. */
export const removeToaster = (toasterId: string) => {
  for (const toast of toasts.values()) {
    if (toast.toaster.id === toasterId) disposeToast(toast);
  }

  const toaster = toasters.get(toasterId);
  if (toaster) {
    if (toaster.announceTimer) clearTimeout(toaster.announceTimer);
    toaster.cmp.remove();
    toasters.delete(toasterId);
    syncVisibilityListener();
  }

  if (defaultToaster?.id === toasterId) {
    defaultToaster = toasters.values().next().value ?? null;
  }
};

/** The toast's own icon, the toaster's for its kind, or its kind's glyph (`Toaster.scss`) */
const createIcon = (toaster: Toaster, type: ToastType, icon: ToastProps['icon']) => {
  const resolved = icon ?? resolvePerType(toaster.settings.icons, type, undefined);
  if (resolved === '') return null;
  if (resolved && typeof resolved !== 'string') return resolved;
  return CMP({
    class: `${TOAST_CLASS}__icon`,
    attr: { 'aria-hidden': 'true', ...(resolved ? {} : { 'data-glyph': '' }) },
    ...(resolved ? { html: () => `<span>${resolved}</span>` } : {}),
  });
};

const createToastCmp = (
  id: string,
  toaster: Toaster,
  type: ToastType,
  { title, message, icon, className }: ToastProps,
  hasCloseButton: boolean
) => {
  const { settings } = toaster;
  const toastCmp = CMP({
    id,
    class: className ? [TOAST_CLASS, className] : TOAST_CLASS,
    attr: { 'data-type': type, [PHASE_ATTR]: 'entering' },
    // A down or right toaster's newest toast is first: it settles where it slid in
    prepend: settings.toastDirection === 'down' || settings.toastDirection === 'right',
  });

  const iconCmp = createIcon(toaster, type, icon);
  if (iconCmp) toastCmp.add(iconCmp);

  const contentCmp = toastCmp.add({ class: `${TOAST_CLASS}__content` });
  if (title) {
    contentCmp.add(
      typeof title === 'string' ? { class: `${TOAST_CLASS}__title`, text: title } : title
    );
  }
  if (message) {
    contentCmp.add(
      typeof message === 'string' ? { class: `${TOAST_CLASS}__message`, text: message } : message
    );
  }

  if (hasCloseButton) {
    const closeBtnIcon = settings.closeBtnIcon;
    toastCmp.add({
      tag: 'button',
      class: `${TOAST_CLASS}__close`,
      attr: { type: 'button', 'aria-label': 'Close', ...(closeBtnIcon ? { 'data-icon': '' } : {}) },
      ...(closeBtnIcon ? { html: () => `<button>${closeBtnIcon}</button>` } : {}),
      onClick: () => removeToast(id),
    });
  }

  return toastCmp;
};

/** The pause on hover and focus, and Escape while it holds the focus (the overlay stack, p803
 * D7): its entry gives the focus back to what had it before */
const addToastListeners = (toast: Toast) => {
  const elem = toast.cmp.elem;
  elem.addEventListener('pointerenter', () => {
    toast.isHovered = true;
    syncShowTimer(toast);
  });
  elem.addEventListener('pointerleave', () => {
    toast.isHovered = false;
    syncShowTimer(toast);
  });
  elem.addEventListener('focusin', (e) => {
    toast.isFocused = true;
    syncShowTimer(toast);
    if (toast.removeOverlay) return;
    const from = e.relatedTarget as HTMLElement | null;
    toast.removeOverlay = pushOverlay({
      elem,
      close: () => removeToast(toast.id),
      returnFocus: from && !elem.contains(from) ? from : null,
    });
  });
  elem.addEventListener('focusout', (e) => {
    if (elem.contains(e.relatedTarget as Node | null)) return;
    toast.isFocused = false;
    toast.removeOverlay?.(false);
    toast.removeOverlay = null;
    syncShowTimer(toast);
  });
};

/** Ends a toast's appearing: it joins the queue's flow and the toaster drops the room it made. */
const settleToast = (toast: Toast) => {
  toast.cmp.updateStyle(SETTLED_TOAST_STYLE);
  toast.toaster.cmp.updateStyle(NO_PADDING);
  toast.toaster.cmp.elem.removeAttribute(UPDATING_ATTR);
};

const setPhase = (toast: Toast, phase: ToastPhase) => {
  toast.phase = phase;
  toast.cmp.elem.setAttribute(PHASE_ATTR, phase.toLowerCase());
};

/** Clears the toast's pending timer and removes it right away (no fade). */
const disposeToast = (toast: Toast) => {
  if (toast.timer) clearTimeout(toast.timer);
  toast.timer = null;
  toast.removeOverlay?.(false);
  toast.removeOverlay = null;
  toast.cmp.remove();
  toasts.delete(toast.id);
};

/**
 * Adds a toast to a toaster (`toasterId`, else the default one): it slides in, making room in the
 * queue, shows for its showing time (paused while it's hovered or holds the focus, and while the
 * page is hidden) and fades out. Under reduced motion it fades in place. A screen reader reads its
 * title and message once, through the toaster's live region. Throws when there's no such
 * toaster, or no toaster at all.
 * @example
 * ```ts
 * const toast = addToast({ type: 'alert', title: 'Disconnected', isClosable: true });
 * onReconnected(() => toast.removeToast());
 * ```
 */
export const addToast = (props: ToastProps): AddToastResponse => {
  const { type = 'info', toasterId, showingTime, animationTime, isClosable } = props;
  const toaster = toasterId ? toasters.get(toasterId) : defaultToaster;
  if (!toaster) {
    throw new Error(
      `Error while adding toast. Could not find toaster (${toasterId ? `toasterId: ${toasterId}` : 'using defaultToaster'}).`
    );
  }
  const { settings } = toaster;

  const startedTime = performance.now();
  const id = `toast-${++toastCount}`;
  // The kit root's --aek-motion: under reduced motion (0) the toast fades in place, unscaled
  const motion = getMotionFactor(toaster.cmp.elem);
  const isStill = motion === 0;
  const baseAnimTime = animationTime ?? (settings.animationTimeMs || DEFAULT_ANIM_TIME);
  const animTime = isStill ? baseAnimTime : baseAnimTime * motion;
  const showTime =
    showingTime ?? resolvePerType(settings.showingTimeMs, type, DEFAULT_SHOW_TIMES[type]);
  const hasCloseButton = isClosable ?? resolvePerType(settings.isClosable, type, false);

  const toastCmp = createToastCmp(id, toaster, type, props, hasCloseButton);
  toastCmp.updateStyle({ '--aek-toast-time': `${animTime}ms` });
  const toast: Toast = {
    id,
    toaster,
    cmp: toastCmp,
    animationTime: animTime,
    phase: 'ENTERING',
    timer: null,
    showLeft: showTime,
    showEndsAt: 0,
    isHovered: false,
    isFocused: false,
    removeOverlay: null,
  };
  toasts.set(id, toast);
  addToastListeners(toast);

  // Rendered off-screen first (see the ENTERING phase's styles) to get its size
  toaster.cmp.add(toastCmp);
  const width = toastCmp.elem.offsetWidth;
  const height = toastCmp.elem.offsetHeight;
  // A text longer than the toast scrolls: a tab stop then, so the keys scroll it too
  const content = toastCmp.elem.querySelector<HTMLElement>(`.${TOAST_CLASS}__content`);
  if (content && content.scrollHeight > content.clientHeight) {
    content.setAttribute('tabindex', '0');
  }
  if (isStill) {
    settleToast(toast);
  } else {
    toastCmp.updateStyle({
      transform: APPEAR_START_TRANSFORM[settings.toastAppearFromDirection](width, height),
    });
    toaster.cmp.updateStyle(NO_PADDING);
  }
  announce(toaster, type, props);

  toast.timer = setTimeout(() => {
    // Slide in while the queue makes room (or, still, fade in place)
    setPhase(toast, 'APPEARING');
    if (!isStill) {
      const push = QUEUE_PUSH[settings.toastDirection];
      toastCmp.updateStyle(push.anchor);
      toaster.cmp.elem.setAttribute(UPDATING_ATTR, '');
      toaster.cmp.updateStyle({
        '--aek-toast-time': `${animTime}ms`,
        ...push.padding(width, height),
      });
    }

    toast.timer = setTimeout(() => {
      toast.timer = null;
      setPhase(toast, 'SHOWING');
      if (!isStill) settleToast(toast);
      runShowTimer(toast);
    }, animTime);
  }, ENTER_DELAY_MS);

  return {
    id,
    toasterId: toaster.id,
    dimensions: { x: width, y: height },
    startedTime,
    animationTime: animTime,
    showingTime: showTime,
    totalTime: showTime + animTime * 2,
    toastCmp,
    hasCloseButton,
    timeout: toast.timer,
    type,
    title: props.title,
    message: props.message,
    icon: props.icon,
    removeToast: () => removeToast(id),
  };
};

/**
 * Fades a toast out and disposes it; with the focus in it, the focus goes back to what had it
 * before. A no-op for a toast that is gone or already fading out.
 */
export const removeToast = (id: string) => {
  const toast = toasts.get(id);
  if (!toast || toast.phase === 'REMOVING') return;

  if (toast.timer) clearTimeout(toast.timer);
  // Closed before it finished appearing: the toaster must not keep the room it was making
  if (toast.phase !== 'SHOWING') settleToast(toast);
  // Before it fades: the focus mustn't stay on a button that's going
  toast.removeOverlay?.(true);
  toast.removeOverlay = null;
  setPhase(toast, 'REMOVING');
  toast.timer = setTimeout(() => disposeToast(toast), toast.animationTime);
};
