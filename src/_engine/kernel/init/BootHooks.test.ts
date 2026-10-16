import { describe, expect, it } from 'vitest';
import { addBootAfterStartHook, runBootAfterStartHooks } from './BootHooks';

describe('the boot after-start hooks', () => {
  it('runs the hooks once, in order; a hook added after the step is refused', () => {
    const calls: string[] = [];
    expect(addBootAfterStartHook(() => calls.push('a'))).toBe(true);
    expect(addBootAfterStartHook(() => calls.push('b'))).toBe(true);

    runBootAfterStartHooks();
    expect(calls).toEqual(['a', 'b']);

    expect(addBootAfterStartHook(() => calls.push('late'))).toBe(false);
    runBootAfterStartHooks();
    expect(calls).toEqual(['a', 'b']);
  });
});
