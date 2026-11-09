import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { addDrawingPipelineHook, getDrawingPipelineHooks } from './DrawingPipeline';

// p354 D5: the engine's drawing pipeline seam, on a stub renderer (three's pipeline needs only the
// renderer's `drawingPipeline` for what's tested here)

const createRenderer = () => {
  const three = new THREE.StandardDrawingPipeline();
  const renderer = { drawingPipeline: three } as unknown as THREE.Renderer;
  return { renderer, three };
};

const createList = () => ({ begin: vi.fn(), finish: vi.fn() });

const createCamera = () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  return camera;
};

/** A render's calls into the pipeline, as three's `_renderScene` makes them (the projection's
 * object visits left out). */
const render = (renderer: THREE.Renderer, camera: THREE.Camera, list = createList()) => {
  const pipeline = renderer.drawingPipeline;
  pipeline.begin(camera, {});
  pipeline.beginRenderList(list);
  pipeline.finishRenderList(list);
  return list;
};

describe('addDrawingPipelineHook', () => {
  test("the first hook installs the engine's pipeline, the last one's removal puts three's back", () => {
    const { renderer, three } = createRenderer();
    const removeA = addDrawingPipelineHook(renderer, {});
    const engine = renderer.drawingPipeline;
    expect(engine).not.toBe(three);
    expect(engine).toBeInstanceOf(THREE.StandardDrawingPipeline);

    const removeB = addDrawingPipelineHook(renderer, {});
    expect(renderer.drawingPipeline).toBe(engine);
    removeA();
    expect(renderer.drawingPipeline).toBe(engine);
    removeB();
    expect(renderer.drawingPipeline).toBe(three);
    expect(getDrawingPipelineHooks(renderer)).toEqual([]);

    // Installed again with a new hook, the old removers do nothing
    addDrawingPipelineHook(renderer, {});
    removeB();
    expect(renderer.drawingPipeline).not.toBe(three);
  });

  test('calls the hooks in the order they were added, with the render camera', () => {
    const { renderer } = createRenderer();
    const calls: string[] = [];
    const camera = createCamera();
    for (const id of ['a', 'b']) {
      addDrawingPipelineHook(renderer, {
        begin: (c, r) => {
          expect(c).toBe(camera);
          expect(r).toBe(renderer);
          calls.push(`begin ${id}`);
        },
        finishRenderList: (c, r) => {
          expect(c).toBe(camera);
          expect(r).toBe(renderer);
          calls.push(`finish ${id}`);
        },
      });
    }
    const list = render(renderer, camera);
    expect(calls).toEqual(['begin a', 'begin b', 'finish a', 'finish b']);
    // Three's own list calls still run
    expect(list.begin).toHaveBeenCalledTimes(1);
    expect(list.finish).toHaveBeenCalledTimes(1);
  });

  test("finishRenderList is the render's own list's, not a render bundle's inside it", () => {
    const { renderer } = createRenderer();
    const finish = vi.fn();
    addDrawingPipelineHook(renderer, { finishRenderList: finish });
    const pipeline = renderer.drawingPipeline;
    const top = createList();
    const bundle = createList();
    pipeline.begin(createCamera(), {});
    pipeline.beginRenderList(top);
    // A BundleGroup's list, projected and finished during the render's projection
    pipeline.beginRenderList(bundle);
    pipeline.finishRenderList(bundle);
    expect(finish).not.toHaveBeenCalled();
    pipeline.finishRenderList(top);
    expect(finish).toHaveBeenCalledTimes(1);
    // A second finish of the same list (no new begin) isn't another render
    pipeline.finishRenderList(top);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  test("isCulled: the first hook's answer decides, undefined passes on, then three's test", () => {
    const { renderer } = createRenderer();
    const camera = createCamera();
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    const mine = new THREE.Mesh(new THREE.BoxGeometry());
    mine.userData.mine = true;
    // Behind the camera (it looks down -z): three culls it
    const behind = new THREE.Mesh(new THREE.BoxGeometry());
    behind.position.set(0, 0, 10);
    behind.updateMatrixWorld();

    const second = vi.fn(() => false);
    addDrawingPipelineHook(renderer, {
      isCulled: (object) => (object.userData.mine ? true : undefined),
    });
    addDrawingPipelineHook(renderer, {
      isCulled: (object) => (object === behind ? undefined : second()),
    });
    const pipeline = renderer.drawingPipeline;
    pipeline.begin(camera, {});
    expect(pipeline.isCulled(mine, camera)).toBe(true);
    expect(second).not.toHaveBeenCalled();
    expect(pipeline.isCulled(behind, camera)).toBe(true);
    behind.frustumCulled = false;
    expect(pipeline.isCulled(behind, camera)).toBe(false);
  });

  test('a hook removed during a render leaves the others called', () => {
    const { renderer } = createRenderer();
    const calls: string[] = [];
    const removeA = addDrawingPipelineHook(renderer, {
      begin: () => {
        calls.push('a');
        removeA();
      },
    });
    addDrawingPipelineHook(renderer, { begin: () => calls.push('b') });
    render(renderer, createCamera());
    render(renderer, createCamera());
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  test('a pipeline set meanwhile by someone else stays', () => {
    const { renderer } = createRenderer();
    const remove = addDrawingPipelineHook(renderer, {});
    const other = new THREE.StandardDrawingPipeline();
    renderer.drawingPipeline = other;
    remove();
    expect(renderer.drawingPipeline).toBe(other);
  });
});
