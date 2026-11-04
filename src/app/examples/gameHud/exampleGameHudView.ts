import * as THREE from 'three/webgpu';
import { existsOrThrow, getAppDelta, getRenderer, getRootScene } from 'aekasha';
import { createViewport } from 'aekasha/viewports';

// The game HUD example's views beside the player's camera: the camera's orbit input and the
// minimap's viewport. The rig that uses the orbit and the frame over the minimap are the scene
// file's.

/** The right stick's look speed, in the rig's mouse pixels a second */
const STICK_LOOK_SPEED = 900;

// #region game-hud-orbit (shown in the Hub: hub/pages/examples/game-hud/)
/**
 * The camera's orbit input: a right-drag on the canvas (the pointer's movement summed between
 * frames) and the right stick's rate, in the rig's pixels. The drag is DOM events, not an action
 * map: a map's `read()` is the last physics step's sample, which two frames between steps would
 * read twice. Returns the rig's `getMouseMoveInput` and the listeners' remover.
 */
export const createOrbitInput = (look: () => { x: number; y: number }, isLocked: () => boolean) => {
  const canvas = existsOrThrow(getRenderer()?.domElement, 'No canvas');
  const moved = { x: 0, y: 0 };
  const out = { x: 0, y: 0 };
  let dragging = false;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 2) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    moved.x += e.movementX;
    moved.y += e.movementY;
  };
  const onUp = () => {
    dragging = false;
  };
  // The right button is the orbit's, not the browser's menu
  const onContextMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  return {
    getMouseMoveInput: () => {
      // The rig reads it once a frame, in an app stage: the stick's rate over the app's frame
      const dt = Math.min(getAppDelta(), 0.1);
      const stick = look();
      out.x = isLocked() ? 0 : moved.x + stick.x * STICK_LOOK_SPEED * dt;
      // The stick's up is positive, the pointer's down
      out.y = isLocked() ? 0 : moved.y - stick.y * STICK_LOOK_SPEED * dt;
      moved.x = 0;
      moved.y = 0;
      return out;
    },
    remove: () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
};
// #endregion game-hud-orbit

// #region game-hud-minimap (shown in the Hub: hub/pages/examples/game-hud/)
/** The minimap: a top-down orthographic camera over the game's scene, north up, in a viewport
 * at the bottom right, its slot the frame's place. It starts over `at`; the scene's frame moves
 * it with the player. */
export const createMinimap = (sceneId: string, at: { x: number; z: number }) => {
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 80);
  // Looking straight down with -z (north) up: its rotation is set once, the frame moves it
  camera.up.set(0, 0, -1);
  camera.position.set(at.x, 40, at.z);
  camera.lookAt(at.x, 0, at.z);
  const viewport = createViewport({
    id: 'exampleGameHudMap',
    scene: existsOrThrow(getRootScene(), 'No root scene'),
    camera,
    anchor: 'BOTTOM_RIGHT',
    slotClass: 'exampleGameHudMinimap',
    transparent: false,
    clearColor: '#1c212b',
    toneMapping: 'RENDERER',
    sceneId,
  });
  return { camera, viewport };
};
// #endregion game-hud-minimap
