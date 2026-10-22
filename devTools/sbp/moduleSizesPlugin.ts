/**
 * The modules' sizes after minification (p619 §1.4 B1, V7): `yarn sbp`'s groups and the debug
 * check read them. The visualizer measures each module's rendered code before minification, so its
 * JSDoc and names counted (a group's "gzip" summed to 832 kB against a 379 kB initial download),
 * and it runs in the main build only, so the workers' modules weren't measured or checked.
 *
 * In the main build and in every worker build (`worker.plugins`), `generateBundle` minifies each
 * module's rendered code per chunk with esbuild (the build's target, as Vite's own minify), and
 * gzips each group's concatenated minified code per chunk (a group's gzip, which compresses the
 * way the chunk does) and each module's alone (for `modules` budgets: those overcount a little,
 * each pays its own gzip header). One collector for the builds of a `vite build`; the main build's
 * `writeBundle` writes it (`dist-stats/module-sizes.json`, an embed's next to its visualizer
 * report). About 1-2 s per app build.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { transform } from 'esbuild';
import type { Plugin, Rollup } from 'vite';
import { ROOT } from '../paths';
import {
  type GroupSize,
  MAIN_BUILD,
  MODULE_SIZES_FORMAT_VERSION,
  type ModuleSize,
  type ModuleSizesFile,
  getModuleGroup,
} from './bundleModel';

/** A module id as the visualizer writes it: from the project folder, `/src/…` */
const toModuleId = (id: string, root: string) =>
  id.startsWith(`${root}/`) ? id.slice(root.length) : id;

const gzipLength = (code: string) => zlib.gzipSync(code, { level: 9 }).length;

type MeasureContext = { root: string; target: string | string[]; warn: (msg: string) => void };

/** Minifies one module's rendered code; on a parse error (a fragment esbuild can't read) its
 * rendered code counts, with a warning */
const minifyModule = async (id: string, code: string, ctx: MeasureContext) => {
  try {
    const result = await transform(code, {
      loader: 'js',
      format: 'esm',
      minify: true,
      // A module's declarations are used by the chunk's other modules
      treeShaking: false,
      charset: 'utf8',
      target: ctx.target,
    });
    return result.code;
  } catch (error) {
    ctx.warn(
      `[module sizes] ${id} measured unminified: ${(error as Error).message.split('\n')[0]}`
    );
    return code;
  }
};

/** One chunk's modules measured, and its groups */
const measureChunk = async (chunk: Rollup.OutputChunk, ctx: MeasureContext) => {
  const measured = await Promise.all(
    Object.entries(chunk.modules)
      .filter(([, module]) => module.code)
      .map(async ([rawId, module]) => {
        const id = toModuleId(rawId, ctx.root);
        const code = await minifyModule(id, module.code!, ctx);
        const size: ModuleSize = {
          rendered: module.renderedLength,
          minified: Buffer.byteLength(code),
          gzip: gzipLength(code),
        };
        return { id, size, code };
      })
  );
  const groupCode = new Map<string, { size: GroupSize; code: string[] }>();
  for (const { id, size, code } of measured) {
    const name = getModuleGroup(id);
    const group = groupCode.get(name) ?? { size: { modules: 0, minified: 0, gzip: 0 }, code: [] };
    group.size.modules++;
    group.size.minified += size.minified;
    group.code.push(code);
    groupCode.set(name, group);
  }
  const groups: Record<string, GroupSize> = {};
  for (const [name, { size, code }] of [...groupCode].sort(([a], [b]) => a.localeCompare(b))) {
    groups[name] = { ...size, gzip: gzipLength(code.join('')) };
  }
  return { file: chunk.fileName, modules: measured, groups };
};

/** Measures one build's chunks into the collected file */
const measureBundle = async (
  into: ModuleSizesFile,
  build: string,
  bundle: Rollup.OutputBundle,
  ctx: MeasureContext
) => {
  const chunks = await Promise.all(
    Object.values(bundle).flatMap((output) =>
      output.type === 'chunk' ? [measureChunk(output, ctx)] : []
    )
  );
  const modules = new Map<string, Record<string, ModuleSize>>();
  for (const chunk of chunks) {
    into.chunks[chunk.file] = { build, groups: chunk.groups };
    for (const { id, size } of chunk.modules) {
      modules.set(id, { ...modules.get(id), [chunk.file]: size });
    }
  }
  for (const [id, chunks] of modules) into.modules.push({ id, build, chunks });
};

/**
 * A worker build and the main build emit the same chunk (the same code: one file of one name,
 * Rapier, the meshopt modules): the main build's, which ran after; the worker's records of it go,
 * or its modules would count twice
 */
const dropSharedChunks = (sizes: ModuleSizesFile): ModuleSizesFile => ({
  ...sizes,
  modules: sizes.modules.flatMap((module) => {
    const chunks = Object.entries(module.chunks).filter(
      ([file]) => sizes.chunks[file]?.build === module.build
    );
    return chunks.length ? [{ ...module, chunks: Object.fromEntries(chunks) }] : [];
  }),
});

const createEmptySizes = (): ModuleSizesFile => ({
  formatVersion: MODULE_SIZES_FORMAT_VERSION,
  chunks: {},
  modules: [],
});

/**
 * The plugins of one `vite build`: `plugin` for `plugins`, `workerPlugin` for `worker.plugins`
 * (a new one per worker build, all into the same collector).
 * @param opts.file where the main build's `writeBundle` writes the sizes
 * @param opts.root the folder module ids are written from (the repo's)
 */
export const createModuleSizesPlugins = (opts: { file: string; root?: string }) => {
  const root = opts.root ?? ROOT;
  let sizes = createEmptySizes();
  const measurePlugin = (isMain: boolean): Plugin => {
    let target: string | string[] = 'esnext';
    return {
      name: 'vite-plugin-aek-module-sizes',
      apply: 'build',
      enforce: 'post',
      configResolved(config) {
        if (config.build.target) target = config.build.target;
      },
      async generateBundle(_, bundle) {
        // A worker is named by its entry chunk (`PhysicsWorker`)
        const entry = Object.values(bundle).find((o) => o.type === 'chunk' && o.isEntry);
        const build = isMain ? MAIN_BUILD : entry?.name;
        if (!build) {
          this.warn('[module sizes] a worker build without an entry chunk: not measured');
          return;
        }
        await measureBundle(sizes, build, bundle, { root, target, warn: (msg) => this.warn(msg) });
      },
    };
  };
  return {
    plugin: (): Plugin => ({
      ...measurePlugin(true),
      // The worker builds run inside the main build, after its start
      buildStart() {
        sizes = createEmptySizes();
      },
      writeBundle() {
        fs.mkdirSync(path.dirname(opts.file), { recursive: true });
        fs.writeFileSync(opts.file, `${JSON.stringify(dropSharedChunks(sizes))}\n`);
      },
    }),
    workerPlugin: (): Plugin => measurePlugin(false),
  };
};
