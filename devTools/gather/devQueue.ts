/**
 * The dev server's gather queue (`sceneGathererPlugin`): file events fold into one pending work
 * item, which runs once the events have been quiet for the debounce. One run at a time: events
 * during a run go into the next one.
 */

/** A debounced queue of work, run one item at a time */
export type WorkQueue<W> = {
  /** Folds a change into the pending work and (re)starts the debounce */
  schedule: (update: (work: W) => void) => void;
  /** Drops the pending work and its timer; a run in progress finishes (the server closed) */
  close: () => void;
};

/**
 * A queue: `create` makes an empty work item, `runAsync` runs one (a throw goes to `onError`, and the
 * queue goes on).
 * @remarks A burst of events that straddles the end of a run becomes one more run, not two: the
 * run in progress takes no pending work while its debounce timer is still set (p619 §1.4 G9).
 */
export const createWorkQueue = <W>(opts: {
  create: () => W;
  runAsync: (work: W) => Promise<void>;
  onError: (err: unknown, work: W) => void;
  debounceMs: number;
}): WorkQueue<W> => {
  let pending = opts.create();
  let hasPending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let isClosed = false;

  const drainAsync = async () => {
    // A burst still coming in (its timer is set) waits for its debounce
    while (hasPending && !timer && !isClosed) {
      const work = pending;
      pending = opts.create();
      hasPending = false;
      try {
        await opts.runAsync(work);
      } catch (err) {
        opts.onError(err, work);
      }
    }
  };

  const flush = () => {
    timer = null;
    if (running) return; // The run in progress takes it when it ends
    running = drainAsync().finally(() => {
      running = null;
    });
  };

  return {
    schedule: (update) => {
      if (isClosed) return;
      update(pending);
      hasPending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, opts.debounceMs);
    },
    close: () => {
      isClosed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
};
