// The fog showcase's tab (p106 Phase 5): the scene's fogs (one per mode, or none), the day (its
// hour, playing, its speed: the fog's colour follows the sky) and a dense valley fog that fills
// the valley over a few seconds through `updateFog`, and lifts again to the values it had. The
// engine's Fog tab edits the fog showing; this one only switches and drives it at runtime, so
// nothing here is saved or undone.
import { createDebuggerTab } from 'aekasha/debug';
import { type FogDef, type FogUpdate, getFog, onFogChange, setFog, updateFog } from 'aekasha/fog';
import {
  getDayNightSpeed,
  getTimeOfDay,
  isDayNightPlaying,
  pauseDayNight,
  playDayNight,
  setDayNightSpeed,
  setTimeOfDay,
} from 'aekasha/skybox';
import {
  FOG_SHOWCASE_FOG_IDS,
  FOG_SHOWCASE_SCENE_ID,
  FOG_SHOWCASE_START_HOUR,
} from './fogShowcase';

const TAB_ID = 'fogShowcase';
/** The fog switch's value for none */
const NO_FOG = 'NONE';
/** The dense valley fog's transitions, seconds */
const PRESET_TRANSITION_SEC = 4;
/**
 * The dense valley fog: a thin layer, thick at the lake's level and thinning fast above it (the
 * camera, 9 m up, nearly over it), so the floor is about 70 % fogged at 100 m while the hills stand
 * out of it, glowing toward the sun
 */
const DENSE_VALLEY: FogUpdate = {
  mode: 'HEIGHT',
  height: { density: 0.08, baseHeight: 0, falloff: 0.35, startDistance: 0, maxOpacity: 1 },
  sunScattering: { enabled: true },
};

/** The fog's values before the dense valley fog filled it, to lift it to: null while it isn't
 * filled (another fog, or none, forgets them) */
let beforePreset: FogUpdate | null = null;

const fillValley = () => {
  const fog = getFog();
  if (!fog || beforePreset) return;
  // The values to lift it to: the fog's own, without what names it
  const { id: _id, isDefault: _isDefault, debugData: _debugData, ...values } = fog as FogDef;
  beforePreset = structuredClone(values);
  updateFog(DENSE_VALLEY, { transitionSec: PRESET_TRANSITION_SEC });
};

const liftValley = () => {
  if (!beforePreset) return;
  updateFog(beforePreset, { transitionSec: PRESET_TRANSITION_SEC });
  beforePreset = null;
};

/**
 * Creates the fog showcase's drawer tab (the scene's, removed on its exit).
 * @internal
 * @returns what the scene's exit calls: it stops listening to the fog
 */
export const createFogShowcaseTab = () => {
  beforePreset = null;
  // setFog shows a fog's own values: nothing to lift
  const removeFogListener = onFogChange((_fog, reason) => {
    if (reason === 'set' || reason === 'clear') beforePreset = null;
  });
  createDebuggerTab({
    id: TAB_ID,
    title: 'Fog showcase',
    icon: 'fog',
    sceneId: FOG_SHOWCASE_SCENE_ID,
    // The day's fields follow the playing sky, the fog switch an update from the Fog tab
    refreshIntervalMs: 500,
    content: () => [
      {
        pane: true,
        title: 'Fogs',
        id: 'fogShowcaseFogs',
        content: [
          {
            label: 'Fog',
            kind: 'segmented',
            fill: true,
            options: [
              { label: 'Linear', value: FOG_SHOWCASE_FOG_IDS.LINEAR },
              { label: 'Exp²', value: FOG_SHOWCASE_FOG_IDS.EXP2 },
              { label: 'Height', value: FOG_SHOWCASE_FOG_IDS.HEIGHT },
              { label: 'None', value: NO_FOG },
            ],
            get: () => getFog()?.id ?? NO_FOG,
            set: (id: unknown) => setFog(id === NO_FOG ? null : String(id)),
            hint: 'One of the scene’s fogs (its JSON’s fogs: Height is its default), or none. Switching never recompiles a material; the Fog tab edits the one showing',
          },
        ],
      },
      {
        pane: true,
        title: 'Day',
        id: 'fogShowcaseDay',
        content: [
          {
            label: 'Time of day',
            get: () => getTimeOfDay() ?? FOG_SHOWCASE_START_HOUR,
            set: (hours: unknown) => setTimeOfDay(Number(hours)),
            kind: 'slider',
            min: 0,
            max: 24,
            step: 0.25,
            unit: 'h',
            hint: 'The sky’s hour (the scene’s 16:30, standing still, on every visit). The fog takes the sky’s horizon colour away from the sun, and glows toward the sky’s colour around it',
          },
          {
            label: 'Play the day',
            get: () => isDayNightPlaying(),
            set: (isPlaying: unknown) => (isPlaying ? playDayNight() : pauseDayNight()),
            kind: 'switch',
            hint: 'Runs the day-night cycle from the hour above (20 minutes a day at speed 1)',
          },
          {
            label: 'Speed',
            get: () => getDayNightSpeed() ?? 1,
            set: (speed: unknown) => setDayNightSpeed(Number(speed)),
            kind: 'slider',
            min: 0.25,
            max: 40,
            step: 0.25,
            unit: '×',
            hint: 'The cycle’s time multiplier: 20 is a day a minute',
          },
        ],
      },
      {
        pane: true,
        title: 'Dense valley fog',
        id: 'fogShowcasePreset',
        content: [
          {
            type: 'button',
            title: `Fill the valley (${PRESET_TRANSITION_SEC} s)`,
            disabled: () => !getFog() || beforePreset !== null,
            onClick: fillValley,
          },
          {
            type: 'button',
            title: `Lift it (${PRESET_TRANSITION_SEC} s)`,
            disabled: () => beforePreset === null,
            onClick: liftValley,
          },
        ],
      },
    ],
  });
  return removeFogListener;
};
