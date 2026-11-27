// Fonts at runtime (p391 D6): a font is the asset pipeline's two outputs, a layout JSON (the
// gathered data's `__url`) and its distance field atlas (a KTX2 beside it, D3: `__atlasUrl`, which
// the layout names too). The load downloads both at once, parses the layout into typed arrays
// (`FontData`) and registers the atlas as an ordinary texture
// (`font:<id>`), so the atlas is owned and released like any other: a scene's release frees it
// once no material samples it, and its `dispose` drops the font. The `text()` feature's install
// adds the scene hooks that load a scene's `fonts` with its assets; `getFont` and `loadFontAsync`
// work without it.
import * as THREE from 'three/webgpu';
import { lerror, lwarn } from '../../utils/Logger';
import type { FeatureContext } from '../../kernel/init/Features';
import {
  getAssetOwnerScope,
  retagAssetOwner,
  runInAssetOwnerScope,
} from '../../kernel/assets/AssetOwners';
import { toAppUrl } from '../../kernel/assets/AssetUrl';
import { getTextureRegistry, loadTextureAsync } from '../../kernel/assets/Texture';
import { getGeneratedAppData, type SceneData } from '../../kernel/scene/Scene';
import type { FontType, SceneFontDef } from './FontSchema';
import { FONT_LAYOUT_FORMAT, type FontLayout } from './FontLayoutFormat';

/** A font's vertical metrics in em (the em is 1), y up from the baseline. */
export type FontMetrics = {
  /** The ascender's height (positive). */
  ascender: number;
  /** The descender's depth (negative). */
  descender: number;
  /** The baseline-to-baseline distance of a line. */
  lineHeight: number;
  /** The underline's centre (negative: below the baseline). */
  underlineY: number;
  /** The underline's thickness. */
  underlineThickness: number;
};

/**
 * A loaded font: its layout in typed arrays by glyph index (the glyphs in code point order) and
 * its distance field atlas. A glyph's index is {@link getFontGlyphIndex}'s, a pair's kerning
 * `kerning.get(getFontKerningKey(first, second)) ?? 0`. Read it, never write it: every reader
 * shares it.
 */
export type FontData = {
  /** The font's id (its `*.font.json`). */
  id: string;
  /** The atlas type: `MTSDF` (the median in RGB, the true distance in A), `MSDF` (the median in
   * RGB, A 1) or `SDF` (the true distance alone, a one-channel atlas). */
  type: FontType;
  /** The atlas: a registered texture (`font:<id>`), linear, filtered, without mips; `v = 0` is
   * its top row. */
  atlas: THREE.Texture;
  /** The atlas's width in pixels. */
  atlasWidth: number;
  /** The atlas's height in pixels. */
  atlasHeight: number;
  /** The em's size in atlas pixels. */
  size: number;
  /** The distance range in atlas pixels, its full width. */
  pxRange: number;
  /** The vertical metrics in em. */
  metrics: FontMetrics;
  /** How many glyphs the atlas holds (with the ones without ink: space). */
  glyphCount: number;
  /** Each glyph's code point, ascending. */
  codePoints: Uint32Array;
  /** Each glyph's advance in em. */
  advances: Float32Array;
  /** Four per glyph, the quad's `left, bottom, width, height` in em from the pen's position on
   * the baseline (y up; its distance range included); zeros for a glyph without ink. */
  planeRects: Float32Array;
  /** Four per glyph, its tile's `u, v, width, height` in the atlas's UV, `v` from the top; zeros
   * for a glyph without ink. */
  atlasRects: Float32Array;
  /** Glyph index by code point. */
  glyphIndices: ReadonlyMap<number, number>;
  /** The fallback glyph's index: what a code point the font lacks draws. */
  fallbackIndex: number;
  /** Kerning in em by {@link getFontKerningKey} of a pair; a pair without kerning isn't there. */
  kerning: ReadonlyMap<number, number>;
};

/** The loaded fonts by id; one leaves when its atlas is disposed */
const fonts = new Map<string, FontData>();
/** The loads running, by id: a second call shares one */
const loading = new Map<string, Promise<FontData>>();

/** Past the last code point (0x10FFFF): a pair's key as one number with no collision */
const CODE_POINT_SPAN = 0x110000;

