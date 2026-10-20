import { lerror, llog } from '../../utils/Logger';
import { existsOrThrow } from '../../utils/Assert';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { getFatLineBackendFactory, loadFatLineBackend } from './LineBackend';
import { retagLineEntity } from './LineEntity';
import { LineObject } from './LineObject';
import { getRegisteredLine, getRegisteredLines, nextLineId, registerLine } from './LineRegistry';
import { installLineTimeSystem } from './LineSystem';
import type { LineProps } from './LineTypes';

export { LineObject } from './LineObject';
export type { LineWriter } from './LineWriter';
export type * from './LineTypes';
export * from './LineBuilders';
export { LINE_PULSE_MAX_COLORS, lineTimeUniform } from './LinePulse';

let isInstalled = false;
const toolsLoggedOff = new Set<string>();

/** The entity side went first (deleted, or its LINE component removed): dispose the line
 * without it trying to take the entity down again. */
const disposeEntityLine = (entityId: number, world: ECSWorld) => {
  const line = getLineForEntity(entityId, world);
  if (!line || line.entityBinding?.world !== world || line.entityBinding.entityId !== entityId) {
    return;
  }
  line.entityBinding = null;
  line.dispose();
};

/**
 * Installs the line core (the `lines()` feature's install, LinesFeature.ts): the per-frame time
 * uniform every pulsing line reads, and the LINE component hooks that dispose an entity's line
 * with it. Without it, {@link createLines} throws.
 * @internal
 */
export const installLines = (ctx: FeatureContext) => {
  installLineTimeSystem(ctx);
  // deleteEntity runs only onDeleteEntity hooks, removeComponent only onRemoveComponent
  ctx.registerComponentHooks(ComponentType.LINE, {
    onDeleteEntity: disposeEntityLine,
    onRemoveComponent: disposeEntityLine,
  });
  isInstalled = true;
};

/**
 * Whether the `lines()` feature is installed, for the engine's debug drawing (ray helpers,
 * collider wireframes, overlays), which checks it before creating a line. When it isn't, logs
 * once per `tool` that the tool is off.
 * @internal
 */
export const isLinesInstalledFor = (tool: string) => {
  if (isInstalled) return true;
  if (!toolsLoggedOff.has(tool)) {
    toolsLoggedOff.add(tool);
    llog(`The ${tool} is off: it needs the lines() feature (aekasha/lines).`);
  }
  return false;
};

/**
 * Creates a line-segment object and attaches it (to the root scene unless `props.attach`
 * says otherwise). The returned handle is plain gameplay API: no ECS world involved. It
 * lives until it is disposed or the scene changes — a scene switch disposes every line
 * that is not `persistent` or owned by an entity (disposeNonPersistentLines).
 *
 * A line wider than 1px needs the thick-line backend, which is loaded on demand: until it
 * arrives the line draws 1px and then upgrades itself. Await `preloadFatLineBackend()`
 * first when the width must be right on the first frame.
 * @example
 * // Build once
 * const outline = createLines({ segments: box3EdgesToSegments(box), color: 0x00ffff });
 *
 * // Refill every frame, allocation-free
 * const trail = createLines({ capacity: 256, growth: 'FIXED' });
 * const w = trail.beginWrite();
 * for (const [a, b] of pairs) w.vec(a, b);
 * trail.endWrite();
 */
export const createLines = (props: LineProps = {}): LineObject => {
  if (!isInstalled) {
    const msg =
      "createLines: the lines feature isn't installed. Add `lines()` (from 'aekasha/lines') to InitEngine's `features`.";
    lerror(msg);
    throw new Error(msg);
  }
  const id = props.id ?? nextLineId();
  if (getRegisteredLine(id)) {
    const msg = `A line with the id "${id}" already exists. Dispose the old line first or pick another id (createLines).`;
    lerror(msg);
    throw new Error(msg);
  }
  const line = new LineObject(id, props);
  registerLine(line);
  return line;
};

/** Returns a live line by id. */
export const getLine = (id: string) => getRegisteredLine(id);

/** Returns every live line. */
export const getAllLines = () => Array.from(getRegisteredLines().values());

/** Disposes every live line, entity-owned and persistent ones included. */
export const disposeAllLines = () => {
  for (const line of getAllLines()) line.dispose();
};

/** Disposes every line that is neither `persistent` nor owned by an entity (those follow
 * their entity: clearNonPersistent deletes it, and its line with it). Runs on every scene
 * switch (the `lines()` feature's `exit` scene hook). */
export const disposeNonPersistentLines = () => {
  for (const line of getAllLines()) {
    if (!line.persistent && !line.entityBinding) line.dispose();
  }
};

// ----------------------------------------------------------------------------
// ECS
// ----------------------------------------------------------------------------

