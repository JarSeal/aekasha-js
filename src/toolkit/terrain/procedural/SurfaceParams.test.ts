import { describe, expect, it } from 'vitest';
import type { Color } from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { buildSurfaceParams, checkSurfaceParamSpecs } from './SurfaceParams';

const SPECS = {
  wavelength: { default: 0.12, min: 0.02, max: 0.5 },
  octaves: { default: 4, min: 1, max: 8, isStatic: true, isInteger: true },
  light: { type: 'color', default: '#808080' },
  seams: { type: 'boolean', default: false },
} as const;

const uniformValue = (node: unknown) => (node as UniformNode<'float', number | Color>).value;

describe('buildSurfaceParams', () => {
  it('makes numbers and colours uniforms, static numbers and toggles plain values', () => {
    const { nodes, values } = buildSurfaceParams('test', SPECS);
    expect(uniformValue(nodes.wavelength)).toBe(0.12);
    expect(nodes.octaves).toBe(4);
    expect(nodes.seams).toBe(false);
    // sRGB 0.5 is about 0.214 linear
    const light = uniformValue(nodes.light) as Color;
    expect(light.r).toBeCloseTo(0.2159, 3);
    expect(values).toEqual({ wavelength: 0.12, octaves: 4, light: '#808080', seams: false });
  });

  it('takes the given values over the defaults', () => {
    const { nodes, values } = buildSurfaceParams('test', SPECS, {
      wavelength: 0.3,
      octaves: 6,
      seams: true,
    });
    expect(uniformValue(nodes.wavelength)).toBe(0.3);
    expect(nodes.octaves).toBe(6);
    expect(nodes.seams).toBe(true);
    expect(values.light).toBe('#808080');
  });

  it('refuses an unknown name and a value its spec refuses, naming both', () => {
    expect(() => buildSurfaceParams('test', SPECS, { depth: 1 } as never)).toThrow(
      /\[test\] has no param "depth" \(params: wavelength, octaves, light, seams\)/
    );
    expect(() => buildSurfaceParams('test', SPECS, { wavelength: 0.6 })).toThrow(
      /"wavelength": 0.6 is above its max 0.5/
    );
    expect(() => buildSurfaceParams('test', SPECS, { octaves: 2.5 })).toThrow(
      /"octaves": 2.5 isn't a whole number/
    );
    expect(() => buildSurfaceParams('test', SPECS, { light: 'red' })).toThrow(
      /"light": "red" isn't an sRGB colour/
    );
    expect(() => buildSurfaceParams('test', SPECS, { seams: 1 } as never)).toThrow(
      /"seams": 1 isn't true or false/
    );
  });

  it('sets the uniforms later, refusing a static change and leaving the values on a refusal', () => {
    const params = buildSurfaceParams('test', SPECS);
    params.set({ wavelength: 0.2, light: '#ffffff' });
    expect(uniformValue(params.nodes.wavelength)).toBe(0.2);
    expect((uniformValue(params.nodes.light) as Color).r).toBeCloseTo(1, 5);
    expect(params.values.wavelength).toBe(0.2);
    // The same static value again is fine
    params.set({ octaves: 4 });
    expect(() => params.set({ octaves: 5 })).toThrow(/"octaves" is fixed when the graph is built/);
    expect(() => params.set({ seams: true })).toThrow(/"seams" is fixed/);
    expect(() => params.set({ wavelength: 9 })).toThrow(/above its max/);
    expect(params.values.wavelength).toBe(0.2);
  });
});

describe('checkSurfaceParamSpecs', () => {
  it('refuses a default its own spec refuses', () => {
    expect(() => checkSurfaceParamSpecs('test', SPECS)).not.toThrow();
    expect(() => checkSurfaceParamSpecs('test', { size: { default: 3, max: 2 } })).toThrow(
      /\[test\] The param "size"'s default: 3 is above its max 2/
    );
  });
});
