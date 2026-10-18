import * as THREE from 'three/webgpu';
import type {
  ComponentData,
  ECSPosition,
  ECSRotation,
  ECSTransformProp,
} from './ECSCoreComponents';
import { ComponentType, Transform } from './ECSCoreComponents';
import { existsOrThrow } from '../../utils/Assert';
import type { RigidBodyAPI } from '../../features/physics/types/PhysicsBodyTypes';
import { getConfig, IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../config/Config';
import type { ECSStorageMode, IComponentStorage } from './ECSComponentStorage';
import { getECSStorageLSOverride } from './ECSComponentStorage';
import { TypedArrayTransformStore } from './TypedArrayTransformStore';
import { ECSSystemStage } from '../loop/SystemStages';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import { loadDebugModuleAsync, useDebug, type DebugModuleRef } from '../config/DebugModules';
import { lerror, lwarn } from '../../utils/Logger';

/**
 * A system: run by its world once per frame in its stage (or once per fixed physics step in
 * `APP_PHYSICS_STEP`), with the stage's delta in seconds. See {@link ECSWorld.addSystem}.
 */
export type ECSSystem = (world: ECSWorld, dt: number) => void;

type SystemEntry = { id: string; fn: ECSSystem; order: number; seq: number };

/**
 * Sets up a world, usually by adding its systems: run on every existing world when registered and
 * on every world created later (see {@link ECSWorld.registerPlugin}).
 */
export type WorldPlugin = (world: ECSWorld) => void;
/** A component hook (see {@link ECSWorld.registerComponentHooks}), called with the entity and its world. */
export type ComponentHook = (entityId: number, world: ECSWorld) => void;
/** See {@link ECSWorld.registerTransformResetListener}. */
export type TransformResetListener = (world: ECSWorld, entityId: number) => void;

/** The default world's id: `getECSWorld()` without an id returns it. */
export const DEFAULT_ECS_WORLD_ID = '[default]';

/** {@link ECSWorld}'s options. */
export type ECSWorldOptions = {
  /** Defaults to DEFAULT_ECS_WORLD_ID. Must be unique among live worlds — the identity/lookup key. */
  id?: string;
  /** Debug-only display name. Defaults to `id` if omitted. Not required to be unique. */
  name?: string;
  /** Debug-only free-text description, shown in the ECS debug tab's Worlds listing. */
  description?: string;
  /** The `TRANSFORM` storage's backend ({@link ECSStorageMode}). Default `'MAP'`. */
  storageMode?: ECSStorageMode;
  /** The most entities the world holds at once (creating one more throws). Default 100,000. */
  maxEntities?: number;
  /** Whether globally registered plugins (ECSWorld.registerPlugin) run on this world. Default true. */
  applyGlobalPlugins?: boolean;
};

let ecsWorld: ECSWorld;

/**
 * Creates the default ECS World from `AppConfig.ecs` (and, in the debug env, the ECS tab's saved
 * storage override). `InitEngine` calls it.
 * @internal
 */
export const initECSWorld = (): ECSWorld => {
  const ecsConfig = getConfig().ecs;
  let storageMode: ECSStorageMode = ecsConfig?.storageMode ?? 'MAP';
  let maxEntities = ecsConfig?.maxEntities ?? 100_000;
  if (IS_DEBUG_ENV) {
    const lsOverride = getECSStorageLSOverride(DEFAULT_ECS_WORLD_ID);
    if (lsOverride?.storageMode) storageMode = lsOverride.storageMode;
    if (lsOverride?.maxEntities) maxEntities = lsOverride.maxEntities;
  }
  ecsWorld = new ECSWorld({ storageMode, maxEntities });
  return ecsWorld;
};

/** Returns the ECS World for `id` (defaults to the default world) or throws an error. */
export const getECSWorld = (id: string = DEFAULT_ECS_WORLD_ID): ECSWorld =>
  existsOrThrow(
    ECSWorld.getWorld(id),
    `ECS World '${id}' not initialized. Could not get ECS World.`
  );

/**
 * Returns every currently registered ECS World. The array is shared and read-only (no copy: the
 * main loop reads it several times a frame); creating or deleting a world replaces it, so
 * iterating it while deleting worlds is safe.
 */
export const getAllECSWorlds = (): readonly ECSWorld[] => ECSWorld.getAllWorlds();

/**
 * Deletes an ECS World by id. Routes every live entity through deleteEntity
 * so onDeleteEntity hooks still run (mesh/light/camera disposal, physics
 * body cleanup, etc.) instead of a bulk wipe that would skip them.
 * Returns false if no world with that id exists.
 */
export const deleteECSWorld = (id: string): boolean => ECSWorld.deleteWorld(id);

/**
 * Subscribes to world creation/deletion (not entity or component changes —
 * see `onECSEntityCountChange` and `ECSWorld.registerComponentHooks` for
 * those). Used by debug tooling (the ECS debug tab's live world list) to
 * know when to refresh; nothing else in the engine needs this today.
 */
export const onECSWorldRegistryChange = (listener: () => void): void =>
  ECSWorld.onWorldRegistryChange(listener);

/**
 * Subscribes to entity creation/deletion in ANY world (the listener
 * receives which one). Fires from `createRawEntity`/`createEntity`/
 * `deleteEntity` — note `createRawEntity` adds no components, so this is
 * the only reliable way to observe "this world's entity count changed",
 * `registerComponentHooks` would silently miss raw entities entirely.
 * Debug-tooling-only today (the ECS debug tab's live entity counts); fires
 * unconditionally regardless of `IS_DEBUG_ENV` (an empty listener array in
 * production, so the cost is one no-op `.forEach()` per entity op) rather
 * than adding a branch to every entity-creation/deletion call site.
 */
export const onECSEntityCountChange = (listener: (world: ECSWorld) => void): void =>
  ECSWorld.onEntityCountChange(listener);

/**
 * An ECS world: entities (packed numeric ids), their components (one storage per component type)
 * and the systems that run on them, stage by stage, every frame. The engine creates the default
 * world (`getECSWorld()`); a scene or tool can create more with an `id` of its own.
 *
 * Plugins, component hooks and transform reset listeners are static: registered once (in a
 * feature's `install`, through its `FeatureContext`), they apply to every world.
 * @remarks An entity id is only unique within its world, and after a slot was reused 4096 times
 * the same id comes back (its 12-bit generation wraps): don't keep ids of deleted entities.
 * @example
 * ```ts
 * import { ComponentType, ECSSystemStage, getECSWorld } from 'aekasha';
 *
 * const world = getECSWorld();
 * const crateId = world.createEntity({ appId: 'crate' });
 * world.setTransform(crateId, { pos: { x: 0, y: 2, z: 0 } });
 * // Slides the crate along x at one unit per second
 * world.addSystem(ECSSystemStage.APP_LOGIC, 'crateSlide', (w, dt) => {
 *   const transform = w.getComponent(crateId, ComponentType.TRANSFORM);
 *   if (!transform) return;
 *   transform.position.x += dt;
 *   transform.setDirty();
 *   w.commitTransform(crateId, transform);
 * });
 * ```
 */
export class ECSWorld {
  // INSTANCE TRACKING (keyed by world id — also the identity/lookup registry)
  private static worldsById: Map<string, ECSWorld> = new Map();
  // worldsById's values, rebuilt (a new array) whenever a world is created or deleted
  private static worldList: readonly ECSWorld[] = [];
  private static worldRegistryListeners: (() => void)[] = [];
  private static entityCountListeners: ((world: ECSWorld) => void)[] = [];
  // STATIC REGISTRIES (External core managers write to these)
  // `corePlugins` are universal engine plumbing (e.g. the ECSCoreSystems.ts
  // object3D/physics/lookAt sync) that every world needs regardless of
  // `applyGlobalPlugins` — without them a world's entities never visually
  // update. `plugins` are app/feature systems (light culling, hover/follow
  // tool effects, etc.) that a bare world can legitimately opt out of.
  private static corePlugins: WorldPlugin[] = [];
  private static plugins: WorldPlugin[] = [];
  private static onAddComponentHooks: Map<ComponentType, ComponentHook[]> = new Map();
  private static onRemoveComponentHooks: Map<ComponentType, ComponentHook[]> = new Map();
  private static onDeleteEntityHooks: Map<ComponentType, ComponentHook[]> = new Map();
  private static transformResetListeners: TransformResetListener[] = [];

  /**
   * Runs `plugin` on every world that applies the global plugins: the existing ones now, and
   * every later one when it's created (right after the core plugins).
   * @remarks Call it from an install (`FeatureContext.registerPlugin`), never at module load.
   * There is no unregister: a plugin applies for the rest of the page load.
   */
  public static registerPlugin(plugin: WorldPlugin) {
    // Save for future worlds (Cold Loading, if the world has not been initiated yet)
    this.plugins.push(plugin);

    // Apply to existing worlds immediately (Hot Loading, if the world is already initiated),
    // skipping worlds that opted out via applyGlobalPlugins: false.
    this.worldsById.forEach((world) => {
      if (world.applyGlobalPlugins) plugin(world);
    });
  }

  /**
   * Like `registerPlugin`, but always applies to every world — current and
   * future — regardless of `applyGlobalPlugins`. Reserved for universal
   * engine plumbing (see ECSCoreSystems.ts) that every world needs to
   * function correctly; app/feature systems should use `registerPlugin`.
   */
  public static registerCorePlugin(plugin: WorldPlugin) {
    this.corePlugins.push(plugin);
    this.worldsById.forEach((world) => {
      plugin(world);
    });
  }

  /** Returns the ECS World registered under `id`, or undefined if none exists. */
  public static getWorld(id: string): ECSWorld | undefined {
    return this.worldsById.get(id);
  }

  /** Returns every currently registered ECS World (shared and read-only, see `getAllECSWorlds`). */
  public static getAllWorlds(): readonly ECSWorld[] {
    return this.worldList;
  }

  /**
   * Deletes an ECS World by id. Every live entity goes through `deleteEntity` first
   * ({@link ECSWorld.clearWorld}), so the onDeleteEntity hooks run (mesh, light and camera
   * disposal, physics body cleanup).
   * Returns false if no world with that id exists.
   */
  public static deleteWorld(id: string): boolean {
    const world = this.worldsById.get(id);
    if (!world) return false;
    world.clearWorld();
    this.worldsById.delete(id);
    this.worldList = Array.from(this.worldsById.values());
    this.notifyWorldRegistryChange();
    return true;
  }

  /** See the module-level `onECSWorldRegistryChange` export. */
  public static onWorldRegistryChange(listener: () => void): void {
    this.worldRegistryListeners.push(listener);
  }

  private static notifyWorldRegistryChange(): void {
    this.worldRegistryListeners.forEach((listener) => listener());
  }

  /** See the module-level `onECSEntityCountChange` export. */
  public static onEntityCountChange(listener: (world: ECSWorld) => void): void {
    this.entityCountListeners.push(listener);
  }

  private static notifyEntityCountChange(world: ECSWorld): void {
    this.entityCountListeners.forEach((listener) => listener(world));
  }

  /**
   * Adds hooks for a component type, in every world: `onAddComponent` after the component is
   * stored (every add, a replacement included), `onRemoveComponent` before an entity's component is
   * removed (it can still read it), `onDeleteEntity` before a deleted entity's components are
   * cleared, for each type it has. Hooks of one type run in registration order.
   * @remarks `deleteEntity` runs only the `onDeleteEntity` hooks and `removeComponent` only the
   * `onRemoveComponent` ones: a resource the component owns needs both to be released. Call it from
   * an install (`FeatureContext.registerComponentHooks`), never at module load.
   */
  public static registerComponentHooks(
    type: ComponentType,
    hooks: {
      onAddComponent?: ComponentHook;
      onRemoveComponent?: ComponentHook;
      onDeleteEntity?: ComponentHook;
    }
  ) {
    if (hooks.onAddComponent) {
      if (!this.onAddComponentHooks.has(type)) this.onAddComponentHooks.set(type, []);
      this.onAddComponentHooks.get(type)!.push(hooks.onAddComponent);
    }
    if (hooks.onRemoveComponent) {
      if (!this.onRemoveComponentHooks.has(type)) this.onRemoveComponentHooks.set(type, []);
      this.onRemoveComponentHooks.get(type)!.push(hooks.onRemoveComponent);
    }
    if (hooks.onDeleteEntity) {
      if (!this.onDeleteEntityHooks.has(type)) this.onDeleteEntityHooks.set(type, []);
      this.onDeleteEntityHooks.get(type)!.push(hooks.onDeleteEntity);
    }
  }

  /**
   * Registers a listener fired whenever setTransform (and so teleport) explicitly moves or
   * rotates an entity, after its rigid body and TRANSFORM have been updated. That is a pose
   * discontinuity: anything holding pose history (e.g. physics' render interpolation)
   * must not smooth across it. Static like registerComponentHooks, so it covers every world —
   * and lets such managers react without ECS importing them back.
   */
  public static registerTransformResetListener(listener: TransformResetListener) {
    this.transformResetListeners.push(listener);
  }

  // Bitwise constants for generation usage:
  // We use 20 bits for the index (~1 million entities)
  // and 12 bits for the generation (4096 reuses per slot)
  private readonly INDEX_MASK = 0xfffff;
  private readonly GEN_MASK = 0xfff;
  private readonly GEN_SHIFT = 20;
  // Tracks the current 'version' of every index ever created. Sized to
  // `maxEntities` (capped at the full 20-bit index space), not the full
  // 1,048,576-slot address space the packed-id scheme could support — a
  // world with a small maxEntities (e.g. a bare secondary world) shouldn't
  // pay for the ~4 MiB a full-size array would cost regardless of how many
  // entities it actually ever holds. Allocated in the constructor, after
  // `maxEntities` is known.
  private generations: Uint32Array;

  private nextEntityId = 1;
  private freeIds: number[] = [];
  private entities = new Set<number>();

  // One storage per component type, read back typed by _getStorageOf
  private storages: Map<ComponentType, IComponentStorage<unknown>> = new Map();

  // The APP_ID lookup (getEntityIdByAppId): an app id's first entity still alive. The ids more
  // than one entity took, so deleting the holder looks for the next one only for those.
  private entityIdsByAppId = new Map<string, number>();
  private duplicatedAppIds = new Set<string>();

  // The removals whose hooks are running (entity and type, pairwise): a hook that removes the same
  // component again (two entities whose links point at each other) doesn't run them twice
  private removingIds: number[] = [];
  private removingTypes: ComponentType[] = [];

  private systems: Map<ECSSystemStage, SystemEntry[]> = new Map();
  private systemSeq = 0;

  /** The storage backend chosen at creation ({@link ECSStorageMode}): `TYPED_ARRAY` applies to
   * `TRANSFORM` only, every other component type is Map-backed either way. */
  public readonly storageMode: ECSStorageMode;
  /** The most entities this world holds at once. */
  public readonly maxEntities: number;

  /** The world's unique id, its lookup key ({@link getECSWorld}). */
  public readonly id: string;
  /** Debug-only — never used for lookup/equality, purely a nicer label in the debug tab. */
  public readonly name: string;
  /** Debug-only — shown alongside `name` in the debug tab, omitted if not given. */
  public readonly description?: string;
  private readonly applyGlobalPlugins: boolean;

  /**
   * Creates and registers a world, then runs the core plugins on it and, unless
   * `applyGlobalPlugins` is false, the plugins. Throws when a live world has the id (without an
   * `id`, the default world's).
   */
  constructor(opts?: ECSWorldOptions) {
    const id = opts?.id ?? DEFAULT_ECS_WORLD_ID;
    if (ECSWorld.worldsById.has(id)) {
      const msg =
        id === DEFAULT_ECS_WORLD_ID
          ? 'Default ECS World already exists. Pass an explicit `id` to create an additional world.'
          : `ECS World with id '${id}' already exists.`;
      lerror(msg);
      throw new Error(msg);
    }

    this.id = id;
    this.name = opts?.name ?? id;
    this.description = opts?.description;
    this.applyGlobalPlugins = opts?.applyGlobalPlugins ?? true;

    // Debug-tab storage overrides (per world id, see ECSComponentStorage.ts)
    // only fill in a field the caller left unset — they never clobber an
    // explicit opts.storageMode/opts.maxEntities. initECSWorld() already
    // resolves its own Config+LS-override precedence for the default world
    // before ever calling this constructor, so this only matters for
    // secondary worlds that leave these fields unset.
    const lsOverride = IS_DEBUG_ENV ? getECSStorageLSOverride(id) : undefined;
    this.storageMode = opts?.storageMode ?? lsOverride?.storageMode ?? 'MAP';
    this.maxEntities = opts?.maxEntities ?? lsOverride?.maxEntities ?? 100_000;
    this.generations = new Uint32Array(Math.min(this.maxEntities, this.INDEX_MASK + 1));

    // Pre-allocate system stages and storages
    Object.values(ECSSystemStage).forEach((s) => this.systems.set(s, []));
    Object.values(ComponentType).forEach((type) => {
      if (type === ComponentType.TRANSFORM && this.storageMode === 'TYPED_ARRAY') {
        this.storages.set(
          type,
          new TypedArrayTransformStore(this.maxEntities, (id) => this.getEntityIndex(id))
        );
      } else {
        this.storages.set(type, new Map());
      }
    });

    // REGISTER THIS INSTANCE
    ECSWorld.worldsById.set(id, this);
    ECSWorld.worldList = Array.from(ECSWorld.worldsById.values());

    // BOOTSTRAP: core plugins (universal engine plumbing) always run, first,
    // regardless of applyGlobalPlugins — see the corePlugins field comment.
    ECSWorld.corePlugins.forEach((plugin) => plugin(this));

    // Then run app/feature plugins, unless this world opted out via
    // applyGlobalPlugins: false.
    if (this.applyGlobalPlugins) {
      ECSWorld.plugins.forEach((plugin) => plugin(this));
    }

    ECSWorld.notifyWorldRegistryChange();
  }

  /**
   * Registers a system function to run every frame during `stage`.
   *
   * Ordering contract:
   * - Within a stage, systems run in descending `order` — higher runs earlier.
   * - Equal `order` (the default, 0) runs in registration order: the order
   *   `addSystem` was actually called, not source-file position. A system
   *   removed via `removeSystem` and re-registered later is treated as a new
   *   registration and moves to the back of its `order` tier.
   * - Resolved once, here, at registration time. `_runStage` never sorts.
   *
   * `order` is a plain number, not a fixed tier set — pick a value relative
   * to the specific systems you need to run before/after, not as a point on
   * some global priority scale.
   */
  public addSystem(stage: ECSSystemStage, id: string, fn: ECSSystem, order: number = 0) {
    const stageSystems = this.systems.get(stage);
    // Prevent duplicate systems if a plugin is re-run
    if (stageSystems?.some((s) => s.id === id)) return;
    stageSystems?.push({ id, fn, order, seq: this.systemSeq++ });
    stageSystems?.sort((a, b) => b.order - a.order || a.seq - b.seq);
  }

  /**
   * Removes a system by `id` from every stage.
   *
   * `.filter()` never reorders, so a stage's already-sorted array stays
   * correctly sorted after removal. If a removed `id` is later re-registered
   * via `addSystem`, it gets a fresh `seq` (the counter never rewinds) and
   * lands at the back of its `order` tier, not back in its original tie
   * position — a new registration, not a resumed one.
   */
  public removeSystem(id: string) {
    this.systems.forEach((list, stage) => {
      this.systems.set(
        stage,
        list.filter((s) => s.id !== id)
      );
    });
  }

  /** Extracts the storage index from a packed ID */
  private _getIndex(id: number): number {
    return id & this.INDEX_MASK;
  }

  /** Extracts the generation version from a packed ID */
  private _getGeneration(id: number): number {
    return id >>> this.GEN_SHIFT;
  }

  /** Combines an index and a generation into a single number */
  private _pack(index: number, gen: number): number {
    // Mask gen to 12 bits (0xfff) before shifting to ensure it never
    // interferes with bits outside the 32-bit signed integer range.
    return ((gen & this.GEN_MASK) << this.GEN_SHIFT) | (index & this.INDEX_MASK);
  }

  /**
   * Extracts the stable, dense entity-slot index from a packed entity id.
   * Exposed (narrowly, alongside the still-private `_pack`/`_getGeneration`)
   * for storage backends — e.g. the TypedArray-backed sparse set in
   * TypedArrayTransformStore.ts — that need a numeric array
   * offset; the packed id itself is not usable as one.
   */
  public getEntityIndex(entityId: number): number {
    return this._getIndex(entityId);
  }

  /** Returns the number of currently live entities in this world. */
  public getEntityCount(): number {
    return this.entities.size;
  }

  /**
   * The component types this world has a storage for: every engine type, plus each app or toolkit
   * type once something added it or asked for its storage. A storage can be empty. For debug
   * listings (the entity inspector, the profiler); allocates an array.
   */
  public getComponentTypes(): ComponentType[] {
    return [...this.storages.keys()];
  }

  /**
   * Returns the TypedArray-backed Transform store when TRANSFORM storage is
   * in `TYPED_ARRAY` mode, or `undefined` in the default `MAP` mode.
   * Hot-path systems use this to branch once per call instead of paying the
   * cold-path `getComponent()` materialization cost per entity.
   */
  public getTypedTransformStore(): TypedArrayTransformStore | undefined {
    return this.storageMode === 'TYPED_ARRAY'
      ? (this.storages.get(ComponentType.TRANSFORM) as TypedArrayTransformStore)
      : undefined;
  }

  /**
   * Writes a `Transform` object back into TRANSFORM storage after in-place
   * mutation. Cold-path `getComponent(TRANSFORM)` may return a
   * disconnected, freshly materialized copy (`TYPED_ARRAY` mode) rather
   * than a live reference (`MAP` mode) — callers that fetch a Transform,
   * mutate its position/quaternion/scale in place, and call `setDirty()`
   * must call this afterward for the change to persist in both modes.
   */
  public commitTransform(entityId: number, transform: Transform): void {
    this.storages.get(ComponentType.TRANSFORM)?.set(entityId, transform);
  }

  /**
   * Whether the entity exists: false for a deleted one, also once a new entity took its slot
   * (its generation differs), so a kept id can't act on its slot's next entity.
   */
  public isAlive(entityId: number): boolean {
    const index = this._getIndex(entityId);
    const gen = this._getGeneration(entityId);
    return this.generations[index] === gen && this.entities.has(entityId);
  }

  private _getNewEntityId() {
    // Recycled slots were validly allocated before, so only a fresh
    // (never-recycled) index needs the maxEntities bounds check — without
    // it, index >= generations.length would silently no-op on write and
    // always read back 0/undefined instead of throwing (Uint32Array access
    // out of bounds doesn't throw), corrupting isAlive() for that slot.
    if (this.freeIds.length === 0 && this.nextEntityId >= this.maxEntities) {
      const msg = `ECS World '${this.id}' has reached its maxEntities cap (${this.maxEntities}). Increase maxEntities or free existing entities before creating more.`;
      lerror(msg);
      throw new Error(msg);
    }

    const index = this.freeIds.length > 0 ? this.freeIds.pop()! : this.nextEntityId++;
    // Use the current generation for this specific slot
    const gen = this.generations[index];
    return this._pack(index, gen);
  }

  /**
   * Creates an entity without any component (no `APP_ID`, no `TRANSFORM`): for data-only
   * entities, eg. a stress test's thousands. Most code wants {@link ECSWorld.createEntity}.
   * @returns the new entity's id
   */
  createRawEntity() {
    const id = this._getNewEntityId();
    this.entities.add(id);
    ECSWorld.notifyEntityCountChange(this);
    return id;
  }

  /**
   * Creates an entity with the core components: `APP_ID` (`opts.appId`, else a generated UUID),
   * `TRANSFORM` (identity), `USER_DATA`, `DEBUG_DATA` (debug env and prod test only), `MANAGED_BY`
   * when given, and `DISABLED` when `opts.disabled`.
   * @returns the new entity's id
   */
  createEntity(opts?: CoreEntityOpts): number {
    const id = this._getNewEntityId();
    this.entities.add(id);
    this.addComponent(id, ComponentType.APP_ID, {
      id: opts?.appId || THREE.MathUtils.generateUUID(),
      isFixed: Boolean(opts?.appId),
    });
    this.addComponent(id, ComponentType.TRANSFORM, new Transform());
    this.addComponent(id, ComponentType.USER_DATA, opts?.userData || {});
    this.addComponent(id, ComponentType.DEBUG_DATA, opts?.debugData || {});
    if (opts?.managedBy) this.addComponent(id, ComponentType.MANAGED_BY, { ...opts.managedBy });
    this.setDisabled(id, Boolean(opts?.disabled));
    ECSWorld.notifyEntityCountChange(this);
    return id;
  }

  /**
   * Deletes an entity: runs the `onDeleteEntity` hooks of each component type it has (a throwing
   * hook is logged and the rest still run), then clears its components and frees its slot. A dead
   * id is ignored.
   */
  deleteEntity(entityId: number): void {
    // Safety: Ignore if entity is already dead
    if (!this.isAlive(entityId)) return;

    // Trigger Destruction Hooks (onDeleteEntity)
    // We check every storage to see if this entity has it
    this.storages.forEach((storage, type) => {
      if (storage.has(entityId)) {
        const hooks = ECSWorld.onDeleteEntityHooks.get(type);
        hooks?.forEach((hook) => {
          // One hook throwing (e.g. a disposal error) must not block another
          // hook's cleanup, or the entity-removal code below it in this method.
          try {
            hook(entityId, this);
          } catch (err) {
            lerror(
              `onDeleteEntity hook for component type '${type}' threw for entity ${entityId}.`,
              err
            );
          }
        });
      }
    });

    const index = this._getIndex(entityId);

    // Incrementing the generation at this index means any OLD IDs
    // floating around will fail the isAlive() check immediately. It wraps at
    // the packed id's 12 bits: isAlive compares it with the id's masked
    // generation, so an unwrapped 4096 would make every later entity in the
    // slot dead on creation and undeletable. An id repeats after 4096 reuses
    // of its slot (docs/issues/ecs-generation-wrap-after-4096-reuses.md).
    this.generations[index] = (this.generations[index] + 1) & this.GEN_MASK;

    // Clear ECS data using the packed ID as the key for Map consistency
    this._unmapAppId(entityId);
    this.storages.forEach((storage) => storage.delete(entityId));
    this.entities.delete(entityId);

    // Recycle the index for future use
    this.freeIds.push(index);

    ECSWorld.notifyEntityCountChange(this);
  }

  /**
   * Stores `data` as the entity's `type` component (replacing one it has), then runs the type's
   * `onAddComponent` hooks. `DEBUG_DATA` is dropped outside the debug env and prod test mode.
   * @remarks The data is stored as given, not copied: a component object shared by two entities
   * changes for both.
   */
  addComponent<K extends ComponentType>(entityId: number, type: K, data: ComponentData[K]): void {
    // DEBUG_DATA is only stored where it is read: debug and prodTest mode (eg. the on-screen
    // tools' camera names). Production never stores it. The flags are read here, not at load:
    // they're set by InitEngine
    if (type === ComponentType.DEBUG_DATA && !IS_DEBUG_ENV && !IS_PROD_TEST_MODE) return;

    let storage = this.storages.get(type);
    if (!storage) {
      storage = new Map();
      this.storages.set(type, storage);
    }

    if (type === ComponentType.APP_ID) {
      const appId = data as ComponentData[typeof ComponentType.APP_ID];
      // The same id again keeps the entity's place in the lookup
      const isSameId = this._getStorageOf(ComponentType.APP_ID)?.get(entityId)?.id === appId.id;
      if (!isSameId) this._unmapAppId(entityId);
      storage.set(entityId, data);
      if (!isSameId) this._mapAppId(entityId, appId);
    } else {
      storage.set(entityId, data);
    }

    // Trigger Initialization Hooks (onAddComponent); an index loop: no closure per add
    const hooks = ECSWorld.onAddComponentHooks.get(type);
    if (hooks) for (let i = 0; i < hooks.length; i++) hooks[i](entityId, this);
  }

  /**
   * Removes the entity's `type` component, running the type's `onRemoveComponent` hooks first (they
   * can still read it). Nothing runs when the entity doesn't have it, or when its hooks call this
   * again for the same entity and type (that removal is already running).
   */
  public removeComponent(entityId: number, type: ComponentType): void {
    const storage = this.storages.get(type);
    if (!storage?.has(entityId)) return;
    for (let i = 0; i < this.removingIds.length; i++) {
      if (this.removingIds[i] === entityId && this.removingTypes[i] === type) return;
    }
    // Fire hooks BEFORE the data is actually gone from storage so the hook
    // can still read the component's last value (including via
    // `hasComponent`/`getComponent` for `type` itself) if needed.
    const hooks = ECSWorld.onRemoveComponentHooks.get(type);
    if (hooks) {
      this.removingIds.push(entityId);
      this.removingTypes.push(type);
      try {
        for (let i = 0; i < hooks.length; i++) hooks[i](entityId, this);
      } finally {
        this.removingIds.pop();
        this.removingTypes.pop();
      }
    }
    if (type === ComponentType.APP_ID) this._unmapAppId(entityId);
    storage.delete(entityId);
  }

  /**
   * The entity's `type` component, or undefined.
   * @remarks In `TYPED_ARRAY` mode `TRANSFORM` comes back as a new copy: write a changed one back
   * with {@link ECSWorld.commitTransform}.
   */
  public getComponent<K extends ComponentType>(
    entityId: number,
    type: K
  ): ComponentData[K] | undefined {
    return this._getStorageOf(type)?.get(entityId);
  }

  /**
   * The entity that has `appId` (its `APP_ID.id`), or undefined: one lookup. When several entities
   * have it, the first one created keeps it until it's deleted.
   */
  public getEntityIdByAppId(appId: string): number | undefined {
    return this.entityIdsByAppId.get(appId);
  }

  private _mapAppId(entityId: number, data: ComponentData[typeof ComponentType.APP_ID]) {
    const holder = this.entityIdsByAppId.get(data.id);
    if (holder === undefined) {
      this.entityIdsByAppId.set(data.id, entityId);
      return;
    }
    if (holder === entityId) return;
    this.duplicatedAppIds.add(data.id);
    // A generated id never repeats; a given one shouldn't
    if (IS_DEBUG_ENV && data.isFixed) {
      lwarn(
        `ECS World '${this.id}': the app id '${data.id}' is already entity ${holder}'s, so entity ${entityId}'s isn't found by it (getEntityIdByAppId returns the first).`
      );
    }
  }

  /** Before the entity's APP_ID is removed or replaced: hands its id to the next entity with it. */
  private _unmapAppId(entityId: number) {
    const data = this._getStorageOf(ComponentType.APP_ID)?.get(entityId);
    if (!data || this.entityIdsByAppId.get(data.id) !== entityId) return;
    this.entityIdsByAppId.delete(data.id);
    if (!this.duplicatedAppIds.has(data.id)) return;
    // The next holder: the first other entity with the id, in the storage's (creation) order
    for (const [otherId, other] of this._getStorageOf(ComponentType.APP_ID)!) {
      if (otherId !== entityId && other.id === data.id) {
        this.entityIdsByAppId.set(data.id, otherId);
        return;
      }
    }
    this.duplicatedAppIds.delete(data.id);
  }

  /** The type's storage, typed (the map holds them as unknown) */
  private _getStorageOf<K extends ComponentType>(
    type: K
  ): IComponentStorage<ComponentData[K]> | undefined {
    return this.storages.get(type) as IComponentStorage<ComponentData[K]> | undefined;
  }

  /** Checks if an entity has a specific component. */
  public hasComponent(entityId: number, type: ComponentType): boolean {
    return this.storages.get(type)?.has(entityId) ?? false;
  }

  /** Returns the resolved (already-sorted) system order for `stage`, for debugging/inspection. */
  public getSystemOrder(stage: ECSSystemStage): { id: string; order: number; seq: number }[] {
    return (this.systems.get(stage) ?? []).map(({ id, order, seq }) => ({ id, order, seq }));
  }

  /**
   * The type's storage, for iterating every entity that has the component: read it once per system
   * run, not per entity. A type nothing has added yet gets an empty storage.
   * @remarks The iteration order isn't guaranteed: a `Map` storage iterates in insertion order
   * today, while the `TYPED_ARRAY` `TRANSFORM` storage reorders on removal (a swap-remove), and
   * yields new `Transform` copies. Don't depend on either.
   */
  public getStorage<K extends ComponentType>(type: K): IComponentStorage<ComponentData[K]> {
    let storage = this._getStorageOf(type);

    // --- PREVENT ITERABLE ERROR ---
    if (!storage) {
      // If it doesn't exist, create an empty one so systems don't crash
      storage = new Map();
      this.storages.set(type, storage);
    }

    return storage;
  }

  /**
   * Deletes every entity, each through {@link ECSWorld.deleteEntity} (their `onDeleteEntity` hooks
   * run, their slots are freed with a new generation). The world stays registered, with its
   * systems.
   */
  public clearWorld(): void {
    for (const entityId of Array.from(this.entities)) this.deleteEntity(entityId);
  }

  /**
   * Wipes all entities EXCEPT those marked as persistent (PERSISTENT).
   * Used for switching scenes while keeping loaders/global state alive
   * and any other entity needed to be shared between scenes.
   */
  public clearNonPersistent(): void {
    const persistentEntities = new Set<number>();
    const persistentStorage = this.getStorage(ComponentType.PERSISTENT);
    if (persistentStorage) {
      for (const [entityId] of persistentStorage) {
        persistentEntities.add(entityId);
      }
    }
    const allEntities = Array.from(this.entities);
    for (const entityId of allEntities) {
      if (persistentEntities.has(entityId)) continue;
      this.deleteEntity(entityId);
    }
  }

  /**
   * Internal helper to wipe physical state.
   * Shared by setTransform (teleport) and setEnabled (respawn).
   */
  private _resetBodyState(
    rb: RigidBodyAPI,
    resetVelocity: boolean,
    resetForces: boolean,
    wakeUp: boolean
  ): void {
    if (resetVelocity) {
      rb.setLinvel({ x: 0, y: 0, z: 0 }, wakeUp);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, wakeUp);
    }

    if (resetForces) {
      rb.resetForces(wakeUp);
      rb.resetTorques(wakeUp);
    }
  }

  /**
   * Moves and / or rotates the entity: its rigid body (when it has one, also a dynamic body in a
   * `STATIC` or `DISABLED` physics tier) and its `TRANSFORM`, then tells the transform reset
   * listeners (a pose jump: render interpolation doesn't smooth across it). `resetVelocity` and
   * `resetForces` apply to a dynamic body; `doNotWakeUp` keeps a sleeping body asleep.
   * @remarks Physics writes belong in `APP_PHYSICS_STEP` systems or scene-load code: from another
   * stage their timing depends on the frame rate.
   */
  setTransform(
    entityId: number,
    tra:
      | {
          pos: ECSPosition;
          rot?: ECSRotation;
          resetVelocity?: boolean;
          resetForces?: boolean;
          doNotWakeUp?: boolean;
        }
      | {
          pos?: ECSPosition;
          rot: ECSRotation;
          resetVelocity?: boolean;
          resetForces?: boolean;
          doNotWakeUp?: boolean;
        }
  ): void {
    const { pos, rot, resetVelocity, resetForces, doNotWakeUp } = tra;

    const transform = this.getComponent(entityId, ComponentType.TRANSFORM);
    const rb = this._getWritableBody(entityId);

    // Update Physics (Worker or Main thread)
    if (rb) {
      const wakeUp = !Boolean(doNotWakeUp);

      // Standard move
      if (pos) rb.setTranslation(pos, wakeUp);
      if (rot) rb.setRotation(rot, wakeUp);

      if (this._hasDynamicBody(entityId)) {
        this._resetBodyState(rb, Boolean(resetVelocity), Boolean(resetForces), wakeUp);
      }
    }

    // Update Visuals (Main Thread Cache)
    if (transform) {
      if (pos) transform.position.set(pos.x, pos.y, pos.z);
      if (rot) transform.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      transform.setDirty();
      this.commitTransform(entityId, transform);
    }

    if (pos || rot) {
      for (const listener of ECSWorld.transformResetListeners) listener(this, entityId);
    }
  }

  /**
   * Teleports an entity to a specific location and rotation.
   * Unlike setTransform, this resets velocities to ensure
   * the object doesn't carry old momentum to the new spot.
   */
  public teleport(entityId: number, tra: ECSTransformProp): void {
    // Render interpolation history is invalidated by setTransform's transform reset listeners.
    this.setTransform(entityId, { ...tra, resetVelocity: true, resetForces: true });
  }

  /**
   * Sets Linear and/or Angular velocity.
   * Only affects dynamic/kinematic rigid bodies.
   */
  setVelocity(
    entityId: number,
    linvel?: { x: number; y: number; z: number },
    angvel?: { x: number; y: number; z: number }
  ): void {
    const rb = this._getWritableBody(entityId);

    // Static bodies cannot have velocity; we only act if it's dynamic
    if (rb && this._hasDynamicBody(entityId)) {
      if (linvel) rb.setLinvel(linvel, true);
      if (angvel) rb.setAngvel(angvel, true);
    }
  }

  /**
   * The entity's `TRANSFORM` position, or undefined without one. Read it, don't write it: move an
   * entity with {@link ECSWorld.setTransform}.
   * @remarks In `TYPED_ARRAY` mode it's a copy's vector.
   */
  getPosition(entityId: number): THREE.Vector3 | undefined {
    return this.getComponent(entityId, ComponentType.TRANSFORM)?.position;
  }

  /** The entity's `TRANSFORM` rotation, or undefined. Like {@link ECSWorld.getPosition}, to read. */
  getRotation(entityId: number): THREE.Quaternion | undefined {
    return this.getComponent(entityId, ComponentType.TRANSFORM)?.quaternion;
  }

  /** The entity's `TRANSFORM` scale, or undefined. Like {@link ECSWorld.getPosition}, to read. */
  getScale(entityId: number): THREE.Vector3 | undefined {
    return this.getComponent(entityId, ComponentType.TRANSFORM)?.scale;
  }

  /**
   * The entity's `TRANSFORM` position, rotation and scale (throws without one). Like
   * {@link ECSWorld.getPosition}, to read.
   */
  getTransform(entityId: number): {
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
    scale: THREE.Vector3;
  } {
    const tra = existsOrThrow(
      this.getComponent(entityId, ComponentType.TRANSFORM),
      'TRANSFORM ECS component not found.'
    );
    return { position: tra.position, rotation: tra.quaternion, scale: tra.scale };
  }

  /** Whether the entity has `DISABLED` (see {@link ECSWorld.setDisabled}). */
  public isDisabled(entityId: number): boolean {
    return this.hasComponent(entityId, ComponentType.DISABLED);
  }

  /**
   * Disables or enables the entity: adds or removes `DISABLED`, whose hooks hide or show its
   * Object3D (and disable its `TARGET_LINK` target with it), and disables or enables its rigid
   * body (a body in the `DISABLED` physics tier stays disabled). A dynamic body's velocities and
   * forces are reset either way unless `opts` says otherwise.
   */
  public setDisabled(
    entityId: number,
    disabled: boolean,
    opts?: {
      /** Zero the dynamic body's velocities. Default is true */
      resetVelocity?: boolean;
      /** Clear the dynamic body's forces and torques. Default is true */
      resetForces?: boolean;
      /** Wake the body with the resets. Default is true */
      wakeUp?: boolean;
    }
  ): void {
    // Handle Physics (a REMOVED physics tier body comes back with the entity's enabled state)
    const rb = this._getWritableBody(entityId);
    if (rb) {
      const resetVelocity = opts?.resetVelocity === undefined ? true : opts.resetVelocity;
      const resetForces = opts?.resetForces === undefined ? true : opts.resetForces;
      const wakeUp = opts?.wakeUp === undefined ? true : opts.wakeUp;

      // A body in the DISABLED physics tier stays disabled (PhysicsTiers.ts applies the same rule)
      const tier = this.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER)?.tier;
      rb.setEnabled(!disabled && tier !== 'DISABLED');

      if (this._hasDynamicBody(entityId)) {
        this._resetBodyState(rb, Boolean(resetVelocity), Boolean(resetForces), wakeUp);
      }
    }

    // Update the state component
    if (disabled) {
      // Disabled
      this.addComponent(entityId, ComponentType.DISABLED, disabled);
      return;
    }
    // Enabled
    this.removeComponent(entityId, ComponentType.DISABLED);
  }

  /**
   * The entity's rigid body: its `BODY_DYNAMIC_VISUAL`, `BODY_DYNAMIC_HEADLESS` or `BODY_STATIC`
   * component (a dynamic body in a `STATIC` or `DISABLED` physics tier is in `BODY_STATIC`), or
   * undefined. Undefined while its tier is `REMOVED`.
   */
  getRigidBody(entityId: number): RigidBodyAPI | undefined {
    return (
      this.getComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
      this.getComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS) ||
      this.getComponent(entityId, ComponentType.BODY_STATIC)
    );
  }

  /** Whether the entity's body is in a dynamic bucket (`BODY_DYNAMIC_VISUAL` or `_HEADLESS`). */
  isEntityDynamic(entityId: number): boolean {
    return (
      this.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
      this.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS)
    );
  }

  /** The body to write to: the entity's, and also one that is back in the world from the
   * REMOVED physics tier but whose bucket component isn't yet (WORKER_THREAD, in flight; the
   * worker applies writes in order). None while REMOVED: there's no body in the world. */
  private _getWritableBody(entityId: number): RigidBodyAPI | undefined {
    const rb = this.getRigidBody(entityId);
    if (rb) return rb;
    const tier = this.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER);
    return tier && tier.tier !== 'REMOVED' ? tier.body : undefined;
  }

  /** A dynamic body, also while a STATIC or DISABLED physics tier has it in BODY_STATIC (only
   * dynamic bodies get tiers): its velocities are its own, so resets apply to it. */
  private _hasDynamicBody(entityId: number): boolean {
    return (
      this.isEntityDynamic(entityId) || this.hasComponent(entityId, ComponentType.PHYSICS_SIM_TIER)
    );
  }

  /**
   * The ids of the entities that have `type` (none for a type nothing has added yet). The order
   * isn't guaranteed, as with {@link ECSWorld.getStorage}.
   * @example
   * ```ts
   * import { ComponentType, getECSWorld } from 'aekasha';
   *
   * const world = getECSWorld();
   * for (const entityId of world.getEntitiesWith(ComponentType.TAG_IS_LIGHT)) {
   *   world.setDisabled(entityId, true);
   * }
   * ```
   */
  public getEntitiesWith(type: ComponentType): IterableIterator<number> {
    return this.getStorage(type).keys();
  }

  /**
   * Runs the `MAIN` and `APP_PRE_PHYSICS` stages (the main loop, every frame).
   * @internal
   */
  public updateMainLoop(dt: number) {
    this._runStage(ECSSystemStage.MAIN, dt);
    this._runStage(ECSSystemStage.APP_PRE_PHYSICS, dt);
  }

  /**
   * Runs the `APP_PHYSICS_STEP` stage, once per fixed physics sub-step right before it (the main
   * loop's fixed-step driver).
   * @internal
   */
  public updatePhysicsStep(dt: number) {
    this._runStage(ECSSystemStage.APP_PHYSICS_STEP, dt);
  }

  /**
   * Runs the `APP_POST_PHYSICS`, `APP_LOGIC` and `APP_RENDER_SYNC` stages (the main loop, while the
   * app loop plays).
   * @internal
   */
  public updateAppLoop(dt: number) {
    this._runStage(ECSSystemStage.APP_POST_PHYSICS, dt);
    this._runStage(ECSSystemStage.APP_LOGIC, dt);
    this._runStage(ECSSystemStage.APP_RENDER_SYNC, dt);
  }

  /**
   * Runs the `LATE_MAIN` stage (the main loop, after the frame is rendered).
   * @internal
   */
  public updateLateMainLoop(dt: number) {
    this._runStage(ECSSystemStage.LATE_MAIN, dt);
  }

  /**
   * Runs every system registered for `stage`, in the order resolved once at
   * registration time by `addSystem` — this function does no sorting and
   * never reorders anything itself, so it has no ordering-related per-frame
   * cost.
   *
   * Stage execution order itself is decided elsewhere: it's the fixed call
   * sequence in `updateMainLoop` / `updateAppLoop` / `updateLateMainLoop`, plus
   * `updatePhysicsStep` once per fixed physics sub-step.
   */
  private _runStage(stage: ECSSystemStage, dt: number) {
    const list = this.systems.get(stage)!;
    for (let i = 0; i < list.length; i++) {
      list[i].fn(this, dt);
    }
  }
}

