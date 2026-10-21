/**
 * A build's files by key (p619 §1.4 B2): the name without the content hash (`assets/index.js`), so
 * the baselines and the budgets name a file across builds. `vite build` gives two files one name
 * in two ways, and a key says which:
 *
 * - A worker build's copy of a module the main build has too (`EngineRapier`, three's
 *   `three.module`) and the worker's entry next to its `?worker` wrapper: the manifest's file keeps
 *   the plain key, the worker's is `<key>@<worker>` (`assets/EngineRapier.js@PhysicsWorker`).
 * - Two of the manifest's files of one name from two folders (three's two Draco decoders): each
 *   `<key>@<source folder>` (`assets/draco_decoder.wasm@gltf`).
 *
 * Any other shared name throws: numbering them in hash order swapped two files' keys between
 * builds (the `#2` keys before p619).
 */
import path from 'path';
import type { Manifest } from './bundleModel';

/** `assets/index-Hx4K2rfZ.js` → `assets/index.js` (Vite's 8-character content hash) */
export const stripHash = (file: string) => file.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1');

const TEXT_FILE = /\.(js|mjs|css)$/;

/**
 * The files reachable from the roots: a text file (JS, CSS) reaches every file whose name it
 * contains. A name is only in code that ships (a tree-shaken importer leaves none), so what isn't
 * reached is never loaded.
 * @param files every file of the build (relative paths)
 * @param read a text file's content
 */
export const findReachableFiles = (
  roots: string[],
  files: string[],
  read: (file: string) => string
) => {
  const byName = new Map(files.map((file) => [path.posix.basename(file), file]));
  const reached = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    if (!TEXT_FILE.test(file)) continue;
    const text = read(file);
    for (const [name, other] of byName) {
      if (!reached.has(other) && text.includes(name)) queue.push(other);
    }
  }
  return reached;
};

/** Every file the manifest names (its chunks, their CSS and assets) → its entry's source, if any */
const listManifestFiles = (manifest: Manifest) => {
  const files = new Map<string, string | undefined>();
  for (const { file, src, css, assets } of Object.values(manifest)) {
    files.set(file, src);
    for (const other of [...(css ?? []), ...(assets ?? [])]) {
      if (!files.has(other)) files.set(other, undefined);
    }
  }
  return files;
};

/**
 * Each file's key (see the file's header).
 * @param opts.files the build's files (paths from its output folder, hashed: `assets/index-Bd_fo_yS.js`)
 * @param opts.workers each worker build's name → its chunks (`module-sizes.json`); a worker's
 *   other files are the ones its chunks reach by name ({@link findReachableFiles})
 * @param opts.read a text file's content
 * @returns hashed name → key
 * @throws when two files share a name and neither rule tells them apart
 */
export const keyBuildFiles = (opts: {
  files: string[];
  manifest: Manifest;
  workers: Record<string, string[]>;
  read: (file: string) => string;
}): Record<string, string> => {
  const byBase = new Map<string, string[]>();
  for (const file of [...opts.files].sort()) {
    const base = stripHash(file);
    byBase.set(base, [...(byBase.get(base) ?? []), file]);
  }
  const manifestFiles = listManifestFiles(opts.manifest);
  const fileSet = new Set(opts.files);
  let reachedBy: [worker: string, reached: Set<string>][] | null = null;
  /** The workers whose chunks reach it; crawled on the first name a worker's file may share */
  const getWorkersOf = (file: string) => {
    reachedBy ??= Object.entries(opts.workers).map(([worker, chunks]) => [
      worker,
      findReachableFiles(
        chunks.filter((chunk) => fileSet.has(chunk)),
        opts.files,
        opts.read
      ),
    ]);
    return reachedBy.filter(([, reached]) => reached.has(file)).map(([worker]) => worker);
  };
  const ambiguous = (base: string, files: string[], why: string): never => {
    throw new Error(`${files.join(' and ')} share the key ${base}: ${why}`);
  };

  const keys: Record<string, string> = {};
  for (const [base, files] of byBase) {
    if (files.length === 1) {
      keys[files[0]] = base;
      continue;
    }
    const inManifest = files.filter((file) => manifestFiles.has(file));
    if (inManifest.length === 1) keys[inManifest[0]] = base;
    for (const file of inManifest.length > 1 ? inManifest : []) {
      const src = manifestFiles.get(file);
      if (!src) ambiguous(base, inManifest, `${file} has no source in the manifest`);
      keys[file] = `${base}@${path.posix.basename(path.posix.dirname(src!))}`;
    }
    for (const file of files.filter((f) => !manifestFiles.has(f))) {
      const workers = getWorkersOf(file);
      if (workers.length !== 1) {
        ambiguous(
          base,
          files,
          `${file} isn't in the manifest and ${workers.length ? `${workers.join(' and ')} reach it` : 'no worker build reaches it'}`
        );
      }
      keys[file] = `${base}@${workers[0]}`;
    }
  }
  const files = new Map<string, string>();
  for (const [file, key] of Object.entries(keys)) {
    const other = files.get(key);
    if (other) ambiguous(key, [other, file], 'their source folders or workers share a name');
    files.set(key, file);
  }
  return keys;
};