/**
 * Creates a line as an ECS entity, like createMeshEntity/createGroupEntity: its Object3D
 * is the entity's OBJECT3D (tagged TAG_IS_LINE, never TAG_IS_MESH), the ECS transform
 * places it (`props.localTransform` seeds it), deleting the entity disposes the line and
 * disposing the line deletes the entity. A backend swap re-points OBJECT3D at the new
 * Object3D, so read OBJECT3D (or `getLineForEntity(id).object3D`) each time, never cache it.
 * @param props the line's props, as `createLines`'; `entityOpts.appId` is its id when it has none
 * @param entityOpts the entity's options; `doNotAddToScene` attaches the line nowhere
 * @param ecsWorld the entity's world (default: the default world)
 * @returns the entity id
 * @example
 * ```ts
 * import { setTransform } from 'aekasha';
 * import { createLineEntity, polylineToSegments } from 'aekasha/lines';
 *
 * // A ring marker: moved like any entity, deleted with its scene
 * const markerId = createLineEntity({ segments: polylineToSegments(ring, true), color: 0xffcc00 });
 * setTransform(markerId, { pos: { x: 0, y: 0.05, z: 10 } });
 * ```
 */
export const createLineEntity = (
  props: LineProps = {},
  entityOpts?: CoreEntityOpts,
  ecsWorld?: ECSWorld
): number => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in createLineEntity.');
  const line = createLines({
    ...props,
    id: props.id ?? entityOpts?.appId,
    attach: entityOpts?.doNotAddToScene ? { to: 'NONE' } : props.attach ?? { to: 'ROOT_SCENE' },
  });
  const obj = line.object3D;

  const entityId = world.createEntity(entityOpts);
  obj.userData.entityId = entityId;
  line.entityBinding = { world, entityId, ownsEntity: true };
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: obj, _lastVersion: -1 });
  world.addComponent(entityId, ComponentType.LINE, { lineId: line.id });
  retagLineEntity(world, entityId);
  if (entityOpts?.persistent) world.addComponent(entityId, ComponentType.PERSISTENT, true);

  // The ECS transform owns placement from here on, starting where the props put it
  world.setTransform(entityId, {
    pos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    rot: { x: obj.quaternion.x, y: obj.quaternion.y, z: obj.quaternion.z, w: obj.quaternion.w },
  });
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (transform && (obj.scale.x !== 1 || obj.scale.y !== 1 || obj.scale.z !== 1)) {
    transform.scale.copy(obj.scale);
    transform.setDirty();
    world.commitTransform(entityId, transform);
  }

  return entityId;
};

/**
 * Ties an existing line's lifetime to an entity: deleting the entity (or removing its LINE
 * component) disposes the line, disposing the line removes the component. Placement is
 * separate — `line.attach({ to: 'ENTITY', entityId })` parents it to the entity's Object3D.
 * An entity holds at most one line.
 * @param line the line, not disposed and bound to no entity
 * @param entityId an entity without a line
 * @param ecsWorld the entity's world (default: the default world)
 * @example
 * ```ts
 * import { bindLineToEntity, createLines, polylineToSegments } from 'aekasha/lines';
 *
 * // A path drawn under an NPC: it follows the NPC and goes when the NPC is deleted
 * const path = createLines({ segments: polylineToSegments(waypoints), width: 2 });
 * path.attach({ to: 'ENTITY', entityId: npcId });
 * bindLineToEntity(path, npcId);
 * ```
 */
export const bindLineToEntity = (line: LineObject, entityId: number, ecsWorld?: ECSWorld) => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in bindLineToEntity.');
  if (line.isDisposed || line.entityBinding || world.hasComponent(entityId, ComponentType.LINE)) {
    const msg = `Cannot bind line "${line.id}" to entity ${entityId}: the line is disposed or already bound, or the entity already has a line (bindLineToEntity).`;
    lerror(msg);
    throw new Error(msg);
  }
  line.entityBinding = { world, entityId, ownsEntity: false };
  world.addComponent(entityId, ComponentType.LINE, { lineId: line.id });
};

/** Returns the line an entity holds (createLineEntity/bindLineToEntity), if any. */
export const getLineForEntity = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  const lineId = world?.getComponent(entityId, ComponentType.LINE)?.lineId;
  return lineId === undefined ? undefined : getRegisteredLine(lineId);
};

/**
 * Loads the thick-line (FAT) backend, which draws lines wider than 1px. It lives in its own
 * chunk so an app that only draws 1px lines never downloads it — which also means a width
 * above 1px can never be honoured synchronously. Lines created before it has loaded draw
 * 1px and upgrade themselves when it arrives; await this first to avoid that.
 * @returns (Promise<boolean>) whether the backend is available
 */
export const preloadFatLineBackend = () => loadFatLineBackend();

/** Whether the thick-line backend has loaded (new wide lines are then created thick). */
export const isFatLineBackendAvailable = () => getFatLineBackendFactory() !== null;
