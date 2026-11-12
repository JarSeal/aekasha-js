import { describe, expect, test, vi } from 'vitest';
import type { FeatureContext } from '../../kernel/init/Features';
import * as Logger from '../../utils/Logger';
import { installStreaming, setSceneStreamingSettings } from './Streaming';

// The settings set in code (Streaming.ts' setSceneStreamingSettings): the build-time fields

installStreaming({
  config: {},
  registerPlugin: () => {},
  addSceneHooks: () => {},
} as unknown as FeatureContext);

describe('setSceneStreamingSettings', () => {
  test('warns once for the build-time base, radii and farEntries, and keeps the settings (p377 D2)', () => {
    const warn = vi.spyOn(Logger, 'lwarn').mockImplementation(() => {});
    setSceneStreamingSettings('plain', { cellSize: 64, rings: { far: 4 } });
    expect(warn).not.toHaveBeenCalled();
    setSceneStreamingSettings('world', { cellSize: 64, farEntries: 'LOD_LEVELS' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("setSceneStreamingSettings('world')");
    expect(warn.mock.calls[0][0]).toContain('base, radii and farEntries');
    // Once: another scene's, another field's
    setSceneStreamingSettings('other', { cellSize: 64, base: ['tower'], farEntries: 'ALL' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('throws on invalid settings, as before', () => {
    expect(() => setSceneStreamingSettings('bad', { cellSize: 64, rings: { far: 0 } })).toThrow(
      "setSceneStreamingSettings('bad')"
    );
  });
});
