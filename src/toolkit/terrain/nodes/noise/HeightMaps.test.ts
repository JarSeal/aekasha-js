import { describe, expect, it } from 'vitest';
import { float, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { heightToCavity, heightToNormal } from './HeightMaps';

const uv = vec2(0.5, 0.5) as unknown as Node<'vec2'>;
const texel = vec2(1 / 256, 1 / 128) as unknown as Node<'vec2'>;

/** A height function that records the uvs it's built for */
const recordingHeight = () => {
  const taps: Node<'vec2'>[] = [];
  const height = (at: Node<'vec2'>) => {
    taps.push(at);
    return float(0.5) as unknown as Node<'float'>;
  };
  return { taps, height };
};

describe('heightToNormal', () => {
  it('builds the height at four taps around the point, never at the point', () => {
    const { taps, height } = recordingHeight();
    const normal = heightToNormal(height, { uv, texel, heightScale: 0.02 });
    expect(normal.isNode).toBe(true);
    expect(taps).toHaveLength(4);
    expect(taps).not.toContain(uv);
  });
});

describe('heightToCavity', () => {
  it('builds the height at the point and a ring of 8', () => {
    const { taps, height } = recordingHeight();
    const ao = heightToCavity(height, { uv, radius: 0.01 });
    expect(ao.isNode).toBe(true);
    expect(taps).toHaveLength(9);
    expect(taps[8]).toBe(uv);
  });

  it('refuses a radius that isn’t above 0', () => {
    const { height } = recordingHeight();
    expect(() => heightToCavity(height, { uv, radius: 0 })).toThrow(/radius is 0/);
  });
});
