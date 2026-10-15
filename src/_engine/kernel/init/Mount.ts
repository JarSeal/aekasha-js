// mountAekasha (p611 D6): the engine mounted into an element of a page it doesn't own (a site's
// background, a banner, a product view), next to the full-page boot (InitEngine). It boots the same
// way (Boot.ts) without the page's styles, sizes the canvas to its container, scopes the input to
// the canvas or nothing, loads the app's files from `assetBaseUrl`, and returns a handle to load
// scenes, pause and unmount.
import WebGL from 'three/addons/capabilities/WebGL.js';
import { setAssetBaseUrl } from '../assets/AssetUrl';
import { stopAssetsWorker } from '../assets/AssetsAPI';
import { removeAllInputListeners, setInputScope } from '../input/InputState';
import { stopMainLoop, toggleMainPlay } from '../loop/MainLoop';
import { createElementSizeSource, setCanvasSizeSource } from '../render/CanvasSize';
import { createRenderer, deleteRenderer, getRenderer } from '../render/Renderer';
import type { RendererCanvasOptions, RendererOptions } from '../render/Renderer';
import { addAfterRender } from '../render/RenderHooks';
import { createSceneLoader, loadScene } from '../scene/SceneLoader';
import { lerror, lwarn } from '../../utils/Logger';
import { bootEngineAsync, isEngineBooted } from './Boot';
import type { InitEngineOptions } from './InitEngine';

/** {@link mountAekasha}'s options: {@link InitEngineOptions}' `config`, `data` and `features`
 * (the mount's own start loads `sceneId`), and the page's side. */
export type MountAekashaOptions = Omit<InitEngineOptions, 'start'> & {
  /** The element the engine goes into, or a selector for it. The mount adds its own container
   * inside it and changes nothing else on the page. */
  target: HTMLElement | string;
  /** The first scene. Default: the first scene in `data`. */
  sceneId?: string;
  /** The container's width, any CSS length (`'100%'`, `'40rem'`, `'calc(100% - 2rem)'`): the
   * canvas follows the container's box. Default: `'100%'`. */
  width?: string;
  /** The container's height, any CSS length. Default: `'100%'` (of the target, which then needs a
   * height of its own; a container without one is warned about). */
  height?: string;
  /** `INLINE` (default): in the target's flow. `BACKGROUND`: fixed to the viewport behind the
   * page's content, without pointer events. */
  layout?: 'INLINE' | 'BACKGROUND';
  /** The canvas's id, classes and inline styles. */
  canvas?: RendererCanvasOptions;
  /** `NONE` (default): no input listeners at all. `CANVAS`: the pointer and touch on the canvas,
   * the keys and gamepads while it has focus. The page's own input is never taken. */
  input?: 'NONE' | 'CANVAS';
  /** Pauses the loop while the container is out of the viewport (a hidden tab pauses anyway).
   * Default: true. */
  pauseWhenHidden?: boolean;
  /** `RESPECT` (default): with `prefers-reduced-motion: reduce`, the scene renders, then pauses
   * until `resume()`. `IGNORE`: runs either way. */
  reducedMotion?: 'RESPECT' | 'IGNORE';
  /** An image URL shown until the first frame, and instead of the scene when neither WebGPU nor
   * WebGL2 is available (or the boot fails). */
  fallbackImage?: string;
  /** The folder the app's files (`aek-assets/`, `basis/`, `draco/`) are served from. Default: the
   * page's (Vite's `base` against the page), which an embed served from its own folder overrides
   * with its module's URL. */
  assetBaseUrl?: string;
  /** The renderer's options (`createRenderer`'s): `alpha: true` lets the page show through. */
  renderer?: Partial<RendererOptions>;
};

/** A mounted engine: {@link mountAekasha}'s handle. */
export type AekashaMount = {
  /** The mount's container in the target: the canvas, the HUD and the fallback image. */
  readonly container: HTMLElement;
  /** Neither WebGPU nor WebGL2 is available (or the boot failed): the container shows
   * `fallbackImage`, and the handle's methods do nothing. */
  readonly isFallback: boolean;
  /** Loads a scene (by id, from the mount's `data`) in place of the current one. */
  loadScene: (sceneId: string) => Promise<void>;
  /** Pauses the loop until `resume()` (out of view and reduced motion pause it too). */
  pause: () => void;
  /** Resumes the loop, a reduced-motion pause included; it stays paused while out of view. */
  resume: () => void;
  /** Whether the loop is paused, for any reason. */
  isPaused: () => boolean;
  /**
   * Stops the loop, removes the listeners, the observers and the container (the canvas with it),
   * and disposes the renderer. The engine doesn't mount again in this page load.
   */
  unmount: () => void;
};

