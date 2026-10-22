import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatDevFileJson } from './format';
import { checkImageBytes } from './imageCheck';
import { resolveDevFilePath } from './paths';

// p619 §1.4 F3: a dev files write of `src/app/x/package.json` with a "prettier" key naming a
// staged file made the next JSON commit into that folder load it with `require()` (code run in
// the dev server). Reproduced here in a temp folder, never under `src/`.

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p619-prettier-'));
const MARKER = path.join(TMP, 'ran.txt');

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('F3: a folder’s own config is never loaded', () => {
  it('formats with the repo root’s Prettier config, not the target folder’s', async () => {
    // The repro: a "PNG" holding JavaScript, and a package.json naming it as Prettier's config
    fs.writeFileSync(
      path.join(TMP, 'evil.png'),
      `require('fs').writeFileSync(${JSON.stringify(MARKER)}, 'ran'); module.exports = { tabWidth: 8 };`
    );
    fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ prettier: './evil.png' }));
    const formatted = await formatDevFileJson({ a: { b: 1 } }, path.join(TMP, 'x.json'));
    expect(fs.existsSync(MARKER)).toBe(false);
    // The root's tabWidth (2), not the payload's 8
    expect(formatted).toBe('{\n  "a": {\n    "b": 1\n  }\n}\n');
  });
});

describe('F3: config file names are refused in every root', () => {
  it.each([
    'src/app/x/package.json',
    'src/toolkit/package.json',
    'src/public/x/PACKAGE.JSON',
    'src/app/tsconfig.json',
    'src/app/x/tsconfig.app.json',
    'src/app/jsconfig.json',
  ])('%s', async (repoPath) => {
    await expect(resolveDevFilePath(repoPath)).rejects.toMatchObject({ code: 'FORBIDDEN_PATH' });
  });

  it('takes a name that only ends like one (my.package.json)', async () => {
    await expect(resolveDevFilePath('src/app/x/my.package.json')).resolves.toMatchObject({
      isJson: true,
    });
  });
});

describe('F3: a staged image must start like its format', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
  const WEBP = [...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WEBPVP8 ')];
  const SCRIPT = [...Buffer.from("require('fs')")];

  it.each([
    ['x.png', PNG],
    ['x.jpg', JPEG],
    ['x.JPEG', JPEG],
    ['x.webp', WEBP],
    ['x.json', SCRIPT],
  ])('takes %s', (name, bytes) => {
    expect(() => checkImageBytes(`src/app/${name}`, Uint8Array.from(bytes))).not.toThrow();
  });

  it.each([
    ['x.png', SCRIPT],
    ['x.png', JPEG],
    ['x.jpg', PNG],
    ['x.webp', [...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WAVE')]],
    ['x.png', []],
  ])('refuses %s holding something else', (name, bytes) => {
    expect(() => checkImageBytes(`src/app/${name}`, Uint8Array.from(bytes))).toThrow(
      expect.objectContaining({ code: 'INVALID_IMAGE' })
    );
  });
});
