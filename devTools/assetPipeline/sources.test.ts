import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getLogicalPath } from './outputs';
import { PUBLIC_DIR, resolveAssetSource } from './sources';

const JSON_FILE = 'src/app/textures/rock.texture.json';

describe('resolveAssetSource', () => {
  it('resolves a public file name under src/public', () => {
    const source = resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/textures/rock.png' });
    expect(source).toMatchObject({
      kind: 'public',
      file: path.join(PUBLIC_DIR, 'textures/rock.png'),
    });
  });

  // p619 Phase 0 (§1.4 A4): `new URL()` normalises `..` before `decodeURIComponent` decodes `%2F`
  it.fails('keeps an encoded "../" inside src/public', () => {
    const source = resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/..%2F..%2Fx.png' });
    if ('error' in source) return;
    expect(source.kind).toBe('public');
    if (source.kind !== 'public') return;
    expect(source.file.startsWith(PUBLIC_DIR + path.sep)).toBe(true);
    // The output's logical path: writeOutput joins it to aek-assets/
    expect(getLogicalPath(source)).not.toMatch(/(^|\/)\.\.(\/|$)/);
  });

  it.fails('returns an error for a stray "%", not a URIError', () => {
    expect(() => resolveAssetSource({ jsonFile: JSON_FILE, fileName: '/100%.png' })).not.toThrow();
  });
});
