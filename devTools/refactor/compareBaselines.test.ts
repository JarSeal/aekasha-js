import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { DocsBaseline, FolderDocs } from '../verify/baselines';
import {
  type Baselines,
  type ChunkModules,
  compareBaselines,
  createChunkNameMap,
  mapApiModules,
  mapDocs,
} from './compareBaselines';
import { buildPathMap } from './moveApply';

const ROOT = path.resolve(__dirname, '../..');
const E = 'src/_engine/';

/** The committed baselines and today's p608 map */
const setup = () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf-8' })
    .trim()
    .split('\n');
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf-8'));
  const moveMap = read('devTools/refactor/moveMap.json').files;
  const map = buildPathMap({ files, moveMap, plan: 'p608' });
  const dir = 'devTools/verify/baselines';
  const before: Baselines = {
    api: read(`${dir}/api.json`),
    docs: read(`${dir}/docs.json`),
    bundle: read(`${dir}/bundle.json`),
  };
  return { map, before };
};

/** What `yarn verify:baselines --update` would record after a move that changed only paths */
const mapCopy = ({ map, before }: ReturnType<typeof setup>): Baselines => {
  const docs = mapDocs(map, before.docs, before.api);
  const folders: DocsBaseline['folders'] = {};
  for (const [folder, undocumented] of docs.undocumented) {
    // The per-folder coverage isn't compared (the totals and the names are)
    folders[folder] = { ...before.docs.total, undocumented } as FolderDocs;
  }
  const nameOf = createChunkNameMap(map);
  const chunks: Baselines['bundle']['chunks'] = {};
  for (const [name, size] of Object.entries(before.bundle.chunks)) {
    let key = nameOf(name).name;
    for (let n = 2; chunks[key]; n++) key = `${nameOf(name).name}#${n}`;
    chunks[key] = { ...size };
  }
  return {
    api: { ...before.api, modules: mapApiModules(map, before.api.modules).modules },
    docs: { ...before.docs, total: docs.total, subtrees: docs.subtrees, folders },
    bundle: { ...before.bundle, chunks, main: { ...before.bundle.main } },
  };
};

const attentionOf = (findings: ReturnType<typeof compareBaselines>) =>
  findings.filter((f) => f.attention).map((f) => f.line);

