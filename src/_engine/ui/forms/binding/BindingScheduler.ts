// The refresh scheduler (p804 D4): one per host (a debugger tab, a window, an app panel). Its
// `refresh()` reads every field of the host; its tick, one requestAnimationFrame loop, reads the
// live ones (monitors) at their intervals. Not the main loop: the kit doesn't import it (p803 D4),
// and a debugger's monitors keep running while the loop is paused. Each loop over the entries is
// an ancestor pass (`AncestorReads.ts`): the fields of one folder share their visibility walk.
import { beginAncestorPass, endAncestorPass } from './AncestorReads';

/** What {@link createBindingScheduler} makes a scheduler from. */
export type BindingSchedulerProps = {
  /** Whether the host shows at the start (default true): the tick runs only while it does. */
  visible?: boolean;
};

/** A scheduler {@link createBindingScheduler} made: give it to fields as their `scheduler`. */
export type BindingScheduler = {
  /** Reads every field of the host that shows: its value (a changed edit field flashes once), and
   * its `hidden` and `disabled` functions. Never fires a field's `onChange`. */
  refresh: () => void;
  /** Says whether the host shows: the tick stops while it doesn't. */
  setVisible: (visible: boolean) => void;
  /** Stops the tick and lets go of the fields; a field added later isn't read. */
  dispose: () => void;
};

/**
 * A field (or a collection, `addScheduledRefresh`) as its scheduler reads it.
 * @internal
 */
export type ScheduledEntry = {
  /** Reads the bound value and draws a change. `fromRefresh` is true for `refresh()` (an edit
   * field flashes a change then) and false for the tick and a reveal (never a flash) */
  read: (fromRefresh: boolean) => void;
  /** Re-reads the `hidden` and `disabled` functions: on every `refresh()`, shown or not */
  readState?: () => void;
  /** Whether it shows (not hidden, not in a collapsed folder): one that doesn't isn't read */
  isShown: () => boolean;
  /** A live field's interval in ms (0: every frame), read by the tick; none: by `refresh()` only */
  interval?: number;
};

type Entry = {
  binding: ScheduledEntry;
  /** The frame time of its last tick read */
  lastRead: number;
  /** It was hidden at a read: read when it shows again */
  stale: boolean;
};

type SchedulerState = {
  add: (binding: ScheduledEntry) => () => void;
  reveal: () => void;
};

/** Each scheduler's own functions, kept off its public handle */
const states = new WeakMap<BindingScheduler, SchedulerState>();

/**
 * Creates a refresh scheduler for one host (p804 D4): a debugger tab, a window, an app's panel.
 * Fields made with it as their `scheduler` are read by its `refresh()`, and the live ones
 * (monitors, a field with an `interval`) by its tick: one `requestAnimationFrame` loop that runs
 * only while the host shows (`setVisible`), the page isn't hidden and a live field exists, each
 * field read at its own `interval` against the frame's time (no timer per field). A field that
 * doesn't show (hidden, in a collapsed folder) isn't read, and is read once when it shows again.
 * A read that finds the value unchanged writes nothing, and allocates nothing for a number, a
 * string or a vector.
 * @param props whether the host shows at the start
 * @example
 * ```ts
 * const scheduler = createBindingScheduler({ visible: false });
 * // Its fields take `scheduler`; the panel says when it shows
 * settingsPanel.onShow(() => {
 *   scheduler.setVisible(true);
 *   scheduler.refresh();
 * });
 * settingsPanel.onHide(() => scheduler.setVisible(false));
 * settingsPanel.onRemove(() => scheduler.dispose());
 * ```
 */