/**
 * The key of a pair of code points in a font's `kerning` map. Not `first << 16 | second`: a code
 * point past the Basic Multilingual Plane needs 21 bits.
 * @param first the left character's code point
 * @param second the right character's code point
 * @returns the key: a whole number below 2^41
 * @example
 * ```ts
 * import { getFont, getFontKerningKey } from 'aekasha/text';
 *
 * const font = getFont('plexSans');
 * const av = font?.kerning.get(getFontKerningKey(0x41, 0x56)) ?? 0; // "AV", in em
 * ```
 */
export const getFontKerningKey = (first: number, second: number) =>
  first * CODE_POINT_SPAN + second;

/**
 * A code point's glyph index in a font, or its fallback glyph's when the atlas lacks it.
 * @param font the loaded font
 * @param codePoint the character's code point (`codePointAt`, not `charCodeAt`)
 * @returns the index into the font's arrays
 * @example
 * ```ts
 * import { getFont, getFontGlyphIndex } from 'aekasha/text';
 *
 * const font = getFont('plexSans');
 * if (font) {
 *   const index = getFontGlyphIndex(font, 'Æ'.codePointAt(0)!);
 *   console.log(`Æ advances ${font.advances[index]} em.`);
 * }
 * ```
 */
export const getFontGlyphIndex = (font: FontData, codePoint: number) =>
  font.glyphIndices.get(codePoint) ?? font.fallbackIndex;

/**
 * The atlas texture's registry id.
 * @internal
 */
export const getFontAtlasId = (id: string) => `font:${id}`;

/** Throws for a layout of another format than this engine reads */
const checkFontLayoutFormat = (id: string, layout: FontLayout) => {
  if (layout.format === FONT_LAYOUT_FORMAT) return;
  throw new Error(
    `the font "${id}"'s layout is format ${String(layout.format)}, and this engine reads ${FONT_LAYOUT_FORMAT}: run "yarn assets --only ${id}"`
  );
};

/**
 * Parses a font's layout JSON into a {@link FontData} around its loaded atlas: the glyphs in code
 * point order, the plane bounds as rects, the atlas pixels as UV, the kerning from font units to
 * em. Throws naming the font for a layout of another format, a glyph entry of another length or a
 * fallback glyph the layout lacks.
 * @internal
 */
export const parseFontLayout = (id: string, layout: FontLayout, atlas: THREE.Texture): FontData => {
  checkFontLayoutFormat(id, layout);
  const { width, height } = layout.atlas;
  const codePoints = Uint32Array.from(Object.keys(layout.glyphs), Number).sort();
  const glyphCount = codePoints.length;
  const advances = new Float32Array(glyphCount);
  const planeRects = new Float32Array(glyphCount * 4);
  const atlasRects = new Float32Array(glyphCount * 4);
  const glyphIndices = new Map<number, number>();
  for (let i = 0; i < glyphCount; i++) {
    const entry = layout.glyphs[codePoints[i]];
    glyphIndices.set(codePoints[i], i);
    advances[i] = entry[0];
    if (entry.length === 1) continue;
    if (entry.length !== 9) {
      throw new Error(
        `the font "${id}"'s layout has a glyph of ${(entry as number[]).length} values (U+${codePoints[i].toString(16).toUpperCase().padStart(4, '0')}), not 1 or 9`
      );
    }
    const [, left, bottom, right, top, x, y, w, h] = entry;
    planeRects.set([left, bottom, right - left, top - bottom], i * 4);
    atlasRects.set([x / width, y / height, w / width, h / height], i * 4);
  }
  const fallbackIndex = glyphIndices.get(layout.fallback);
  if (fallbackIndex === undefined) {
    throw new Error(`the font "${id}"'s layout lacks its fallback glyph (U+${layout.fallback})`);
  }
  const kerning = new Map<number, number>();
  if (layout.kerning && layout.kerningUnitsPerEm) {
    const scale = 1 / layout.kerningUnitsPerEm;
    for (const [first, pairs] of Object.entries(layout.kerning)) {
      const firstCode = Number(first);
      for (let p = 0; p + 1 < pairs.length; p += 2) {
        kerning.set(getFontKerningKey(firstCode, pairs[p]), pairs[p + 1] * scale);
      }
    }
  }
  return {
    id,
    type: layout.type,
    atlas,
    atlasWidth: width,
    atlasHeight: height,
    size: layout.atlas.size,
    pxRange: layout.atlas.pxRange,
    metrics: { ...layout.metrics },
    glyphCount,
    codePoints,
    advances,
    planeRects,
    atlasRects,
    glyphIndices,
    fallbackIndex,
    kerning,
  };
};

