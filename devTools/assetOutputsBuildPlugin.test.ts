import { describe, expect, it } from 'vitest';
import { collectUrls } from './assetOutputsBuildPlugin';

describe('collectUrls', () => {
  it('collects every output a build ships: each __url, and a font’s atlas beside its layout', () => {
    const urls = new Set<string>();
    collectUrls(
      {
        scenes: {
          a: {
            textures: [{ id: 'rock', __url: '/aek-assets/rock.ktx2', __sourceUrl: '/rock.png' }],
            fonts: [
              {
                id: 'sans',
                __url: '/aek-assets/sans.layout.1.json',
                __atlasUrl: '/aek-assets/sans.atlas.2.ktx2',
              },
            ],
          },
        },
        fonts: { sans: { __url: '/aek-assets/sans.layout.1.json', __atlasUrl: 7 } },
      },
      urls
    );
    expect([...urls].sort()).toEqual([
      '/aek-assets/rock.ktx2',
      '/aek-assets/sans.atlas.2.ktx2',
      '/aek-assets/sans.layout.1.json',
    ]);
  });
});
