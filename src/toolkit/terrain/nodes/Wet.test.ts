import { describe, expect, it } from 'vitest';
import { float, uniform, vec3 } from 'three/tsl';
import { Vector2, type Node } from 'three/webgpu';
import type { SurfaceConditionNodes } from 'aekasha/surface';
import { applySurfaceWetness, type WetSurfaceInput } from './Wet';

/** The nodes the roots reach, each once */
const collectNodes = (roots: unknown[]) => {
  const nodes = new Set<unknown>();
  const stack = [...roots] as (Node | null)[];
  while (stack.length) {
    const node = stack.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    for (const child of node.getChildren()) stack.push(child as Node);
  }
  return nodes;
};

const makeConditions = () =>
  ({
    wetness: uniform(0.6),
    rain: uniform(0),
    puddleLevel: uniform(0),
    waterLevel: uniform(-1e9),
    snowCoverage: uniform(0),
    temperature: uniform(10),
    wind: uniform(new Vector2()),
    time: uniform(0),
  }) as unknown as SurfaceConditionNodes;

const makeSurface = (): WetSurfaceInput &
  Required<Pick<WetSurfaceInput, 'normal' | 'height' | 'cavity'>> => ({
  albedo: vec3(0.5, 0.4, 0.3) as unknown as Node<'vec3'>,
  roughness: float(0.8) as unknown as Node<'float'>,
  normal: vec3(0, 1, 0) as unknown as Node<'vec3'>,
  height: uniform(0.4) as unknown as Node<'float'>,
  cavity: uniform(0.2) as unknown as Node<'float'>,
  response: {
    porosity: uniform(0.7) as unknown as Node<'float'>,
    wetDarkening: uniform(0.6) as unknown as Node<'float'>,
    wetRoughness: 0.15,
  },
});

describe('applySurfaceWetness', () => {
  it("wets the albedo, the roughness and the normal by the conditions' wetness and the response", () => {
    const conditions = makeConditions();
    const surface = makeSurface();
    const wet = applySurfaceWetness(surface, conditions);
    const albedo = collectNodes([wet.albedo]);
    expect(albedo.has(conditions.wetness)).toBe(true);
    expect(albedo.has(surface.response.porosity)).toBe(true);
    expect(albedo.has(surface.response.wetDarkening)).toBe(true);
    // FULL: the relief and the cavity shape the local wetness
    expect(albedo.has(surface.height)).toBe(true);
    expect(albedo.has(surface.cavity)).toBe(true);
    expect(collectNodes([wet.roughness]).has(conditions.wetness)).toBe(true);
    expect(wet.normal).toBeTruthy();
    expect(collectNodes([wet.normal]).has(conditions.wetness)).toBe(true);
    for (const mask of Object.values(wet.masks)) expect(mask).toBeTruthy();
    // The film's stage reads the porosity (a dense surface films at once)
    expect(collectNodes([wet.masks.film]).has(surface.response.porosity)).toBe(true);
  });

  it('SIMPLE reads no relief, no cavity and leaves the normal', () => {
    const conditions = makeConditions();
    const surface = makeSurface();
    const wet = applySurfaceWetness(surface, conditions, { quality: 'SIMPLE' });
    const albedo = collectNodes([wet.albedo]);
    expect(albedo.has(conditions.wetness)).toBe(true);
    expect(albedo.has(surface.height)).toBe(false);
    expect(albedo.has(surface.cavity)).toBe(false);
    expect(wet.normal).toBe(surface.normal);
  });

  it('takes its exposure, normals and influences as nodes or numbers', () => {
    const conditions = makeConditions();
    const { normal: _normal, ...surface } = makeSurface();
    const up = uniform(0.3) as unknown as Node<'float'>;
    const shelter = uniform(new Vector2(30, 90)) as unknown as Node<'vec2'>;
    const heightInfluence = uniform(1) as unknown as Node<'float'>;
    const wet = applySurfaceWetness(surface, conditions, { up, shelter, heightInfluence });
    const exposure = collectNodes([wet.masks.exposure]);
    expect(exposure.has(up)).toBe(true);
    expect(exposure.has(shelter)).toBe(true);
    expect(collectNodes([wet.masks.wetness]).has(heightInfluence)).toBe(true);
    expect(wet.normal).toBeUndefined();
    // The film flattens toward the geometry normal given
    const geometryNormal = vec3(0, 0, 1) as unknown as Node<'vec3'>;
    const flattened = applySurfaceWetness(makeSurface(), conditions, {
      geometryNormal,
      shelter: [0, 90],
    });
    expect(collectNodes([flattened.normal]).has(geometryNormal)).toBe(true);
  });
});