/** The mount's scene loader: no UI, the container shows the fallback image until the first frame */
const MOUNT_SCENE_LOADER_ID = 'aekMountSceneLoader';

let hasMounted = false;

const resolveTarget = (target: HTMLElement | string) => {
  const elem = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!elem) throw new Error(`mountAekasha: no element matches the target "${String(target)}".`);
  return elem;
};

/** WebGPU, or WebGL2 for the renderer's fallback backend */
const isRenderingSupported = () => 'gpu' in navigator || WebGL.isWebGL2Available();

/** The container, the canvas's parent in it, and the fallback image's element */
const createContainer = (opts: MountAekashaOptions) => {
  const layout = opts.layout ?? 'INLINE';
  const container = document.createElement('div');
  container.className = `aekMount aekMount_${layout}`;
  Object.assign(container.style, {
    width: opts.width ?? '100%',
    height: opts.height ?? '100%',
    overflow: 'hidden',
    // A containing block for the HUD's fixed elements: they stay inside the container
    contain: 'layout',
    ...(layout === 'BACKGROUND'
      ? { position: 'fixed', top: '0', left: '0', zIndex: '-1', pointerEvents: 'none' }
      : { position: 'relative', display: 'block' }),
  });
  // Its own element: a scene load sets pointer-events on the canvas's parent, which in the
  // BACKGROUND layout must stay the container's (none)
  const canvasParent = document.createElement('div');
  Object.assign(canvasParent.style, { position: 'absolute', inset: '0' });
  container.appendChild(canvasParent);
  // The HUD root takes this element's place (the UI kit's root replaces the element it attaches to)
  const hudSlot = document.createElement('div');
  container.appendChild(hudSlot);

  let fallbackElem: HTMLElement | null = null;
  if (opts.fallbackImage) {
    fallbackElem = document.createElement('div');
    fallbackElem.className = 'aekMountFallback';
    Object.assign(fallbackElem.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      background: `center / cover no-repeat url(${JSON.stringify(opts.fallbackImage)})`,
    });
    container.appendChild(fallbackElem);
  }
  return { container, canvasParent, hudSlot, fallbackElem };
};

/** The handle of a mount that shows its fallback image only */
const createFallbackMount = (container: HTMLElement): AekashaMount => ({
  container,
  isFallback: true,
  loadScene: async () => {},
  pause: () => {},
  resume: () => {},
  isPaused: () => true,
  unmount: () => container.remove(),
});

/**
 * Mounts the engine into an element of a page it doesn't own: a site's background, a banner, a
 * product view. It boots like {@link _engine/kernel/init/InitEngine!InitEngine} (the same
 * `config`, `data` and `features`), but leaves the page's styles and input alone: the canvas
 * fills a container the mount adds to `target`, sized by `width` and `height` (any CSS length)
 * and followed with a `ResizeObserver`.
 * Resolves once the first scene has loaded, or with a fallback handle (`isFallback`) when the
 * browser can't render or the boot fails (logged).
 * @returns the mount's handle
 * @remarks
 * One engine per page load: the engine's state is module-level, so a second mount throws, also
 * after `unmount()` (docs/issues/remount-after-unmount.md), and so does a mount after
 * {@link _engine/kernel/init/InitEngine!InitEngine}. `unmount()` doesn't stop a physics worker
 * (`physics()` has no stop yet). The app's files are loaded from `assetBaseUrl`, and workers
 * start from the embed's own files: serve them from the page's origin.
 * @example
 * ```ts
 * import { mountAekasha } from 'aekasha';
 * import { appData } from './generated';
 *
 * const mount = await mountAekasha({
 *   target: '#hero',
 *   data: appData,
 *   features: [],
 *   sceneId: 'banner',
 *   height: '60vh',
 *   renderer: { alpha: true },
 *   fallbackImage: '/images/banner.webp',
 * });
 * document.querySelector('#stop')?.addEventListener('click', () => mount.unmount());
 * ```
 */
