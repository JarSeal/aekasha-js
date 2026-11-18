import { describe, expect, it } from 'vitest';
import { float, texture, uniform, vec3 } from 'three/tsl';
import { Texture, Vector2, type Node, type TextureNode } from 'three/webgpu';
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

  it("shows the overall wetness to the drying speed's power; 1 or none adds no power", () => {
    const conditions = makeConditions();
    const dryingSpeed = uniform(1.6) as unknown as Node<'float'>;
    const surface = makeSurface();
    const wet = applySurfaceWetness(
      { ...surface, response: { ...surface.response, dryingSpeed } },
      conditions
    );
    const countPow = (root: unknown) =>
      [...collectNodes([root])].filter((node) => (node as { method?: string }).method === 'pow')
        .length;
    expect(collectNodes([wet.masks.wetness]).has(dryingSpeed)).toBe(true);
    expect(countPow(wet.masks.wetness)).toBe(1);
    const alike = applySurfaceWetness(
      { ...surface, response: { ...surface.response, dryingSpeed: 1 } },
      conditions
    );
    expect(countPow(alike.masks.wetness)).toBe(0);
    expect(countPow(applySurfaceWetness(surface, conditions).masks.wetness)).toBe(0);
  });

  it('films as far as water stands on it, and darkens by wetDarkening alone', () => {
    const conditions = makeConditions();
    const puddleResponse = uniform(0.2) as unknown as Node<'float'>;
    const surface = makeSurface();
    const wet = applySurfaceWetness(
      { ...surface, response: { ...surface.response, puddleResponse } },
      conditions
    );
    expect(collectNodes([wet.masks.film]).has(puddleResponse)).toBe(true);
    expect(collectNodes([wet.roughness]).has(puddleResponse)).toBe(true);
    // The darkening's product: the pores' stage (by the porosity) × wetDarkening, no second porosity
    const products = [...collectNodes([wet.albedo])].filter(
      (node) =>
        (node as { op?: string }).op === '*' &&
        (node as { bNode?: unknown }).bNode === wet.masks.pores
    );
    expect(products).toHaveLength(1);
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

  it('ripples where water stands while it rains: the normal takes the branch, the mask reads the rain', () => {
    const conditions = makeConditions();
    const surface = makeSurface();
    const atlas = texture(new Texture()) as unknown as TextureNode;
    const fade = uniform(1) as unknown as Node<'float'>;
    const wet = applySurfaceWetness(surface, conditions, {
      puddles: {},
      ripples: { atlas, fade },
    });
    // The normal adds the ripples' branch: one Fn call more (its body reads the rain and the
    // clock, Ripples.test.ts; three's normal nodes are calls too)
    const countCalls = (root: unknown) =>
      [...collectNodes([root])].filter((node) => (node as { shaderNode?: unknown }).shaderNode)
        .length;
    // Its weight: the standing water (the puddle's level, the film) × the fade, × the rain
    const ripple = collectNodes([wet.masks.ripple]);
    for (const node of [conditions.rain, conditions.puddleLevel, fade]) {
      expect(ripple.has(node)).toBe(true);
    }
    // The albedo and roughness don't read it
    expect(collectNodes([wet.albedo]).has(conditions.rain)).toBe(false);
    // Without ripples, nothing reads the rain; SIMPLE and a surface without a normal have none
    const dry = applySurfaceWetness(surface, conditions, { puddles: {} });
    expect(collectNodes([dry.normal, dry.masks.ripple]).has(conditions.rain)).toBe(false);
    expect(countCalls(wet.normal)).toBe(countCalls(dry.normal) + 1);
    const simple = applySurfaceWetness(surface, conditions, {
      quality: 'SIMPLE',
      ripples: { atlas },
    });
    expect(simple.normal).toBe(surface.normal);
    expect(collectNodes([simple.masks.ripple]).has(conditions.rain)).toBe(false);
    const { normal: _normal, ...unshaded } = surface;
    const noNormal = applySurfaceWetness(unshaded, conditions, { ripples: { atlas } });
    expect(collectNodes([noNormal.masks.ripple]).has(conditions.rain)).toBe(false);
  });

  it('streaks steep faces in either quality: the colour and roughness take the branch, the mask reads the weather', () => {
    const conditions = makeConditions();
    const surface = makeSurface();
    const noise = texture(new Texture()) as unknown as TextureNode;
    const up = uniform(0) as unknown as Node<'float'>;
    const minSlope = uniform(70) as unknown as Node<'float'>;
    const countCalls = (root: unknown) =>
      [...collectNodes([root])].filter((node) => (node as { shaderNode?: unknown }).shaderNode)
        .length;
    const plain = applySurfaceWetness(surface, conditions, { up });
    for (const quality of ['FULL', 'SIMPLE'] as const) {
      const wet = applySurfaceWetness(surface, conditions, {
        quality,
        up,
        streaks: { texture: noise, minSlope },
      });
      // Its weight: the face's steepness (the facing, the slope) × the rain or the wetness
      const streak = collectNodes([wet.masks.streak]);
      for (const node of [conditions.rain, conditions.wetness, up, minSlope]) {
        expect(streak.has(node)).toBe(true);
      }
      // The rivulets darken (the pores) and gloss (the film): one Fn call more each
      expect(countCalls(wet.albedo)).toBe(countCalls(plain.albedo) + 1);
      expect(countCalls(wet.roughness)).toBe(countCalls(plain.roughness) + 1);
    }
    expect(collectNodes([plain.masks.streak]).has(conditions.rain)).toBe(false);
  });
});
