// p392 D1: the texts' API and the `text()` feature's install of them (the fonts' is Fonts.ts').
import * as THREE from 'three/webgpu';
import { lerror } from '../../utils/Logger';
import { existsOrThrow } from '../../utils/Assert';
import type { CreateEntityOpts } from '../../kernel/ecs/ECSHelpers';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { getRootScene } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { detachTextEntityObject } from './TextEntity';
import { TextObject } from './TextObject';
import { getRegisteredText, getRegisteredTexts, nextTextId, registerText } from './TextRegistry';
import type { TextEntityProps, TextProps } from './TextTypes';

let isInstalled = false;

/**
 * Creates a text in the 3D world: a string in a loaded font, laid out and drawn before the next
 * frame, sized in metres or CSS pixels and lying in its plane or facing the camera. The handle
 * is plain gameplay API, no ECS world involved; it lives until it's disposed or the scene
 * changes (a scene switch disposes every text neither `persistent` nor bound to an entity).
 * @param props the string, its font (loaded: the scene's `fonts`, or `loadFontAsync` first), its
 *   look, layout and place
 * @returns the text's handle: its setters change it in place
 * @example
 * ```ts
 * import { createText } from 'aekasha/text';
 *
 * // A sign 2 m up, its first line's baseline centred there
 * const sign = createText({
 *   text: 'North gate',
 *   font: 'plexSans',
 *   size: 0.4,
 *   anchor: 'BASELINE_CENTER',
 *   position: { x: 0, y: 2, z: -5 },
 * });
 * sign.setText('North gate (closed)');
 * sign.setColor('#ff6644');
 * ```
 */
export const createText = (props: TextProps): TextObject => {
  if (!isInstalled) {
    const msg =
      "createText: the text feature isn't installed. Add `text()` (from 'aekasha/text') to InitEngine's `features`.";
    lerror(msg);
    throw new Error(msg);
  }
  const id = props.id ?? nextTextId();
  if (getRegisteredText(id)) {
    const msg = `A text with the id "${id}" already exists. Dispose the old text first or pick another id (createText).`;
    lerror(msg);
    throw new Error(msg);
  }
  const text = new TextObject(id, props);
  registerText(text);
  return text;
};

/**
 * A live text by id.
 * @param id the text's id (`TextProps.id`, or the generated `text_<n>`)
 * @returns the text, or undefined when none has the id
 */
export const getText = (id: string) => getRegisteredText(id);

/**
 * Disposes every text that is neither `persistent` nor bound to an entity (those follow their
 * entity: the world's clear deletes a non-persistent one, and its text with it). Runs on every
 * scene switch (the `text()` feature's `exit` scene hook).
 * @internal
 */
export const disposeNonPersistentTexts = () => {
  for (const text of Array.from(getRegisteredTexts().values())) {
    if (!text.persistent && !text.entityBinding) text.dispose();
  }
};

// ----------------------------------------------------------------------------
// ECS
// ----------------------------------------------------------------------------

/**
 * Creates a text as an ECS entity: the entity's `OBJECT3D` is an empty Object3D its transform
 * places (and parenting moves), which the text follows; the props' `position`, `rotation` or
 * `quaternion` and `scale` are the transform's start. Deleting the entity disposes the text, and
 * disposing the text deletes the entity. The entity's options' `persistent` keeps both across
 * scene switches, and their `appId` is the text's id when the props have none.
 * @param props the text's props, as `createText`'s (no `attach`: the entity places it)
 * @param opts the entity's options (`doNotAddToScene` adds its Object3D nowhere) and its world
 *   (default: the default world)
 * @returns the entity id
 * @example
 * ```ts
 * import { setTransform } from 'aekasha';
 * import { createTextEntity } from 'aekasha/text';
 *
 * // An exit sign: moved like any entity, deleted with its scene
 * const signId = createTextEntity(
 *   { text: 'EXIT', font: 'plexSans', size: 0.3, color: '#33ff66' },
 *   { appId: 'exitSign' }
 * );
 * setTransform(signId, { pos: { x: 4, y: 2.5, z: -10 } });
 * ```
 */
