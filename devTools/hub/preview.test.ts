import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveHubRoute } from './serve';
import { ROOT } from './paths';

// docs/plans/p619_review-schemas-pipeline-devtools-hub.md Phase 0 (§1.4 H2): `yarn hub:preview`
// against a temp build. An `it.fails` is a bug not fixed yet: Phase 2 turns it into an `it`.

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p619-preview-'));
fs.writeFileSync(path.join(DIR, 'index.html'), '<p>home</p>');
fs.writeFileSync(path.join(DIR, '404.html'), '<p>not found</p>');

const getFreePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer().listen(0, 'localhost', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

let preview: ChildProcess;
let port: number;
let output = '';

beforeAll(async () => {
  port = await getFreePort();
  preview = spawn(
    path.join(ROOT, 'node_modules/.bin/tsx'),
    ['devTools/hubPreview.ts', '--dir', DIR, '--port', String(port)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  preview.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  preview.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no start: ${output}`)), 20_000);
    preview.stdout?.on('data', () => {
      if (output.includes(`localhost:${port}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}, 30_000);

afterAll(() => {
  preview?.kill();
  fs.rmSync(DIR, { recursive: true, force: true });
});

const get = async (urlPath: string) => (await fetch(`http://localhost:${port}${urlPath}`)).status;

describe('resolveHubRoute', () => {
  it('serves the index and 404s a missing file', () => {
    expect(resolveHubRoute(DIR, '/', '/')).toEqual({
      kind: 'file',
      file: path.join(DIR, 'index.html'),
    });
    expect(resolveHubRoute(DIR, '/', '/nope.html')).toEqual({ kind: 'notFound' });
  });

  it.fails('404s a path with a NUL byte instead of throwing', () => {
    expect(resolveHubRoute(DIR, '/', '/a\0b')).toEqual({ kind: 'notFound' });
  });
});

describe('yarn hub:preview', () => {
  it('serves the build (the check itself)', async () => {
    expect(await get('/')).toBe(200);
    expect(await get('/nope.html')).toBe(404);
  });

  // Run in this order: the first malformed request kills the server today
  it.fails('answers a malformed escape with 400 and keeps serving', async () => {
    const status = await get('/%E0%A4%A').catch(() => 0);
    expect(status).toBe(400);
    expect(await get('/')).toBe(200);
  });

  it.fails('answers %00 and keeps serving', async () => {
    const status = await get('/%00').catch(() => 0);
    expect([400, 404]).toContain(status);
    expect(await get('/')).toBe(200);
  });
});
