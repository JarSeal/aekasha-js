import * as THREE from 'three/webgpu';
import { ComponentType, ECSSystemStage, ECSWorld, getActiveCamera, getCanvasSize } from 'aekasha';
import type { Compass, WorldAnchor, WorldAnchorLayer, WorldAnchorView } from 'aekasha/ui';

/**
 * The world anchor sync's component key: add {@link WorldAnchorData} under
 * `WorldAnchorComponentType.WORLD_ANCHOR` to an entity to keep an anchor of a
 * `WorldAnchorLayer` on it.
 */
export enum WorldAnchorComponentType {
  /** An entity a world anchor follows ({@link WorldAnchorData}). */
  WORLD_ANCHOR = 'TOOL_WORLD_ANCHOR',
}

/**
 * An entity's world anchor: every frame its `OBJECT3D`'s world position (the rendered pose,
 * interpolated) is the anchor's, raised by `offsetY`. Removing the component or deleting the
 * entity removes the anchor from its layer.
 */
export interface WorldAnchorData {
  /** The anchor (`layer.addAnchor(…)`); its layer is the one `registerWorldAnchorSync` updates. */
  anchor: WorldAnchor;
  /** Raises the anchor above the entity's origin, in world units (a nameplate over a head);
   * default 0. */
  offsetY?: number;
}

declare module 'aekasha' {
  interface ComponentDataMap {
    [WorldAnchorComponentType.WORLD_ANCHOR]: WorldAnchorData;
  }
}

/** What {@link registerWorldAnchorSync} updates, and from what. */
export interface WorldAnchorSyncOptions {
  /** The layer the entities' anchors are in: its `update` runs once a frame after their
   * positions. */
  layer: WorldAnchorLayer;
  /** A compass turned to the camera's heading each frame (north is -z, east +x). */
  compass?: Compass;
  /** The camera to project with (default `getActiveCamera`); a frame it returns none in updates
   * nothing. */
  camera?: () => THREE.Camera | undefined;
  /** The size the camera renders into, in CSS px (default `getCanvasSize`; an `'inline'` layer's
   * box gives its own). */
  size?: () => { width: number; height: number };
}

type SyncState = {
  options: WorldAnchorSyncOptions;
  view: WorldAnchorView;
  viewProjection: THREE.Matrix4;
};

const SYSTEM_ID = 'worldAnchorSync';
const syncs = new WeakMap<ECSWorld, SyncState>();
let hasHooks = false;

const removeAnchor = (entityId: number, world: ECSWorld) => {
  world.getComponent(entityId, WorldAnchorComponentType.WORLD_ANCHOR)?.anchor.remove();
};

/**
 * A direction's compass bearing in radians, clockwise from north, where north is -z and east +x
 * (the compass's and the minimap frame's unit): `getCompassBearing(target.x - player.x,
 * target.z - player.z)` is a waypoint's marker bearing.
 * @param dx The direction's x (east)
 * @param dz The direction's z (south)
 * @returns The bearing in (-π, π]; 0 for no direction
 */
export const getCompassBearing = (dx: number, dz: number) => Math.atan2(dx, -dz);

/** The camera's heading: its forward direction's bearing, or its up's when it looks straight
 * down (a top-down camera's screen up) */
const getCameraHeading = (camera: THREE.Camera) => {
  const e = camera.matrixWorld.elements;
  const forwardX = -e[8];
  const forwardZ = -e[10];
  if (forwardX * forwardX + forwardZ * forwardZ > 1e-12) {
    return getCompassBearing(forwardX, forwardZ);
  }
  return getCompassBearing(e[4], e[6]);
};

const syncWorld = (world: ECSWorld) => {
  const state = syncs.get(world);
  if (!state) return;
  const { options, view, viewProjection } = state;
  const camera = (options.camera ?? getActiveCamera)();
  if (!camera) return;

  const objects = world.getStorage(ComponentType.OBJECT3D);
  for (const [entityId, data] of world.getStorage(WorldAnchorComponentType.WORLD_ANCHOR)) {
    const object = objects.get(entityId)?.value;
    if (!object) continue;
    const e = object.matrixWorld.elements;
    data.anchor.setPosition(e[12], e[13] + (data.offsetY ?? 0), e[14]);
  }

  // The render has updated the camera's matrices (this runs after it)
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const cameraMatrix = camera.matrixWorld.elements;
  view.cameraPosition.x = cameraMatrix[12];
  view.cameraPosition.y = cameraMatrix[13];
  view.cameraPosition.z = cameraMatrix[14];
  const size = (options.size ?? getCanvasSize)();
  view.width = size.width;
  view.height = size.height;
  options.layer.update(view);
  options.compass?.setHeading(getCameraHeading(camera));
};

/**
 * Registers the world anchor sync on `world` (p808 D7): one `LATE_MAIN` system (after the render
 * has updated every matrix, and while the app is paused too: a paused fly camera still moves the
 * labels) that moves each `WORLD_ANCHOR` entity's anchor to its `OBJECT3D`'s world position, then
 * projects the layer's anchors with the camera, and turns the compass. An entity without an
 * `OBJECT3D` leaves its anchor where it was. Removing the component or deleting the entity
 * removes its anchor (the component's hooks, added on the first call). A second call on the same
 * world replaces its options (a scene's new layer).
 * @returns The world, for chaining
 * @example
 * ```ts
 * import { createWorldAnchorLayer, createCompass, getHUDRootCMP } from 'aekasha/ui';
 *
 * const layer = createWorldAnchorLayer({ cullDistance: 40 });
 * const compass = createCompass();
 * getHUDRootCMP().add(layer.cmp);
 * getHUDRootCMP().add(compass.cmp);
 * const world = getECSWorld();
 * registerWorldAnchorSync(world, { layer, compass });
 *
 * // A nameplate over an NPC's head: removed with the NPC
 * world.addComponent(npcEntityId, WorldAnchorComponentType.WORLD_ANCHOR, {
 *   anchor: layer.addAnchor({ content: 'Mara', align: 'above' }),
 *   offsetY: 2,
 * });
 * ```
 */
export const registerWorldAnchorSync = (world: ECSWorld, options: WorldAnchorSyncOptions) => {
  if (!hasHooks) {
    hasHooks = true;
    // deleteEntity runs only onDeleteEntity hooks, removeComponent only onRemoveComponent
    ECSWorld.registerComponentHooks(WorldAnchorComponentType.WORLD_ANCHOR, {
      onDeleteEntity: removeAnchor,
      onRemoveComponent: removeAnchor,
    });
  }
  const state = syncs.get(world);
  if (state) {
    state.options = options;
    return world;
  }
  const viewProjection = new THREE.Matrix4();
  syncs.set(world, {
    options,
    // Kept and written in place each frame; it reads the matrix's elements as they are
    view: {
      viewProjection: viewProjection.elements,
      width: 0,
      height: 0,
      cameraPosition: { x: 0, y: 0, z: 0 },
    },
    viewProjection,
  });
  world.addSystem(ECSSystemStage.LATE_MAIN, SYSTEM_ID, syncWorld);
  return world;
};

/**
 * Removes the world anchor sync from `world`: the anchors stay where they were, and the
 * components stay (their hooks still remove an anchor with its entity).
 * @returns The world, for chaining
 */
export const unregisterWorldAnchorSync = (world: ECSWorld) => {
  syncs.delete(world);
  world.removeSystem(SYSTEM_ID);
  return world;
};
