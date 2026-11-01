// The ray testers' pick with the mouse (p806 D11: out of _dbg__RayTester.ts): a one-shot click on
// the scene writes the hit point into a ray's origin or target.
import * as THREE from 'three/webgpu';
import { getCanvasElem } from '../Renderer';
import { createMouseBinding, deleteMouseBinding } from '../../input/MouseInput';
import { collectSceneTargets } from './_dbg__RayTesterFire';
import type { AimedRay, RayTesterKind } from './_dbg__RayTesterState';

/** ORIGIN writes the origin. TARGET writes the target point, or in DIRECTION mode aims the
 * direction at the picked point. */
export type PickField = 'ORIGIN' | 'TARGET';
type ArmedPick = { kind: RayTesterKind; field: PickField; ray: AimedRay; onPicked: () => void };

const PICK_BINDING_ID = 'debugRayTesterPick';
/** At most one pick is armed, across both windows */
let armedPick: ArmedPick | null = null;
let cursorBeforePick = '';
/** Called whenever a kind's armed pick starts or ends (the window's status line) */
let onPickChange: ((kind: RayTesterKind) => void) | null = null;

const scratchVec = new THREE.Vector3();

/** Sets what's called when a kind's pick is armed or ends: the windows' status line. */
export const setPickChangeListener = (listener: (kind: RayTesterKind) => void) => {
  onPickChange = listener;
};

/** The field the kind's armed pick waits for, or null. */
export const getArmedPickField = (kind: RayTesterKind) =>
  armedPick?.kind === kind ? armedPick.field : null;

/**
 * Arms a one-shot pick: the next left click on the scene (not a drag) writes the hit point
 * into the ray. Pressing the same button again cancels it, another pick button re-arms. It
 * picks on the rendered scene (collectSceneTargets), for the physics tester too, and uses the
 * active camera, so it works with the debug camera.
 */
export const togglePick = (
  kind: RayTesterKind,
  field: PickField,
  ray: AimedRay,
  onPicked: () => void
) => {
  const isSame = armedPick?.kind === kind && armedPick.field === field;
  cancelPick();
  if (isSame) return;
  armedPick = { kind, field, ray, onPicked };
  createMouseBinding({
    id: PICK_BINDING_ID,
    type: 'MOUSE_CLICK',
    button: 'LEFT',
    name: 'Ray tester pick',
    targets: collectSceneTargets,
    enabledInDebugCam: 'ENABLED_IN_DEBUG',
    fn: (_e, hit) => completePick(hit.point),
  });
  // Capture phase: while a pick is armed, Esc is the pick's only
  window.addEventListener('keydown', onPickKeyDown, true);
  const canvas = getCanvasElem();
  cursorBeforePick = canvas.style.cursor;
  canvas.style.cursor = 'crosshair';
  onPickChange?.(kind);
};

const completePick = (point: THREE.Vector3) => {
  if (!armedPick) return;
  const { field, ray, onPicked } = armedPick;
  if (field === 'ORIGIN') {
    ray.origin.x = point.x;
    ray.origin.y = point.y;
    ray.origin.z = point.z;
  } else if (ray.aim.mode === 'DIRECTION') {
    const dir = scratchVec.set(point.x, point.y, point.z).sub(ray.origin);
    // Picking the origin itself leaves the direction as it was
    if (dir.lengthSq() > 0) {
      dir.normalize();
      ray.aim.dir.x = dir.x;
      ray.aim.dir.y = dir.y;
      ray.aim.dir.z = dir.z;
    }
  } else {
    ray.aim.point.x = point.x;
    ray.aim.point.y = point.y;
    ray.aim.point.z = point.z;
  }
  cancelPick();
  onPicked();
};

/** Ends the armed pick, if any (a scene enter). */
export const cancelPick = () => {
  if (!armedPick) return;
  const { kind } = armedPick;
  armedPick = null;
  deleteMouseBinding(PICK_BINDING_ID);
  window.removeEventListener('keydown', onPickKeyDown, true);
  getCanvasElem().style.cursor = cursorBeforePick;
  onPickChange?.(kind);
};

/** Ends the kind's armed pick (its window closed or rebuilt). */
export const cancelPickFor = (kind: RayTesterKind) => {
  if (armedPick?.kind === kind) cancelPick();
};

const onPickKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  cancelPick();
};
