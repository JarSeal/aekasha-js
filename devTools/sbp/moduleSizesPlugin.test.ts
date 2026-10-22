import fs from 'fs';
import os from 'os';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { findDebugCodeInBuild } from '../verify/debugInProduction';
import { type CollectedBundle, type ModuleSizesFile, collectBundle } from './bundleModel';
import { createModuleSizesPlugins } from './moduleSizesPlugin';

// A tiny app with a worker: both import `math.js`, and both `import()` `shared.js`, which imports
// `math.js` from the main chunk in one build and from the worker's in the other, so the two
// `shared` chunks differ and share a name. The worker imports a debug module.
const SOURCES: Record<string, string> = {
  'index.html': '<script type="module" src="./main.js"></script>',
  'main.js': [
    "import { add } from './math.js';",
    "import Worker from './w.js?worker';",
    'new Worker().postMessage(add(1, 2));',
    "import('./shared.js').then((m) => console.log(m.hello()));",
  ].join('\n'),
  'w.js': [
    "import { add } from './math.js';",
    "import { probe } from './_dbg__probe.js';",
    "self.onmessage = () => import('./shared.js').then((m) => self.postMessage(add(m.hello(), probe())));",
  ].join('\n'),
  'shared.js': "import { add } from './math.js';\nexport const hello = () => add(40, 2);",
  'math.js': [
    '/**',
    ' * A long comment, which the rendered code keeps and minification drops: the visualizer',
    ' * counted every word of it, and the JSDoc of a whole engine folder added up.',
    ' */',
    'export const add = (first, second) => first + second;',
  ].join('\n'),
  '_dbg__probe.js': 'export const probe = () => 42;',
};

describe('moduleSizesPlugin on a real build', () => {
  let root = '';
  let sizes: ModuleSizesFile;
  let collected: CollectedBundle;

  beforeAll(async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aek-module-sizes-')));
    for (const [name, code] of Object.entries(SOURCES)) {
      fs.writeFileSync(path.join(root, name), code);
    }
    const location = {
      outDir: path.join(root, 'dist'),
      statsFile: path.join(root, 'stats/bundle-stats.html'),
      sizesFile: path.join(root, 'stats/module-sizes.json'),
      isAssetsOnly: true,
    };
    const moduleSizes = createModuleSizesPlugins({ file: location.sizesFile, root });
    await build({
      configFile: false,
      root,
      logLevel: 'silent',
      build: { outDir: location.outDir, manifest: true },
      worker: { format: 'es', plugins: () => [moduleSizes.workerPlugin()] },
      plugins: [moduleSizes.plugin(), visualizer({ filename: location.statsFile, gzipSize: true })],
    });
    sizes = JSON.parse(fs.readFileSync(location.sizesFile, 'utf-8')) as ModuleSizesFile;
    collected = collectBundle(location);
  }, 30_000);

  it('measures the main build and the worker build, each module minified', () => {
    const builds = Object.values(sizes.chunks).map((chunk) => chunk.build);
    expect(new Set(builds)).toEqual(new Set(['main', 'w']));
    const math = sizes.modules.filter((module) => module.id === '/math.js');
    expect(math.map((module) => module.build).sort()).toEqual(['main', 'w']);
    for (const module of math) {
      for (const size of Object.values(module.chunks)) {
        expect(size.minified).toBeLessThan(size.rendered / 3);
        expect(size.gzip).toBeGreaterThan(0);
      }
    }
  });

  it('keys the worker’s copy of a shared name @<worker>, and the main build’s plainly', () => {
    expect(Object.keys(collected.bundle.chunks).sort()).toEqual([
      'assets/index.js',
      'assets/shared.js',
      'assets/shared.js@w',
      'assets/w.js',
    ]);
    expect(collected.bundle.main.chunk).toBe('assets/index.js');
    // main.js, math.js and the worker's wrapper (outside `src/`: `other`), and Vite's helpers
    expect(collected.bundle.mainGroups.other.modules).toBe(3);
    expect(collected.bundle.main.modules).toBe(5);
  });

  it('finds a debug module in the worker build', () => {
    expect(
      findDebugCodeInBuild({
        files: Object.keys(collected.bundle.chunks),
        modules: collected.modules,
        assets: collected.assets,
      })
    ).toEqual(['debug module _dbg__probe.js in assets/w.js (the w worker)']);
  });
});