export const mountAekasha = async (opts: MountAekashaOptions): Promise<AekashaMount> => {
  if (hasMounted || isEngineBooted()) {
    throw new Error(
      'mountAekasha: the engine has already booted in this page (a mount, also an unmounted one, or InitEngine): it boots once per page load.'
    );
  }
  const target = resolveTarget(opts.target);
  const sceneId = opts.sceneId ?? Object.keys(opts.data.json.scenes)[0];
  if (!sceneId) throw new Error('mountAekasha: `data` has no scenes.');
  hasMounted = true;

  const { container, canvasParent, hudSlot, fallbackElem } = createContainer(opts);
  target.appendChild(container);
  if (!isRenderingSupported()) {
    lwarn('mountAekasha: neither WebGPU nor WebGL2 is available, showing the fallback image.');
    return createFallbackMount(container);
  }
  if (!container.clientHeight) {
    lwarn(
      'mountAekasha: the container has no height. Give the target a height, or pass `height` (eg. "60vh").'
    );
  }

  // The seams (p611 Phase 3), before the boot reads them
  setCanvasSizeSource(createElementSizeSource(container));
  setInputScope(opts.input ?? 'NONE');
  if (opts.assetBaseUrl) setAssetBaseUrl(opts.assetBaseUrl);

  // The loop plays unless one of these holds it
  const holds = { user: false, outOfView: false, reducedMotion: false };
  let isPlaying = true;
  const applyPlay = () => {
    const play = !holds.user && !holds.outOfView && !holds.reducedMotion;
    if (play === isPlaying) return;
    isPlaying = play;
    toggleMainPlay(play);
  };

  // The first loop frame (the second render: the first is initMainLoop's, before any system
  // ran) takes the fallback image away, and pauses for reduced motion
  const holdForReducedMotion =
    (opts.reducedMotion ?? 'RESPECT') === 'RESPECT' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderCount = 0;
  let removeFirstFrameHook: (() => void) | null = addAfterRender(() => {
    renderCount++;
    if (renderCount < 2 || !removeFirstFrameHook) return;
    // After this frame's hooks: removing it now would skip the next one this frame
    const remove = removeFirstFrameHook;
    removeFirstFrameHook = null;
    queueMicrotask(remove);
    fallbackElem?.remove();
    if (holdForReducedMotion) {
      holds.reducedMotion = true;
      applyPlay();
    }
  });

  let observer: IntersectionObserver | null = null;
  if (opts.pauseWhenHidden ?? true) {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      holds.outOfView = !entry.isIntersecting;
      applyPlay();
    });
    observer.observe(container);
  }

  let isMounted = true;
  /** Everything but the container, which a failed boot keeps for its fallback image */
  const teardown = () => {
    isMounted = false;
    observer?.disconnect();
    removeFirstFrameHook?.();
    removeFirstFrameHook = null;
    stopMainLoop();
    removeAllInputListeners();
    stopAssetsWorker();
    if (getRenderer()) deleteRenderer();
    canvasParent.remove();
    setCanvasSizeSource(null);
    setInputScope('WINDOW');
    setAssetBaseUrl(null);
  };

  // A promise's catch, not a try block (Rollup keeps a try block's calls whole, see InitEngine)
  const isBooted = await bootEngineAsync({
    config: opts.config,
    data: opts.data,
    features: opts.features,
    hudSlot,
    start: async () => {
      await createRenderer({
        ...opts.renderer,
        parent: canvasParent,
        canvas: { ...opts.canvas, style: `display: block; ${opts.canvas?.style ?? ''}` },
      });
      await createSceneLoader({ id: MOUNT_SCENE_LOADER_ID });
      await loadScene({ sceneId });
    },
  }).then(
    () => true,
    (err: unknown) => {
      lerror('mountAekasha: the engine could not boot, showing the fallback image.', err);
      return false;
    }
  );
  if (!isBooted) {
    teardown();
    return createFallbackMount(container);
  }

  return {
    container,
    isFallback: false,
    loadScene: async (id) => {
      if (isMounted) await loadScene({ sceneId: id });
    },
    pause: () => {
      holds.user = true;
      if (isMounted) applyPlay();
    },
    resume: () => {
      holds.user = false;
      holds.reducedMotion = false;
      if (isMounted) applyPlay();
    },
    isPaused: () => !isPlaying,
    unmount: () => {
      if (!isMounted) return;
      teardown();
      container.remove();
    },
  };
};
