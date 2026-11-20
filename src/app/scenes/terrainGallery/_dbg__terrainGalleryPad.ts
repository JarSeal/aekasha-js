// The terrain gallery tab's footprint pad (p310 §2.1 row L): while "Stamp on click" is on, a click
// on the canvas that lands on the pad (`padBlock.ts`) stamps a footprint there, its toe away from
// the camera, into a runtime decal pool (`createDecalPool`, `spawnDecal`) made with the first
// stamp; the Wet switch soaks the gallery so the prints' puddle masks fill. A press that moves
// before its release (a debug camera's drag) stamps nothing.
import * as THREE from 'three/webgpu';
import { getActiveCamera, getMeshByAppId, getRenderer } from 'aekasha';
import { updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import { getSurfaceConditions, setSurfaceConditions } from 'aekasha/surface';
import { createDecalPool, spawnDecal, type DecalPool } from 'aekasha/toolkit/terrain';
import { flyGalleryCamera } from './_dbg__terrainGalleryCamera';
import { getPadBlock, PAD_BLOCK, PAD_BLOCK_ID } from './padBlock';

const FOOTPRINT_CELLS = ['footprintBoot', 'footprintBare', 'footprintPaw', 'footprintSnowBoot'];
const POOL_ID = 'terrainGalleryPadFootprints';
const MAX_FOOTPRINTS = 64;
/** A press that moves farther than this before its release is a drag, CSS px */
const CLICK_SLOP = 4;
/** The weathers the Wet switch sets (the Decals section's dry and wet) */
const DRY = { wetness: 0, puddleLevel: 0, rain: 0 };
const WET = { wetness: 0.6, puddleLevel: 0.6, rain: 0 };

/** The pad's state as the tab's fields bind it (the defaults on every visit) */
const padState = { stamp: false, cell: FOOTPRINT_CELLS[0] };

let pool: DecalPool | null = null;
/** This visit's canvas listeners' remover */
let removeListeners: (() => void) | null = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const forward = new THREE.Vector3();

const getPool = () => {
  if (!pool || pool.isDisposed()) {
    pool = createDecalPool({
      id: POOL_ID,
      material: 'decalsGround_blend',
      atlas: 'decalsGround',
      maxDecals: MAX_FOOTPRINTS,
    });
  }
  return pool;
};

/** Stamps a footprint where a click at the canvas point hits the pad, if it does */
const stampAt = (canvas: HTMLElement, clientX: number, clientY: number) => {
  const block = getPadBlock();
  const mesh = getMeshByAppId(`terrainBlock/${PAD_BLOCK_ID}`);
  const camera = getActiveCamera();
  if (!block || !mesh || !camera) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(mesh, false)[0];
  if (!hit) return;
  camera.getWorldDirection(forward);
  spawnDecal(getPool(), {
    target: block,
    position: { x: hit.point.x, z: hit.point.z },
    // v (the toe) along the camera's heading, as the walk's prints along the walker's
    rotation: Math.atan2(-forward.x, -forward.z),
    cell: padState.cell,
  });
};

/** Listens for clicks on the canvas (a press and a release within the slop) */
const listenForStamps = () => {
  const canvas = getRenderer()?.domElement;
  if (!canvas) return null;
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = e.button === 0 && padState.stamp ? { x: e.clientX, y: e.clientY } : null;
  };
  const onUp = (e: PointerEvent) => {
    if (!down || !padState.stamp) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved <= CLICK_SLOP) stampAt(canvas, e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
  };
};

/**
 * Starts the pad's part of the tab for a visit: the defaults, no pool yet, the canvas listened to
 * @returns the visit's cleanup (the scene's exit): the listeners removed, the pool disposed
 */
export const startPadTab = () => {
  padState.stamp = false;
  padState.cell = FOOTPRINT_CELLS[0];
  pool = null;
  removeListeners?.();
  removeListeners = listenForStamps();
  return () => {
    removeListeners?.();
    removeListeners = null;
    pool?.dispose();
    pool = null;
  };
};

/**
 * The tab's Footprint pad section
 * @param tabId the tab, refreshed after a clear
 * @returns the section
 */
export const getPadSections = (tabId: string): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Footprint pad',
    id: 'terrainGalleryPad',
    content: [
      {
        key: 'stamp',
        target: padState,
        label: 'Stamp on click',
        kind: 'switch',
        hint: 'A click on the pad (wet mud02 in front of the Decals stage) stamps a footprint there, its toe away from the camera (a runtime decal pool; a drag stamps nothing)',
      },
      {
        key: 'cell',
        target: padState,
        label: 'Footprint',
        kind: 'select',
        options: FOOTPRINT_CELLS.map((cell) => ({ label: cell, value: cell })),
      },
      {
        label: 'Wet',
        get: () => (getSurfaceConditions()?.wetness ?? 0) > 0,
        set: (isWet: unknown) => setSurfaceConditions(isWet ? WET : DRY),
        kind: 'switch',
        hint: 'The whole gallery’s weather (the Decals section’s Dry and Wet): wet, the prints’ puddle masks fill',
      },
      {
        label: 'Footprints',
        get: () => `${pool && !pool.isDisposed() ? pool.getDecalCount() : 0} / ${MAX_FOOTPRINTS}`,
        readonly: true,
      },
      {
        type: 'button',
        title: 'Clear',
        onClick: () => {
          pool?.dispose();
          pool = null;
          updateDebuggerTab(tabId);
        },
      },
      {
        type: 'button',
        title: 'Camera to the pad',
        onClick: () =>
          flyGalleryCamera({
            pos: { x: PAD_BLOCK.x, y: 9, z: PAD_BLOCK.z + PAD_BLOCK.size * 0.9 },
            look: { x: PAD_BLOCK.x, y: 0, z: PAD_BLOCK.z },
          }),
      },
    ],
  },
];
