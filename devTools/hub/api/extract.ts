import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { JSONOutput, MinimalNode, MinimalSourceFile } from 'typedoc';
import { ENTRY_FILES, type EntryName } from '../../aliases';
import { hashContent } from '../hash';
import { HUB_API_CACHE_FILE, PACKAGE_JSON_FILE, ROOT, toRepoPath, TSCONFIG_FILE } from '../paths';
import { Kind } from './model';

/**
 * The API model: TypeDoc's JSON for the engine and the toolkit, from the
 * `typedocOptions` in `tsconfig.json` (the entry points and the `_dbg__*` / `*.test.ts` /
 * `index.ts` excludes `yarn docs` uses too). It's cached in `.cache/hub/typedoc.json` with a hash of its
 * inputs (the source files' paths, mtimes and sizes, the configs, the TypeDoc version), and kept
 * in memory, so an unchanged model costs a hash: the conversion takes seconds.
 *
 * TypeDoc is loaded only to convert, never on a cache hit (the dev plugin imports this). It runs
 * without type checking (`skipErrorChecking`: `tsc` checks the types, and a type error elsewhere
 * would stop the docs) and without git (`disableGit`: the Hub writes its own source links, so the
 * model doesn't change with the commit).
 *
 * The dev plugin never converts in its own process (§2.5): a conversion blocks the event loop for
 * seconds at a time (the app's requests too) and keeps hundreds of MB. Its builds take the last
 * good model whatever its inputs (`getLastApiModel`), and its rebuilds convert in a child process
 * (`extractApiModelInChildProcess`), which writes the cache file this process then reads.
 *
 * The model carries the public entries (`ENTRY_FILES`, p619 D6): each entry file's names and the
 * modules they come from, read with the conversion (TypeScript is loaded then anyway; the Hub's
 * builds never load it). After the conversion, `linkNamedReferences` gives a type reference
 * TypeDoc left by name its reflection (p619 R3). TypeDoc's own validation doesn't run: its
 * `notExported` checked against every module, and the Hub's leaked type check (`entries.ts`)
 * checks against the entries, which covers it. The model has `typedoc-plugin-zod`
 * (`typedocOptions.plugin`): a `z.infer` / `z.input` alias shows its fields.
 */

/** Bump when the options below, the passes after the conversion or the cache file's shape change */
const EXTRACT_VERSION = 4;

/** The folders the entry points are in; the engine also imports `src/`'s own files */
const SOURCE_DIRS = ['src/_engine', 'src/toolkit'].map((dir) => path.join(ROOT, dir));
const SRC_DIR = path.join(ROOT, 'src');
/** The type information comes from installed packages too */
const LOCK_FILE = path.join(ROOT, 'yarn.lock');
/**
 * `typedocOptions.exclude`: they aren't in the model, so they aren't in its hash. The entries
 * (`index.ts`, p606) only re-export: TypeDoc documents the source files, and the entry files are
 * hashed apart (`ENTRY_PATHS`), since the model's entry list comes from them.
 */
const EXCLUDED_FILE_REGEX = /^(_dbg__|index\.ts$)|\.test\.ts$/;
const ENTRY_PATHS = Object.values(ENTRY_FILES).map((file) => path.join(ROOT, file));
/** The child process's entry, run through tsx */
const CHILD_PROCESS_ENTRY = path.join(ROOT, 'devTools', 'hub', 'api', 'extractProcess.ts');

/** One of the conversion's errors or warnings, with its file and line when TypeDoc gave one */
export type ApiExtractMessage = {
  level: 'error' | 'warning';
  message: string;
  /** Absolute, when TypeDoc named a source position or a reflection of a known module */
  file?: string;
  line?: number;
};

/** A name on an entry: the module it comes from and its name there */
export type ApiEntryExport = {
  name: string;
  /** Its name in `sourcePath` (`export { a as b }`: `a`) */
  imported: string;
  /** From the repo root: `src/_engine/kernel/scene/SceneLoader.ts` */
  sourcePath: string;
};

