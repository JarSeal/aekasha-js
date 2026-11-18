import { describe, expect, it } from 'vitest';
import {
  createRainMapRenderState,
  RAIN_OCCLUSION_DEFAULTS,
  resolveRainOcclusionOpts,
  shouldRenderRainMap,
  snapRainMapCoordinate,
} from './RainOcclusionModel';

describe('resolveRainOcclusionOpts', () => {
  it('fills in the defaults', () => {
    expect(resolveRainOcclusionOpts()).toEqual(RAIN_OCCLUSION_DEFAULTS);
    expect(resolveRainOcclusionOpts({ extent: 96 })).toEqual({
      ...RAIN_OCCLUSION_DEFAULTS,
      extent: 96,
    });
  });

  it('refuses an option out of its range, naming it', () => {
    expect(() => resolveRainOcclusionOpts({ size: 8 })).toThrow(/size/);
    expect(() => resolveRainOcclusionOpts({ size: 512.5 })).toThrow(/size/);
    expect(() => resolveRainOcclusionOpts({ extent: 0 })).toThrow(/extent/);
    expect(() => resolveRainOcclusionOpts({ height: Number.NaN })).toThrow(/height/);
    expect(() => resolveRainOcclusionOpts({ updateFrames: -1 })).toThrow(/updateFrames/);
    expect(() => resolveRainOcclusionOpts({ bias: -0.1 })).toThrow(/bias/);
    expect(resolveRainOcclusionOpts({ updateFrames: 0, bias: 0 }).updateFrames).toBe(0);
  });
});

describe('snapRainMapCoordinate', () => {
  it('snaps to the texel grid', () => {
    expect(snapRainMapCoordinate(10.06, 0.125)).toBe(10);
    expect(snapRainMapCoordinate(10.07, 0.125)).toBe(10.125);
    expect(snapRainMapCoordinate(-3.2, 0.5)).toBe(-3);
  });
});

describe('shouldRenderRainMap', () => {
  const opts = RAIN_OCCLUSION_DEFAULTS;
  const rendered = () => ({
    ...createRainMapRenderState(),
    hasRendered: true,
    isRequested: false,
  });

  it('renders first, and when asked', () => {
    expect(shouldRenderRainMap(createRainMapRenderState(), 0, 0, 0, opts)).toBe(true);
    expect(shouldRenderRainMap({ ...rendered(), isRequested: true }, 0, 0, 0, opts)).toBe(true);
    expect(shouldRenderRainMap(rendered(), 0, 0, 0, opts)).toBe(false);
  });

  it('renders once the camera moves past an eighth of the extent or of the height', () => {
    // 64 m: 8 m across; 100 m: 12.5 m up or down
    expect(shouldRenderRainMap(rendered(), 7.9, 0, -7.9, opts)).toBe(false);
    expect(shouldRenderRainMap(rendered(), 8.1, 0, 0, opts)).toBe(true);
    expect(shouldRenderRainMap(rendered(), 0, 0, -8.1, opts)).toBe(true);
    expect(shouldRenderRainMap(rendered(), 0, 12.4, 0, opts)).toBe(false);
    expect(shouldRenderRainMap(rendered(), 0, -12.6, 0, opts)).toBe(true);
  });

  it('renders every updateFrames frames, never by frames at 0', () => {
    expect(shouldRenderRainMap({ ...rendered(), framesSince: 29 }, 0, 0, 0, opts)).toBe(false);
    expect(shouldRenderRainMap({ ...rendered(), framesSince: 30 }, 0, 0, 0, opts)).toBe(true);
    const still = { ...opts, updateFrames: 0 };
    expect(shouldRenderRainMap({ ...rendered(), framesSince: 1e6 }, 0, 0, 0, still)).toBe(false);
  });
});
