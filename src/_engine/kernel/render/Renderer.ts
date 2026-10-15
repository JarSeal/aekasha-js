import * as THREE from 'three/webgpu';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { getCanvasSize } from './CanvasSize';
import { lerror, lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import { lsGetItem } from '../../utils/LocalAndSessionStorage';
import { existsOrThrow } from '../../utils/Assert';
import type { DebugModuleRef } from '../config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../config/DebugModules';

let r: THREE.WebGPURenderer | null = null;
let rendererCreatedCallbacks: ((renderer: THREE.WebGPURenderer) => void)[] = [];
/** The element createRenderer put the canvas in (null: `#mainCanvas`, looked up) */
let canvasParent: HTMLElement | null = null;
const ELEM_ID = 'mainCanvas';
const CANVAS_ID = 'AEK_CANVAS_ELEM';
const LS_KEY = 'debugRenderer';
let options: RendererOptions = {
  antialias: true,
  forceWebGL: false,
  devicePixelRatio: 1,
  currentApi: 'WebGL',
  currentApiIsWebGPU: false,
  currentApiIsWebGL: true,
  toneMapping: THREE.NoToneMapping,
  toneMappingExposure: 1,
  outputColorSpace: THREE.SRGBColorSpace,
  alpha: false,
  enableShadows: false,
  shadowMapType: THREE.BasicShadowMap,
};

export type RendererOptions = {
  antialias?: boolean;
  forceWebGL?: boolean;
  devicePixelRatio?: number;
  currentApi: 'WebGL' | 'WebGL2' | 'WebGPU';
  currentApiIsWebGPU: boolean;
  currentApiIsWebGL: boolean;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  outputColorSpace: THREE.ColorSpace;
  alpha?: boolean;
  enableShadows?: boolean;
  shadowMapType?: THREE.ShadowMapType;
};

/** The canvas element's own attributes, set by {@link createRenderer}. */
export type RendererCanvasOptions = {
  /** The canvas's id. Default: `AEK_CANVAS_ELEM`. */
  id?: string;
  /** Class names for the canvas, space separated. */
  className?: string;
  /** Inline CSS for the canvas (`'border-radius: 8px'`). Its width and height are the
   * renderer's: it sets them to the canvas's size. */
  style?: string;
};

/** {@link createRenderer}'s options: the renderer's, and where its canvas goes. */
export type CreateRendererOptions = Partial<RendererOptions> & {
  /** The element the canvas is appended to. Default: the page's `#mainCanvas` element. */
  parent?: HTMLElement;
  /** The canvas's id, classes and inline styles. */
  canvas?: RendererCanvasOptions;
};

/**
 * Creates the Three.js WebGPU renderer (WebGL2 when WebGPU isn't available or `forceWebGL`),
 * sized to the canvas's size (the window, or the element the engine is mounted into), and
 * appends its canvas to `parent`. A second call returns the first renderer.
 * @param opts the renderer's options and its canvas's place and attributes
 * @returns the renderer, after its `init()`
 */
export const createRenderer = async (opts?: CreateRendererOptions) => {
  if (r) return r;

  const { parent, canvas, ...rendererOpts } = opts ?? {};
  const canvasSize = getCanvasSize();

  setRendererOptions(rendererOpts);

  const renderer = new THREE.WebGPURenderer({
    antialias: options.antialias,
    forceWebGL: options.currentApiIsWebGL || options.forceWebGL,
    alpha: options.alpha,
  });
  const canvasElem = renderer.domElement;
  canvasElem.id = canvas?.id ?? CANVAS_ID;
  if (canvas?.className) canvasElem.className = canvas.className;
  // Before setSize, which sets the canvas's width and height
  if (canvas?.style) canvasElem.style.cssText = canvas.style;
  renderer.toneMapping = options.toneMapping;
  renderer.toneMappingExposure = options.toneMappingExposure;
  renderer.outputColorSpace = options.outputColorSpace;
  renderer.debug.checkShaderErrors = IS_DEBUG_ENV;

  renderer.shadowMap.enabled = options.enableShadows || false;
  if (rendererOpts.shadowMapType) {
    renderer.shadowMap.type = options.shadowMapType || THREE.BasicShadowMap;
  }

  renderer.setPixelRatio(options.devicePixelRatio || window.devicePixelRatio);
  renderer.setSize(canvasSize.width, canvasSize.height);

  const canvasParentElem = parent ?? getCanvasParentElem();
  canvasParentElem.appendChild(canvasElem);
  canvasParent = canvasParentElem;

  r = renderer;
  const callbacks = rendererCreatedCallbacks;
  rendererCreatedCallbacks = [];
  for (const fn of callbacks) fn(renderer);

  await renderer.init();

  return renderer;
};

/**
 * Runs `fn` with the renderer once createRenderer has constructed it, before its init() (so it
 * sees every GPU resource the renderer creates), or right away if it already exists.
 * @param fn callback, called once
 */
export const onRendererCreated = (fn: (renderer: THREE.WebGPURenderer) => void) => {
  if (r) fn(r);
  else rendererCreatedCallbacks.push(fn);
};

/**
 * Returns the element the canvas is in: `createRenderer`'s `parent`, else the page's
 * `#mainCanvas` element.
 * @returns HTMLElement
 */
export const getCanvasParentElem = () => {
  if (canvasParent) return canvasParent;
  const canvasParentElem = document.getElementById(ELEM_ID);
  if (!canvasParentElem) {
    throw new Error(`Canvas parent element with id "${ELEM_ID}" was not found.`);
  }
  return canvasParentElem;
};

/** Returns the renderer's canvas (before createRenderer, the element with the default id). */
export const getCanvasElem = () =>
  r?.domElement ??
  existsOrThrow(
    document.getElementById(CANVAS_ID),
    `Could not find a canvas element with id "${CANVAS_ID}".`
  );

/**
 * Returns the initialized renderer or null
 * @param throwOnError (boolean) optional flag to throw if renderer is not defined
 * @returns THREE.WebGPURenderer | null
 */
export const getRenderer = (throwOnError?: boolean) => {
  if (!r && throwOnError) {
    const msg = 'Renderer is not defined (not created) in getRenderer.';
    lerror(msg);
    throw new Error(msg);
  }
  return r;
};

/**
 * Deletes the initialized renderer
 */
export const deleteRenderer = () => {
  if (!r) {
    lwarn(`The renderer has not been created or it has been deleted, in deleteRenderer(id).`);
    return;
  }
  r.dispose();
  r = null;
};

const setRendererOptions = async (opts?: Partial<RendererOptions>) => {
  options = { ...options, ...opts };
  options.antialias = Boolean(opts?.antialias);
  options.forceWebGL = Boolean(opts?.forceWebGL);
  options.devicePixelRatio = opts?.devicePixelRatio || window?.devicePixelRatio || 1;

  if (IS_DEBUG_ENV) {
    const savedOptions = lsGetItem(LS_KEY, options);
    options = { ...options, ...opts, ...savedOptions };
  }

  if (!options.forceWebGL && 'gpu' in navigator) {
    options.currentApi = 'WebGPU';
    options.currentApiIsWebGPU = true;
    options.currentApiIsWebGL = false;
  } else {
    options.currentApi = WebGL.isWebGL2Available() ? 'WebGL2' : 'WebGL';
    options.currentApiIsWebGPU = false;
    options.currentApiIsWebGL = true;
  }
};

/**
 * Returns render options object
 * @returns (object) {@link RendererOptions}
 */
export const getRendererOptions = () => options;

export const isWebGPURenderer = () => options.currentApiIsWebGPU;
export const isWebGLRenderer = () => options.currentApiIsWebGL;

// Debug
type RendererGUIModule = typeof import('./debug/_dbg__Renderer');
let debugGUI: DebugModuleRef<RendererGUIModule> | null = null;

export const createRendererDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__Renderer'));
  useDebug(debugGUI)?._createRendererDebugGUI(options, r, LS_KEY);
};