export const createBindingScheduler = (props: BindingSchedulerProps = {}): BindingScheduler => {
  const entries: Entry[] = [];
  let liveCount = 0;
  let visible = props.visible ?? true;
  let disposed = false;
  let frame: number | null = null;
  let isListeningToPage = false;

  const isPageHidden = () => document.visibilityState === 'hidden';

  const shouldTick = () => !disposed && visible && liveCount > 0 && !isPageHidden();

  const stopTick = () => {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  };

  const tick = (now: number) => {
    frame = null;
    const outer = beginAncestorPass();
    try {
      tickEntries(now);
    } finally {
      endAncestorPass(outer);
    }
    scheduleTick();
  };

  /** The tick's reads: each entry's visibility is an ancestor read the pass shares (a hidden one
   * is walked every frame, to be read on the first frame it shows) */
  const tickEntries = (now: number) => {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const interval = entry.binding.interval;
      if (interval === undefined) continue;
      // Not due yet: its visibility (a DOM walk) isn't read either; a hidden one is marked
      // stale at the frame it's due
      if (!entry.stale && now - entry.lastRead < interval) continue;
      if (!entry.binding.isShown()) {
        entry.stale = true;
        continue;
      }
      entry.lastRead = now;
      entry.stale = false;
      entry.binding.read(false);
    }
  };

  const scheduleTick = () => {
    if (frame === null && shouldTick()) frame = requestAnimationFrame(tick);
  };

  const onPageVisibility = () => (isPageHidden() ? stopTick() : scheduleTick());

  /** The page's visibility is listened to only while a live field exists */
  const listenToPage = (on: boolean) => {
    if (on === isListeningToPage) return;
    isListeningToPage = on;
    if (on) document.addEventListener('visibilitychange', onPageVisibility);
    else document.removeEventListener('visibilitychange', onPageVisibility);
  };

  const scheduler: BindingScheduler = {
    refresh: () => {
      const outer = beginAncestorPass();
      try {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          entry.binding.readState?.();
          if (!entry.binding.isShown()) {
            entry.stale = true;
            continue;
          }
          entry.stale = false;
          entry.binding.read(true);
        }
      } finally {
        endAncestorPass(outer);
      }
    },
    setVisible: (isVisible) => {
      visible = isVisible;
      if (visible) scheduleTick();
      else stopTick();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopTick();
      listenToPage(false);
      entries.length = 0;
      liveCount = 0;
      states.delete(scheduler);
    },
  };

  states.set(scheduler, {
    add: (binding) => {
      if (disposed) return () => {};
      const entry: Entry = { binding, lastRead: -Infinity, stale: false };
      entries.push(entry);
      if (binding.interval !== undefined) {
        liveCount++;
        listenToPage(true);
        scheduleTick();
      }
      return () => {
        const index = entries.indexOf(entry);
        if (index === -1) return;
        entries.splice(index, 1);
        if (binding.interval === undefined) return;
        liveCount--;
        if (liveCount > 0) return;
        stopTick();
        listenToPage(false);
      };
    },
    reveal: () => {
      const outer = beginAncestorPass();
      try {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (!entry.stale || !entry.binding.isShown()) continue;
          entry.stale = false;
          entry.binding.read(false);
        }
      } finally {
        endAncestorPass(outer);
      }
    },
  });

  return scheduler;
};

/**
 * Adds a field to its scheduler (its own `scheduler`, or its property grid's or form's); the
 * field calls the remover when it's removed.
 * @internal
 * @returns the remover
 */
export const addScheduledBinding = (scheduler: BindingScheduler, binding: ScheduledEntry) =>
  states.get(scheduler)?.add(binding) ?? (() => {});

/**
 * Adds a collection (a table, a list, a tree; p805 D3) to a scheduler: its `refresh` runs on the
 * scheduler's `refresh()`, on the tick every `interval` ms while `isShown`, and once when it
 * shows again (`revealScheduledBindings`), as a field's read does. The collection calls the
 * remover when it's removed.
 * @internal
 * @returns the remover
 */
export const addScheduledRefresh = (
  scheduler: BindingScheduler,
  refresh: (fromRefresh: boolean) => void,
  { interval, isShown }: Pick<ScheduledEntry, 'interval' | 'isShown'>
) => addScheduledBinding(scheduler, { read: refresh, isShown, interval });

/** The page's scheduler, made on first use */
let pageScheduler: BindingScheduler | null = null;

/**
 * The scheduler a live field (a monitor, an edit field with an `interval`) joins when it's given
 * none and isn't in a property grid or form: one tick for every such field on the page, made on
 * the first one's creation and never disposed (with no live field it has no loop and no
 * listener). Its `refresh()` is nobody's: such a field's own `refresh()` reads it.
 * @internal
 */
export const getPageScheduler = () => (pageScheduler ??= createBindingScheduler());

/**
 * Reads, once, each field of the scheduler that was hidden at a read and shows now: what a folder
 * calls when it opens, and a field when it's shown (`setHidden(false)`, its `hidden` function).
 * No flash: the user wasn't looking.
 * @internal
 */
export const revealScheduledBindings = (scheduler: BindingScheduler) => {
  states.get(scheduler)?.reveal();
};

/**
 * How long an edit field's flash shows: `--aek-motion-base` unscaled, so under reduced motion
 * the static tint shows as long (D4)
 */
const FLASH_MS = 200;
const FLASH_ATTR = 'data-flash';

/**
 * An edit field's flash (p804 D4): `flash()` sets `data-flash` on `elem` for 200 ms (a second
 * flash restarts it), which the field's stylesheet draws (the accent's soft background, a static
 * tint under reduced motion). Monitors never flash. `dispose()` clears its timer.
 * @internal
 */
export const createFlash = (elem: HTMLElement) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    elem.removeAttribute(FLASH_ATTR);
  };
  return {
    flash: () => {
      clear();
      elem.setAttribute(FLASH_ATTR, '');
      timer = setTimeout(clear, FLASH_MS);
    },
    dispose: clear,
  };
};
