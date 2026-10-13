import { createActionMap, createMeshEntity, createSceneMainLooper } from 'aekasha';
import {
  getDayNightSpeed,
  getTimeOfDay,
  isDayNightPlaying,
  pauseDayNight,
  playDayNight,
  setDayNightSpeed,
  setTimeOfDay,
} from 'aekasha/skybox';
import { createExampleHud } from '../exampleHud';

const SCENE_ID = 'exampleSkyBox';

// #region sky-objects (shown in the Hub: hub/pages/examples/sky-box/)
export const scene = async () => {
  // No lights here: the sky box's sun and moon light the scene. A ground, a mirror ball, a matte
  // ball and a pillar to cast a long shadow at dusk.
  createMeshEntity({
    geo: { id: 'skyGround', type: 'BOX', params: { width: 40, height: 0.2, depth: 40 } },
    mat: { id: 'skyGround', type: 'STANDARD', params: { color: '#6b6f66', roughness: 0.9 } },
    position: { y: -0.1 },
    receiveShadow: true,
  });
  const balls = [
    { id: 'skyMirrorBall', x: -1.5, metalness: 1, roughness: 0.05 },
    { id: 'skyMatteBall', x: 1.5, metalness: 0, roughness: 0.6 },
  ];
  for (const { id, x, metalness, roughness } of balls) {
    createMeshEntity({
      geo: { id: 'skyBall', type: 'SPHERE', params: { radius: 1, widthSegments: 48 } },
      mat: { id, type: 'STANDARD', params: { color: '#e8e4dc', metalness, roughness } },
      position: { x, y: 1 },
      castShadow: true,
      receiveShadow: true,
    });
  }
  createMeshEntity({
    geo: { id: 'skyPillar', type: 'CYLINDER', params: { radiusTop: 0.3, height: 5 } },
    mat: { id: 'skyPillar', type: 'STANDARD', params: { color: '#9a938a', roughness: 0.85 } },
    position: { x: -4, y: 2.5, z: -3 },
    castShadow: true,
    receiveShadow: true,
  });

  createDayNightControls();
};
// #endregion sky-objects

// #region sky-controls (shown in the Hub: hub/pages/examples/sky-box/)
/** Keys for the running day (setTimeOfDay wraps the hours), and a HUD line that shows it */
const createDayNightControls = () => {
  // The scene's actions: active in this scene only, replaced by the next visit's map (its id)
  const actions = createActionMap({
    id: SCENE_ID,
    sceneId: SCENE_ID,
    actions: {
      playPause: { type: 'BUTTON', name: 'Play or pause the day' },
      hourBack: { type: 'BUTTON', name: 'An hour back' },
      hourOn: { type: 'BUTTON', name: 'An hour on' },
      faster: { type: 'BUTTON', name: 'Faster' },
      slower: { type: 'BUTTON', name: 'Slower' },
    },
    bindings: {
      playPause: [{ device: 'KEYBOARD', keys: [' '] }],
      hourBack: [{ device: 'KEYBOARD', keys: ['ArrowLeft'] }],
      hourOn: [{ device: 'KEYBOARD', keys: ['ArrowRight'] }],
      faster: [{ device: 'KEYBOARD', keys: ['ArrowUp'] }],
      slower: [{ device: 'KEYBOARD', keys: ['ArrowDown'] }],
    },
  });
  // At each press (also while the app is paused)
  actions.onPressed('playPause', () => (isDayNightPlaying() ? pauseDayNight() : playDayNight()));
  actions.onPressed('hourBack', () => setTimeOfDay((getTimeOfDay() ?? 0) - 1));
  actions.onPressed('hourOn', () => setTimeOfDay((getTimeOfDay() ?? 0) + 1));
  actions.onPressed('faster', () => setDayNightSpeed(Math.min((getDayNightSpeed() ?? 1) * 2, 64)));
  actions.onPressed('slower', () =>
    setDayNightSpeed(Math.max((getDayNightSpeed() ?? 1) / 2, 1 / 16))
  );

  // The time, read every frame, written to the HUD when it changes
  const hud = createExampleHud('');
  let shown = '';
  createSceneMainLooper(() => {
    const minutes = Math.floor((getTimeOfDay() ?? 0) * 60);
    const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    const state = isDayNightPlaying() ? `playing ×${getDayNightSpeed()}` : 'paused';
    const text = `${time} (${state})\nSpace: play / pause · ← →: an hour · ↑ ↓: speed`;
    if (text !== shown) hud.updateText((shown = text));
  }, SCENE_ID);
};
// #endregion sky-controls
