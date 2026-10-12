import type { AppConfig } from './Config';
import { type ComponentHook, ECSWorld, type TransformResetListener, type WorldPlugin } from './ECS';
import type { ComponentType } from './ECS/ECSCoreComponents';
import { type ImportExtension, registerImportExtension } from './Import/ImportExtensions';
import { type FixedStepDriver, setFixedStepDriver } from './MainLoop';
import {
  addAfterRender,
  type AfterRenderHook,
  type RenderPipelineProvider,
  setRenderPipeline,
} from './RenderHooks';
import { addSceneHooks, type SceneHooks } from './SceneHooks';
import { lerror } from '../utils/Logger';

// The install contract (p607 D1): `InitEngine` installs the kernel, then each of `features` in
// list order, and a feature reaches the kernel only through the `FeatureContext` its `install`
// gets. Nothing registers itself when its module is imported, so a build holds only the features
// an app lists, and the registration order is the list's.

/** A debug registration a feature hands to `InitEngine` (see {@link FeatureContext.onDebug}). */
export type FeatureDebugHook = () => void | Promise<void>;

/** What a feature's `install` gets: the kernel's seams. */
export type FeatureContext = {
  /** The merged app configuration (the engine defaults under `InitEngine`'s `config`). */
  readonly config: Readonly<AppConfig>;
  /** Whether a feature with this id was installed before this one (for optional cooperation,
   * eg. instancing with LOD). A required one goes in `requires` instead. */
  isInstalled: (id: string) => boolean;
  /** {@link ECSWorld.registerPlugin}: runs `plugin` on every world that applies the global
   * plugins, the existing ones now and every later one when it's created. */
  registerPlugin: (plugin: WorldPlugin) => void;
  /** {@link ECSWorld.registerCorePlugin}: like `registerPlugin`, also on worlds created with
   * `applyGlobalPlugins: false`. For the systems every world needs to work. */
  registerCorePlugin: (plugin: WorldPlugin) => void;
  /** {@link ECSWorld.registerComponentHooks}: hooks for a component type, in every world. */
  registerComponentHooks: (
    type: ComponentType,
    hooks: {
      onAddComponent?: ComponentHook;
      onRemoveComponent?: ComponentHook;
      onDeleteEntity?: ComponentHook;
    }
  ) => void;
  /** {@link ECSWorld.registerTransformResetListener}: told when `setTransform` or `teleport`
   * moves an entity, so pose history can be dropped. */
  registerTransformResetListener: (listener: TransformResetListener) => void;
  /** Adds the feature's part of every scene load, by phase ({@link SceneHooks}). Returns the
   * remover. */
  addSceneHooks: (hooks: SceneHooks) => () => void;
  /** Makes the feature the main loop's fixed-step driver ({@link FixedStepDriver}): physics.
   * One per page; a second throws. */
  setFixedStepDriver: (driver: FixedStepDriver) => void;
  /** Renders every frame through the provider's pipeline when it returns one
   * ({@link RenderPipelineProvider}): PostFX. One per page; a second throws. */
  setRenderPipeline: (provider: RenderPipelineProvider) => void;
  /** Draws over every finished frame ({@link AfterRenderHook}): viewports. Returns the remover. */
  addAfterRender: (hook: AfterRenderHook) => () => void;
  /** Adds the feature's part of `importAssetAsync` and `spawnImportedAsset`
   * ({@link ImportExtension}): physics' bodies, LOD's chains. Each member has one provider; a
   * second throws. */
  registerImportExtension: (extension: ImportExtension) => void;
  /**
   * Runs `fn` in `InitEngine`'s debug block, before the app's `start`, in install order (the
   * debug env only: `?isDebug=true` in a development or test build). Load the debug code there,
   * through an `import()`, so a production build leaves it out.
   */
  onDebug: (fn: FeatureDebugHook) => void;
  /** Like `onDebug`, after the app's `start` (the renderer exists then). */
  onDebugAfterStart: (fn: FeatureDebugHook) => void;
};

/**
 * An engine feature, or an app's own: listed in `InitEngine`'s `features`, which installs each
 * once, in list order, awaiting each `install`.
 * @example
 * ```ts
 * import type { EngineFeature } from 'aekasha';
 *
 * const myGame: EngineFeature = {
 *   id: 'myGame',
 *   install: (ctx) => {
 *     ctx.registerPlugin((world) => {
 *       world.addSystem(ECSSystemStage.APP_LOGIC, 'myGameSystem', () => {});
 *     });
 *   },
 * };
 * ```
 */