/**
 * The loaded font with the id: a scene's `fonts`, loaded with it, or one {@link loadFontAsync}
 * loaded. A font leaves with its atlas: released with its scene once no material samples it, or
 * deleted.
 * @param id the font's id (its `*.font.json`)
 * @returns the font, or undefined when it isn't loaded
 * @example
 * ```ts
 * import { getFont } from 'aekasha/text';
 *
 * const font = getFont('plexSans');
 * if (font) console.log(`${font.glyphCount} glyphs, a line ${font.metrics.lineHeight} em.`);
 * ```
 */
export const getFont = (id: string) => fonts.get(id);

/** A font's gathered entry: the development data's section first, else the first scene's */
const findFontDeclaration = (id: string): SceneFontDef | undefined => {
  const json = getGeneratedAppData();
  const section = json.fonts as Record<string, SceneFontDef> | undefined;
  if (section?.[id]) return section[id];
  for (const scene of Object.values(json.scenes) as SceneData[]) {
    const found = scene.fonts?.find((font) => font.id === id);
    if (found) return found;
  }
  return undefined;
};

/** The atlas's sampler state: the field is read between texels, and has no mips (D3) */
const ATLAS_TEX_OPTS = {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  generateMipmaps: false,
  colorSpace: THREE.NoColorSpace,
} as const;

/** The layout JSON, checked for its format */
const fetchFontLayoutAsync = async (id: string, url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`its layout: HTTP ${response.status}`);
  const layout = (await response.json()) as FontLayout;
  checkFontLayoutFormat(id, layout);
  return layout;
};

/** The layout and the atlas, both started at the call (the atlas registers in the caller's owner
 * scope), then the parse; rejects naming the font and both files */
const loadFontFilesAsync = async (
  def: SceneFontDef & { __url: string; __atlasUrl: string },
  isPersistent: boolean
): Promise<FontData> => {
  const { id } = def;
  const layoutUrl = toAppUrl(def.__url);
  try {
    const [layout, atlas] = await Promise.all([
      fetchFontLayoutAsync(id, layoutUrl),
      loadTextureAsync({
        id: getFontAtlasId(id),
        __url: def.__atlasUrl,
        texOpts: ATLAS_TEX_OPTS,
        throwOnError: true,
        isPersistent,
        debugData: { name: `${def.name ?? id} atlas`, description: `The font "${id}"'s atlas` },
      }),
    ]);
    // Generated data older than the outputs names another encode's atlas
    if (!def.__atlasUrl.endsWith(`/${layout.atlas.file}`)) {
      throw new Error(
        `its layout names the atlas "${layout.atlas.file}", and its data another: run "yarn gatherAppData"`
      );
    }
    const image = atlas.image as { width?: number; height?: number } | null;
    if (image?.width !== layout.atlas.width || image.height !== layout.atlas.height) {
      throw new Error(
        `its atlas is ${image?.width}×${image?.height} and its layout says ${layout.atlas.width}×${layout.atlas.height}: run "yarn assets --only ${id}"`
      );
    }
    const font = parseFontLayout(id, layout, atlas);
    fonts.set(id, font);
    atlas.addEventListener('dispose', () => {
      if (fonts.get(id) === font) fonts.delete(id);
    });
    return font;
  } catch (err) {
    throw new Error(
      `loadFontAsync: the font "${id}" didn't load (layout "${layoutUrl}", atlas "${def.__atlasUrl}"): ${(err as Error).message}`
    );
  }
};

/** A font registered persistent only by its first load: warns when a later load asks for it */
const warnNotPersistent = (font: FontData, isPersistent: boolean) => {
  if (!isPersistent || getTextureRegistry()[getFontAtlasId(font.id)]?.persistent) return;
  lwarn(
    `loadFontAsync: the font "${font.id}" was loaded without isPersistent first (a scene's fonts, or another call), so it stays its scene's: load it persistent before any scene does.`
  );
};

