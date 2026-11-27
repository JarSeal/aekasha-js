/**
 * Fonts in the gather (p391 D5, D6): pass 1 registers each `*.font.json` in its own id space; the
 * scene pass writes each font a scene's `fonts` lists into its data (the layout's `__url` from the
 * run); and the characters the scenes' texts write with a font that collects them
 * (`collectFromScenes`) go into the generated charset file the encode reads. The gather never
 * encodes: a font whose atlas lacks a collected character is stale, a warning naming the command
 * (an error in a production build when a shipped scene writes the character).
 */
import fs from 'fs';
import path from 'path';
import { isControlCodePoint } from '../../src/_engine/features/text/FontCharsets';
import { FontAssetSchema, type SceneFontDef } from '../../src/_engine/schemas';
import { getFontAssetKey } from '../assetPipeline/assets';
import { resolveRequestedCharset } from '../assetPipeline/fonts/charset';
import {
  FONT_CHARSETS_FILE,
  createFontSource,
  type FontSource,
  type ResolvedFont,
} from '../assetPipeline/fonts/fontSource';
import { getFontGeneratedFields } from '../assetPipeline/generated';
import { writeFileIfChanged } from '../files';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import type { EngineSceneAsset } from './engineSchemas';
import { getIdFromFileName } from './gatheredJson';
import { applySceneSaveEntry } from './saveEntries';
import type { SceneRun } from './sceneAssets';

/** A font pass 1 registered */
export type RegisteredFont = {
  id: string;
  name?: string;
  /** The font JSON, absolute */
  jsonFile: string;
  /** From the repo root: the development data's `__sourcePath` */
  sourcePath: string;
  font: ResolvedFont;
};

/** The generated charset file's name in the gather's output folder ({@link FONT_CHARSETS_FILE}) */
export const FONT_CHARSETS_FILENAME = path.basename(FONT_CHARSETS_FILE);

/** Pass 1: every `*.font.json` registered by its id (the JSON's, else its file name) */
export const readFonts = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'font', FontAssetSchema, (data, { file, fullPath, sourcePath }) => {
    const id = data.id || getIdFromFileName(file, 'font');
    if (!claimIds(ctx, taken.fonts, 'font', file, id)) return;
    // Its font file and charset files: the pipeline leaves a font without them out
    const source = createFontSource(fullPath, data);
    if ('error' in source) {
      ctx.log.error(`The font ${file}: ${source.error}`);
      return;
    }
    reg.fonts[id] = { id, name: data.name, jsonFile: fullPath, sourcePath, font: source.font };
  });

/** A font as scenes' data holds it: the development data also names it and its file */
export const toSceneFont = (ctx: GatherContext, font: RegisteredFont): SceneFontDef => ({
  id: font.id,
  type: font.font.type,
  ...(ctx.isProduction
    ? {}
    : { ...(font.name ? { name: font.name } : {}), __sourcePath: font.sourcePath }),
  ...getFontGeneratedFields(ctx.pipeline, font.jsonFile),
});

/**
 * The scene pass: each font the scene's `fonts` lists, once, in place of its id (a production
 * build checks it has an output). An id no font has fails the gather.
 */
export const resolveFonts = ({ ctx, reg, ship, sceneId, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.fonts)) return;
  const defs: SceneFontDef[] = [];
  for (const fontId of new Set(scene.fonts)) {
    const font = reg.fonts[fontId];
    if (!font) {
      reportUnknownId('font', fontId);
      continue;
    }
    ship.checkFont(font.jsonFile, sceneId);
    defs.push(toSceneFont(ctx, font));
  }
  // TODO p392: append the fonts the scene's texts name (D6, like the texture closure)
  // The generated data's shape: the definitions in place of the ids
  scene.fonts = defs as unknown as string[];
};

/** A text a scene writes with a font */
export type FontText = { font: string; text: string };

/**
 * The texts a scene's data writes with fonts, for the collection (D5). None yet: the scene has no
 * texts before the `text()` feature's.
 */
// TODO p392: the scene's `texts` (each entry's `font` and `text`); p397: its text decals'
export const listSceneFontTexts: (scene: EngineSceneAsset) => FontText[] = () => [];

/** The characters collected for a font: each code point with the scenes writing it */
export type CollectedFontChars = Map<number, Set<string>>;

