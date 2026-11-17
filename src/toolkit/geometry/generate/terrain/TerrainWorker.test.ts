import path from 'node:path';
import { build, type Metafile } from 'esbuild';
import { beforeAll, describe, expect, test } from 'vitest';

// The terrain worker's boundary (p306 Phase 4): it runs the core alone. An engine entry would load
// the whole engine in the dev server's worker (no tree-shaking there), the UI kit's styles
// included, and three would weigh down its chunk: a value import where a type import belongs
// fails here.

const FOLDER = __dirname;
const WORKER = path.resolve(FOLDER, 'TerrainWorker.ts');

/** The one package the worker may load: three's simplex noise, a file without imports */
const ALLOWED_PACKAGES = ['three/examples/jsm/math/SimplexNoise.js'];

let metafile: Metafile;

beforeAll(async () => {
  // Packages stay external, so the bundle is only our modules and the packages are the externals
  // they import. So do the entries' aliases, which esbuild would resolve through `tsconfig.json`'s
  // `paths`: an `aekasha*` import then fails the package check by name, not the build on the
  // engine's styles.
  const result = await build({
    entryPoints: [WORKER],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    packages: 'external',
    logLevel: 'silent',
    plugins: [
      {
        name: 'entries-external',
        setup: (b) =>
          b.onResolve({ filter: /^aekasha(\/|$)/ }, (args) => ({
            external: true,
            path: args.path,
          })),
      },
    ],
  });
  metafile = result.metafile;
});

describe('the terrain worker bundle', () => {
  test("holds only its own folder's modules", () => {
    const inputs = Object.keys(metafile.inputs).map((input) => path.resolve(input));
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.filter((input) => path.dirname(input) !== FOLDER)).toEqual([]);
  });

  test("loads no package but three's simplex noise (no engine entry, no three)", () => {
    const packages = new Set<string>();
    for (const input of Object.values(metafile.inputs)) {
      for (const imported of input.imports) {
        if (imported.external && !imported.path.startsWith('.')) packages.add(imported.path);
      }
    }
    expect([...packages].filter((p) => !ALLOWED_PACKAGES.includes(p))).toEqual([]);
  });
});
