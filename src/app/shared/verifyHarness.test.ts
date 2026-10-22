import { describe, expect, it, vi } from 'vitest';
import { expectError, expectSyncError, getErrorMessage, nextFrames } from './verifyHarness';

describe('verifyHarness', () => {
  it('reads an error message, or the thrown value', () => {
    expect(getErrorMessage(new Error('bad'))).toBe('bad');
    expect(getErrorMessage('plain')).toBe('plain');
    expect(getErrorMessage(42)).toBe('42');
  });

  it('expectError: the message of a throw or a rejection, a note when nothing failed', async () => {
    expect(
      await expectError(() => {
        throw new Error('thrown');
      })
    ).toBe('thrown');
    expect(await expectError(() => Promise.reject(new Error('rejected')))).toBe('rejected');
    expect(await expectError(() => Promise.resolve(1))).toBe('FAILED: did not throw');
  });

  it('expectSyncError: the message of a throw, a note when nothing threw', () => {
    expect(
      expectSyncError(() => {
        throw new Error('thrown');
      })
    ).toBe('thrown');
    expect(expectSyncError(() => 1)).toBe('FAILED: did not throw');
  });

  it('nextFrames waits that many animation frames', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => callbacks.push(cb));
    let isDone = false;
    const waiting = nextFrames(3).then(() => (isDone = true));
    for (let frame = 0; frame < 3; frame++) {
      await Promise.resolve();
      expect(isDone).toBe(false);
      callbacks.shift()?.(0);
    }
    await waiting;
    expect(isDone).toBe(true);
    expect(callbacks).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
