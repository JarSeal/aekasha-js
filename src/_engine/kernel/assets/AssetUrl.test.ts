import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppBaseUrl, resolveFileUrl, setAssetBaseUrl, toAppUrl } from './AssetUrl';
import { configureDraco, getDracoWorkerSettings } from './import/DracoDecoder';

// A page at a sub path, as a host page or the template app served from one
vi.hoisted(() => {
  vi.stubGlobal('document', { baseURI: 'https://site.test/shop/page.html' });
});

/** The URL formula before p611's assetBaseUrl, which the default must keep */
const oldToAppUrl = (url: string, base: string) =>
  new URL(`${base}${url.replace(/^\/+/, '')}`, document.baseURI).href;

afterEach(() => {
  setAssetBaseUrl(null);
  configureDraco({ decoderPath: '' });
  vi.unstubAllEnvs();
});

describe('the default: the page', () => {
  it.each(['/', './', '/sub/'])("toAppUrl matches the old formula with the base '%s'", (base) => {
    vi.stubEnv('BASE_URL', base);
    for (const url of ['/aek-assets/app/a.ktx2', 'aek-assets/b.glb']) {
      expect(toAppUrl(url)).toBe(oldToAppUrl(url, base));
    }
  });

  it('resolves file names against the document', () => {
    expect(resolveFileUrl('textures/a.png')).toBe('https://site.test/shop/textures/a.png');
    expect(resolveFileUrl('/textures/a.png')).toBe('https://site.test/textures/a.png');
  });

  it("puts the decoders under the app's base", () => {
    vi.stubEnv('BASE_URL', '/');
    expect(getDracoWorkerSettings().decoderPath).toBe('https://site.test/draco/gltf/');
  });
});

describe('assetBaseUrl (a mounted engine)', () => {
  it("replaces the app's base, a missing trailing slash added", () => {
    setAssetBaseUrl('https://cdn.test/embed/banner');
    expect(getAppBaseUrl()).toBe('https://cdn.test/embed/banner/');
    expect(toAppUrl('/aek-assets/app/a.ktx2')).toBe(
      'https://cdn.test/embed/banner/aek-assets/app/a.ktx2'
    );
    expect(resolveFileUrl('textures/a.png')).toBe('https://cdn.test/embed/banner/textures/a.png');
    expect(getDracoWorkerSettings().decoderPath).toBe('https://cdn.test/embed/banner/draco/gltf/');
  });

  it('resolves a relative one against the document', () => {
    setAssetBaseUrl('embed/');
    expect(getAppBaseUrl()).toBe('https://site.test/shop/embed/');
  });

  it('resolves a configured Draco path like a file name, and leaves absolute and data URLs as they are', () => {
    setAssetBaseUrl('https://cdn.test/embed/');
    configureDraco({ decoderPath: 'decoders/' });
    expect(getDracoWorkerSettings().decoderPath).toBe('https://cdn.test/embed/decoders/');
    expect(resolveFileUrl('https://other.test/a.png')).toBe('https://other.test/a.png');
    expect(resolveFileUrl('data:image/png;base64,AA==')).toBe('data:image/png;base64,AA==');
  });

  it('null goes back to the page', () => {
    setAssetBaseUrl('https://cdn.test/embed/');
    setAssetBaseUrl(null);
    vi.stubEnv('BASE_URL', '/');
    expect(getAppBaseUrl()).toBe('https://site.test/');
  });
});
