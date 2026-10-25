import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getProjectMetadata } from '../projectMetadata';
import { buildScripts, type HubBuiltScripts } from './assets';
import { HubDiagnostics } from './diagnostics';
import { HUB_KIT_STAND_INS } from './kitStandIns';
import { HUB_COMPONENTS_FILE, ROOT } from './paths';

// p802 Phase 4 (D9): the component library's chunk is the dev Hub's only, and the UI kit builds
// into it without the engine (§4's risk: the kit's kernel import pulled three and both workers)
// and without the app's storage

const fromRoot = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const UI_DIR = path.join(ROOT, 'src', '_engine', 'ui');

const buildAsync = async (mode: 'public' | 'dev') => {
  const diag = new HubDiagnostics();
  const scripts = await buildScripts(mode, diag, getProjectMetadata());
  expect(diag.errors).toEqual([]);
  return scripts as HubBuiltScripts;
};
const outPaths = (scripts: HubBuiltScripts) => scripts.files.map((file) => file.outPath);

/** The runtime names `source` imports from a module named `name` (`import { a, b } from '…/name'`) */
const readImportedNames = (source: string, name: string) => {
  const names: string[] = [];
  const regex = new RegExp(`import\\s+\\{([^}]*)\\}\\s+from\\s+'[^']*/${name}'`, 'g');
  for (const match of source.matchAll(regex)) {
    for (const part of match[1].split(',').map((p) => p.trim())) {
      if (part && !part.startsWith('type ')) names.push(part.split(/\s+as\s+/)[0]);
    }
  }
  return names;
};

describe('the script build', () => {
  let dev: HubBuiltScripts;
  beforeAll(async () => {
    dev = await buildAsync('dev');
  }, 30_000);

  it('leaves the component library out of a public build', async () => {
    const scripts = await buildAsync('public');
    expect(outPaths(scripts).filter((out) => out.includes('_components'))).toEqual([]);
    expect(scripts.sources.filter((file) => file.startsWith(UI_DIR))).toEqual([]);
  }, 30_000);

  it('builds the UI kit into the dev chunk, with its CSS and without the engine', () => {
    const outs = outPaths(dev);
    expect(outs.some((out) => /^_assets\/chunks\/_components-[\w-]+\.js$/.test(out))).toBe(true);
    expect(outs.some((out) => /^_assets\/chunks\/_components-[\w-]+\.css$/.test(out))).toBe(true);
    // Nothing but the scripts and the kit's CSS: no worker, wasm or decoder came along
    expect(outs.filter((out) => !/\.(js|css)$/.test(out))).toEqual([]);
    const sources = dev.sources.map(fromRoot);
    expect(sources).toContain('src/_engine/ui/DraggableWindow.ts');
    expect(sources.filter((file) => file.startsWith('node_modules/three/'))).toEqual([]);
    expect(dev.sources).not.toContain(HUB_COMPONENTS_FILE); // in hub/: watched already
  });

  it('uses each stand-in in place of its module', () => {
    for (const [module, standIn] of Object.entries(HUB_KIT_STAND_INS)) {
      expect(fs.existsSync(module)).toBe(true);
      expect(path.basename(standIn)).toBe(path.basename(module));
      expect(dev.sources).not.toContain(module);
    }
  });

  it('gives each stand-in every name the bundled modules import from it', () => {
    for (const [module, standIn] of Object.entries(HUB_KIT_STAND_INS)) {
      const name = path.basename(module, '.ts');
      const imported = new Set(
        dev.sources
          .filter((file) => file.endsWith('.ts'))
          .flatMap((file) => readImportedNames(fs.readFileSync(file, 'utf8'), name))
      );
      expect(imported.size).toBeGreaterThan(0);
      const standInSource = fs.readFileSync(standIn, 'utf8');
      for (const id of imported) expect(standInSource).toMatch(new RegExp(`export const ${id}\\b`));
    }
  });
});