/** loadFontAsync from a gathered entry */
const loadFontFromDefAsync = async (def: SceneFontDef, isPersistent: boolean) => {
  // Before the first await: a shared load re-tags the atlas to the caller's owner scope, and a
  // new one starts the atlas's load synchronously, in that scope (AssetOwners)
  const ownerScope = getAssetOwnerScope();
  const loaded = fonts.get(def.id);
  if (loaded) {
    retagAssetOwner(loaded.atlas);
    warnNotPersistent(loaded, isPersistent);
    return loaded;
  }
  const running = loading.get(def.id);
  if (running) {
    const font = await running;
    runInAssetOwnerScope(ownerScope, () => retagAssetOwner(font.atlas));
    warnNotPersistent(font, isPersistent);
    return font;
  }
  const { __url, __atlasUrl } = def;
  if (!__url || !__atlasUrl) {
    throw new Error(
      `loadFontAsync: the font "${def.id}" has no asset pipeline output (not encoded yet, or its encode failed; see the dev server's log, or run "yarn assets --only ${def.id}").`
    );
  }
  const load = loadFontFilesAsync({ ...def, __url, __atlasUrl }, isPersistent).finally(() => {
    if (loading.get(def.id) === load) loading.delete(def.id);
  });
  loading.set(def.id, load);
  return load;
};

/**
 * Loads a font: its layout and its atlas, the atlas registered in the caller's owner scope (the
 * loading or current scene's, released with it once no material samples it, unless
 * `isPersistent`). A scene's `fonts` load with the scene: this is for code that draws with a font
 * no scene lists. A loaded font resolves at once (re-tagged to the caller's scene, as a cached
 * texture is), and a call while one loads shares that load.
 *
 * Re-check the scene after the await before using the font: a scene switch meanwhile releases what
 * the left scene loaded.
 * @param id the font's id (its `*.font.json`)
 * @param opts `isPersistent`: never released by a scene (only deleting its atlas, `font:<id>`,
 * removes it). Only the font's first load sets it: a later one asking for it is warned.
 * @returns the loaded font
 * @throws (rejects) for a font no data has (in a production build, a font no scene lists), one
 * without an asset pipeline output, or a layout or atlas that doesn't load
 * @example
 * ```ts
 * import { loadFontAsync } from 'aekasha/text';
 *
 * const mono = await loadFontAsync('plexMono', { isPersistent: true });
 * ```
 */
export const loadFontAsync = (id: string, opts: { isPersistent?: boolean } = {}) => {
  const def = findFontDeclaration(id);
  if (!def) {
    return Promise.reject(
      new Error(
        `loadFontAsync: no data has the font "${id}" (in a production build, a scene must list it in its fonts).`
      )
    );
  }
  return loadFontFromDefAsync(def, opts.isPersistent === true);
};

/**
 * Loads a scene's `fonts` from its own entries; a font that fails is logged naming the scene, and
 * the load goes on (its texts can't be created).
 * @internal
 */
export const loadSceneFontsAsync = (sceneData: SceneData) => {
  if (!sceneData.fonts?.length) return undefined;
  return Promise.all(
    sceneData.fonts.map((def) =>
      loadFontFromDefAsync(def, false).catch((err: unknown) => {
        lerror(`[Text] The scene "${sceneData.id}"'s font: ${(err as Error).message}`);
      })
    )
  ).then(() => {});
};

/**
 * The fonts' install: the scene hooks that load a scene's `fonts` with its assets: started when
 * the world is cleared (the next scene's data, which owns what registers from then on), beside
 * its textures, and awaited once they've loaded, before its scene code runs.
 * @internal
 */
export const installFonts = (ctx: FeatureContext) => {
  let pending: Promise<void> | undefined;
  ctx.addSceneHooks({
    worldCleared: (_world, _prevSceneId, nextSceneData) => {
      pending = loadSceneFontsAsync(nextSceneData);
    },
    assetsLoaded: () => {
      const started = pending;
      pending = undefined;
      return started;
    },
  });
};