/** An entry (`aekasha/physics`) and its names, in the entry file's order */
export type ApiEntry = {
  entry: EntryName;
  /** From the repo root */
  file: string;
  exports: ApiEntryExport[];
};

/** The API model: TypeDoc's JSON project and the entries' names, under its inputs' hash */
export type ApiModel = {
  /** The inputs' hash: an unchanged one is the same model */
  hash: string;
  project: JSONOutput.ProjectReflection;
  /** In `ENTRY_FILES`' order */
  entries: ApiEntry[];
  /** TypeDoc's warnings, kept with the model so a cache hit reports them too */
  messages: ApiExtractMessage[];
};

/** A conversion's outcome: the model (or null), its messages, and whether the cache served it */
export type ApiExtractResult = {
  /** Null when the conversion failed (`messages` says why) */
  model: ApiModel | null;
  messages: ApiExtractMessage[];
  isCached: boolean;
  durationMs: number;
};

/** What the child process (`extractProcess.ts`) sends back: the cached model's hash, or null */
export type ApiChildProcessReply = Omit<ApiExtractResult, 'model'> & { hash: string | null };

type CacheFile = ApiModel & { version: number };

const isSourceFileName = (name: string) => name.endsWith('.ts') && !EXCLUDED_FILE_REGEX.test(name);

const listSourceFiles = (dir: string, files: string[] = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(file, files);
    else if (isSourceFileName(entry.name)) files.push(file);
  }
  return files;
};

/** Whether `file` (absolute) is one of `hashApiInputs`' inputs: the dev plugin's stale check */
export const isApiInputFile = (file: string) => {
  if (file === TSCONFIG_FILE || file === PACKAGE_JSON_FILE || file === LOCK_FILE) return true;
  if (ENTRY_PATHS.includes(file)) return true;
  if (!isSourceFileName(path.basename(file))) return false;
  return (
    path.dirname(file) === SRC_DIR || SOURCE_DIRS.some((dir) => file.startsWith(dir + path.sep))
  );
};

const getTypedocVersion = () =>
  (
    JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules', 'typedoc', 'package.json'), 'utf-8')
    ) as { version: string }
  ).version;

/** The hash of everything the model is built from */
const hashApiInputs = () => {
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => (fs.existsSync(dir) ? listSourceFiles(dir) : [])),
    ...fs
      .readdirSync(SRC_DIR)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => path.join(SRC_DIR, name)),
    ...ENTRY_PATHS,
    TSCONFIG_FILE,
    PACKAGE_JSON_FILE,
    LOCK_FILE,
  ].sort();
  const lines = files.map((file) => {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    return `${path.relative(ROOT, file)}\0${stat?.mtimeMs ?? -1}\0${stat?.size ?? -1}`;
  });
  return hashContent(`${EXTRACT_VERSION}\n${getTypedocVersion()}\n${lines.join('\n')}`);
};

/** The last good model in this process */
let memory: ApiModel | null = null;
/** The last conversion's messages when it failed (the dev plugin's builds keep `memory` then) */
let failure: ApiExtractMessage[] | null = null;

const readCacheFile = (): CacheFile | null => {
  try {
    const cache = JSON.parse(fs.readFileSync(HUB_API_CACHE_FILE, 'utf-8')) as CacheFile;
    return cache.version === EXTRACT_VERSION ? cache : null;
  } catch {
    return null; // None yet, or unreadable: converted again
  }
};

const toModel = ({ hash, project, entries, messages }: CacheFile): ApiModel => ({
  hash,
  project,
  entries,
  messages,
});

const readCache = (hash: string): ApiModel | null => {
  if (memory?.hash === hash) return memory;
  const cache = readCacheFile();
  return cache?.hash === hash ? (memory = toModel(cache)) : null;
};

