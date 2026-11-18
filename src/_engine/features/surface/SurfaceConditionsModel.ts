// The surface conditions' model (p307 D1): the state's shape, its defaults, the transitions and
// the wet / dry simulation, as plain functions of a state and a time step. No three, no ECS:
// SurfaceConditions.ts holds the running state, steps it per frame and writes the uniforms.

/** How the surface conditions change on their own: `'SIMULATED'` (rain wets, the sun and the
 * wind dry, puddles follow, snow melts) or `'MANUAL'` (only the app's calls change them). */
export type SurfaceConditionsMode = 'SIMULATED' | 'MANUAL';

/**
 * The global surface conditions that wet materials read (the `surfaceConditions()` feature): one
 * state for the whole world, the part of a weather system that surfaces show.
 */
export type SurfaceConditions = {
  /** How wet the surfaces are: 0 dry, 0.5 the pores full, 1 a water film. */
  wetness: number;
  /** Rain intensity, 0 to 1: wets the surfaces and drives the ripples. */
  rain: number;
  /** How full the puddles are, 0 to 1: follows `wetness` with a lag (fills and drains slower). */
  puddleLevel: number;
  /** The water surface's world Y for the shoreline's wet band, or null for none. */
  waterLevel: number | null;
  /** Snow cover, 0 to 1. Melts into `wetness` above 0 °C. */
  snowCoverage: number;
  /** The air temperature in °C: the melting and freezing thresholds. */
  temperature: number;
  /** How much `wetness` dries per minute in full sun without wind (0 or more). */
  dryingRate: number;
  /** The wind's world x and z (m/s): faster drying, and the streaks' bend. */
  wind: [number, number];
  /** Whether the state simulates itself or only the app changes it. */
  mode: SurfaceConditionsMode;
};

/** The values `setSurfaceConditions` and a scene's `surfaceConditions` take: any of the state's. */
export type SurfaceConditionsInput = Partial<Omit<SurfaceConditions, 'wind'>> & {
  /** The wind's world x and z (m/s). */
  wind?: readonly [number, number];
};

/**
 * Every value's default, what each scene starts from before its own `surfaceConditions`.
 * @internal
 */
export const SURFACE_CONDITIONS_DEFAULTS: Readonly<
  Omit<SurfaceConditions, 'wind'> & { wind: readonly [number, number] }
> = {
  wetness: 0,
  rain: 0,
  puddleLevel: 0,
  waterLevel: null,
  snowCoverage: 0,
  temperature: 15,
  dryingRate: 0.1,
  wind: [0, 0],
  mode: 'SIMULATED',
};

// The simulation's rates, per minute of the surface clock. Starting values, tuned by eye with the
// debug tab's buttons and the gallery's wet row (p307 Phase 2).

/**
 * How much full rain (`rain` 1) raises `wetness` per minute: dry to a water film in a minute.
 * @internal
 */
export const SURFACE_WETTING_PER_MIN = 1;
/**
 * How fast `puddleLevel` rises toward `wetness` per minute (slower than the wetting).
 * @internal
 */
export const SURFACE_PUDDLE_FILL_PER_MIN = 0.5;
/**
 * How fast puddles drain toward `wetness`, as a share of the surfaces' drying.
 * @internal
 */
export const SURFACE_PUDDLE_DRAIN_SCALE = 0.5;
/**
 * How much `snowCoverage` melts per minute per °C above 0 (all of it into `wetness`).
 * @internal
 */
export const SURFACE_SNOW_MELT_PER_DEG_MIN = 0.02;
/**
 * The sun factor's floor: at night and under a low sun, surfaces still dry at this share.
 * @internal
 */
export const SURFACE_MIN_SUN_FACTOR = 0.2;
/**
 * The wind speed (m/s) past which the wind dries no faster; there it triples the drying.
 * @internal
 */
