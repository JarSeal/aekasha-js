import { describe, expect, it } from 'vitest';
import type { RenderPipeline, Renderer } from 'three/webgpu';
import {
  addAfterRender,
  getRenderPipeline,
  runAfterRenderHooks,
  setRenderPipeline,
} from './RenderHooks';

const renderer = {} as Renderer;

describe('render hooks', () => {
  it('reads the pipeline from the one provider, and refuses a second', () => {
    expect(getRenderPipeline()).toBeNull();
    const pipeline = {} as RenderPipeline;
    let isOn = false;
    setRenderPipeline(() => (isOn ? pipeline : null));
    expect(getRenderPipeline()).toBeNull();
    isOn = true;
    expect(getRenderPipeline()).toBe(pipeline);
    expect(() => setRenderPipeline(() => null)).toThrow(/already set/);
  });

  it('runs the after-render hooks in the order added, until removed', () => {
    const calls: string[] = [];
    const removeA = addAfterRender((r, delta) => calls.push(`a:${r === renderer}:${delta}`));
    const removeB = addAfterRender(() => calls.push('b'));
    runAfterRenderHooks(renderer, 0.5);
    removeA();
    runAfterRenderHooks(renderer, 1);
    removeB();
    runAfterRenderHooks(renderer, 2);
    expect(calls).toEqual(['a:true:0.5', 'b', 'b']);
  });
});