const writeCache = (model: ApiModel) => {
  const cache: CacheFile = { version: EXTRACT_VERSION, ...model };
  fs.mkdirSync(path.dirname(HUB_API_CACHE_FILE), { recursive: true });
  const temp = `${HUB_API_CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(cache));
  fs.renameSync(temp, HUB_API_CACHE_FILE);
};

/** `The signature _engine/kernel/scene/SceneLoader.SceneLoader.loadFn…`: the module's file */
const findModuleFile = (message: string, project: JSONOutput.ProjectReflection) => {
  let best: JSONOutput.DeclarationReflection | null = null;
  for (const module of project.children ?? []) {
    if (!message.includes(`${module.name}.`)) continue;
    if (!best || module.name.length > best.name.length) best = module;
  }
  const fileName = best?.sources?.[0]?.fileName;
  return fileName ? path.join(ROOT, fileName) : undefined;
};

/**
 * The entry files' names (p606: an entry holds only named `export … from`; `aliases.test.ts`),
 * each with the module it comes from; a name re-exported from another entry (the toolkit's
 * deprecated `createSeededRandom`) with that entry's module. A star re-export, a declaration in
 * the entry file or a module that isn't there is an error.
 */
const readEntries = async (): Promise<{ entries: ApiEntry[]; messages: ApiExtractMessage[] }> => {
  // TypeScript, through the import graph's parser: only a conversion loads it
  const { parseModuleSource } = await import('../../refactor/importGraph');
  const messages: ApiExtractMessage[] = [];
  const parsed = new Map(
    Object.entries(ENTRY_FILES).map(([entry, file]) => {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      return [entry, { file, exports: parseModuleSource(file, text).exports }] as const;
    })
  );
  const resolve = (
    entry: string,
    name: string,
    seen = new Set<string>()
  ): Omit<ApiEntryExport, 'name'> | string => {
    const { file, exports } = parsed.get(entry)!;
    const from = exports.named[name];
    if (!from) return `\`${name}\` isn't on ${entry}`;
    if (parsed.has(from.specifier)) {
      if (seen.has(from.specifier)) return `\`${name}\` is re-exported in a cycle of entries`;
      return resolve(from.specifier, from.imported, new Set([...seen, entry]));
    }
    const base = path.posix.join(path.posix.dirname(file), from.specifier);
    const sourcePath = [`${base}.ts`, `${base}/index.ts`].find((candidate) =>
      fs.existsSync(path.join(ROOT, candidate))
    );
    return sourcePath
      ? { imported: from.imported, sourcePath }
      : `\`${name}\` comes from '${from.specifier}', which isn't a module`;
  };
  const entries = [...parsed].map(([entry, { file, exports }]): ApiEntry => {
    const error = (message: string) =>
      messages.push({
        level: 'error',
        message: `${entry}: ${message}`,
        file: path.join(ROOT, file),
      });
    for (const specifier of exports.star)
      error(`\`export * from '${specifier}'\`: name each export`);
    for (const name of exports.local) error(`\`${name}\` is declared in the entry file`);
    const resolved: ApiEntryExport[] = [];
    for (const name of Object.keys(exports.named)) {
      const result = resolve(entry, name);
      if (typeof result === 'string') error(result);
      else resolved.push({ name, ...result });
    }
    return { entry: entry as EntryName, file, exports: resolved };
  });
  return { entries, messages };
};

/** The reflection kinds a reference by name can mean: what a module declares */
const NAMED_REFERENCE_KINDS: number[] = [
  Kind.Enum,
  Kind.Variable,
  Kind.Function,
  Kind.Class,
  Kind.Interface,
  Kind.TypeAlias,
];

/**
 * p619 R3: a type reference TypeDoc left by name (`{ packagePath, qualifiedName }`) while the
 * model has its reflection gets that reflection's id. An interface merged by
 * `declare module 'aekasha'` (`ComponentDataMap`, `CharacterBrainKinds`) is one: the reference
 * names the merged symbol, which has no reflection of its own. A type parameter (`K`) and another
 * package's type are left as they are. Changes `project` in place.
 */