export const SURFACE_MAX_DRYING_WIND = 20;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * How much the sun speeds the drying: `sin(elevation)` within [0.2, 1], or 1 without a sun
 * (`elevation` null: no sun source, or no active sky box).
 * @internal
 */
export const getSurfaceSunFactor = (elevation: number | null) =>
  elevation === null || !Number.isFinite(elevation)
    ? 1
    : clamp(Math.sin(elevation), SURFACE_MIN_SUN_FACTOR, 1);

/**
 * How much the wind speeds the drying: 1 still, up to 3 at 20 m/s and over.
 * @internal
 */
export const getSurfaceWindFactor = (wind: readonly [number, number]) =>
  1 +
  (2 * Math.min(Math.hypot(wind[0], wind[1]), SURFACE_MAX_DRYING_WIND)) / SURFACE_MAX_DRYING_WIND;

// Transitions: each number the state holds is a channel (the wind two), which moves linearly from
// where it was to its target over the transition's time. While a channel moves, the simulation
// leaves it alone.

/** A number of the state that transitions. */
type SurfaceChannel =
  | 'wetness'
  | 'rain'
  | 'puddleLevel'
  | 'waterLevel'
  | 'snowCoverage'
  | 'temperature'
  | 'dryingRate'
  | 'windX'
  | 'windZ';

const SURFACE_CHANNELS: readonly SurfaceChannel[] = [
  'wetness',
  'rain',
  'puddleLevel',
  'waterLevel',
  'snowCoverage',
  'temperature',
  'dryingRate',
  'windX',
  'windZ',
];

/** The channels within [0, 1]. */
const UNIT_CHANNELS = new Set<SurfaceChannel>(['wetness', 'rain', 'puddleLevel', 'snowCoverage']);

type SurfaceTransition = {
  isActive: boolean;
  from: number;
  to: number;
  elapsedSec: number;
  durationSec: number;
};

/**
 * A running state's transitions (one slot per channel, reused) and its scheduled rain stop
 * (`startRain`'s `durationSec`).
 * @internal
 */
export type SurfaceDynamics = {
  transitions: Record<SurfaceChannel, SurfaceTransition>;
  /** Counts down by the surface clock; at 0 the rain stops over `rampSec`. */
  rainStop: { remainingSec: number; rampSec: number } | null;
};

/**
 * A state at the defaults (its own wind array).
 * @internal
 */
export const createSurfaceConditionsState = (): SurfaceConditions => ({
  ...SURFACE_CONDITIONS_DEFAULTS,
  wind: [SURFACE_CONDITIONS_DEFAULTS.wind[0], SURFACE_CONDITIONS_DEFAULTS.wind[1]],
});

/**
 * Transitions and a rain stop with nothing running.
 * @internal
 */
export const createSurfaceDynamics = (): SurfaceDynamics => {
  const transitions = {} as Record<SurfaceChannel, SurfaceTransition>;
  for (const channel of SURFACE_CHANNELS) {
    transitions[channel] = { isActive: false, from: 0, to: 0, elapsedSec: 0, durationSec: 0 };
  }
  return { transitions, rainStop: null };
};

const readChannel = (state: SurfaceConditions, channel: SurfaceChannel) => {
  if (channel === 'windX') return state.wind[0];
  if (channel === 'windZ') return state.wind[1];
  return state[channel];
};

const writeChannel = (state: SurfaceConditions, channel: SurfaceChannel, value: number) => {
  if (channel === 'windX') state.wind[0] = value;
  else if (channel === 'windZ') state.wind[1] = value;
  else state[channel] = value;
};

/** A channel's value within its range: [0, 1], a drying rate of 0 or more, else as it is. */
const limitChannel = (channel: SurfaceChannel, value: number) => {
  if (UNIT_CHANNELS.has(channel)) return clamp(value, 0, 1);
  if (channel === 'dryingRate') return Math.max(0, value);
  return value;
};

