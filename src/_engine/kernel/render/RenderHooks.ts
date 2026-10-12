import type { RenderPipeline, Renderer } from 'three/webgpu';

// The render seams (p607 D5): the feature that renders the frame through a pipeline (`postFx()`)
// sets the provider, and the features that draw over the finished frame (`viewports()`) add an
// after-render hook. `MainLoop.renderScene` and `Snapshot.ts` read them, so the kernel imports
// neither feature.

/**
 * Returns the pipeline to render this frame with, or null to render the scene directly
 * (`FeatureContext.setRenderPipeline`). Called once per rendered frame, and by a snapshot of the
 * root scene with the active camera, which renders through it at its own size.
 */
export type RenderPipelineProvider = () => RenderPipeline | null;

/**
 * Draws over the finished frame (`FeatureContext.addAfterRender`): called once per rendered frame,
 * after the scene (and its pipeline) or the active editor view has rendered, in the order added.
 * Snapshots leave it out.
 */
export type AfterRenderHook = (renderer: Renderer, delta: number) => void;

let renderPipelineProvider: RenderPipelineProvider | null = null;
const afterRenderHooks: AfterRenderHook[] = [];

/**
 * Sets the render pipeline provider (`FeatureContext.setRenderPipeline`). Throws on a second one.
 * @internal
 */
export const setRenderPipeline = (provider: RenderPipelineProvider) => {
  if (renderPipelineProvider) {
    throw new Error(
      'setRenderPipeline: a render pipeline provider is already set (one feature renders the frame through a pipeline).'
    );
  }
  renderPipelineProvider = provider;
};

/**
 * The pipeline the provider returns for this frame, or null (no provider, or it renders directly).
 * @internal
 */
export const getRenderPipeline = () => (renderPipelineProvider ? renderPipelineProvider() : null);

/**
 * Adds an after-render hook (`FeatureContext.addAfterRender`). Returns the remover.
 * @internal
 */
export const addAfterRender = (hook: AfterRenderHook) => {
  afterRenderHooks.push(hook);
  return () => {
    const index = afterRenderHooks.indexOf(hook);
    if (index !== -1) afterRenderHooks.splice(index, 1);
  };
};

/**
 * Runs the after-render hooks. `MainLoop.renderScene` calls it once per rendered frame.
 * @internal
 */
export const runAfterRenderHooks = (renderer: Renderer, delta: number) => {
  for (let i = 0; i < afterRenderHooks.length; i++) afterRenderHooks[i](renderer, delta);
};
