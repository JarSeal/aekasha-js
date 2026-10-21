import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getLogicalPath } from './outputs';
import { resolveAssetSource } from './sources';
import { PUBLIC_DIR } from '../paths';

const JSON_FILE = 'src/app/textures/rock.texture.json';

describe('resolveAssetSource', () => {
  it('resolves a public file name under src/public', () => {
    const source = resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/textures/rock.png' });
    expect(source).toMatchObject({
      kind: 'public',
      file: path.join(PUBLIC_DIR, 'textures/rock.png'),
    });
  });

  // p619 §1.4 A4: `new URL()` normalises `..` before `decodeURIComponent` decodes `%2F`, so an
  // encoded "../" would reach the output's logical path, which writeOutput joins to aek-assets/
  it('refuses an encoded "../" that leaves src/public', () => {
    const source = resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/..%2F..%2Fx.png' });
    expect(source).toEqual({ error: expect.stringContaining('resolves outside src/public') });
  });

  it('keeps an encoded "../" that stays inside src/public', () => {
    const source = resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/a/..%2Fx.png' });
    if ('error' in source || source.kind !== 'public') throw new Error('not a public source');
    expect(source.file).toBe(path.join(PUBLIC_DIR, 'x.png'));
    expect(getLogicalPath(source)).toBe('x');
  });

  it('returns an error for a stray "%", not a URIError', () => {
    const source = resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/100%.png' });
    expect(source).toEqual({ error: expect.stringContaining("isn't a valid URL path") });
  });
});
