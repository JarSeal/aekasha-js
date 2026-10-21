import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkQueue } from './workQueue';

const DEBOUNCE_MS = 100;
const RUN_MS = 300;

/** A queue whose runs take RUN_MS and record their work (a set of file names) */
const createTestQueue = () => {
  const runs: string[][] = [];
  const errors: unknown[] = [];
  const queue = createWorkQueue<Set<string>>({
    create: () => new Set(),
    runAsync: async (work) => {
      runs.push([...work]);
      if (work.has('throws')) throw new Error('run failed');
      await new Promise((resolve) => setTimeout(resolve, RUN_MS));
    },
    onError: (err) => errors.push(err),
    debounceMs: DEBOUNCE_MS,
  });
  const add = (file: string) => queue.schedule((work) => work.add(file));
  return { queue, runs, errors, add };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the dev gather queue', () => {
  it('folds a burst within the debounce into one run', async () => {
    const { runs, add } = createTestQueue();
    add('a');
    await vi.advanceTimersByTimeAsync(50);
    add('b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + RUN_MS);
    expect(runs).toEqual([['a', 'b']]);
  });

  it('runs the events of a run in progress after it, once', async () => {
    const { runs, add } = createTestQueue();
    add('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    add('b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    add('c');
    await vi.advanceTimersByTimeAsync(2 * RUN_MS);
    expect(runs).toEqual([['a'], ['b', 'c']]);
  });

  it('a burst straddling the end of a run becomes one more run, not two (G9)', async () => {
    const { runs, add } = createTestQueue();
    add('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + RUN_MS - 50);
    // The run ends 50 ms into this burst, while its debounce is still running
    add('b');
    await vi.advanceTimersByTimeAsync(80);
    add('c');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 2 * RUN_MS);
    expect(runs).toEqual([['a'], ['b', 'c']]);
  });

  it('a run that throws goes to onError, and the queue goes on', async () => {
    const { runs, errors, add } = createTestQueue();
    add('throws');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    add('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + RUN_MS);
    expect(errors).toHaveLength(1);
    expect(runs).toEqual([['throws'], ['a']]);
  });

  it('close drops the pending work', async () => {
    const { queue, runs, add } = createTestQueue();
    add('a');
    queue.close();
    add('b');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + RUN_MS);
    expect(runs).toEqual([]);
  });
});
