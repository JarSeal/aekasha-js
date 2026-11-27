// p392 D1: a text's tie to an ECS entity, as lines' LineEntity.ts. A text entity
// (createTextEntity) is a plain Object3D the entity's transform places, which the text follows:
// the text itself is drawn by its batch, never in the scene graph.
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';

/**
 * A text's tie to an ECS entity. `ownsEntity` is true when the text IS the entity
 * (`createTextEntity`: its Object3D is the entity's `OBJECT3D`, which the text is attached to):
 * disposing the text then deletes the entity and takes the Object3D out of the scene. Otherwise
 * the entity only owns the text's lifetime (`bindTextToEntity`).
 * @internal
 */
export type TextEntityBinding = { world: ECSWorld; entityId: number; ownsEntity: boolean };

/**
 * Takes a text entity's Object3D out of its parent: a plain Object3D entity's deletion doesn't
 * (a mesh's and a group's do), and a text entity's object is one.
 * @internal
 */
export const detachTextEntityObject = (world: ECSWorld, entityId: number) => {
  world.getComponent(entityId, ComponentType.OBJECT3D)?.value.removeFromParent();
};

/**
 * A bound text was disposed by its owner: take the entity side down too. (When the entity goes
 * first, the `TEXT` hooks (Texts.ts) clear the binding before disposing.)
 * @internal
 */
export const releaseTextEntity = ({ world, entityId, ownsEntity }: TextEntityBinding) => {
  if (!world.isAlive(entityId)) return;
  if (ownsEntity) {
    detachTextEntityObject(world, entityId);
    world.deleteEntity(entityId);
  } else {
    world.removeComponent(entityId, ComponentType.TEXT);
  }
};