export const createTextEntity = (props: TextEntityProps, opts?: CreateEntityOpts): number => {
  const { world: ecsWorld, ...entityOpts } = opts ?? {};
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in createTextEntity.');
  const rootScene = entityOpts.doNotAddToScene
    ? null
    : existsOrThrow(getRootScene(), 'Could not find root scene in createTextEntity.');

  const { position, rotation, quaternion, scale, ...textProps } = props;
  const obj = new THREE.Object3D();
  if (position) obj.position.copy(position);
  if (quaternion) {
    obj.quaternion.copy(quaternion);
  } else if (rotation) {
    obj.rotation.set(rotation.x, rotation.y, rotation.z);
  }
  if (scale) obj.scale.copy(scale);

  // Throws for an unloaded font or a taken id before the entity exists
  const text = createText({
    ...textProps,
    id: props.id ?? entityOpts.appId,
    persistent: entityOpts.persistent ?? false,
    attach: { to: 'OBJECT3D', object3D: obj },
  });
  obj.name = text.name;
  obj.userData.textId = text.id;
  rootScene?.add(obj);

  const entityId = world.createEntity(entityOpts);
  obj.userData.entityId = entityId;
  text.entityBinding = { world, entityId, ownsEntity: true };
  world.addComponent(entityId, ComponentType.OBJECT3D, { value: obj, _lastVersion: -1 });
  world.addComponent(entityId, ComponentType.TEXT, { textId: text.id });

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
 * Ties an existing text's lifetime to an entity: deleting the entity (or removing its `TEXT`
 * component) disposes the text, disposing the text removes the component. Placement is separate:
 * `text.attach({ to: 'ENTITY', entityId })` makes it follow the entity. An entity holds at most
 * one text.
 * @param text the text, not disposed and bound to no entity
 * @param entityId an entity without a text
 * @param ecsWorld the entity's world (default: the default world)
 * @example
 * ```ts
 * import { bindTextToEntity, createText } from 'aekasha/text';
 *
 * // A nameplate over an NPC's head: it follows the NPC and goes when the NPC is deleted
 * const plate = createText({ text: 'Mira', font: 'plexSans', size: 0.25, orientation: 'BILLBOARD_Y' });
 * plate.attach({ to: 'ENTITY', entityId: npcId });
 * plate.setLocalTransform({ position: { x: 0, y: 2.1, z: 0 } });
 * bindTextToEntity(plate, npcId);
 * ```
 */
export const bindTextToEntity = (text: TextObject, entityId: number, ecsWorld?: ECSWorld) => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in bindTextToEntity.');
  if (
    text.isDisposed ||
    text.entityBinding ||
    !world.isAlive(entityId) ||
    world.hasComponent(entityId, ComponentType.TEXT)
  ) {
    const msg = `Cannot bind text "${text.id}" to entity ${entityId}: the text is disposed or already bound, or the entity is gone or already has a text (bindTextToEntity).`;
    lerror(msg);
    throw new Error(msg);
  }
  text.entityBinding = { world, entityId, ownsEntity: false };
  world.addComponent(entityId, ComponentType.TEXT, { textId: text.id });
};

/**
 * The text an entity holds (`createTextEntity`, `bindTextToEntity`).
 * @param entityId a text entity, or one a text is bound to
 * @param ecsWorld the entity's world (default: the default world)
 * @returns the text, or undefined when the entity holds none
 */
export const getTextForEntity = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  const textId = world?.getComponent(entityId, ComponentType.TEXT)?.textId;
  return textId === undefined ? undefined : getRegisteredText(textId);
};

/** The entity side went first (deleted, or its `TEXT` component removed): dispose the text
 * without it trying to take the entity down again */
const disposeEntityText = (entityId: number, world: ECSWorld) => {
  const text = getTextForEntity(entityId, world);
  const binding = text?.entityBinding;
  if (!text || binding?.world !== world || binding.entityId !== entityId) return;
  text.entityBinding = null;
  if (binding.ownsEntity) detachTextEntityObject(world, entityId);
  text.dispose();
};

/** The texts' part of a scene load: the previous scene's texts go, except the `persistent` ones
 * and those an entity owns (they go with their entity) */
const textsSceneHooks: SceneHooks = {
  exit: () => disposeNonPersistentTexts(),
};

/**
 * Installs the texts (the `text()` feature's install, TextFeature.ts): the scene exit's disposal
 * and the `TEXT` component hooks that dispose an entity's text with it. Without it,
 * {@link createText} throws.
 * @internal
 */
export const installTexts = (ctx: FeatureContext) => {
  ctx.addSceneHooks(textsSceneHooks);
  // deleteEntity runs only onDeleteEntity hooks, removeComponent only onRemoveComponent
  ctx.registerComponentHooks(ComponentType.TEXT, {
    onDeleteEntity: disposeEntityText,
    onRemoveComponent: disposeEntityText,
  });
  isInstalled = true;
};
