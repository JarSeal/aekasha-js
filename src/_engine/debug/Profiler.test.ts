import { describe, expect, it, vi } from 'vitest';

// The profiler's implementation builds a draggable window (DOM): only its entry points, recorded
const profiler = vi.hoisted(() => ({
  _createProfilerTab: vi.fn(),
  _onStatsSourceReplaced: vi.fn(),
}));
vi.mock(import('./profiler/_dbg__Profiler'), () => profiler as never);

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import { initEnvironment } from '../kernel/config/Config';
import { createProfilerTab, registerProfiler } from './Profiler';

describe('profiler: registration (p618 §1.4)', () => {
  // B4: a tab created before the profiler loads (a feature's onDebug hook) was dropped
  it.fails('keeps a tab created before the profiler loads (B4)', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    const def = { id: 'early', title: 'Early', icon: 'gear', content: () => [] };
    createProfilerTab(def);

    await registerProfiler();

    expect(profiler._createProfilerTab).toHaveBeenCalledWith(def);
  });
});
