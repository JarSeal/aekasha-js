import {
  DevFilesError,
  getDevFilesSaveHistorySize,
  isDevFilesOptionOn,
  type DevFileRead,
  type DevFilesStatus,
  type DevFileWrite,
  type EncodePNGOpts,
  type PNGSource,
} from './DevFiles';
import {
  AEK_GATHER_EVENT,
  DEV_FILES_HASH_HEADER,
  DEV_FILES_ROUTE_BASE,
  DEV_FILES_TOKEN_HEADER,
  DEV_FILES_TOKEN_META,
  type DevFilesCommitBody,
  type DevDataGatheredEvent,
  type DevFilesCommitRequest,
  type DevFilesErrorBody,
  type DevFilesSaveData,
  type DevFilesStageBody,
  type DevFilesStatusBody,
} from './DevFilesProtocol';
import { lerror } from '../utils/Logger';
import { encodeRGBA8PNG } from './_dbg__PNGEncoder';
import { confirmDevFilesWrites } from './_dbg__DevFilesConfirm';
import { _handleOwnGather, _rememberWrittenPaths } from './_dbg__DevFilesGather';

export { _showGatherNoteAfterReload } from './_dbg__DevFilesGather';

// p342 §2.4, p355 §2.4
/** The dev files' browser side; the public API is `debug/DevFiles.ts`. */

const getToken = () =>
  document.querySelector<HTMLMetaElement>(`meta[name="${DEV_FILES_TOKEN_META}"]`)?.content || null;

const isErrorBody = (body: unknown): body is DevFilesErrorBody =>
  !!body &&
  typeof body === 'object' &&
  'error' in body &&
  typeof (body as DevFilesErrorBody).error?.code === 'string';

/** A route's response; a refusal rejects with the server's code */
const request = async (route: string, init: RequestInit = {}, withToken = true) => {
  const headers = new Headers(init.headers);
  if (withToken) {
    if (!import.meta.hot) {
      throw new DevFilesError('UNAVAILABLE', "The page wasn't served by the dev server");
    }
    const token = getToken();
    if (!token) {
      throw new DevFilesError(
        'UNAVAILABLE',
        'The page has no dev files token (AEK_DEV_FILES=false, or reload the page)'
      );
    }
    headers.set(DEV_FILES_TOKEN_HEADER, token);
  }
  let response: Response;
  try {
    response = await fetch(`${DEV_FILES_ROUTE_BASE}${route}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch (err) {
    throw new DevFilesError('NETWORK', `Dev files ${route}: ${(err as Error).message}`);
  }
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  if (isErrorBody(body)) {
    throw new DevFilesError(body.error.code, body.error.message, body.error.details);
  }
  throw new DevFilesError('NETWORK', `Dev files ${route}: HTTP ${response.status}`);
};

const readJson = async <T>(response: Response, route: string) => {
  try {
    return (await response.json()) as T;
  } catch {
    throw new DevFilesError('NETWORK', `Dev files ${route}: the answer isn't JSON`);
  }
};

export const _getDevFilesStatus = async (): Promise<DevFilesStatus> => {
  if (!import.meta.hot) {
    return {
      available: false,
      reason: 'NO_DEV_SERVER',
      message: "The page wasn't served by the dev server",
      server: null,
    };
  }
  let server: DevFilesStatusBody;
  try {
    server = await readJson<DevFilesStatusBody>(await request('status', {}, false), 'status');
  } catch (err) {
    return {
      available: false,
      reason: 'UNREACHABLE',
      message: (err as Error).message,
      server: null,
    };
  }
  if (!server.enabled) {
    return {
      available: false,
      reason: 'NOT_ENABLED',
      message: 'The dev file routes are off (AEK_DEV_FILES=false)',
      server,
    };
  }
  if (!server.canWrite) {
    return {
      available: false,
      reason: 'NOT_LOCAL',
      message: 'Writes from the server’s machine only (AEK_DEV_FILES_LAN=true allows the LAN)',
      server,
    };
  }
  if (!getToken()) {
    return {
      available: false,
      reason: 'NO_TOKEN',
      message: 'The page has no dev files token: reload it',
      server,
    };
  }
  return { available: true, server };
};

const stageBlob = async (blob: Blob) => {
  const response = await request('stage', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob,
  });
  return (await readJson<DevFilesStageBody>(response, 'stage')).stageId;
};

