import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { isGatheredJsonFile, validateGatheredJson } from './gatheredJson';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(REPO_ROOT, 'src');

// Every gathered asset JSON in src/, as the gatherer walks it
const assetFiles = (fs.readdirSync(SRC, { recursive: true }) as string[])
  .filter((file) => isGatheredJsonFile(file))
  .map((file) => path.relative(REPO_ROOT, path.join(SRC, file)))
  .sort();

const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')) as Record<string, unknown>;

const omit = (json: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(json).filter(([k]) => k !== key));

/** The first repo asset with this suffix, to break one thing in */
const firstOf = (suffix: string) => {
  const file = assetFiles.find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`No ${suffix} in src/ to derive a bad fixture from`);
  return { file, json: readJson(file) };
};

describe('the repo’s asset JSONs', () => {
  test('there are some', () => {
    expect(assetFiles.length).toBeGreaterThan(50);
  });

  test.each(assetFiles)('%s passes its schema', (file) => {
    expect(validateGatheredJson(file, readJson(file))).toBeNull();
  });
});

describe('bad assets fail', () => {
  // Each is a repo asset with one thing broken, and must fail at the broken path or inside it (the
  // unions discriminate on `type`, so a light's bad field is reported at the field).
  const cases: [string, string, string, (json: Record<string, unknown>) => unknown][] = [
    ['a scene without an id', '.scene.json', 'id', (json) => omit(json, 'id')],
    ['a scene without a sceneFile', '.scene.json', 'sceneFile', (json) => omit(json, 'sceneFile')],
    ['a camera without camProps', '.camera.json', 'camProps', (json) => omit(json, 'camProps')],
    [
      'a light of an unknown type',
      '.light.json',
      'lightProps.type',
      (json) => ({ ...json, lightProps: { ...(json.lightProps as object), type: 'LASER' } }),
    ],
    [
      'a light with a string intensity',
      '.light.json',
      'lightProps.intensity',
      (json) => ({ ...json, lightProps: { ...(json.lightProps as object), intensity: 'bright' } }),
    ],
    [
      'a shadow map size that isn’t a pair',
      '.light.json',
      'lightProps.shadowMapSize',
      (json) => ({ ...json, lightProps: { type: 'DIRECTIONAL', shadowMapSize: [1024, 1024, 1] } }),
    ],
    [
      'a spot light whose map isn’t a texture id',
      '.light.json',
      'lightProps.map',
      (json) => ({ ...json, lightProps: { type: 'SPOT', map: { image: 'x' } } }),
    ],
    [
      'a camera with a string fov',
      '.camera.json',
      'camProps.fov',
      (json) => ({ ...json, camProps: { type: 'PERSPECTIVE', fov: 'wide' } }),
    ],
    [
      'a geometry with a string param',
      '.geometry.json',
      'geoProps.params.radius',
      (json) => ({ ...json, geoProps: { type: 'SPHERE', params: { radius: 'big' } } }),
    ],
    [
      'an impostor of an unknown kind',
      '.impostor.json',
      'kind',
      (json) => ({ ...json, kind: 'SPHERE' }),
    ],
    ['a material that is an array', '.material.json', '', () => []],
    [
      'a material of an unknown type',
      '.material.json',
      'type',
      (json) => ({ ...omit(json, 'tslFile'), type: 'GLASS' }),
    ],
    [
      'a TSL material without its tslFile',
      '.material.json',
      'tslFile',
      (json) => ({ ...omit(json, 'tslFile'), type: 'STANDARDNODEMATERIAL' }),
    ],
    [
      'a scene with an inline mesh without props',
      '.scene.json',
      'meshes.0',
      (json) => ({ ...json, meshes: [{ entityOpts: {} }] }),
    ],
    [
      'a scene with an inline mesh whose geometry has a bad param',
      '.scene.json',
      'meshes.0.props.geo',
      (json) => ({
        ...json,
        meshes: [{ props: { geo: { type: 'BOX', params: { width: 'wide' } }, mat: 'grey' } }],
      }),
    ],
    [
      'a scene with an inline import without a fileName',
      '.scene.json',
      'importedAssets.0',
      (json) => ({ ...json, importedAssets: [{ id: 'x' }] }),
    ],
    [
      'a scene with an inline import of a file relative to the JSON',
      '.scene.json',
      'importedAssets.0',
      (json) => ({ ...json, importedAssets: [{ fileName: './model.glb' }] }),
    ],
    [
      'a save entry that is not a list',
      '.scene.json',
      '__saveData.someScene',
      (json) => ({ ...json, __saveData: { someScene: { id: 'x' } } }),
    ],
  ];

  test.each(cases)('%s', (_name, suffix, issuePath, breakIt) => {
    const { file, json } = firstOf(suffix);
    const issues = validateGatheredJson(file, breakIt(json));
    const paths = issues?.map((issue) => issue.path) ?? [];
    expect(
      paths.some((p) => p === issuePath || !issuePath || p.startsWith(`${issuePath}.`)),
      `issues at ${JSON.stringify(paths)}`
    ).toBe(true);
  });

  test('a file that isn’t a gathered type isn’t validated', () => {
    expect(validateGatheredJson('src/app/notes.json', { anything: true })).toBeNull();
  });
});