/** Sets a channel now, or starts its transition (a running one is replaced, from where it is). */
const setChannel = (
  state: SurfaceConditions,
  dynamics: SurfaceDynamics,
  channel: SurfaceChannel,
  value: number,
  transitionSec: number
) => {
  const transition = dynamics.transitions[channel];
  const target = limitChannel(channel, value);
  const current = readChannel(state, channel);
  // A water level from or to none can't move: it switches
  if (transitionSec > 0 && current !== null) {
    transition.isActive = true;
    transition.from = current;
    transition.to = target;
    transition.elapsedSec = 0;
    transition.durationSec = transitionSec;
    return;
  }
  transition.isActive = false;
  writeChannel(state, channel, target);
};

/**
 * Applies `input` to the state: each value now, or over `transitionSec` (seconds of the surface
 * clock; `mode` and a water level from or to none always switch at once). A value that isn't a
 * finite number is ignored, and each is kept within its range (the unit values within [0, 1],
 * `dryingRate` 0 or more). A value set while it moves replaces its transition, from where it is.
 * @internal
 */
export const applySurfaceConditions = (
  state: SurfaceConditions,
  dynamics: SurfaceDynamics,
  input: SurfaceConditionsInput,
  transitionSec = 0
) => {
  const sec = Number.isFinite(transitionSec) ? Math.max(0, transitionSec) : 0;
  if (input.mode === 'SIMULATED' || input.mode === 'MANUAL') state.mode = input.mode;
  for (const channel of SURFACE_CHANNELS) {
    if (channel === 'windX' || channel === 'windZ' || channel === 'waterLevel') continue;
    const value = input[channel];
    if (typeof value === 'number' && Number.isFinite(value)) {
      setChannel(state, dynamics, channel, value, sec);
    }
  }
  if (input.waterLevel === null) {
    dynamics.transitions.waterLevel.isActive = false;
    state.waterLevel = null;
  } else if (typeof input.waterLevel === 'number' && Number.isFinite(input.waterLevel)) {
    setChannel(state, dynamics, 'waterLevel', input.waterLevel, sec);
  }
  const wind = input.wind;
  if (wind && Number.isFinite(wind[0]) && Number.isFinite(wind[1])) {
    setChannel(state, dynamics, 'windX', wind[0], sec);
    setChannel(state, dynamics, 'windZ', wind[1], sec);
  }
};

/**
 * Puts the state back to the defaults, with no transition or rain stop running.
 * @internal
 */
export const resetSurfaceConditions = (state: SurfaceConditions, dynamics: SurfaceDynamics) => {
  for (const channel of SURFACE_CHANNELS) dynamics.transitions[channel].isActive = false;
  dynamics.rainStop = null;
  const defaults = SURFACE_CONDITIONS_DEFAULTS;
  state.wetness = defaults.wetness;
  state.rain = defaults.rain;
  state.puddleLevel = defaults.puddleLevel;
  state.waterLevel = defaults.waterLevel;
  state.snowCoverage = defaults.snowCoverage;
  state.temperature = defaults.temperature;
  state.dryingRate = defaults.dryingRate;
  state.wind[0] = defaults.wind[0];
  state.wind[1] = defaults.wind[1];
  state.mode = defaults.mode;
};

/**
 * Starts the rain: `rain` to `intensity` over `rampSec`, and with `durationSec`, a stop over the
 * same ramp once the rain has run that long after its ramp.
 * @internal
 */
export const startSurfaceRain = (
  state: SurfaceConditions,
  dynamics: SurfaceDynamics,
  intensity: number,
  rampSec = 0,
  durationSec?: number
) => {
  const ramp = Number.isFinite(rampSec) ? Math.max(0, rampSec) : 0;
  applySurfaceConditions(state, dynamics, { rain: intensity }, ramp);
  dynamics.rainStop =
    durationSec !== undefined && Number.isFinite(durationSec)
      ? { remainingSec: ramp + Math.max(0, durationSec), rampSec: ramp }
      : null;
};

