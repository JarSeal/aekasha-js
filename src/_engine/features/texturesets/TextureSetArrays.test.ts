import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { TextureSetDef } from '../../schemas/TextureSetSchema';
import {
  buildTextureSetArray,
  getTextureSetArray,
  getTextureSetLayerParams,
  setTextureSetArrayLayer,
} from './TextureSetArrays';

// The texture registry, the kernel's array builds and swaps, the declarations and the sets are
// stand-ins: a build registers a 1 × 1 array under its id (or rejects when a member's id is in
// `failing`), and records its props; a swap records its call (or rejects likewise)
const fns = vi.hoisted(() => ({
  registered: new Map<string, unknown>(),
  declarations: new Map<string, { id: string; fileName: string }>(),
  sets: new Map<string, unknown>(),
  failing: new Set<string>(),
  builds: [] as { id: string; members: unknown[]; swappable?: boolean }[],
  swaps: [] as [string, number, unknown][],
  deleted: [] as string[],
}));
const memberId = (member: unknown) =>
  typeof member === 'string' ? member : (member as { id: string }).id;
vi.mock(import('../../kernel/assets/Texture'), () => ({
  getTexture: (id: string) => fns.registered.get(id) as never,
  deleteTexture: ((id: string) => {
    fns.deleted.push(id);
    (fns.registered.get(id) as THREE.Texture | undefined)?.dispose();
    fns.registered.delete(id);
  }) as never,
}));
vi.mock(import('../../kernel/assets/TextureArray'), () => ({
  buildTextureArray: (async (props: { id: string; members: unknown[]; swappable?: boolean }) => {
    fns.builds.push(props);
    await Promise.resolve();
    const failing = props.members.map(memberId).find((id) => fns.failing.has(id));
    if (failing) throw new Error(`member "${failing}" is 512 × 512, layer 0 is 1024 × 1024.`);
    const existing = fns.registered.get(props.id);
    if (existing) return existing;
    const array = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1);
    fns.registered.set(props.id, array);
    return array;
  }) as never,
  setTextureArrayLayer: (async (id: string, layer: number, member: unknown) => {
    fns.swaps.push([id, layer, member]);
    await Promise.resolve();
    if (fns.failing.has(memberId(member))) throw new Error(`"${memberId(member)}" doesn't fit.`);
  }) as never,
}));
vi.mock(import('../../kernel/assets/MaterialDependencies'), () => ({
  findTextureDeclaration: ((id: string) => fns.declarations.get(id)) as never,
}));
vi.mock(import('./TextureSets'), () => ({
  getTextureSet: ((id: string) => fns.sets.get(id)) as never,
}));

const makeSet = (id: string, extra: Partial<TextureSetDef> = {}): TextureSetDef => ({
  id,
  category: 'SAND',
  physicalSize: [3, 2],
  heightScale: 0.03,
  defaultPacking: 'LITE',
  packings: {
    LITE: { albedoRough: `${id}_albedoRough`, normalHeight: `${id}_normalHeight` },
  },
  surface: {
    tint: '#ffffff',
    normalStrength: 1,
    roughnessScale: 0.9,
    aoStrength: 1,
    heightContrast: 1.5,
    porosity: 0.85,
    wetDarkening: 0.55,
    wetRoughness: 0.4,
  },
  ...extra,
});

/** Declares both LITE textures of each set (none registered) */
const addSets = (...sets: TextureSetDef[]) => {
  for (const set of sets) {
    fns.sets.set(set.id, set);
    for (const slot of ['albedoRough', 'normalHeight']) {
      const id = `${set.id}_${slot}`;
      fns.declarations.set(id, { id, fileName: `${id}.ktx2` });
    }
  }
};

const paramsOf = (values: unknown[], layer: number) =>
  (values as THREE.Vector4[]).slice(layer * 4, layer * 4 + 4).map((v) => v.toArray());

beforeEach(() => {
  fns.registered.clear();
  fns.declarations.clear();
  fns.sets.clear();
  fns.failing.clear();
  fns.builds.length = 0;
  fns.swaps.length = 0;
  fns.deleted.length = 0;
  addSets(
    makeSet('sand'),
    makeSet('rock', {
      physicalSize: [6, 6],
      heightScale: 0.2,
      surface: { ...makeSet('x').surface, tint: '#ff0000', wetRoughness: 0.1 },
    }),
    makeSet('mud'),
    makeSet('ice', { packings: { FULL: { albedoHeight: 'a', normal: 'n', orm: 'o' } } })
  );
});

