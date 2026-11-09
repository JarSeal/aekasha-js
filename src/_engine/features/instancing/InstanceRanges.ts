// An instance set's ranges (docs/plans/p354_gpu-driven-culling.md D1, Phase 5 step 1): which of
// its instance indices are live, and the free list a removed range waits in for a later add. Pure
// bookkeeping, no three: the front (InstanceSet.ts) keeps one per set and tells the backend what
// changed.
//
// - An add takes the first free range it fits in (first fit, by start: the lowest indices fill
//   first, so the extent stays low), the rest of that range staying free; with none it fits, it
//   appends at the end, up to the capacity.
// - A removed range merges with the free ranges next to it. One at the end lowers the end instead,
//   with every free range it then touches: the end is always the highest live range's, so the
//   backend visits no removed instance past it.

/** A run of instance indices. */
type Run = { start: number; count: number };

/**
 * Creates a set's range bookkeeping for `capacity` instances.
 * @internal
 */
export const createInstanceRanges = (capacity: number) => {
  /** Free runs below `end`, by start, none touching another. */
  const free: Run[] = [];
  /** Each live range's count, by its start. */
  const live = new Map<number, number>();
  let end = 0;
  let liveCount = 0;

  /** Frees a run, merging it with its free neighbours, or lowering the end. */
  const freeRun = (start: number, count: number) => {
    if (start + count === end) {
      end = start;
      // A free run now at the end goes with it
      const last = free[free.length - 1];
      if (last && last.start + last.count === end) {
        end = last.start;
        free.pop();
      }
      return;
    }
    let at = 0;
    while (at < free.length && free[at].start < start) at++;
    const before = free[at - 1];
    const after = free[at];
    const isAfterMerged = after?.start === start + count;
    if (before && before.start + before.count === start) {
      before.count += count + (isAfterMerged ? after.count : 0);
      if (isAfterMerged) free.splice(at, 1);
    } else if (isAfterMerged) {
      after.start = start;
      after.count += count;
    } else {
      free.splice(at, 0, { start, count });
    }
  };

  return {
    /** The highest live range's end: the instances a backend visits. */
    get end() {
      return end;
    },
    /** The live instances. */
    get count() {
      return liveCount;
    },
    /** Takes `count` (at least 1) instances: the first free range they fit in, else the end.
     * Returns the first one's index, or -1 when nothing fits (the capacity reached). */
    take: (count: number) => {
      let start = -1;
      for (let i = 0; i < free.length; i++) {
        const run = free[i];
        if (run.count < count) continue;
        start = run.start;
        if (run.count === count) free.splice(i, 1);
        else {
          run.start += count;
          run.count -= count;
        }
        break;
      }
      if (start < 0) {
        if (end + count > capacity) return -1;
        start = end;
        end += count;
      }
      live.set(start, count);
      liveCount += count;
      return start;
    },
    /** Frees a live range, exactly as `take` gave it; false (and nothing freed) for any other. */
    release: (start: number, count: number) => {
      if (live.get(start) !== count) return false;
      live.delete(start);
      liveCount -= count;
      freeRun(start, count);
      return true;
    },
    /** Whether `start` and `count` are a live range, exactly as `take` gave it. */
    isLive: (start: number, count: number) => live.get(start) === count,
    /** Calls `fn` with each live range (in no order). */
    forEachLive: (fn: (start: number, count: number) => void) => {
      for (const [start, count] of live) fn(start, count);
    },
    /** The free ranges below the end, by start (for tests and the debug tools). */
    getFree: (): readonly Readonly<Run>[] => free,
  };
};

/**
 * A set's range bookkeeping (`createInstanceRanges`).
 * @internal
 */
export type InstanceRanges = ReturnType<typeof createInstanceRanges>;
