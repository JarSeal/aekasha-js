import { describe, expect, it, vi } from 'vitest';
import { createBakeQueue } from './TextureBakeQueue';

const THROTTLE_MS = 150;

describe('createBakeQueue', () => {
  it('runs at most one request per runNext, in the order the ids were first requested', async () => {
    const queue = createBakeQueue(THROTTLE_MS);
    const ran: string[] = [];
    const a = queue.request('a', () => ran.push('a'));
    const b = queue.request('b', () => ran.push('b'));
    expect(queue.runNext(0)).toBe('a');
    expect(ran).toEqual(['a']);
    await a;
    expect(queue.runNext(16)).toBe('b');
    await b;
    expect(queue.runNext(32)).toBeNull();
    expect(queue.hasPending()).toBe(false);
  });

  it("joins an id's pending request: the latest run, once, and every promise settles", async () => {
    const queue = createBakeQueue(THROTTLE_MS);
    const first = vi.fn();
    const latest = vi.fn();
    const promises = [queue.request('a', first), queue.request('a', first)];
    promises.push(queue.request('a', latest));
    expect(queue.runNext(0)).toBe('a');
    await Promise.all(promises);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(queue.runNext(16)).toBeNull();
  });

  it('throttles a rebake of the same id, and the latest request still runs', () => {
    const queue = createBakeQueue(THROTTLE_MS);
    const run = vi.fn();
    queue.request('a', run);
    queue.runNext(0);
    // A drag: a request every frame, 16 ms apart
    let runs = 1;
    for (let ms = 16; ms < 1000; ms += 16) {
      queue.request('a', run);
      if (queue.runNext(ms) === 'a') runs++;
    }
    // 0 ms, then one run per 150 ms at most
    expect(runs).toBeLessThanOrEqual(1 + Math.floor(1000 / THROTTLE_MS));
    expect(runs).toBeGreaterThan(1);
    expect(run).toHaveBeenCalledTimes(runs);
    // The drag ends: its last request is due 150 ms after the last run
    expect(queue.hasPending()).toBe(true);
    expect(queue.runNext(10_000)).toBe('a');
    expect(queue.hasPending()).toBe(false);
  });

  it("runs another id while one is throttled, never its first request's throttle", () => {
    const queue = createBakeQueue(THROTTLE_MS);
    queue.request('a', vi.fn());
    queue.runNext(0);
    queue.request('a', vi.fn());
    queue.request('b', vi.fn());
    expect(queue.runNext(16)).toBe('b');
    expect(queue.runNext(32)).toBeNull();
    expect(queue.runNext(150)).toBe('a');
  });

  it('rejects the promises of a run that throws, and keeps going', async () => {
    const queue = createBakeQueue(THROTTLE_MS);
    const failed = queue.request('a', () => {
      throw new Error('lost device');
    });
    const ok = queue.request('b', vi.fn());
    expect(queue.runNext(0)).toBe('a');
    await expect(failed).rejects.toThrow('lost device');
    expect(queue.runNext(16)).toBe('b');
    await expect(ok).resolves.toBeUndefined();
  });

  it('settles a request markRun covers, and throttles from that run', async () => {
    const queue = createBakeQueue(THROTTLE_MS);
    const run = vi.fn();
    const pending = queue.request('a', run);
    queue.markRun('a', 100);
    await pending;
    expect(run).not.toHaveBeenCalled();
    queue.request('a', run);
    expect(queue.runNext(200)).toBeNull();
    expect(queue.runNext(250)).toBe('a');
  });

  it('resolves a cancelled request without running it, and forgets its throttle', async () => {
    const queue = createBakeQueue(THROTTLE_MS);
    const run = vi.fn();
    queue.request('a', run);
    queue.runNext(0);
    const pending = queue.request('a', run);
    queue.cancel('a');
    await pending;
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.hasPending()).toBe(false);
    // A new bake under the id runs at once
    queue.request('a', run);
    expect(queue.runNext(16)).toBe('a');
  });
});