describe('buildTextureSetArray', () => {
  test('builds one array per slot, layer i from sets[i], with the layers params', async () => {
    const borrowed = new THREE.Texture();
    fns.registered.set('rock_albedoRough', borrowed);

    const built = await buildTextureSetArray({ sets: ['sand', 'rock'], packing: 'LITE' });

    expect(built.id).toMatch(/^tsa:/);
    expect(built.layerCount).toBe(2);
    expect(built.sets).toEqual(['sand', 'rock']);
    expect(fns.builds.map(({ id }) => id)).toEqual([
      `${built.id}.albedoRough`,
      `${built.id}.normalHeight`,
    ]);
    // A registered texture is borrowed by its id, another loaded from its declaration
    expect(fns.builds[0].members).toEqual([
      { id: 'sand_albedoRough', fileName: 'sand_albedoRough.ktx2' },
      'rock_albedoRough',
    ]);
    expect(built.arrays.albedoRough).toBe(fns.registered.get(`${built.id}.albedoRough`));
    expect(built.arrays.normalHeight).toBe(fns.registered.get(`${built.id}.normalHeight`));
    expect(getTextureSetArray(built.id)).toBe(built);

    const values = built.layerParams.array;
    expect(values).toHaveLength(8);
    expect(paramsOf(values, 0)).toEqual([
      [3, 2, 0.03, 1.5],
      [1, 1, 1, 1],
      [0.9, 1, 0.85, 0.55],
      [0.4, 0, 0, 0],
    ]);
    // The tint is linear
    expect(paramsOf(values, 1)[0]).toEqual([6, 6, 0.2, 1.5]);
    expect(paramsOf(values, 1)[1]).toEqual([1, 0, 0, 1]);
    expect(paramsOf(values, 1)[3][0]).toBe(0.1);
  });

  test('derives one id per packing and list, and a build of a registered one returns it', async () => {
    const first = await buildTextureSetArray({ sets: ['sand', 'rock'], packing: 'LITE' });
    const again = await buildTextureSetArray({ sets: ['sand', 'rock'], packing: 'LITE' });
    const other = await buildTextureSetArray({ sets: ['rock', 'sand'], packing: 'LITE' });

    expect(again).toBe(first);
    expect(other.id).not.toBe(first.id);
    // Two overlapping builds share one entry
    const [a, b] = await Promise.all([
      buildTextureSetArray({ id: 'ground', sets: ['sand'], packing: 'LITE' }),
      buildTextureSetArray({ id: 'ground', sets: ['sand'], packing: 'LITE' }),
    ]);
    expect(a).toBe(b);
  });

  test('gives a swappable array a unique id', async () => {
    const a = await buildTextureSetArray({ sets: ['sand'], packing: 'LITE', swappable: true });
    const b = await buildTextureSetArray({ sets: ['sand'], packing: 'LITE', swappable: true });

    expect(a.id).not.toBe(b.id);
    expect(a.swappable).toBe(true);
    expect(fns.builds.every(({ swappable }) => swappable)).toBe(true);
  });

  test('drops the set array when one of its arrays is disposed', async () => {
    const built = await buildTextureSetArray({ id: 'ground', sets: ['sand'], packing: 'LITE' });

    built.arrays.normalHeight.dispose();

    expect(getTextureSetArray('ground')).toBeUndefined();
  });

  test('refuses before building: no sets, a packing, an unknown set or texture, a taken id', async () => {
    const reject = (props: Parameters<typeof buildTextureSetArray>[0]) =>
      expect(buildTextureSetArray(props)).rejects;

    await reject({ sets: [], packing: 'LITE' }).toThrow('at least one set');
    await reject({ sets: ['sand'], packing: 'HUGE' as never }).toThrow('"HUGE" isn\'t a packing');
    await reject({ sets: ['sand', 'snow'], packing: 'LITE' }).toThrow(
      'no data has the texture set "snow"'
    );
    await reject({ sets: ['sand', 'ice'], packing: 'LITE' }).toThrow(
      'the texture set "ice" has no packing "LITE" (packings: FULL)'
    );
    fns.declarations.delete('mud_normalHeight');
    await reject({ sets: ['mud'], packing: 'LITE' }).toThrow(
      'no data declares the texture "mud_normalHeight" (the normalHeight of the texture set "mud"'
    );
    expect(fns.builds).toHaveLength(0);

    await buildTextureSetArray({ id: 'ground', sets: ['sand'], packing: 'LITE' });
    await reject({ id: 'ground', sets: ['rock'], packing: 'LITE' }).toThrow(
      'Texture set array "ground" (LITE: 0 sand) is registered already'
    );
  });

  test('deletes the arrays it registered when a slot fails, naming the slot and the layers', async () => {
    fns.failing.add('rock_normalHeight');

    await expect(
      buildTextureSetArray({ id: 'ground', sets: ['sand', 'rock'], packing: 'LITE' })
    ).rejects.toThrow(
      'Texture set array "ground" (LITE: 0 sand, 1 rock), slot normalHeight: member "rock_normalHeight" is 512 × 512'
    );
    expect(fns.deleted).toEqual(['ground.albedoRough']);
    expect(getTextureSetArray('ground')).toBeUndefined();
  });
});

