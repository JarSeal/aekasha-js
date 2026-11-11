import { describe, expect, it } from 'vitest';
import type { MaterialAsset, MergeMaterialAsset } from '../../src/_engine/schemas';
import { checkMergeMaterialClass, type MaterialLookup } from './mergeMaterialClass';

type Mat = Pick<MaterialAsset, 'type' | 'params' | '__saveData'>;

const lookup =
  (materials: Record<string, Mat>): MaterialLookup =>
  (id) =>
    materials[id] && { jsonFile: `/repo/src/app/${id}.material.json`, data: materials[id] };

const standard = (params: Record<string, unknown> = {}): Mat => ({ type: 'STANDARD', params });

const palette = (
  materials: string[],
  slots: MergeMaterialAsset['slots'] = { map: { size: [64, 64] } }
): MergeMaterialAsset => ({ materials, slots });

describe('checkMergeMaterialClass', () => {
  it('passes members that differ only in the table’s parameters, and lists their maps', () => {
    const result = checkMergeMaterialClass(
      palette(['a', 'b', 'c'], {
        map: { size: [64, 64] },
        normalMap: { size: [64, 64] },
        orm: { size: [64, 64] },
      }),
      lookup({
        a: standard({ map: 'aAlbedo', normalMap: 'aNormal', aoMap: 'aOrm', roughnessMap: 'aOrm' }),
        b: standard({ map: 'bAlbedo', normalMap: 'bNormal', color: '#ff0000', roughness: 0.2 }),
        c: standard({ map: 'cAlbedo', metalness: 1, normalScale: [2, 2], side: 0 }),
      })
    );
    expect(result.errors).toEqual([]);
    expect(result.members.map((member) => member?.id)).toEqual(['a', 'b', 'c']);
    expect(result.maps).toEqual({
      map: [{ map: 'aAlbedo' }, { map: 'bAlbedo' }, { map: 'cAlbedo' }],
      normalMap: [{ normalMap: 'aNormal' }, { normalMap: 'bNormal' }, {}],
      orm: [{ aoMap: 'aOrm', roughnessMap: 'aOrm' }, {}, {}],
    });
    // `side: 0` is three's default, so the members agree; one member's ORM is a warning only
    expect(result.warnings).toEqual([
      expect.stringContaining('slots.orm: only "a" has a map for it'),
    ]);
  });

  it('reads each member’s table entry, three’s default for a missing parameter', () => {
    const result = checkMergeMaterialClass(
      palette(['a', 'b', 'c']),
      lookup({
        a: standard({
          color: '#ff8000',
          opacity: 0.5,
          emissive: 0x202060,
          emissiveIntensity: 2,
          roughness: 0.3,
          metalness: 0.7,
          normalScale: [0.6, -0.6],
          aoMapIntensity: 0.8,
        }),
        b: standard(),
        c: standard({ normalScale: { x: 2, y: 3 } }),
      })
    );
    expect(result.errors).toEqual([]);
    const defaults = {
      color: 0xffffff,
      opacity: 1,
      emissive: 0x000000,
      emissiveIntensity: 1,
      roughness: 1,
      metalness: 0,
      normalScale: [1, 1],
      aoMapIntensity: 1,
    };
    expect(result.entries).toEqual([
      {
        color: '#ff8000',
        opacity: 0.5,
        emissive: 0x202060,
        emissiveIntensity: 2,
        roughness: 0.3,
        metalness: 0.7,
        normalScale: [0.6, -0.6],
        aoMapIntensity: 0.8,
      },
      defaults,
      { ...defaults, normalScale: [2, 3] },
    ]);
  });

  it('refuses a table parameter of the wrong kind, naming the member', () => {
    const result = checkMergeMaterialClass(
      palette(['a', 'b']),
      lookup({
        a: standard({ color: [1, 0, 0], roughness: '0.5' }),
        b: standard({ normalScale: 2 }),
      })
    );
    expect(result.errors).toEqual([
      expect.stringMatching(/^materials\[0\] "a" .*: params\.color is \[1,0,0\]: a colour/),
      expect.stringMatching(/^materials\[0\] "a" .*: params\.roughness is "0\.5": a number$/),
      expect.stringMatching(/^materials\[1\] "b" .*: params\.normalScale is 2: two numbers/),
    ]);
  });

  it('refuses ids that aren’t material JSONs’ and members of another type', () => {
    const { errors, members } = checkMergeMaterialClass(
      palette(['missing', 'phong', 'physical', 'tsl', 'ok']),
      lookup({
        phong: { type: 'PHONG', params: {} },
        physical: { type: 'PHYSICAL', params: {} },
        tsl: { type: 'STANDARDNODEMATERIAL', params: {} },
        ok: standard(),
      })
    );
    expect(members.map((member) => member?.id)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'ok',
    ]);
    expect(errors).toEqual([
      'materials[0] "missing": not a material JSON\'s id (*.material.json)',
      expect.stringMatching(/^materials\[1\] "phong" .*: type PHONG: .*only STANDARD/),
      expect.stringMatching(/^materials\[2\] "physical" .*: type PHYSICAL: clearcoat/),
      expect.stringMatching(
        /^materials\[3\] "tsl" .*: type STANDARDNODEMATERIAL: .*open question 1/
      ),
    ]);
  });

  it('refuses a transparent member', () => {
    const { errors } = checkMergeMaterialClass(
      palette(['a', 'b']),
      lookup({ a: standard({ transparent: true }), b: standard() })
    );
    expect(errors).toEqual([
      expect.stringMatching(/^materials\[0\] "a" .*: params\.transparent: .*never transparent$/),
    ]);
  });

  it('refuses a map without its slot, left out of orm’s from, or one a merge material lacks', () => {
    const { errors } = checkMergeMaterialClass(
      palette(['a', 'b'], {
        map: { size: [64, 64] },
        orm: { size: [64, 64], from: ['roughnessMap'] },
      }),
      lookup({
        a: standard({ normalMap: 'n', aoMap: 'ao' }),
        b: standard({ alphaMap: 'alpha', roughnessMap: 'r', map: 42 }),
      })
    );
    expect(errors).toEqual([
      expect.stringMatching(/"a" .*: params\.normalMap: the palette has no normalMap slot/),
      expect.stringMatching(/"a" .*: params\.aoMap: slots\.orm's "from" leaves aoMap out/),
      expect.stringMatching(/"b" .*: params\.alphaMap: a merge material has no alphaMap/),
      expect.stringMatching(/"b" .*: params\.map isn't a texture's id/),
    ]);
  });

  it('names every value of a state parameter the members don’t agree on', () => {
    const { errors } = checkMergeMaterialClass(
      palette(['a', 'b', 'c']),
      lookup({
        a: standard({ alphaTest: 0.5, flatShading: true }),
        b: standard({ alphaTest: 0.5, flatShading: true }),
        c: standard({ custom: 1, flatShading: true }),
      })
    );
    expect(errors).toEqual([
      'params.alphaTest differs: 0.5 in "a", "b"; 0 in "c" (a draw has one alpha mode: the members must agree; unset is three\'s 0)',
      'params.custom differs: unset in "a", "b"; 1 in "c" (a draw has one material state: the members must agree)',
    ]);
  });

  it('warns about a slot no member uses and a feature one member drags into the others', () => {
    const { errors, warnings } = checkMergeMaterialClass(
      palette(['a', 'b', 'c'], { map: { size: [64, 64] }, emissiveMap: { size: [64, 64] } }),
      lookup({
        a: standard({ emissive: '#ff8000' }),
        b: standard({ emissive: '#000000' }),
        c: standard({ emissive: 0xffffff, emissiveIntensity: 0 }),
      })
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'slots.map: no member has a map for it (map), so no array is built',
      'slots.emissiveMap: no member has a map for it (emissiveMap), so no array is built',
      'only "a" is emissive, and the merge material adds emissive for every member (D1)',
    ]);
  });

  it('warns about a member whose scene save entries change its params', () => {
    const { warnings } = checkMergeMaterialClass(
      palette(['a', 'b']),
      lookup({
        a: { ...standard({ map: 'x' }), __saveData: { s1: [{ params: { roughness: 1 } }] } },
        b: { ...standard({ map: 'y' }), __saveData: { s2: [{ debugData: { name: 'b' } }] } },
      })
    );
    expect(warnings).toEqual([
      expect.stringMatching(/^materials\[0\] "a" .*: the save entries of "s1" change its params/),
    ]);
  });
});
