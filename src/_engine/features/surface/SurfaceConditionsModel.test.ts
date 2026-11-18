import { describe, expect, it } from 'vitest';
import {
  applySurfaceConditions,
  createSurfaceConditionsState,
  createSurfaceDynamics,
  getSurfaceSunFactor,
  getSurfaceWindFactor,
  resetSurfaceConditions,
  startSurfaceRain,
  stepSurfaceDynamics,
  stepSurfaceSimulation,
  stopSurfaceRain,
  SURFACE_CONDITIONS_DEFAULTS,
  SURFACE_MIN_SUN_FACTOR,
} from './SurfaceConditionsModel';

const create = () => ({ state: createSurfaceConditionsState(), dynamics: createSurfaceDynamics() });

/** Steps both the transitions and the simulation, `seconds` in steps of `dt`. */
const run = (
  { state, dynamics }: ReturnType<typeof create>,
  seconds: number,
  { dt = 0.5, sunFactor = 1 } = {}
) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    stepSurfaceDynamics(state, dynamics, dt);
    stepSurfaceSimulation(state, dynamics, dt, sunFactor);
  }
};

describe('surface conditions: values and transitions', () => {
  it('starts at the defaults, with its own wind array', () => {
    const { state } = create();
    expect(state).toEqual(SURFACE_CONDITIONS_DEFAULTS);
    expect(state.wind).not.toBe(SURFACE_CONDITIONS_DEFAULTS.wind);
  });

  it('sets values at once, clamped to their ranges, ignoring non-finite ones', () => {
    const { state, dynamics } = create();
    applySurfaceConditions(state, dynamics, {
      wetness: 1.5,
      rain: -1,
      dryingRate: -2,
      temperature: Number.NaN,
      wind: [3, -4],
      mode: 'MANUAL',
      waterLevel: 2,
    });
    expect(state).toMatchObject({
      wetness: 1,
      rain: 0,
      dryingRate: 0,
      temperature: SURFACE_CONDITIONS_DEFAULTS.temperature,
      wind: [3, -4],
      mode: 'MANUAL',
      waterLevel: 2,
    });
    applySurfaceConditions(state, dynamics, { waterLevel: null });
    expect(state.waterLevel).toBeNull();
  });

  it('moves values linearly over the transition and ends on the target', () => {
    const { state, dynamics } = create();
    applySurfaceConditions(state, dynamics, { temperature: 25, wind: [10, 0] }, 10);
    expect(state.temperature).toBe(15);
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.temperature).toBeCloseTo(20);
    expect(state.wind[0]).toBeCloseTo(5);
    stepSurfaceDynamics(state, dynamics, 7);
    expect(state.temperature).toBe(25);
    expect(state.wind).toEqual([10, 0]);
    expect(dynamics.transitions.temperature.isActive).toBe(false);
  });

  it('restarts a moving value from where it is when it is set again', () => {
    const { state, dynamics } = create();
    applySurfaceConditions(state, dynamics, { temperature: 25 }, 10);
    stepSurfaceDynamics(state, dynamics, 5);
    applySurfaceConditions(state, dynamics, { temperature: 0 }, 4);
    stepSurfaceDynamics(state, dynamics, 2);
    expect(state.temperature).toBeCloseTo(10);
    // Set at once: the transition ends
    applySurfaceConditions(state, dynamics, { temperature: 5 });
    stepSurfaceDynamics(state, dynamics, 2);
    expect(state.temperature).toBe(5);
  });

  it('switches a water level from or to none at once', () => {
    const { state, dynamics } = create();
    applySurfaceConditions(state, dynamics, { waterLevel: 4 }, 10);
    expect(state.waterLevel).toBe(4);
    applySurfaceConditions(state, dynamics, { waterLevel: 8 }, 10);
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.waterLevel).toBeCloseTo(6);
    applySurfaceConditions(state, dynamics, { waterLevel: null }, 10);
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.waterLevel).toBeNull();
  });

  it('resets to the defaults with nothing running', () => {
    const { state, dynamics } = create();
    startSurfaceRain(state, dynamics, 1, 5, 10);
    applySurfaceConditions(state, dynamics, { wetness: 1, wind: [5, 5], mode: 'MANUAL' }, 3);
    resetSurfaceConditions(state, dynamics);
    stepSurfaceDynamics(state, dynamics, 30);
    expect(state).toEqual(SURFACE_CONDITIONS_DEFAULTS);
    expect(dynamics.rainStop).toBeNull();
  });
});