export const linkNamedReferences = (project: JSONOutput.ProjectReflection) => {
  const kinds = new Map<number, number>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(collect);
    const reflection = value as { id?: unknown; variant?: unknown; kind?: unknown };
    if (typeof reflection.id === 'number' && typeof reflection.variant === 'string') {
      kinds.set(reflection.id, reflection.kind as number);
    }
    for (const key in value) collect((value as Record<string, unknown>)[key]);
  };
  collect(project.children);
  /** TypeDoc's `ReflectionId`, a branded number */
  type Id = Extract<JSONOutput.ReferenceType['target'], number>;
  const ids = new Map<string, Id>();
  for (const [id, { packageName, packagePath, qualifiedName }] of Object.entries(
    project.symbolIdMap ?? {}
  )) {
    if (packageName !== project.packageName) continue;
    if (!NAMED_REFERENCE_KINDS.includes(kinds.get(Number(id)) ?? 0)) continue;
    ids.set(`${packagePath}\0${qualifiedName}`, Number(id) as Id);
  }
  let count = 0;
  const link = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(link);
    const type = value as JSONOutput.ReferenceType;
    if (
      type.type === 'reference' &&
      !type.refersToTypeParameter &&
      typeof type.target === 'object' &&
      type.target.packageName === project.packageName
    ) {
      const id = ids.get(`${type.target.packagePath}\0${type.target.qualifiedName}`);
      if (id !== undefined) {
        type.target = id;
        count++;
      }
    }
    for (const key in value) link((value as Record<string, unknown>)[key]);
  };
  link(project.children);
  return count;
};

const convert = async (): Promise<{
  project: JSONOutput.ProjectReflection | null;
  entries: ApiEntry[];
  messages: ApiExtractMessage[];
}> => {
  const { Application, Logger, LogLevel } = await import('typedoc');
  const messages: ApiExtractMessage[] = [];

  /** Keeps TypeDoc's warnings and errors, with the source position it names */
  class CapturingLogger extends Logger {
    private position: { file?: string; line?: number } = {};

    protected override addContext(
      message: string,
      _level: number,
      ...args: [MinimalNode?] | [number, MinimalSourceFile]
    ) {
      const [first, second] = args;
      let file: MinimalSourceFile | undefined;
      let pos = 0;
      if (typeof first === 'number' && second) {
        file = second;
        pos = first;
      } else if (first && typeof first === 'object') {
        file = first.getSourceFile();
        pos = first.getStart();
      }
      this.position = file
        ? {
            file: path.resolve(ROOT, file.fileName),
            line: file.getLineAndCharacterOfPosition(pos).line + 1,
          }
        : {};
      return message;
    }

    override log(message: string, level: number) {
      super.log(message, level);
      const position = this.position;
      this.position = {};
      if (level < LogLevel.Warn) return;
      // Comments in installed packages' declarations (three's) aren't ours to fix
      const nodeModules = `${path.sep}node_modules${path.sep}`;
      if (position.file?.includes(nodeModules) || message.includes('/node_modules/')) return;
      messages.push({ level: level >= LogLevel.Error ? 'error' : 'warning', message, ...position });
    }
  }

  const app = await Application.bootstrapWithPlugins({
    tsconfig: TSCONFIG_FILE,
    skipErrorChecking: true,
    disableGit: true,
    // Required with `disableGit`; the Hub builds its own links from the file and line
    sourceLinkTemplate: '{path}#L{line}',
    logLevel: 'Warn',
  });
  app.logger = new CapturingLogger();
  const project = await app.convert();
  if (!project) return { project: null, entries: [], messages };
  const json = app.serializer.projectToObject(
    project,
    ROOT as Parameters<typeof app.serializer.projectToObject>[1]
  );
  linkNamedReferences(json);
  for (const message of messages) message.file ??= findModuleFile(message.message, json);
  const { entries, messages: entryMessages } = await readEntries();
  messages.push(...entryMessages);
  return { project: json, entries, messages };
};

