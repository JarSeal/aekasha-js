import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatGeneratedAppFns,
  type GeneratedOutput,
  getEmbedProfiles,
  removeStaleProfileOutputs,
  selectProfileOutput,
  writeGeneratedOutput,
} from './gatherOutput';

const EMPTY = { scenes: {}, tslMaterials: {}, postFx: {} };

const app: GeneratedOutput = {
  json: {
    scenes: {
      a: { id: 'a', materials: [{ id: 'matA' }, 'matShared'], postFx: [{ id: 'fxA' }] },
      b: { id: 'b', materials: [{ id: 'matShared' }] },
      c: { id: 'c', materials: [{ id: 'matC' }], postFx: ['fxC'] },
      dbg: { id: 'dbg', isDebugScene: true },
    },
    materials: { matA: {} },
  },
  loaders: {
    scenes: { a: 'app/./a.ts', b: 'app/./b.ts', c: 'app/./c.ts', dbg: 'app/./dbg.ts' },
    tslMaterials: { matA: 'toolkit/a.tsl.ts', matShared: 'app/s.tsl.ts', matC: 'app/c.tsl.ts' },
    postFx: { fxA: 'app/fxA.ts', fxC: 'app/fxC.ts' },
  },
};

const profile = (scenes: string[]) => ({ id: 'banner', entry: 'src/x.embed.ts', scenes });

describe('selectProfileOutput', () => {
  it('keeps the profile’s scenes in its order, and only their files', () => {
    const { output, errors } = selectProfileOutput({
      profile: profile(['b', 'a']),
      app,
      debugSceneIds: new Set(['dbg']),
    });
    expect(errors).toEqual([]);
    expect(Object.keys(output.json)).toEqual(['scenes']);
    expect(Object.keys(output.json.scenes)).toEqual(['b', 'a']);
    expect(output.loaders).toEqual({
      scenes: { a: 'app/./a.ts', b: 'app/./b.ts' },
      tslMaterials: { matA: 'toolkit/a.tsl.ts', matShared: 'app/s.tsl.ts' },
      postFx: { fxA: 'app/fxA.ts' },
    });
  });

  it('names a scene that isn’t in the data and a debug scene', () => {
    const { output, errors } = selectProfileOutput({
      profile: profile(['nope', 'dbg', 'c']),
      app,
      debugSceneIds: new Set(['dbg']),
    });
    expect(errors).toEqual([
      'profile banner: no scene nope in the gathered data',
      'profile banner: scene dbg is a debug scene (isDebugScene)',
    ]);
    expect(Object.keys(output.json.scenes)).toEqual(['c']);
    expect(output.loaders.postFx).toEqual({ fxC: 'app/fxC.ts' });
  });
});

describe('getEmbedProfiles', () => {
  it('leaves the app’s full-page build out', () => {
    expect(
      getEmbedProfiles([{ id: 'app', entry: 'src/index.html' }, profile(['a'])]).map((p) => p.id)
    ).toEqual(['banner']);
  });
});

describe('formatGeneratedAppFns', () => {
  it('writes empty objects without the type import when there is nothing', () => {
    const text = formatGeneratedAppFns(EMPTY, '../');
    expect(text).not.toContain('import type');
    expect(text).toContain('export const sceneFileObjects = {};\n');
    expect(text).toContain('export const tslMaterialFileObjects = {};\n');
    expect(text).toContain('export const postFxFileObjects = {};\n');
  });

  it('imports each file through the prefix, and quotes an id that starts with a digit', () => {
    const text = formatGeneratedAppFns(
      { scenes: { s: 'app/./s.ts' }, tslMaterials: { '1mat': 'app/m.tsl.ts' }, postFx: {} },
      '../../../'
    );
    expect(text).toContain("import type { SceneData, ScenePrimitiveAssets } from 'aekasha';\n");
    expect(text).toContain("    const module = await import('../../../app/./s.ts');\n");
    expect(text).toContain("  '1mat': () => import('../../../app/m.tsl.ts'),\n");
  });
});

describe('writeGeneratedOutput and removeStaleProfileOutputs', () => {
  it('writes the three files with imports relative to src/, and removes unlisted profiles', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-gather-'));
    try {
      const src = path.join(root, 'src');
      const profiles = path.join(src, 'generated', 'profiles');
      writeGeneratedOutput(
        path.join(profiles, 'banner'),
        { json: { scenes: {} }, loaders: { ...EMPTY, scenes: { s: 'app/s.ts' } } },
        src
      );
      fs.mkdirSync(path.join(profiles, 'old'));
      expect(fs.readdirSync(path.join(profiles, 'banner')).sort()).toEqual([
        'generatedAppData.json',
        'generatedAppFns.ts',
        'index.ts',
      ]);
      expect(
        fs.readFileSync(path.join(profiles, 'banner', 'generatedAppFns.ts'), 'utf8')
      ).toContain("import('../../../app/s.ts')");
      expect(removeStaleProfileOutputs(profiles, ['banner'])).toEqual(['old']);
      expect(fs.readdirSync(profiles)).toEqual(['banner']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