export type EngineFeature = {
  /** Unique in the list: `'physics'`, `'skybox'`, …, or an app's own. */
  id: string;
  /** The ids of the features this one needs, each listed before it (`InitEngine` fails naming
   * both otherwise). */
  requires?: string[];
  /** Registers the feature's systems, hooks and seams. */
  install: (ctx: FeatureContext) => void | Promise<void>;
};

/**
 * The kernel's side of a {@link FeatureContext}: the context, the ids installed so far and the
 * debug hooks, which `InitEngine` runs in its debug blocks.
 * @internal
 */
export type FeatureHost = {
  ctx: FeatureContext;
  installed: Set<string>;
  debugHooks: FeatureDebugHook[];
  debugAfterStartHooks: FeatureDebugHook[];
};

/**
 * Creates the context the kernel and the features install with. `InitEngine` creates one.
 * @internal
 */
export const createFeatureHost = (config: AppConfig): FeatureHost => {
  const installed = new Set<string>();
  const debugHooks: FeatureDebugHook[] = [];
  const debugAfterStartHooks: FeatureDebugHook[] = [];
  const ctx: FeatureContext = {
    config,
    isInstalled: (id) => installed.has(id),
    registerPlugin: (plugin) => ECSWorld.registerPlugin(plugin),
    registerCorePlugin: (plugin) => ECSWorld.registerCorePlugin(plugin),
    registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
    registerTransformResetListener: (listener) => ECSWorld.registerTransformResetListener(listener),
    addSceneHooks,
    setFixedStepDriver,
    setRenderPipeline,
    addAfterRender,
    registerImportExtension,
    // A production build keeps none (and runs none: InitEngine's debug blocks fold away)
    onDebug: (fn) => {
      if (__AEK_DEBUG__) debugHooks.push(fn);
    },
    onDebugAfterStart: (fn) => {
      if (__AEK_DEBUG__) debugAfterStartHooks.push(fn);
    },
  };
  return { ctx, installed, debugHooks, debugAfterStartHooks };
};

/**
 * Throws on a list `InitEngine` can't install: an id listed twice, or a `requires` id that isn't
 * listed before the feature needing it. Checks the whole list before anything installs.
 * @internal
 */
export const checkFeatures = (features: readonly EngineFeature[]) => {
  const ids = features.map((feature) => feature.id);
  features.forEach((feature, index) => {
    if (ids.indexOf(feature.id) !== index) {
      throw new Error(`InitEngine: the feature '${feature.id}' is listed twice in \`features\`.`);
    }
    for (const required of feature.requires ?? []) {
      const at = ids.indexOf(required);
      if (at === -1) {
        throw new Error(
          `InitEngine: the feature '${feature.id}' requires '${required}', which isn't in \`features\`.`
        );
      }
      if (at > index) {
        throw new Error(
          `InitEngine: the feature '${feature.id}' requires '${required}', which is listed after ` +
            `it in \`features\`: list '${required}' first.`
        );
      }
    }
  });
};

/**
 * Checks `features` (`checkFeatures`), then installs each in list order, awaiting each
 * `install`. A failed install logs the feature's id and rejects with its error, and the features
 * after it don't install.
 * @internal
 */
export const installFeaturesAsync = async (
  features: readonly EngineFeature[],
  host: FeatureHost
) => {
  checkFeatures(features);
  for (const feature of features) {
    // A promise's catch, not a try block (Rollup keeps a try block's calls whole, InitApp.ts);
    // the async wrapper turns a synchronous throw into the rejection too
    await (async () => feature.install(host.ctx))().catch((err: unknown) => {
      lerror(`InitEngine: the feature '${feature.id}' failed to install.`, err);
      throw err;
    });
    host.installed.add(feature.id);
  }
};

/**
 * Runs a host's debug hooks in order, awaiting each. `InitEngine` calls it in its debug blocks.
 * @internal
 */
export const runFeatureDebugHooksAsync = async (hooks: readonly FeatureDebugHook[]) => {
  for (const hook of hooks) await hook();
};
