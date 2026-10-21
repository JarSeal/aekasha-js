/**
 * The dev file server's routes (p342), under `/__aek/files/`: what the server
 * (`devTools/devFilesPlugin.ts`) and the browser client (`debug/DevFiles.ts`) share.
 * No imports: the dev server (Node) imports this too.
 */

/**
 * The base path of the dev file server's routes.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export const DEV_FILES_ROUTE_BASE = '/__aek/files/';
/**
 * The request header every route but `status` needs.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export const DEV_FILES_TOKEN_HEADER = 'x-aek-dev-token';
/**
 * The `<meta name>` the token is injected into `index.html` with.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export const DEV_FILES_TOKEN_META = 'aek-dev-files';
/**
 * The `read` route's response header with the file's hash.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export const DEV_FILES_HASH_HEADER = 'x-aek-sha256';

export type DevFilesErrorCode =
  | 'NOT_ENABLED'
  | 'BAD_TOKEN'
  | 'BAD_ORIGIN'
  | 'BAD_HOST'
  | 'NOT_LOCAL'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN_PATH'
  | 'TOO_LARGE'
  | 'CONFLICT'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'STAGE_EXPIRED'
  | 'SAVE_DATA_DISABLED'
  | 'WRITE_FAILED';

/**
 * A refused request's body (the client throws it as a `DevFilesError`).
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export type DevFilesErrorBody = {
  error: { code: DevFilesErrorCode; message: string; details?: unknown };
};

/** `GET status` */
export type DevFilesStatusBody = {
  enabled: boolean;
  /** `AEK_DEV_FILES_LAN=true`: the other routes take requests from the LAN too */
  writesFromLAN: boolean;
  /** This request's device may use the other routes (it's local, or the LAN is allowed) */
  canWrite: boolean;
  /** The folders a path must be in (repo-relative, `/`-terminated) */
  roots: string[];
  /** The folders inside them a path must not be in */
  deniedRoots: string[];
  extensions: string[];
  maxFileBytes: number;
  maxBatchBytes: number;
};

/**
 * `PUT stage`'s response.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export type DevFilesStageBody = { stageId: string; bytes: number; sha256: string };

/** A save entry (p342 §2.6): `entry` goes first in the file's `__saveData[sceneId]`, the older
 * entries after it, and the server stamps its `__meta` */
export type DevFilesSaveData = { sceneId: string; entry: Record<string, unknown> };

/**
 * A save entry as a commit sends it: `historySize` is how many entries the scene keeps, the new
 * one included (-1: all; 0 is refused with `SAVE_DATA_DISABLED`). The client fills it in from
 * the "File server" setting.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export type DevFilesSaveDataWrite = DevFilesSaveData & { historySize: number };

/**
 * One write of a `POST commit` batch. The client's and the server's.
 * @internal
 */
export type DevFilesWrite = {
  /** Repo-relative, `/`-separated */
  path: string;
  /** The hash the tool read; null: the file must not exist yet; omitted: overwrite */
  expectedHash?: string | null;
} & ({ json: unknown } | { stageId: string } | { saveData: DevFilesSaveDataWrite });

/**
 * The `POST commit` body: the client's and the server's.
 * @internal
 */
export type DevFilesCommitRequest = { writes: DevFilesWrite[] };

export type DevFilesWriteStatus = 'created' | 'updated' | 'unchanged';

/** `POST commit` */
export type DevFilesCommitBody = {
  results: { path: string; sha256: string; status: DevFilesWriteStatus }[];
};

/** `INVALID_SCHEMA`'s details: the issues per file, as the gatherer lists them */
export type DevFilesSchemaIssues = { path: string; issues: { path: string; message: string }[] }[];

/** `CONFLICT`'s details: the hashes on disk now (null: no file) */
export type DevFilesConflicts = { path: string; currentHash: string | null }[];

/**
 * The scene gatherer's custom HMR event (`devTools/sceneGathererPlugin.ts`), sent after each
 * gather the dev server runs, before its `full-reload`.
 * @deprecated Only the protocol's two sides use it: the dev files client and the dev server (by
 * path, in `devTools/`). It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No
 * replacement: an app reaches the dev server through `writeDevFiles`, `readDevFile` and
 * `onDevDataGathered`.
 */
export const AEK_GATHER_EVENT = 'aek:gather';

export type DevDataGatheredEvent = {
  /** `failed`: the pipeline couldn't start or the gather failed, the generated data is as it was */
  status: 'done' | 'failed';
  /** The changed files the run reacted to (asset JSONs and the files they read, gathered JSONs,
   * `assets.config.json`, `src/CONFIG.ts`), repo-relative */
  files: string[];
  /** The assets the pipeline failed to build: the gather used their sources */
  assetErrors: { id: string; reason: string }[];
  /** A full reload follows: after every gather that wrote the generated data (`done`, asset
   * errors too: Vite reloads on its change). False after a failure: the error overlay shows, and
   * the page keeps the data it has. */
  willReload: boolean;
  /** What failed (`failed` only) */
  message?: string;
};