/**
 * Stops the rain over `rampSec` (and drops a scheduled stop).
 * @internal
 */
export const stopSurfaceRain = (
  state: SurfaceConditions,
  dynamics: SurfaceDynamics,
  rampSec = 0
) => {
  dynamics.rainStop = null;
  applySurfaceConditions(state, dynamics, { rain: 0 }, rampSec);
};

/**
 * Advances the transitions and the scheduled rain stop by `dtSec`. Allocates nothing.
 * @internal
 */
export const stepSurfaceDynamics = (
  state: SurfaceConditions,
  dynamics: SurfaceDynamics,
  dtSec: number
) => {
  if (dtSec <= 0) return;
  for (let i = 0; i < SURFACE_CHANNELS.length; i++) {
    const channel = SURFACE_CHANNELS[i];
    const transition = dynamics.transitions[channel];
    if (transition.isActive) advanceTransition(state, channel, transition, dtSec);
  }
  const rainStop = dynamics.rainStop;
  if (!rainStop) return;
  rainStop.remainingSec -= dtSec;
  if (rainStop.remainingSec > 0) return;
  // The stop's ramp gets only the part of the step after the stop
  const overshootSec = -rainStop.remainingSec;
  stopSurfaceRain(state, dynamics, rainStop.rampSec);
  const rain = dynamics.transitions.rain;
  if (rain.isActive) advanceTransition(state, 'rain', rain, overshootSec);
};

/** Moves a running transition on by `dtSec` and writes its value; it ends on its target. */
const advanceTransition = (
  state: SurfaceConditions,
  channel: SurfaceChannel,
  transition: SurfaceTransition,
  dtSec: number
) => {
  transition.elapsedSec += dtSec;
  const t = Math.min(1, transition.elapsedSec / transition.durationSec);
  writeChannel(state, channel, transition.from + (transition.to - transition.from) * t);
  if (t >= 1) transition.isActive = false;
};

/**
 * Steps the `'SIMULATED'` model by `dtSec` (a no-op in `'MANUAL'`): snow melts into the wetness
 * above 0 °C, the rain wets, the sun (`sunFactor`) and the wind dry what the rain doesn't, and the
 * puddles follow the wetness, filling and draining slower. A value in a transition is left to it.
 * Allocates nothing.
 * @internal
 */
export const stepSurfaceSimulation = (
  state: SurfaceConditions,
  dynamics: SurfaceDynamics,
  dtSec: number,
  sunFactor: number
) => {
  if (state.mode !== 'SIMULATED' || dtSec <= 0) return;
  const { transitions } = dynamics;
  const dtMin = dtSec / 60;
  const drying = state.dryingRate * sunFactor * getSurfaceWindFactor(state.wind);
  let meltWater = 0;
  if (!transitions.snowCoverage.isActive && state.temperature > 0 && state.snowCoverage > 0) {
    meltWater = Math.min(
      state.snowCoverage,
      SURFACE_SNOW_MELT_PER_DEG_MIN * state.temperature * dtMin
    );
    state.snowCoverage -= meltWater;
  }
  if (!transitions.wetness.isActive) {
    // Rain wets; drying works on what the rain leaves (none under full rain)
    const change = (state.rain * SURFACE_WETTING_PER_MIN - drying * (1 - state.rain)) * dtMin;
    state.wetness = clamp(state.wetness + change + meltWater, 0, 1);
  }
  if (!transitions.puddleLevel.isActive) {
    const wetness = state.wetness;
    state.puddleLevel =
      state.puddleLevel < wetness
        ? Math.min(wetness, state.puddleLevel + SURFACE_PUDDLE_FILL_PER_MIN * dtMin)
        : Math.max(wetness, state.puddleLevel - drying * SURFACE_PUDDLE_DRAIN_SCALE * dtMin);
  }
};
