import { describe, expect, it } from 'vitest';
import { buildPathMap } from './moveApply';
import { isAssetJson, rewriteAssetJson } from './moveJson';
import type { MoveEntry } from './moveRules';

const A = 'src/app/';
const S = `${A}scenes/`;
const T = 'src/toolkit/';

const move = (to: string): MoveEntry => ({ to, action: 'move', plan: 'p609' });

const FILES: Record<string, MoveEntry | null> = {
  [`${A}scene01_v2.scene.json`]: move(`${S}scene01V2/scene01V2.scene.json`),
  [`${A}scene01_v2.ts`]: move(`${S}scene01V2/scene01V2.ts`),
  [`${A}oneMore.scene.json`]: move(`${S}oneMore/oneMore.scene.json`),
  [`${A}oneMore.ts`]: move(`${S}oneMore/oneMore.ts`),
  [`${A}debugScene.scene.json`]: move(`${S}testDebug/testDebug.scene.json`),
  [`${A}debugScene.scene.ts`]: move(`${S}testDebug/testDebug.ts`),
  [`${A}examples/ecs/exampleEcs.scene.json`]: null,
  [`${A}examples/ecs/exampleEcs.ts`]: null,
  [`${A}textures/atlas.textureAtlas.json`]: move(`${S}atlases/atlas.textureAtlas.json`),
  [`${A}textures/source/atlas/red.png`]: move(`${S}atlases/source/atlas/red.png`),
  [`${A}textures/shared.texture.json`]: null,
  [`${A}textures/source/shared.png`]: null,
  [`${A}textures/source/moved.png`]: move(`${S}atlases/source/moved.png`),
  [`${A}textures/stays.texture.json`]: null,
  [`${A}cameras/gone.camera.json`]: move(`${S}gone/gone.camera.json`),
  [`${T}materials/grid.material.json`]: move(`${T}materials/grid/grid.material.json`),
  [`${T}materials/grid.tsl.ts`]: move(`${T}materials/grid/grid.tsl.ts`),
  [`${A}materials/test.material.json`]: move(`${S}ecs/test.material.json`),
  [`${A}materials/test.tsl.ts`]: move(`${S}ecs/test.tsl.ts`),
};

const map = buildPathMap({
  files: Object.keys(FILES),
  moveMap: Object.fromEntries(
    Object.entries(FILES).flatMap(([file, entry]) => (entry ? [[file, entry]] : []))
  ),
  plan: 'p609',
});

describe('isAssetJson', () => {
  it('reads the gathered asset JSONs under src/, not the generated data or other JSON', () => {
    expect(isAssetJson(`${A}space.scene.json`)).toBe(true);
    expect(isAssetJson('src/toolkit/models/x/x.importedAsset.json')).toBe(true);
    expect(isAssetJson('src/generated/generatedAppData.json')).toBe(false);
    expect(isAssetJson('src/public/debugger/assets/report.json')).toBe(false);
    expect(isAssetJson('package.json')).toBe(false);
  });
});

describe('rewriteAssetJson', () => {
  it('writes $schema from the new folder, fixing a broken one, and keeps the rest byte for byte', () => {
    const text = `{
  "$schema": "../.schemas/scene.schema.json",
  "id": "scene01V2",
  "sceneFile": "./scene01_v2.ts",
  "__saveData": { "scene01V2": [{ "intensity": 2 }] }
}
`;
    const out = rewriteAssetJson(map, `${A}scene01_v2.scene.json`, text);
    expect(out.errors).toEqual([]);
    expect(out.text).toBe(`{
  "$schema": "../../../../.schemas/scene.schema.json",
  "id": "scene01V2",
  "sceneFile": "./scenes/scene01V2/scene01V2.ts",
  "__saveData": { "scene01V2": [{ "intensity": 2 }] }
}
`);
  });

  it("writes sceneFile as it was written: without './' or '.ts'", () => {
    const oneMore = rewriteAssetJson(map, `${A}oneMore.scene.json`, '{ "sceneFile": "./oneMore" }');
    expect(oneMore).toEqual({ text: '{ "sceneFile": "./scenes/oneMore/oneMore" }', errors: [] });
    const debug = rewriteAssetJson(
      map,
      `${A}debugScene.scene.json`,
      '{ "sceneFile": "debugScene.scene.ts" }'
    );
    expect(debug).toEqual({ text: '{ "sceneFile": "scenes/testDebug/testDebug.ts" }', errors: [] });
  });

  it("writes tslFile from the JSON's root under src/, as the gatherer resolves it", () => {
    const grid = rewriteAssetJson(
      map,
      `${T}materials/grid.material.json`,
      '{ "tslFile": "materials/grid.tsl.ts" }'
    );
    expect(grid).toEqual({ text: '{ "tslFile": "materials/grid/grid.tsl.ts" }', errors: [] });
    const test = rewriteAssetJson(
      map,
      `${A}materials/test.material.json`,
      '{ "tslFile": "materials/test.tsl.ts" }'
    );
    expect(test).toEqual({ text: '{ "tslFile": "scenes/ecs/test.tsl.ts" }', errors: [] });
  });

  it("leaves a JSON that doesn't move and names nothing that moves as it is", () => {
    const text = `{
  "$schema": "../../../../.schemas/scene.schema.json",
  "sceneFile": "./examples/ecs/exampleEcs.ts"
}`;
    const out = rewriteAssetJson(map, `${A}examples/ecs/exampleEcs.scene.json`, text);
    expect(out).toEqual({ text, errors: [] });
  });

  it('moves relative sources with the JSON, in arrays too, and leaves public URLs alone', () => {
    const text = `{
  "slots": { "albedo": { "image": "./source/atlas/red.png" } },
  "layers": ["./source/shared.png", "/debugger/assets/a.png"]
}`;
    const out = rewriteAssetJson(map, `${A}textures/atlas.textureAtlas.json`, text);
    expect(out.errors).toEqual([]);
    expect(out.text).toBe(`{
  "slots": { "albedo": { "image": "./source/atlas/red.png" } },
  "layers": ["../../textures/source/shared.png", "/debugger/assets/a.png"]
}`);
  });

  it("follows a moved source from a JSON that stays, and leaves a staying JSON's own paths", () => {
    const text = '{ "fileName": "./source/moved.png", "other": "./source/shared.png" }';
    const out = rewriteAssetJson(map, `${A}textures/stays.texture.json`, text);
    expect(out).toEqual({
      text: '{ "fileName": "../scenes/atlases/source/moved.png", "other": "./source/shared.png" }',
      errors: [],
    });
  });

  it('fails on a moving JSON whose relative path names no file, and on a missing sceneFile', () => {
    const lost = rewriteAssetJson(map, `${A}cameras/gone.camera.json`, '{\n  "a": "./nope.png"\n}');
    expect(lost.errors).toEqual([
      `${A}cameras/gone.camera.json:2 './nope.png' names no file: it can't follow the JSON`,
    ]);
    expect(lost.text).toBe('{\n  "a": "./nope.png"\n}');
    const scene = rewriteAssetJson(
      map,
      `${A}oneMore.scene.json`,
      '{ "sceneFile": "./missing.ts" }'
    );
    expect(scene.errors).toEqual([
      `${A}oneMore.scene.json:1 sceneFile './missing.ts' names no file`,
    ]);
  });
});