describe('setTextureSetArrayLayer', () => {
  test('swaps each slot of the layer, then the layer params', async () => {
    const built = await buildTextureSetArray({
      id: 'gallery',
      sets: ['sand', 'mud'],
      packing: 'LITE',
      swappable: true,
    });

    await setTextureSetArrayLayer('gallery', 1, 'rock');

    expect(fns.swaps).toEqual([
      ['gallery.albedoRough', 1, { id: 'rock_albedoRough', fileName: 'rock_albedoRough.ktx2' }],
      ['gallery.normalHeight', 1, { id: 'rock_normalHeight', fileName: 'rock_normalHeight.ktx2' }],
    ]);
    expect(built.sets).toEqual(['sand', 'rock']);
    expect(paramsOf(built.layerParams.array, 1)[0]).toEqual([6, 6, 0.2, 1.5]);
    expect(paramsOf(built.layerParams.array, 0)[0]).toEqual([3, 2, 0.03, 1.5]);
    // A build of its id again returns it as swapped
    const again = {
      id: 'gallery',
      sets: ['sand', 'mud'],
      packing: 'LITE',
      swappable: true,
    } as const;
    expect(await buildTextureSetArray({ ...again, sets: [...again.sets] })).toBe(built);
  });

  test('puts the previous set back in the swapped slots when a slot fails', async () => {
    const built = await buildTextureSetArray({
      id: 'gallery',
      sets: ['sand', 'mud'],
      packing: 'LITE',
      swappable: true,
    });
    fns.failing.add('rock_normalHeight');

    await expect(setTextureSetArrayLayer('gallery', 1, 'rock')).rejects.toThrow(
      'layer 1 to "rock", slot normalHeight: "rock_normalHeight" doesn\'t fit.'
    );
    expect(fns.swaps.map(([id, layer, member]) => [id, layer, memberId(member)])).toEqual([
      ['gallery.albedoRough', 1, 'rock_albedoRough'],
      ['gallery.normalHeight', 1, 'rock_normalHeight'],
      ['gallery.albedoRough', 1, 'mud_albedoRough'],
    ]);
    expect(built.sets).toEqual(['sand', 'mud']);
    expect(paramsOf(built.layerParams.array, 1)[0]).toEqual([3, 2, 0.03, 1.5]);
  });

  test('throws at once without a swappable array, out of range, or for a set it cannot take', async () => {
    await buildTextureSetArray({ id: 'fixed', sets: ['sand'], packing: 'LITE' });
    await buildTextureSetArray({ id: 'gallery', sets: ['sand'], packing: 'LITE', swappable: true });

    expect(() => setTextureSetArrayLayer('none', 0, 'rock')).toThrow('no texture set array "none"');
    expect(() => setTextureSetArrayLayer('fixed', 0, 'rock')).toThrow("isn't swappable");
    expect(() => setTextureSetArrayLayer('gallery', 1, 'rock')).toThrow('has layers 0-0, not 1');
    expect(() => setTextureSetArrayLayer('gallery', 0, 'ice')).toThrow('has no packing "LITE"');
    expect(fns.swaps).toHaveLength(0);
  });

  test('a swap of a set array deleted meanwhile writes nothing', async () => {
    const built = await buildTextureSetArray({
      id: 'gallery',
      sets: ['sand'],
      packing: 'LITE',
      swappable: true,
    });
    const swap = setTextureSetArrayLayer('gallery', 0, 'rock');
    built.arrays.albedoRough.dispose();
    fns.registered.delete('gallery.albedoRough');

    await swap;

    expect(fns.swaps).toHaveLength(0);
    expect(built.sets).toEqual(['sand']);
  });
});

describe('getTextureSetLayerParams', () => {
  test('reads a layer by index or node, every field a node', async () => {
    const built = await buildTextureSetArray({ sets: ['sand', 'rock'], packing: 'LITE' });

    for (const layer of [1, new THREE.ConstNode(1)]) {
      const params = getTextureSetLayerParams(built.layerParams, layer as never);
      expect(Object.keys(params)).toEqual([
        'physicalSize',
        'heightScale',
        'heightContrast',
        'tint',
        'normalStrength',
        'roughnessScale',
        'aoStrength',
        'porosity',
        'wetDarkening',
        'wetRoughness',
      ]);
      expect(Object.values(params).every((node) => (node as THREE.Node).isNode)).toBe(true);
    }
  });
});