/**
 * The API model: from memory or the cache when its inputs haven't changed, else converted (and
 * cached). Never throws: a failed conversion is a null model with its messages.
 */
export const loadApiModel = async (): Promise<ApiExtractResult> => {
  const startTime = performance.now();
  const durationMs = () => performance.now() - startTime;
  const hash = hashApiInputs();
  const cached = readCache(hash);
  if (cached) {
    return { model: cached, messages: cached.messages, isCached: true, durationMs: durationMs() };
  }

  try {
    const { project, entries, messages } = await convert();
    if (!project) {
      if (!messages.some((m) => m.level === 'error')) {
        messages.push({
          level: 'error',
          message: 'TypeDoc converted nothing',
          file: TSCONFIG_FILE,
        });
      }
      return { model: null, messages, isCached: false, durationMs: durationMs() };
    }
    memory = { hash, project, entries, messages };
    failure = null;
    writeCache(memory);
    return { model: memory, messages, isCached: false, durationMs: durationMs() };
  } catch (err) {
    const message = `TypeDoc failed: ${(err as Error).stack ?? String(err)}`;
    const messages: ApiExtractMessage[] = [{ level: 'error', message, file: TSCONFIG_FILE }];
    return { model: null, messages, isCached: false, durationMs: durationMs() };
  }
};

/**
 * The dev plugin's model (§2.5): the last good one whatever its inputs (from memory, else the
 * cache file), with the last conversion's messages: a failed one's errors land on the API pages
 * while every other page keeps the last good `api:` links. `isStale` when it was read from a cache
 * file older than its inputs, or there's none and no conversion has run.
 */
export const getLastApiModel = (): ApiExtractResult & { isStale: boolean } => {
  const startTime = performance.now();
  let isStale = false;
  if (!memory && !failure) {
    const cache = readCacheFile();
    if (cache) memory = toModel(cache);
    isStale = !cache || cache.hash !== hashApiInputs();
  }
  return {
    model: memory,
    messages: failure ?? memory?.messages ?? [],
    isCached: true,
    isStale,
    durationMs: performance.now() - startTime,
  };
};

/**
 * Converts in a child process (`extractProcess.ts`, through tsx), which writes the cache file, and
 * then reads it into this process: `getLastApiModel` returns it from then on. A failure keeps the
 * last good model, and its messages are the next builds' (`getLastApiModel`). Never rejects.
 */
export const extractApiModelInChildProcess = () =>
  new Promise<{ isOk: boolean; isCached: boolean; durationMs: number }>((resolve) => {
    const startTime = performance.now();
    let reply: ApiChildProcessReply | null = null;
    let isSettled = false;
    const settle = (isOk: boolean, isCached = false) => {
      if (isSettled) return;
      isSettled = true;
      resolve({ isOk, isCached, durationMs: performance.now() - startTime });
    };
    const fail = (message: string) => {
      failure = [{ level: 'error', message, file: TSCONFIG_FILE }];
      settle(false);
    };

    const child = fork(CHILD_PROCESS_ENTRY, [], {
      cwd: ROOT,
      execArgv: ['--import', 'tsx'],
      // Its stderr reaches the terminal: a crash's stack
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.on('message', (message) => (reply = message as ApiChildProcessReply));
    child.on('error', (err) => fail(`The API extraction process failed: ${err.message}`));
    child.on('exit', (code, signal) => {
      if (!reply) {
        fail(`The API extraction process exited (${signal ?? `code ${code}`}) without a model`);
      } else if (!reply.hash) {
        failure = reply.messages;
        settle(false);
      } else if (readCache(reply.hash)) {
        failure = null;
        settle(true, reply.isCached);
      } else {
        fail(`The API extraction process wrote no ${toRepoPath(HUB_API_CACHE_FILE)}`);
      }
    });
  });