describe('surface conditions: rain', () => {
  it('ramps up, holds for its duration and ramps down', () => {
    const { state, dynamics } = create();
    startSurfaceRain(state, dynamics, 0.8, 10, 60);
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.rain).toBeCloseTo(0.4);
    stepSurfaceDynamics(state, dynamics, 60);
    expect(state.rain).toBeCloseTo(0.8);
    // 70 s: the hold ends and the stop's ramp starts
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.rain).toBeCloseTo(0.8);
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.rain).toBeCloseTo(0.4);
    stepSurfaceDynamics(state, dynamics, 5);
    expect(state.rain).toBe(0);
    expect(dynamics.rainStop).toBeNull();
  });

  it('drops a scheduled stop when stopped or started again', () => {
    const { state, dynamics } = create();
    startSurfaceRain(state, dynamics, 1, 0, 5);
    startSurfaceRain(state, dynamics, 1);
    stepSurfaceDynamics(state, dynamics, 10);
    expect(state.rain).toBe(1);
    stopSurfaceRain(state, dynamics, 0);
    expect(state.rain).toBe(0);
  });
});

describe('surface conditions: the simulation', () => {
  it('wets with the rain, then dries and drains the puddles slower', () => {
    const s = create();
    startSurfaceRain(s.state, s.dynamics, 1);
    run(s, 30);
    expect(s.state.wetness).toBeCloseTo(0.5);
    // The puddles lag the wetness while it rises
    expect(s.state.puddleLevel).toBeCloseTo(0.25);
    run(s, 60);
    expect(s.state.wetness).toBe(1);
    expect(s.state.puddleLevel).toBeCloseTo(0.75);
    run(s, 30);
    expect(s.state.puddleLevel).toBeCloseTo(1);

    stopSurfaceRain(s.state, s.dynamics);
    // 0.1 per minute in full sun: 0.5 dried in 5 minutes, the puddles half as fast
    run(s, 300);
    expect(s.state.wetness).toBeCloseTo(0.5);
    expect(s.state.puddleLevel).toBeCloseTo(0.75);
    run(s, 600);
    expect(s.state.wetness).toBe(0);
    expect(s.state.puddleLevel).toBeCloseTo(0.25);
  });

  it('dries slower under a low sun and faster in the wind', () => {
    const sun = create();
    applySurfaceConditions(sun.state, sun.dynamics, { wetness: 1 });
    run(sun, 60, { sunFactor: SURFACE_MIN_SUN_FACTOR });
    expect(sun.state.wetness).toBeCloseTo(1 - 0.1 * SURFACE_MIN_SUN_FACTOR);

    const windy = create();
    applySurfaceConditions(windy.state, windy.dynamics, { wetness: 1, wind: [0, 10] });
    run(windy, 60);
    expect(windy.state.wetness).toBeCloseTo(0.8);
  });

  it('melts snow into wetness above 0 °C only', () => {
    const s = create();
    applySurfaceConditions(s.state, s.dynamics, {
      snowCoverage: 1,
      temperature: -5,
      dryingRate: 0,
    });
    run(s, 60);
    expect(s.state.snowCoverage).toBe(1);
    applySurfaceConditions(s.state, s.dynamics, { temperature: 10 });
    run(s, 60);
    expect(s.state.snowCoverage).toBeCloseTo(0.8);
    expect(s.state.wetness).toBeCloseTo(0.2);
  });

  it('leaves a moving value to its transition, and everything alone in MANUAL', () => {
    const s = create();
    startSurfaceRain(s.state, s.dynamics, 1);
    applySurfaceConditions(s.state, s.dynamics, { wetness: 0.2 }, 60);
    run(s, 30);
    expect(s.state.wetness).toBeCloseTo(0.1);

    const manual = create();
    applySurfaceConditions(manual.state, manual.dynamics, { mode: 'MANUAL', rain: 1 });
    run(manual, 60);
    expect(manual.state.wetness).toBe(0);
  });
});

describe('surface conditions: the drying factors', () => {
  it('reads the sun as sin(elevation) within [0.2, 1], 1 without a sun', () => {
    expect(getSurfaceSunFactor(null)).toBe(1);
    expect(getSurfaceSunFactor(Math.PI / 2)).toBe(1);
    expect(getSurfaceSunFactor(Math.PI / 6)).toBeCloseTo(0.5);
    expect(getSurfaceSunFactor(-0.3)).toBe(SURFACE_MIN_SUN_FACTOR);
  });

  it('triples the drying at 20 m/s of wind and no more', () => {
    expect(getSurfaceWindFactor([0, 0])).toBe(1);
    expect(getSurfaceWindFactor([6, 8])).toBeCloseTo(2);
    expect(getSurfaceWindFactor([0, 50])).toBe(3);
  });
});
