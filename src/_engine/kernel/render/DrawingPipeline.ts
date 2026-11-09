// The engine's seam on three's drawing pipeline (docs/plans/p354_gpu-driven-culling.md D5):
// `renderer.drawingPipeline` (a `StandardDrawingPipeline`, experimental in three r187) decides
// which objects of a render are drawn. Every render calls it, a nested one (a shadow map, rendered
// while the outer render's list is drawn) and a `compileAsync` projection included: `begin(camera)`,
// `beginRenderList`, `project` (which asks `isCulled` per object), then `finishRenderList`, after
// which the render's list is complete and nothing of it is drawn yet. That's where a GPU-driven
// draw dispatches its cull (three's own `MeshletDrawingPipeline` does too).
//
// Three's interface stays behind this file: the engine installs one subclass with the first hook
// and puts three's back with the last, and every user (instance sets; later p370's indirect draws,
// p375) adds a hook. Only lazy modules import it (an instance set's GPU backend), so it's in no
// first download.
import * as THREE from 'three/webgpu';
import { lwarn } from '../../utils/Logger';

/**
 * What a drawing pipeline hook can do in each render (see `addDrawingPipelineHook`). Every
 * callback is optional; the hooks are called in the order they were added.
 * @internal
 */
export type DrawingPipelineHook = {
  /** A render's projection starts (a `compileAsync`'s too), with its camera. */
  begin?: (camera: THREE.Camera, renderer: THREE.Renderer) => void;
  /** Whether `object` is culled in this render: `true` or `false` decides, `undefined` leaves it
   * to the next hook, and after the last one to three's frustum test. Called per object and
   * render: keep it cheap (a `userData` lookup). */
  isCulled?: (object: THREE.Object3D, camera: THREE.Camera) => boolean | undefined;
  /** The render's projection ended: its list is complete and nothing of it is drawn yet (a render
   * bundle's own list doesn't call it). */
  finishRenderList?: (camera: THREE.Camera, renderer: THREE.Renderer) => void;
};

type RendererPipelineState = {
  pipeline: EngineDrawingPipeline;
  /** The pipeline the engine's replaced, put back with the last hook. */
  previous: THREE.StandardDrawingPipeline;
};

const pipelineStates = new WeakMap<THREE.Renderer, RendererPipelineState>();

/** Three's standard pipeline calling the hooks. The hook list is replaced on every change (never
 * edited), so a hook removed during a render doesn't shift the others' calls. */
class EngineDrawingPipeline extends THREE.StandardDrawingPipeline {
  hooks: readonly DrawingPipelineHook[] = [];
  /** The renderer it's installed on (three sets `renderer` only through its own setter). */
  private readonly owner: THREE.Renderer;
  /** The camera of the render being projected. */
  private camera: THREE.Camera | null = null;
  /** The render's own list: the first one begun after `begin` (a bundle's begins inside it). */
  private renderList: unknown = null;
  private isListPending = false;

  constructor(owner: THREE.Renderer) {
    super();
    this.owner = owner;
  }

  override begin(camera: THREE.Camera, renderContext: unknown) {
    super.begin(camera, renderContext);
    this.camera = camera;
    this.renderList = null;
    this.isListPending = true;
    const { hooks } = this;
    for (let i = 0; i < hooks.length; i++) hooks[i].begin?.(camera, this.owner);
  }

  override beginRenderList(renderList: unknown) {
    super.beginRenderList(renderList);
    if (!this.isListPending) return;
    this.renderList = renderList;
    this.isListPending = false;
  }

  override isCulled(object: THREE.Object3D, camera: THREE.Camera) {
    const { hooks } = this;
    for (let i = 0; i < hooks.length; i++) {
      const isCulled = hooks[i].isCulled?.(object, camera);
      if (isCulled !== undefined) return isCulled;
    }
    return super.isCulled(object, camera);
  }

  override finishRenderList(renderList: unknown) {
    super.finishRenderList(renderList);
    if (renderList !== this.renderList || !this.camera) return;
    const camera = this.camera;
    this.renderList = null;
    const { hooks } = this;
    for (let i = 0; i < hooks.length; i++) hooks[i].finishRenderList?.(camera, this.owner);
  }
}

/**
 * Adds a hook to `renderer`'s drawing pipeline: the first one installs the engine's pipeline
 * (three's standard one calling the hooks), the last one's remover puts back the one it replaced.
 * @internal
 * @returns the remover (idempotent)
 * @remarks A pipeline set on the renderer meanwhile by someone else stays: the remover then only
 * warns, and the hooks stop being called.
 */
export const addDrawingPipelineHook = (renderer: THREE.Renderer, hook: DrawingPipelineHook) => {
  let state = pipelineStates.get(renderer);
  if (!state) {
    const previous = renderer.drawingPipeline;
    if (previous.constructor !== THREE.StandardDrawingPipeline) {
      lwarn(
        `[DrawingPipeline] Replacing the renderer's own drawing pipeline (${previous.constructor.name}) while engine hooks are in use; it comes back with the last hook's removal.`
      );
    }
    state = { pipeline: new EngineDrawingPipeline(renderer), previous };
    pipelineStates.set(renderer, state);
    renderer.drawingPipeline = state.pipeline;
  }
  const { pipeline, previous } = state;
  pipeline.hooks = [...pipeline.hooks, hook];

  let isRemoved = false;
  return () => {
    if (isRemoved) return;
    isRemoved = true;
    pipeline.hooks = pipeline.hooks.filter((h) => h !== hook);
    if (pipeline.hooks.length > 0) return;
    pipelineStates.delete(renderer);
    if (renderer.drawingPipeline === pipeline) {
      renderer.drawingPipeline = previous;
    } else {
      lwarn(
        "[DrawingPipeline] The renderer's drawing pipeline was replaced while engine hooks were in use: leaving the new one."
      );
    }
  };
};

/**
 * The hooks on `renderer`'s drawing pipeline, in call order (empty when the engine's isn't
 * installed). For the tests and the debug tools.
 * @internal
 */
export const getDrawingPipelineHooks = (renderer: THREE.Renderer): readonly DrawingPipelineHook[] =>
  pipelineStates.get(renderer)?.pipeline.hooks ?? [];