describe('compareBaselines', () => {
  const tree = setup();

  it('passes a copy that differs only by the move map', () => {
    const after = mapCopy(tree);
    const findings = compareBaselines(tree.map, tree.before, after);
    expect(attentionOf(findings)).toEqual([]);

    // A moved module, a split export, the re-export the split drops, a deleted module
    const { modules } = after.api;
    expect(modules[`${E}core/SceneLoader.ts`]).toBeUndefined();
    expect(modules[`${E}kernel/scene/SceneLoader.ts`]).toEqual(
      tree.before.api.modules[`${E}core/SceneLoader.ts`]
    );
    expect(modules[`${E}utils/Constants.ts`].HALF_PI).toBe('Variable');
    expect(modules[`${E}kernel/render/ThreeMath.ts`].DIRECTIONS).toBe('Variable');
    expect(modules[`${E}kernel/render/Object3DHelpers.ts`].isOnlyObject3D).toBe('Function');
    expect(modules[`${E}utils/materials/checkerBoardPattern.ts`]).toBeUndefined();
    // 242 modules, less the 2 split and the 2 deleted, and 9 split targets that are new paths
    expect(Object.keys(modules)).toHaveLength(Object.keys(tree.before.api.modules).length + 5);
    expect(modules[`${E}types/three-node-material-helpers.d.ts`]).toEqual({});
    const lines = findings.map((f) => f.line);
    expect(lines).toContain(
      `docs: ${E}utils/materials/checkerBoardPattern.ts (deleted) counted 2 exports, 2 undocumented`
    );

    // An undocumented name of a split module under its target's folder
    expect(after.docs.folders['engine/utils'].undocumented.exports).toContain('Constants#HALF_PI');
    // The deletes take their 4 undocumented exports out of the total
    expect(after.docs.total.exports.total).toBe(tree.before.docs.total.exports.total - 4);
    expect(after.docs.total.exports.documented).toBe(tree.before.docs.total.exports.documented);

    // The chunks named after a renamed module
    expect(after.bundle.chunks['assets/AssetsWorker.js#2']).toBeDefined();
    expect(after.bundle.chunks['assets/assetsWorker.js']).toBeUndefined();
    expect(lines).toContain('bundle: renamed assets/physicsWorker.js → assets/PhysicsWorker.js');
  });

  it('fails an export that moved to another module than the map says', () => {
    const after = mapCopy(tree);
    const { modules } = after.api;
    const { HALF_PI, ...rest } = modules[`${E}utils/Constants.ts`];
    modules[`${E}utils/Constants.ts`] = rest;
    modules[`${E}kernel/render/ThreeMath.ts`].HALF_PI = HALF_PI;
    expect(attentionOf(compareBaselines(tree.map, tree.before, after))).toEqual([
      `api: ${E}kernel/render/ThreeMath.ts exports HALF_PI (Variable), which the mapped baseline hasn't`,
      `api: ${E}utils/Constants.ts doesn't export HALF_PI (Variable) any more`,
    ]);
  });

  it("fails a change to an entry's exports", () => {
    const after = mapCopy(tree);
    after.api = { ...after.api, entries: { ...after.api.entries, aekasha: ['createX'] } };
    const [line] = attentionOf(compareBaselines(tree.map, tree.before, after));
    expect(line).toMatch(/^api: the entry aekasha changed \(added: createX; removed: /);
  });

  it('fails an undocumented name that changed module, and a total that changed', () => {
    const after = mapCopy(tree);
    const lists = after.docs.folders['engine/utils'].undocumented.exports;
    lists.splice(lists.indexOf('Constants#HALF_PI'), 1, 'Numbers#HALF_PI');
    after.docs.total = structuredClone(after.docs.total);
    after.docs.total.members.documented++;
    expect(attentionOf(compareBaselines(tree.map, tree.before, after))).toEqual([
      expect.stringMatching(/^docs: the total is exports .*, members \d+ \/ \d+, the mapped/),
      "docs: engine/utils/Constants#HALF_PI isn't undocumented there any more (exports)",
      'docs: engine/utils/Numbers#HALF_PI is newly undocumented (exports)',
    ]);
  });

  it('passes a renamed chunk within the tolerance, and fails one over it with its split parts', () => {
    const within = mapCopy(tree);
    within.bundle.chunks['assets/AssetsSwitchGLTF.js'].gzip += 90;
    expect(attentionOf(compareBaselines(tree.map, tree.before, within))).toEqual([]);

    const over = mapCopy(tree);
    over.bundle.chunks['assets/AssetsSwitchGLTF.js'].gzip += 3000;
    const chunkModules: ChunkModules = new Map([
      ['assets/AssetsSwitchGLTF.js', [`/${E}kernel/assets/Disposal.ts`, `/${E}core/Other.ts`]],
    ]);
    expect(attentionOf(compareBaselines(tree.map, tree.before, over, chunkModules))).toEqual([
      expect.stringMatching(
        new RegExp(
          `^bundle: assets/AssetsSwitchGLTF\\.js: .* gzip \\(split parts in it: /${E}kernel/assets/Disposal\\.ts\\)$`
        )
      ),
    ]);
  });

  it('pairs chunks of one name by size, whatever their #n order', () => {
    const after = mapCopy(tree);
    const { chunks } = after.bundle;
    [chunks['assets/AssetsWorker.js'], chunks['assets/AssetsWorker.js#2']] = [
      chunks['assets/AssetsWorker.js#2'],
      chunks['assets/AssetsWorker.js'],
    ];
    expect(attentionOf(compareBaselines(tree.map, tree.before, after))).toEqual([]);
  });

  it('fails a new chunk and a main chunk over the tolerance', () => {
    const after = mapCopy(tree);
    after.bundle.chunks['assets/Disposal.js'] = { bytes: 900, gzip: 400 };
    after.bundle.main.gzip += 5000;
    expect(attentionOf(compareBaselines(tree.map, tree.before, after))).toEqual([
      'bundle: 0 chunk(s) named assets/Disposal.js before the move, 1 after it',
      expect.stringMatching(/^bundle: the main chunk's gzip /),
    ]);
  });
});
