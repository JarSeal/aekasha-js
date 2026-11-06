import { describe, expect, it } from 'vitest';
import type { MRTNode, RenderTarget, Renderer } from 'three/webgpu';
import { runCompileAsync, runWithClearRenderState } from './CompileQueue';

/** A renderer stand-in with only the state runWithClearRenderState reads and writes */
const createRendererState = () => {
  const state = {
    target: null as RenderTarget | null,
    cubeFace: 0,
    mipmapLevel: 0,
    mrt: null as MRTNode | null,
  };
  const renderer = {
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.cubeFace,
    getActiveMipmapLevel: () => state.mipmapLevel,
    getMRT: () => state.mrt,
    setRenderTarget: (target: RenderTarget | null, cubeFace = 0, mipmapLevel = 0) => {
      state.target = target;
      state.cubeFace = cubeFace;
      state.mipmapLevel = mipmapLevel;
    },
    setMRT: (mrt: MRTNode | null) => {
      state.mrt = mrt;
    },
  } as unknown as Renderer;
  return { state, renderer };
};

describe('runCompileAsync', () => {
  it('starts a compile only once the earlier ones have ended, a failed one included', async () => {
    const calls: string[] = [];
    let releaseFirst = () => {};
    const first = runCompileAsync(async () => {
      calls.push('first start');
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      calls.push('first end');
      throw new Error('compile failed');
    });
    const second = runCompileAsync(async () => {
      calls.push('second');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['first start']);
    releaseFirst();
    await expect(first).rejects.toThrow('compile failed');
    await second;
    expect(calls).toEqual(['first start', 'first end', 'second']);
  });
});

describe('runWithClearRenderState', () => {
  it('renders without the held target and MRT, and puts them back', () => {
    const { state, renderer } = createRendererState();
    const target = {} as RenderTarget;
    const mrt = {} as MRTNode;
    renderer.setRenderTarget(target, 2, 1);
    renderer.setMRT(mrt);
    const seen = runWithClearRenderState(renderer, () => {
      // A nested render finds the state clear and holds nothing
      runWithClearRenderState(renderer, () => undefined);
      return [state.target, state.mrt];
    });
    expect(seen).toEqual([null, null]);
    expect(state).toEqual({ target, cubeFace: 2, mipmapLevel: 1, mrt });
  });

  it('puts them back when the render throws', () => {
    const { state, renderer } = createRendererState();
    const mrt = {} as MRTNode;
    renderer.setMRT(mrt);
    expect(() =>
      runWithClearRenderState(renderer, () => {
        throw new Error('render failed');
      })
    ).toThrow('render failed');
    expect(state.mrt).toBe(mrt);
    // And the next call holds again
    runWithClearRenderState(renderer, () => expect(state.mrt).toBeNull());
    expect(state.mrt).toBe(mrt);
  });

  it('touches nothing when nothing is set', () => {
    const { state, renderer } = createRendererState();
    let writes = 0;
    const countWrite = () => {
      writes++;
      return renderer;
    };
    renderer.setRenderTarget = countWrite;
    renderer.setMRT = countWrite;
    expect(runWithClearRenderState(renderer, () => 'frame')).toBe('frame');
    expect(writes).toBe(0);
    expect(state.target).toBeNull();
  });
});