/**
 * The entity in `ecsWorld` (default: the default world) whose `APP_ID` is `appId`, or undefined:
 * one lookup ({@link ECSWorld.getEntityIdByAppId}). When several entities have the id, the first
 * one created keeps it until it's deleted; a second entity given a fixed id another one has is
 * warned about in the debug env.
 * @example
 * ```ts
 * import { getEntityIdByAppId, getECSWorld } from 'aekasha';
 *
 * const sunId = getEntityIdByAppId('sun');
 * if (sunId !== undefined) getECSWorld().setDisabled(sunId, true);
 * ```
 */
export const getEntityIdByAppId = (appId: string, ecsWorld?: ECSWorld): number | undefined =>
  (ecsWorld || getECSWorld()).getEntityIdByAppId(appId);

/**
 * Returns the entity's app id, but only when the app explicitly supplied one.
 *
 * Entities created without an `appId` get a generated UUID that is new on every reload, so
 * anything persisted against it (debugger LocalStorage state, undo/redo history) can't find
 * the entity again. `APP_ID.isFixed` marks the ids that are stable across reloads.
 * @param entityId (number) the entity to read
 * @param ecsWorld ({@link ECSWorld}) optional world, defaults to the current world
 * @returns (string | undefined) the stable app id, or undefined for generated ids
 */
export const getStableAppId = (entityId: number, ecsWorld?: ECSWorld): string | undefined => {
  const world = ecsWorld || getECSWorld();
  const appId = world.getComponent(entityId, ComponentType.APP_ID);
  return appId?.isFixed ? appId.id : undefined;
};

// Debug stuff

type ECSGUIModule = typeof import('./debug/_dbg__ECS');
let debugGUI: DebugModuleRef<ECSGUIModule> | null = null;

/**
 * Loads the ECS debug tab's module and builds the tab (debug env only). `InitEngine` calls it.
 * @internal
 */
export const registerECSDebugGUI = async () => {
  if (!IS_DEBUG_ENV) return;
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__ECS'));
  useDebug(debugGUI)?._initECSDebugGUI();
};
