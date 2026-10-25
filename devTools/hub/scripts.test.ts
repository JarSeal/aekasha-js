import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSourceFiles } from '../files';
import { UI_KERNEL_HOOKS } from '../layout/layout';
import { getProjectMetadata } from '../projectMetadata';
import { buildScripts, type HubBuiltScripts } from './assets';
import { HubDiagnostics } from './diagnostics';
import { HUB_KIT_KERNEL_STAND_INS } from './kitKernel';
import { HUB_COMPONENTS_FILE, ROOT } from './paths';

// p802 Phase 4 (D9): the component library's chunk is the dev Hub's only, and the UI kit builds
// into it without the engine (§4's risk: the kit's kernel import pulled three and both workers)

const fromRoot = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const UI_DIR = path.join(ROOT, 'src', '_engine', 'ui');

describe('the kit kernel stand-ins', () => {
  const standIns = Object.entries(HUB_KIT_KERNEL_STAND_INS);

  it('each stands in for one of the kernel modules the kit may import', () => {
    expect(standIns.length).toBeGreaterThan(0);
    for (const [module, standIn] of standIns) {
      expect(UI_KERNEL_HOOKS.has(fromRoot(module))).toBe(true);
      expect(fs.existsSync(module)).toBe(true);
      expect(fs.existsSync(standIn)).toBe(true);
    }
  });

  it('each exports every name the kit imports from its module', () => {
    const kitFiles = listSourceFiles(UI_DIR)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => path.join(UI_DIR, file));
    for (const [module, standIn] of standIns) {
      const name = path.basename(module, '.ts');
      const imported = new Set<string>();
      for (const file of kitFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const regex = new RegExp(`import\\s+\\{([^}]*)\\}\\s+from\\s+'[./]*[^']*/${name}'`, 'g');
        for (const match of source.matchAll(regex)) {
          for (const part of match[1].split(',')) {
            const id = part.trim().replace(/^type\s+/, '');
            if (id && !part.trim().startsWith('type ')) imported.add(id.split(/\s+as\s+/)[0]);
          }
        }
      }
      expect(imported.size).toBeGreaterThan(0);
      const exported = fs.readFileSync(standIn, 'utf8');
      for (const id of imported) expect(exported).toMatch(new RegExp(`export const ${id}\\b`));
    }
  });
});

describe('the script build', () => {
  const buildAsync = async (mode: 'public' | 'dev') => {
    const diag = new HubDiagnostics();
    const scripts = await buildScripts(mode, diag, getProjectMetadata());
    expect(diag.errors).toEqual([]);
    return scripts as HubBuiltScripts;
  };
  const outPaths = (scripts: HubBuiltScripts) => scripts.files.map((file) => file.outPath);

  it('leaves the component library out of a public build', async () => {
    const scripts = await buildAsync('public');
    expect(outPaths(scripts).filter((out) => out.includes('_components'))).toEqual([]);
    expect(scripts.sources.filter((file) => file.startsWith(UI_DIR))).toEqual([]);
  }, 30_000);

  it('builds the UI kit into the dev chunk, with its CSS and without the engine', async () => {
    const scripts = await buildAsync('dev');
    const outs = outPaths(scripts);
    expect(outs.some((out) => /^_assets\/chunks\/_components-[\w-]+\.js$/.test(out))).toBe(true);
    expect(outs.some((out) => /^_assets\/chunks\/_components-[\w-]+\.css$/.test(out))).toBe(true);
    // Nothing but the scripts and the kit's CSS: no worker, wasm or decoder came along
    expect(outs.filter((out) => !/\.(js|css)$/.test(out))).toEqual([]);
    const sources = scripts.sources.map(fromRoot);
    expect(sources).toContain('src/_engine/ui/DraggableWindow.ts');
    expect(sources.filter((file) => /^node_modules\/three\/|\/kernel\/loop\//.test(file))).toEqual(
      []
    );
    expect(scripts.sources).not.toContain(HUB_COMPONENTS_FILE); // in hub/: watched already
  }, 30_000);
});
