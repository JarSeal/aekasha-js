/**
 * The dev file server's routes (p342), under `/__aek/files/`: what the server
 * (`devTools/devFilesPlugin.ts`) and the browser client (`debug/DevFiles.ts`) share.
 * No imports: the dev server (Node) imports this too.
 */

/**
 * The base path of the dev file server's routes.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export const DEV_FILES_ROUTE_BASE = '/__aek/files/';
/**
 * The request header every route but `status` needs.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export const DEV_FILES_TOKEN_HEADER = 'x-aek-dev-token';
/**
 * The `<meta name>` the token is injected into `index.html` with.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export const DEV_FILES_TOKEN_META = 'aek-dev-files';
/**
 * The `read` route's response header with the file's hash.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export const DEV_FILES_HASH_HEADER = 'x-aek-sha256';

/** Why the dev server refused or failed a request (`DevFilesError`'s `code` carries it). */
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
  /** A staged file that doesn't start like the image its path's extension names */
  | 'INVALID_IMAGE'
  | 'STAGE_EXPIRED'
  | 'SAVE_DATA_DISABLED'
  | 'WRITE_FAILED';

/**
 * A refused request's body (the client throws it as a `DevFilesError`).
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export type DevFilesErrorBody = {
  error: { code: DevFilesErrorCode; message: string; details?: unknown };
};

/** The dev server's settings (`GET status`): `DevFilesStatus`'s `server`. */
export type DevFilesStatusBody = {
  /** False with `AEK_DEV_FILES=false` */
  enabled: boolean;
  /** `AEK_DEV_FILES_LAN=true`: the other routes take requests from the LAN too */
  writesFromLAN: boolean;
  /** This request's device may use the other routes (it's local, or the LAN is allowed) */
  canWrite: boolean;
  /** The folders a path must be in (repo-relative, `/`-terminated) */
  roots: string[];
  /** The folders inside them a path must not be in */
  deniedRoots: string[];
  /** The extensions a path may have (`.json`, `.png`, …) */
  extensions: string[];
  /** The largest file a write may send */
  maxFileBytes: number;
  /** The largest batch a commit may send, its files together */
  maxBatchBytes: number;
  /** How many commits' backups the server keeps (`AEK_DEV_FILES_BACKUPS`, default 20): -1 all,
   * 0 none (a commit's backups are removed once it landed) */
  backupsKept: number;
  /** Where the backups are, repo-relative (`.cache/dev-files/backup/`) */
  backupDir: string;
  /** What the server stamps a save entry's `__meta.author` with: git's `user.name`, null without
   * git, outside a repo, or with no `user.name` set (the entry then has no `author`) */
  author: string | null;
};

/**
 * `PUT stage`'s response.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export type DevFilesStageBody = { stageId: string; bytes: number; sha256: string };

/** A save entry (p342 §2.6): `entry` goes first in the file's `__saveData[sceneId]`, the older
 * entries after it, and the server stamps its `__meta` */
export type DevFilesSaveData = {
  /** The scene the entry applies in */
  sceneId: string;
  /** The overrides, in the asset's overrides schema */
  entry: Record<string, unknown>;
};

/**
 * A save entry as a commit sends it: `historySize` is how many entries the scene keeps, the new
 * one included (-1: all; 0 is refused with `SAVE_DATA_DISABLED`). The client fills it in from
 * the "File server" setting.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export type DevFilesSaveDataWrite = DevFilesSaveData & { historySize: number };

/**
 * One write of a `POST commit` batch (`saveData` one entry, or a list of them with each scene once:
 * p355; with `json`, the entries go into that value instead of the file's, p355 §2.6). The
 * client's and the server's.
 * @internal
 */
export type DevFilesWrite = {
  /** Repo-relative, `/`-separated */
  path: string;
  /** The hash the tool read; null: the file must not exist yet; omitted: overwrite */
  expectedHash?: string | null;
} & (
  | { json: unknown; saveData?: DevFilesSaveDataWrite | DevFilesSaveDataWrite[] }
  | { stageId: string }
  | { saveData: DevFilesSaveDataWrite | DevFilesSaveDataWrite[] }
);

/**
 * The `POST commit` body: the client's and the server's. `dryRun`: every check, nothing written
 * (the results tell what the commit would do, and each file's hash to confirm it with).
 * @internal
 */
export type DevFilesCommitRequest = { writes: DevFilesWrite[]; dryRun?: boolean };

/** What a write did: an `unchanged` file isn't written (and sets off no gather). */
export type DevFilesWriteStatus = 'created' | 'updated' | 'unchanged';

/** A committed batch's result (`POST commit`): `writeDevFiles`' answer. */
export type DevFilesCommitBody = {
  /**
   * Per write, in the batch's order: its path, the file's hash after the write (a dry run's: what
   * it would be), what the write did (would do) and the file's hash before it (null: there was no
   * file), a dry run's `expectedHash` for the commit it confirms
   */
  results: {
    path: string;
    sha256: string;
    status: DevFilesWriteStatus;
    previousHash: string | null;
  }[];
};

/** `INVALID_SCHEMA`'s details: the issues per file, as the gatherer lists them */
export type DevFilesSchemaIssues = { path: string; issues: { path: string; message: string }[] }[];

/** `CONFLICT`'s details: the hashes on disk now (null: no file) */
export type DevFilesConflicts = { path: string; currentHash: string | null }[];

/**
 * The scene gatherer's custom HMR event (`devTools/sceneGathererPlugin.ts`), sent after each
 * gather the dev server runs, before its `full-reload`.
 * Only the protocol's two sides use it: the dev files client and the dev server (by path, in
 * `devTools/`).
 * @internal
 */
export const AEK_GATHER_EVENT = 'aek:gather';

/** How a gather the dev server ran went: what `onDevDataGathered`'s listener gets. */
export type DevDataGatheredEvent = {
  /** `failed`: the pipeline couldn't start or the gather failed, the generated data is as it was */
  status: 'done' | 'failed';
  /** The changed files the run reacted to (asset JSONs and the files they read, gathered JSONs,
   * `assets.config.json`, `src/CONFIG.ts`), repo-relative */
  files: string[];
  /** The assets the pipeline failed to build: the gather used their sources */
  assetErrors: { id: string; reason: string }[];
  /** A full reload follows: after a gather that changed the generated data (`done`, asset errors
   * too: Vite reloads on its change), or whose run reacted to a changed source file. False when
   * nothing changed, and after a failure: the error overlay shows, and the page keeps the data it
   * has. */
  willReload: boolean;
  /** What failed (`failed` only) */
  message?: string;
};
