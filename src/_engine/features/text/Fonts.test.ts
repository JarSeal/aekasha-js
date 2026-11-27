import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { setAppData } from '../../kernel/scene/AppData';
import { createRootScene, type SceneData } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import type { FeatureContext } from '../../kernel/init/Features';
import { getAssetOwners, setAssetOwnerScene } from '../../kernel/assets/AssetOwners';
import { deleteTexture, getTexture } from '../../kernel/assets/Texture';
import { releaseSceneOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import type { SceneFontDef } from './FontSchema';
import { FONT_LAYOUT_FORMAT, type FontLayout } from './FontLayoutFormat';
import {
  getFont,
  getFontGlyphIndex,
  getFontKerningKey,
  installFonts,
  loadFontAsync,
  parseFontLayout,
} from './Fonts';
import { text } from './TextFeature';

// The kernel's texture registry, owners and release are the real ones; the KTX2 file's load, the
// layout's fetch and the logs are stand-ins
const fns = vi.hoisted(() => ({
  lerror: vi.fn(),
  lwarn: vi.fn(),
  /** The atlas sizes by URL; a URL without one fails like a 404 */
  atlases: new Map<string, [number, number]>(),
  /** The layouts by URL; a URL without one is a 404 */
  layouts: new Map<string, unknown>(),
  loadKTX2: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror: fns.lerror,
  lwarn: fns.lwarn,
}));
vi.mock(import('../../kernel/assets/import/KTX2'), async (importOriginal) => ({
  ...(await importOriginal()),
  loadKTX2Texture: fns.loadKTX2,
}));

const BASE = 'http://localhost/';

/** A layout of four glyphs in a 128 × 64 atlas: space, `?` (the fallback), `A` and `V` */
const createLayout = (overrides: Partial<FontLayout> = {}): FontLayout => ({
  format: FONT_LAYOUT_FORMAT,
  type: 'MTSDF',
  atlas: { file: 'sans.atlas.1.ktx2', width: 128, height: 64, size: 48, pxRange: 8 },
  metrics: {
    ascender: 1.025,
    descender: -0.275,
    lineHeight: 1.3,
    underlineY: -0.116,
    underlineThickness: 0.05,
  },
  fallback: 0x3f,
  // Out of order on purpose: the parse sorts the code points
  glyphs: {
    86: [0.65, -0.05, -0.1, 0.7, 0.8, 64, 0, 32, 48],
    32: [0.25],
    63: [0.5, -0.05, -0.1, 0.55, 0.75, 0, 0, 30, 40],
    65: [0.6, -0.06, -0.09, 0.66, 0.87, 32, 16, 32, 48],
  },
  kerningUnitsPerEm: 1000,
  kerning: { 65: [86, -50], 86: [65, -40] },
  ...overrides,
});

/** The gathered entry of a font whose outputs are the given layout and an atlas of its size */
const serveFont = (id: string, layout = createLayout(), atlasSize?: [number, number]) => {
  const def: SceneFontDef = {
    id,
    type: layout.type,
    __url: `/aek-assets/fonts/${id}.layout.1.json`,
    __atlasUrl: `/aek-assets/fonts/${layout.atlas.file}`,
  };
  fns.layouts.set(`${BASE}aek-assets/fonts/${id}.layout.1.json`, layout);
  fns.atlases.set(
    `${BASE}aek-assets/fonts/${layout.atlas.file}`,
    atlasSize ?? [layout.atlas.width, layout.atlas.height]
  );
  return def;
};

/** The app's data: the development data's `fonts` section and the scenes */
const setFontsData = (fonts: SceneFontDef[], scenes: Record<string, unknown> = {}) => {
  setAppData({
    json: { scenes, fonts: Object.fromEntries(fonts.map((font) => [font.id, font])) },
    sceneFiles: {},
    tslMaterialFiles: {},
    postFxFiles: {},
  });
};

beforeAll(() => {
  createRootScene();
  vi.stubGlobal('document', { baseURI: BASE });
  vi.stubGlobal('fetch', fns.fetch);
});

beforeEach(() => {
  fns.lerror.mockClear();
  fns.lwarn.mockClear();
  fns.loadKTX2.mockReset();
  fns.loadKTX2.mockImplementation(async (url: string) => {
    const size = fns.atlases.get(url);
    if (!size) throw new Error(`404: ${url}`);
    // As KTX2Loader leaves an uncompressed RGBA8 file (p391 D3): nearest filtering, one level
    const texture = new THREE.DataTexture(new Uint8Array(size[0] * size[1] * 4), ...size);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
  });
  fns.fetch.mockReset();
  fns.fetch.mockImplementation(async (url: string) => {
    const layout = fns.layouts.get(url);
    return layout
      ? { ok: true, status: 200, json: async () => structuredClone(layout) }
      : { ok: false, status: 404, json: async () => ({}) };
  });
  setAssetOwnerScene(null);
});

describe('parseFontLayout', () => {
  const atlas = new THREE.Texture();

  test('lays the glyphs out in code point order, in typed arrays', () => {
    const font = parseFontLayout('sans', createLayout(), atlas);
    expect(font).toMatchObject({
      id: 'sans',
      type: 'MTSDF',
      atlas,
      atlasWidth: 128,
      atlasHeight: 64,
      size: 48,
      pxRange: 8,
      glyphCount: 4,
      metrics: { ascender: 1.025, descender: -0.275, lineHeight: 1.3 },
    });
    expect(font.codePoints).toBeInstanceOf(Uint32Array);
    expect([...font.codePoints]).toEqual([32, 63, 65, 86]);
    expect([...font.glyphIndices]).toEqual([
      [32, 0],
      [63, 1],
      [65, 2],
      [86, 3],
    ]);
    expect(font.advances).toBeInstanceOf(Float32Array);
    expect([...font.advances]).toEqual([0.25, 0.5, 0.6, 0.65].map(Math.fround));
  });

  test('gives each glyph its plane rect in em and its atlas rect in UV from the top; space none', () => {
    const font = parseFontLayout('sans', createLayout(), atlas);
    const rect = (array: Float32Array, index: number) => [...array.slice(index * 4, index * 4 + 4)];
    // Space: no ink
    expect(rect(font.planeRects, 0)).toEqual([0, 0, 0, 0]);
    expect(rect(font.atlasRects, 0)).toEqual([0, 0, 0, 0]);
    // A: left, bottom, width, height in em; u, v, width, height of the 128 × 64 atlas
    expect(rect(font.planeRects, 2)).toEqual([-0.06, -0.09, 0.72, 0.96].map(Math.fround));
    expect(rect(font.atlasRects, 2)).toEqual([0.25, 0.25, 0.25, 0.75].map(Math.fround));
  });

  test('keeps its own copy of the metrics', () => {
    const layout = createLayout();
    const font = parseFontLayout('sans', layout, atlas);
    layout.metrics.lineHeight = 9;
    expect(font.metrics.lineHeight).toBe(1.3);
  });

  test('scales the kerning from font units to em, keyed by the pair', () => {
    const font = parseFontLayout('sans', createLayout(), atlas);
    expect(font.kerning.size).toBe(2);
    expect(font.kerning.get(getFontKerningKey(65, 86))).toBeCloseTo(-0.05);
    expect(font.kerning.get(getFontKerningKey(86, 65))).toBeCloseTo(-0.04);
    expect(font.kerning.get(getFontKerningKey(65, 65))).toBeUndefined();
  });

  test('has no kerning when the layout has none', () => {
    const layout = createLayout();
    delete layout.kerning;
    delete layout.kerningUnitsPerEm;
    expect(parseFontLayout('sans', layout, atlas).kerning.size).toBe(0);
  });

  test('draws a code point the font lacks with its fallback glyph', () => {
    const font = parseFontLayout('sans', createLayout(), atlas);
    expect(font.fallbackIndex).toBe(1);
    expect(getFontGlyphIndex(font, 65)).toBe(2);
    expect(getFontGlyphIndex(font, 0x4e00)).toBe(1);
    expect(getFontGlyphIndex(font, 0x1f600)).toBe(1);
  });

  test('refuses a layout of another format, a glyph of another length and a missing fallback', () => {
    expect(() => parseFontLayout('sans', createLayout({ format: 2 }), atlas)).toThrow(
      /"sans"'s layout is format 2, and this engine reads 1: run "yarn assets --only sans"/
    );
    const short = createLayout();
    short.glyphs[66] = [0.5, 1, 2] as unknown as [number];
    expect(() => parseFontLayout('sans', short, atlas)).toThrow(/3 values \(U\+0042\)/);
    expect(() => parseFontLayout('sans', createLayout({ fallback: 0x25a1 }), atlas)).toThrow(
      /lacks its fallback glyph/
    );
  });
});

describe('getFontKerningKey', () => {
  test('keys every pair apart, past the Basic Multilingual Plane too', () => {
    // `first << 16 | second` would give these two one key
    expect(getFontKerningKey(0x1f600, 0x41)).not.toBe(getFontKerningKey(0xf600, 0x10041));
    expect(getFontKerningKey(0x10ffff, 0x10ffff)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(getFontKerningKey(65, 86)).not.toBe(getFontKerningKey(86, 65));
  });
});

describe('loadFontAsync', () => {
  test('loads the layout and the atlas at once, and registers the atlas filtered, without mips', async () => {
    setFontsData([serveFont('loadSans')]);
    const loading = loadFontAsync('loadSans');
    // Both downloads started before either finished
    expect(fns.fetch).toHaveBeenCalledWith(`${BASE}aek-assets/fonts/loadSans.layout.1.json`);
    expect(fns.loadKTX2).toHaveBeenCalledWith(`${BASE}aek-assets/fonts/sans.atlas.1.ktx2`);
    const font = await loading;

    expect(font.glyphCount).toBe(4);
    expect(getFont('loadSans')).toBe(font);
    expect(getTexture('font:loadSans')).toBe(font.atlas);
    expect(font.atlas).toMatchObject({
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      colorSpace: THREE.NoColorSpace,
    });
    // A loaded font resolves without loading
    expect(await loadFontAsync('loadSans')).toBe(font);
    expect(fns.fetch).toHaveBeenCalledTimes(1);
  });

  test('shares a running load', async () => {
    setFontsData([serveFont('sharedSans')]);
    const [first, second] = await Promise.all([
      loadFontAsync('sharedSans'),
      loadFontAsync('sharedSans'),
    ]);
    expect(second).toBe(first);
    expect(fns.fetch).toHaveBeenCalledTimes(1);
    expect(fns.loadKTX2).toHaveBeenCalledTimes(1);
  });

  test("finds a font in a scene's entry when the data has no fonts section (production)", async () => {
    const def = serveFont('sceneSans');
    setAppData({
      json: { scenes: { a: { id: 'a', fonts: [def] } } },
      sceneFiles: {},
      tslMaterialFiles: {},
      postFxFiles: {},
    });
    expect((await loadFontAsync('sceneSans')).id).toBe('sceneSans');
  });

  test('rejects a font no data has, and one without an output', async () => {
    setFontsData([{ id: 'unencoded', type: 'MTSDF' }]);
    await expect(loadFontAsync('nope')).rejects.toThrow(
      'loadFontAsync: no data has the font "nope" (in a production build, a scene must list it in its fonts).'
    );
    await expect(loadFontAsync('unencoded')).rejects.toThrow(
      /"unencoded" has no asset pipeline output .*yarn assets --only unencoded/
    );
    expect(fns.fetch).not.toHaveBeenCalled();
  });

  test('rejects naming both files when the layout or the atlas fails, and loads again after', async () => {
    const def = serveFont('brokenSans');
    setFontsData([def]);
    fns.layouts.delete(`${BASE}aek-assets/fonts/brokenSans.layout.1.json`);
    await expect(loadFontAsync('brokenSans')).rejects.toThrow(
      `loadFontAsync: the font "brokenSans" didn't load (layout "${BASE}aek-assets/fonts/brokenSans.layout.1.json", atlas "/aek-assets/fonts/sans.atlas.1.ktx2"): its layout: HTTP 404`
    );
    expect(getFont('brokenSans')).toBeUndefined();

    serveFont('brokenSans');
    expect((await loadFontAsync('brokenSans')).id).toBe('brokenSans');
  });

  test('rejects an atlas of another size than its layout, or another encode’s', async () => {
    setFontsData([serveFont('sizeSans', createLayout(), [64, 64])]);
    await expect(loadFontAsync('sizeSans')).rejects.toThrow(
      /its atlas is 64×64 and its layout says 128×64: run "yarn assets --only sizeSans"/
    );
    deleteTexture('font:sizeSans');

    const def = serveFont('staleSans');
    setFontsData([{ ...def, __atlasUrl: '/aek-assets/fonts/sans.atlas.0.ktx2' }]);
    fns.atlases.set(`${BASE}aek-assets/fonts/sans.atlas.0.ktx2`, [128, 64]);
    await expect(loadFontAsync('staleSans')).rejects.toThrow(
      /its layout names the atlas "sans.atlas.1.ktx2", and its data another: run "yarn gatherAppData"/
    );
  });

  test('warns when a font a scene loaded is asked for as persistent', async () => {
    setFontsData([serveFont('latePersistent')]);
    await loadFontAsync('latePersistent');
    await loadFontAsync('latePersistent', { isPersistent: true });
    expect(fns.lwarn).toHaveBeenCalledWith(
      expect.stringContaining('"latePersistent" was loaded without isPersistent first')
    );
  });
});

describe('a font and its scene', () => {
  test('is owned by the scene that loaded it, released with it, and gone with its atlas', async () => {
    setFontsData([serveFont('ownedSans')]);
    setAssetOwnerScene('fontSceneA');
    const font = await loadFontAsync('ownedSans');
    expect(getAssetOwners(font.atlas)).toEqual(['fontSceneA']);

    // The next scene loads it too: a cache hit, re-tagged, so the first scene's release keeps it
    setAssetOwnerScene('fontSceneB');
    expect(await loadFontAsync('ownedSans')).toBe(font);
    expect(releaseSceneOwnedAssets('fontSceneA').textures).toEqual([]);
    expect(getFont('ownedSans')).toBe(font);

    expect(releaseSceneOwnedAssets('fontSceneB').textures).toEqual(['font:ownedSans']);
    expect(getFont('ownedSans')).toBeUndefined();
    expect(getTexture('font:ownedSans')).toBeUndefined();
  });

  test('stays when loaded persistent', async () => {
    setFontsData([serveFont('persistentSans')]);
    setAssetOwnerScene('fontSceneC');
    const font = await loadFontAsync('persistentSans', { isPersistent: true });
    expect(releaseSceneOwnedAssets('fontSceneC').textures).toEqual([]);
    expect(getFont('persistentSans')).toBe(font);
    expect(fns.lwarn).not.toHaveBeenCalled();
  });

  test('outside an owner scope, belongs to the scene current when its atlas registers, as a texture', async () => {
    setFontsData([serveFont('switchSans')]);
    setAssetOwnerScene('fontSceneD');
    const loading = loadFontAsync('switchSans');
    setAssetOwnerScene('fontSceneE');
    // The atlas's load captured the scope at the call: the owner is the scene at registration,
    // as for any texture without a scope (AssetOwners)
    const font = await loading;
    expect(getAssetOwners(font.atlas)).toEqual(['fontSceneE']);
  });
});

describe('the scene hooks', () => {
  const install = () => {
    let hooks: SceneHooks = {};
    installFonts({
      addSceneHooks: (added: SceneHooks) => {
        hooks = added;
        return () => {};
      },
    } as unknown as FeatureContext);
    return hooks;
  };

  test("load a scene's fonts from its own entries, started at the world's clear and awaited after its assets", async () => {
    const hooks = install();
    const def = serveFont('hookSans');
    // No fonts section: the scene's entries are what loads
    setAppData({ json: { scenes: {} }, sceneFiles: {}, tslMaterialFiles: {}, postFxFiles: {} });
    const sceneData = { id: 'hookScene', fonts: [def] } as unknown as SceneData;

    hooks.worldCleared?.({} as never, undefined, sceneData);
    expect(fns.fetch).toHaveBeenCalledTimes(1);
    expect(getFont('hookSans')).toBeUndefined();
    await hooks.assetsLoaded?.(sceneData);
    expect(getFont('hookSans')?.id).toBe('hookSans');
    // Awaited once
    expect(hooks.assetsLoaded?.(sceneData)).toBeUndefined();
  });

  test('log a font that fails, naming the scene, and let the load go on', async () => {
    const hooks = install();
    const ok = serveFont('hookOk');
    const sceneData = {
      id: 'hookFailScene',
      fonts: [{ id: 'hookMissing', type: 'MTSDF' }, ok],
    } as unknown as SceneData;
    hooks.worldCleared?.({} as never, undefined, sceneData);
    await expect(hooks.assetsLoaded?.(sceneData)).resolves.toBeUndefined();
    expect(fns.lerror).toHaveBeenCalledWith(
      expect.stringMatching(/The scene "hookFailScene"'s font: .*"hookMissing" has no asset/)
    );
    expect(getFont('hookOk')).toBeDefined();
  });

  test('do nothing for a scene without fonts', () => {
    const hooks = install();
    const sceneData = { id: 'noFonts' } as unknown as SceneData;
    hooks.worldCleared?.({} as never, undefined, sceneData);
    expect(hooks.assetsLoaded?.(sceneData)).toBeUndefined();
    expect(fns.fetch).not.toHaveBeenCalled();
  });
});

describe('text()', () => {
  test('is the feature `text`; its install adds the fonts’ and the texts’ scene hooks', () => {
    const feature = text();
    expect(feature.id).toBe('text');
    const addSceneHooks = vi.fn(() => () => {});
    const registerComponentHooks = vi.fn();
    void feature.install({ addSceneHooks, registerComponentHooks } as unknown as FeatureContext);
    expect(addSceneHooks).toHaveBeenCalledWith({
      worldCleared: expect.any(Function),
      assetsLoaded: expect.any(Function),
    });
    expect(addSceneHooks).toHaveBeenCalledWith({ exit: expect.any(Function) });
    expect(registerComponentHooks).toHaveBeenCalledWith('CORE_TEXT', {
      onDeleteEntity: expect.any(Function),
      onRemoveComponent: expect.any(Function),
    });
  });
});
