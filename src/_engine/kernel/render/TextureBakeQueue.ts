// The texture baker's queue (p304 D1), on plain numbers and callbacks: no three, so the unit tests
// drive it without a renderer. `textureBakeSystem` (`TextureBaker.ts`) runs one request per frame.

/**
 * A rebake of the same id waits this many ms of the main loop's elapsed time after its last run
 * (the sky box's static layers' throttle; the latest request always runs, so a drag ends on its
 * final value).
 * @internal
 */
export const TEXTURE_BAKE_THROTTLE_MS = 150;

type Waiter = { resolve: () => void; reject: (err: unknown) => void };
type BakeRequest = { run: () => void; waiters: Waiter[] };

/**
 * The bake queue: one request per id, run in the order the ids were first requested, at most one
 * per {@link BakeQueue.runNext} call.
 * @internal
 */
export type BakeQueue = {
  /** Queues `run` for `id`, or joins the id's pending request (its `run` replaced): every promise
   * of a request settles when it runs, or resolves when it's cancelled. */
  request: (id: string, run: () => void) => Promise<void>;
  /** Runs the first request that's due at `nowMs` (its id never ran, or ran `throttleMs` or longer
   * before), and returns its id, or null when none is. A `run` that throws rejects its promises. */
  runNext: (nowMs: number) => string | null;
  /** Records a run of `id` made outside the queue (a scene load's bake): its pending request is
   * settled as run, and the throttle counts from `nowMs`. */
  markRun: (id: string, nowMs: number) => void;
  /** Drops the id's pending request (its promises resolve) and its throttle (a disposed bake). */
  cancel: (id: string) => void;
  /** Whether a request is pending. */
  hasPending: () => boolean;
};

/**
 * A new, empty bake queue.
 * @internal
 * @param throttleMs how long a rebake of the same id waits after its last run
 */
export const createBakeQueue = (throttleMs: number): BakeQueue => {
  const pending = new Map<string, BakeRequest>();
  const lastRunMs = new Map<string, number>();

  const settle = (request: BakeRequest, err?: unknown) => {
    for (const waiter of request.waiters) {
      if (err === undefined) waiter.resolve();
      else waiter.reject(err);
    }
  };

  return {
    request: (id, run) =>
      new Promise<void>((resolve, reject) => {
        const existing = pending.get(id);
        if (existing) {
          existing.run = run;
          existing.waiters.push({ resolve, reject });
        } else {
          pending.set(id, { run, waiters: [{ resolve, reject }] });
        }
      }),
    runNext: (nowMs) => {
      for (const [id, request] of pending) {
        const last = lastRunMs.get(id);
        if (last !== undefined && nowMs - last < throttleMs) continue;
        pending.delete(id);
        lastRunMs.set(id, nowMs);
        try {
          request.run();
        } catch (err) {
          settle(request, err ?? new Error(`The bake of "${id}" failed.`));
          return id;
        }
        settle(request);
        return id;
      }
      return null;
    },
    markRun: (id, nowMs) => {
      lastRunMs.set(id, nowMs);
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      settle(request);
    },
    cancel: (id) => {
      lastRunMs.delete(id);
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      settle(request);
    },
    hasPending: () => pending.size > 0,
  };
};