/**
 * The characters every scene's texts write with each font that collects them, by font id (each a
 * code point → its scenes, ascending): the debug scenes' too, so a production gather writes the
 * same file. A collecting font no text names has none. A text naming a font that doesn't collect,
 * or no font, adds nothing.
 * @param listTexts A scene's texts ({@link listSceneFontTexts}; a test's own)
 */
export const collectFontChars = (
  reg: Registries,
  listTexts: (scene: EngineSceneAsset) => FontText[] = listSceneFontTexts
): Map<string, CollectedFontChars> => {
  const collected = new Map<string, CollectedFontChars>();
  for (const font of Object.values(reg.fonts)) {
    if (font.font.charset.collectFromScenes) collected.set(font.id, new Map());
  }
  if (!collected.size) return collected;
  for (const { id: sceneId, data } of reg.scenes) {
    for (const { font, text } of listTexts(applySceneSaveEntry(data, sceneId))) {
      const chars = collected.get(font);
      if (!chars) continue;
      for (const character of text) {
        const codePoint = character.codePointAt(0) as number;
        if (isControlCodePoint(codePoint)) continue;
        let scenes = chars.get(codePoint);
        if (!scenes) chars.set(codePoint, (scenes = new Set()));
        scenes.add(sceneId);
      }
    }
  }
  for (const [id, chars] of collected) {
    collected.set(id, new Map([...chars].sort(([a], [b]) => a - b)));
  }
  return collected;
};

/**
 * Writes the generated charset file the encode reads (`{ "<fontId>": "<characters>" }`, by id),
 * or removes it when no font collects. Its changes reload no page (nothing the app loads).
 */
export const writeFontCharsets = (outDir: string, collected: Map<string, CollectedFontChars>) => {
  const file = path.join(outDir, FONT_CHARSETS_FILENAME);
  if (!collected.size) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  const json = Object.fromEntries(
    [...collected]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, chars]) => [id, String.fromCodePoint(...chars.keys())])
  );
  fs.mkdirSync(outDir, { recursive: true });
  writeFileIfChanged(file, `${JSON.stringify(json, null, 2)}\n`);
};

/** How many characters a staleness message names */
const NAMED_MAX = 20;

const formatChars = (codePoints: readonly number[]) => {
  const named = codePoints
    .slice(0, NAMED_MAX)
    .map(
      (cp) => `"${String.fromCodePoint(cp)}" U+${cp.toString(16).toUpperCase().padStart(4, '0')}`
    )
    .join(', ');
  return codePoints.length > NAMED_MAX
    ? `${named} and ${codePoints.length - NAMED_MAX} more`
    : named;
};

/**
 * Reports each collecting font whose encoded atlas lacks a collected character (D5): the run's
 * output was encoded with an older collection. A warning, but in a production build an error for
 * the characters a shipped scene writes. Nothing without a run, or for a font the run has no
 * output for (the ship checks report that).
 */
export const reportStaleFonts = (
  ctx: GatherContext,
  reg: Registries,
  collected: Map<string, CollectedFontChars>
) => {
  if (!ctx.pipeline) return;
  const debugScenes = new Set(
    reg.scenes.filter(({ data }) => data.isDebugScene).map(({ id }) => id)
  );
  for (const [id, chars] of collected) {
    const result = ctx.pipeline.results.get(getFontAssetKey(reg.fonts[id].jsonFile));
    if (result?.status !== 'optimized') continue;
    const source = result.asset.source as FontSource;
    const encoded = new Set(
      resolveRequestedCharset(source, { collected: source.collected }).codePoints
    );
    const stale = [...chars.keys()].filter((codePoint) => !encoded.has(codePoint));
    if (!stale.length) continue;
    // The scenes writing them, in the walk's order
    const writing = new Set(stale.flatMap((codePoint) => [...(chars.get(codePoint) ?? [])]));
    const scenes = reg.scenes
      .map(({ id: sceneId }) => sceneId)
      .filter((sceneId) => writing.has(sceneId));
    const shipped = scenes.filter((sceneId) => !debugScenes.has(sceneId));
    const message = `The font "${id}" is stale: its atlas lacks ${stale.length} character(s) the scenes' texts write (${formatChars(stale)}; ${scenes.join(', ')}). Encode it: yarn assets --only ${id}`;
    if (ctx.isProduction && shipped.length) ctx.log.error(message);
    else
      ctx.log.warn(
        `${message}${ctx.isProduction ? '' : ' (until then they draw its fallback glyph)'}`
      );
  }
};