const commit = async (body: DevFilesCommitRequest) => {
  const response = await request('commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readJson<DevFilesCommitBody>(response, 'commit');
};

// p355 §2.3
/**
 * `writeDevFiles` (its JSDoc): with "Confirm writes" on, a dry run, its dialog, then the commit
 * against the dry run's hashes.
 * @param opts.skipConfirm no dry run and dialog: the caller showed its own (the save menu's
 * "Save specific data…" dialog)
 */
export const _writeDevFiles = async (
  writes: DevFileWrite[],
  opts: { skipConfirm?: boolean } = {}
): Promise<DevFilesCommitBody> => {
  if (!Array.isArray(writes) || !writes.length) {
    throw new DevFilesError('BAD_REQUEST', 'writeDevFiles needs at least one write');
  }
  const historySize = getDevFilesSaveHistorySize();
  if (!historySize && writes.some((write) => 'saveData' in write && write.saveData)) {
    throw new DevFilesError(
      'SAVE_DATA_DISABLED',
      'Saving into __saveData is off (save history size 0, Debug tools → File server)'
    );
  }
  const body: DevFilesCommitRequest = {
    writes: await Promise.all(
      writes.map(async (write) => {
        const expectedHash =
          write.expectedHash !== undefined ? { expectedHash: write.expectedHash } : {};
        if ('blob' in write) {
          return { path: write.path, ...expectedHash, stageId: await stageBlob(write.blob) };
        }
        const withHistorySize = (saveData: DevFilesSaveData | DevFilesSaveData[]) =>
          Array.isArray(saveData)
            ? saveData.map((item) => ({ ...item, historySize }))
            : { ...saveData, historySize };
        if ('json' in write) {
          // With `saveData`: the entries go into that value (p355 §2.6)
          const saveData = write.saveData ? { saveData: withHistorySize(write.saveData) } : {};
          return { path: write.path, ...expectedHash, json: write.json, ...saveData };
        }
        return { path: write.path, ...expectedHash, saveData: withHistorySize(write.saveData) };
      })
    ),
  };
  if (!opts.skipConfirm && isDevFilesOptionOn('confirmWrites')) {
    const dryRun = await commit({ ...body, dryRun: true });
    // Nothing would change: no question to ask (the commit writes nothing either)
    if (dryRun.results.some((result) => result.status !== 'unchanged')) {
      if (!(await confirmDevFilesWrites(dryRun.results))) {
        throw new DevFilesError('CANCELLED', 'The writes were cancelled: nothing was written');
      }
    }
    // What was confirmed is what's overwritten: a change since is a CONFLICT
    body.writes = body.writes.map((write, i) => ({
      ...write,
      expectedHash: dryRun.results[i].previousHash,
    }));
  }
  const result = await commit(body);
  _rememberWrittenPaths(
    result.results.filter((write) => write.status !== 'unchanged').map((write) => write.path)
  );
  return result;
};

export const _readDevFile = async (path: string): Promise<DevFileRead | null> => {
  let response: Response;
  try {
    response = await request(`read?path=${encodeURIComponent(path)}`);
  } catch (err) {
    if (err instanceof DevFilesError && err.code === 'NOT_FOUND') return null;
    throw err;
  }
  // Without the header (a proxy dropped it) the hash is unknown: a write with zeros fails with
  // CONFLICT and the file's real hash, as after a change on disk, not BAD_REQUEST (p619 F6)
  const sha256 = response.headers.get(DEV_FILES_HASH_HEADER) ?? '0'.repeat(64);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!path.toLowerCase().endsWith('.json')) return { path, sha256, bytes };
  try {
    return { path, sha256, bytes, json: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch (err) {
    throw new DevFilesError('INVALID_JSON', `${path} isn't JSON: ${(err as Error).message}`);
  }
};

const isCanvas = (source: PNGSource): source is HTMLCanvasElement | OffscreenCanvas =>
  (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
  (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas);

/** A canvas through its own encoder (its pixels are premultiplied anyway) */
const encodeCanvasPNG = async (source: HTMLCanvasElement | OffscreenCanvas, flipY: boolean) => {
  let canvas = source;
  if (flipY) {
    canvas = new OffscreenCanvas(source.width, source.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new DevFilesError('BAD_REQUEST', 'encodePNG: no 2D context to flip with');
    ctx.translate(0, source.height);
    ctx.scale(1, -1);
    ctx.drawImage(source, 0, 0);
  }
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: 'image/png' });
  const htmlCanvas = canvas;
  return new Promise<Blob>((resolve, reject) =>
    htmlCanvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new DevFilesError('BAD_REQUEST', 'encodePNG: empty canvas')),
      'image/png'
    )
  );
};

export const _encodePNG = async (source: PNGSource, opts?: EncodePNGOpts) => {
  const flipY = !!opts?.flipY;
  if (isCanvas(source)) return encodeCanvasPNG(source, flipY);
  const { data, width, height } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new DevFilesError('BAD_REQUEST', `encodePNG: bad size ${width}×${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new DevFilesError(
      'BAD_REQUEST',
      `encodePNG: ${data.length} bytes isn't ${width}×${height} RGBA8 (${width * height * 4})`
    );
  }
  return encodeRGBA8PNG(data, width, height, flipY);
};

// The gatherer's event (§2.5)

/** How long the reload after a gather waits for the listeners' promises */
const GATHER_LISTENERS_TIMEOUT_MS = 2000;

const gatherListeners = new Set<(event: DevDataGatheredEvent) => unknown>();

/** Vite's client handles the next message (the `full-reload`) once this settles */
const dispatchGatherEvent = async (event: DevDataGatheredEvent) => {
  try {
    _handleOwnGather(event);
  } catch (err) {
    lerror('The dev files gather toast failed', err);
  }
  const settled = Promise.all(
    [...gatherListeners].map(async (fn) => {
      try {
        await fn(event);
      } catch (err) {
        lerror('A dev data gathered listener failed', err);
      }
    })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, GATHER_LISTENERS_TIMEOUT_MS);
  });
  await Promise.race([settled, timeout]);
  clearTimeout(timer);
};

import.meta.hot?.on(AEK_GATHER_EVENT, dispatchGatherEvent);

export const _onDevDataGathered = (fn: (event: DevDataGatheredEvent) => unknown) => {
  gatherListeners.add(fn);
  return () => {
    gatherListeners.delete(fn);
  };
};
