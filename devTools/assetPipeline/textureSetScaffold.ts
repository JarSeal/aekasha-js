import fs from 'fs';
import path from 'path';
import {
  TEXTURE_SET_PACKINGS,
  type TextureSetPacking,
  type TextureSetSlot,
} from '../../src/_engine/schemas';
import { formatDevFileJson } from '../devFiles/format';
import { listSourceFiles, writeFileAtomic } from '../files';
import type { TextureSource } from './textureSources';

/**
 * The texture set scaffold (p303 D3, `yarn fetchTextureSources --scaffold`): writes the texture
 * JSONs a set's `packings` name and no file has yet, each a pack recipe of D2's channel layout
 * reading the set's fetched maps (`./source/raw/<map>.<ext>`, `textureSources.ts`), so the
 * recipes are the same across sets but for what the set's JSON and `source.json` give: the maps
 * there are, the format and `surface.aoStrength`. Never overwrites a JSON: a written recipe is
 * the set's own to tune.
 */

/** What a recipe needs from the set's JSON */
export type ScaffoldSet = {
  id: string;
  packings: Partial<Record<TextureSetPacking, Partial<Record<TextureSetSlot, string>>>>;
  surface?: { aoStrength?: number };
};

type PackChannel = number | Record<string, unknown>;

/** A slot's texture JSON (without `$schema`), by D2's table */
export const createSlotTextureJson = (
  set: ScaffoldSet,
  source: TextureSource,
  packing: TextureSetPacking,
  slot: TextureSetSlot,
  textureId: string
) => {
  const ext = source.download.endsWith('-PNG') ? 'png' : 'jpg';
  const raw = (map: string) => `./source/raw/${map}.${ext}`;
  const hasAo = !!source.maps.ao;
  const aoStrength = set.surface?.aoStrength ?? 1;
  // AO into the albedo (LITE, MINIMAL), its strength applied at pack time (D2)
  const albedo = (isAoBaked: boolean): PackChannel =>
    isAoBaked && hasAo
      ? { src: raw('color'), multiply: { src: raw('ao'), channel: 'r', strength: aoStrength } }
      : { src: raw('color') };
  // Remapped to the full 0..1 (D2); `heightScale` is the real relief. Flat without a map.
  const height: PackChannel = source.maps.height
    ? { src: raw('height'), channel: 'r', remap: 'auto' }
    : 0.5;
  const roughness: PackChannel = { src: raw('roughness'), channel: 'r' };

  const recipes: Record<
    string,
    { channels: Record<string, PackChannel>; slot: string; isSrgb: boolean; what: string }
  > = {
    'LITE.albedoRough': {
      channels: { rgb: albedo(true), a: roughness },
      slot: 'baseColor',
      isSrgb: true,
      what: `RGB albedo${hasAo ? ' × AO' : ''} (sRGB), A roughness`,
    },
    'LITE.normalHeight': {
      channels: { rg: { src: raw('normal'), normal: true }, b: height },
      slot: 'data',
      isSrgb: false,
      what: "RG the normal's X and Y (OpenGL; Z reconstructed), B height",
    },
    'FULL.albedoHeight': {
      channels: { rgb: albedo(false), a: height },
      slot: 'baseColor',
      isSrgb: true,
      what: 'RGB albedo (sRGB), A height',
    },
    'FULL.normal': {
      channels: { rgb: { src: raw('normal'), normal: true } },
      slot: 'normal',
      isSrgb: false,
      what: 'RGB the normal (OpenGL)',
    },
    'FULL.orm': {
      // Metalness is 0 for terrain (D2): the channel stays for glTF's layout
      channels: { r: hasAo ? { src: raw('ao'), channel: 'r' } : 1, g: roughness, b: 0 },
      slot: 'orm',
      isSrgb: false,
      what: `R ${hasAo ? 'AO' : 'AO 1 (no map)'}, G roughness, B metalness 0`,
    },
    'MINIMAL.albedoHeight': {
      channels: { rgb: albedo(true), a: height },
      slot: 'baseColor',
      isSrgb: true,
      what: `RGB albedo${hasAo ? ' × AO' : ''} (sRGB), A height`,
    },
  };
  const recipe = recipes[`${packing}.${slot}`];
  if (!recipe) throw new Error(`${packing} has no slot "${slot}"`);
  return {
    id: textureId,
    pack: { channels: recipe.channels },
    optimize: { profile: 'terrainLayer', slot: recipe.slot },
    texOpts: {
      wrapS: 'REPEAT',
      wrapT: 'REPEAT',
      ...(recipe.isSrgb ? { colorSpace: 'srgb' } : {}),
      anisotropy: 'MAX',
    },
    debugData: {
      name: `${set.id} ${slot} (${packing})`,
      description: `The texture set ${set.id}'s ${packing} ${slot}: ${recipe.what}. Packed from ${source.provider} ${source.assetId}'s maps (yarn fetchTextureSources).`,
    },
  };
};

/** What {@link scaffoldTextureSetAsync} did with each slot's texture */
export type ScaffoldResult = { written: string[]; kept: string[] };

/**
 * Writes the set's missing texture JSONs into its folder, `<textureId>.texture.json`. A texture
 * whose id another JSON gives (`existingIds`: the texture ids by file) or whose file is there is
 * kept. Throws when the `source.json` lacks a map every recipe reads (`normal`, `roughness`).
 * @param opts.schemaFile The texture JSON Schema (`.schemas/texture.schema.json`), absolute
 */
export const scaffoldTextureSetAsync = async (
  setDir: string,
  set: ScaffoldSet,
  source: TextureSource,
  opts: { existingIds: Map<string, string>; schemaFile: string }
): Promise<ScaffoldResult> => {
  const lacking = (['normal', 'roughness'] as const).filter((map) => !source.maps[map]);
  if (lacking.length) {
    throw new Error(`the recipes read a ${lacking.join(' and a ')} map: source.json names none`);
  }
  const result: ScaffoldResult = { written: [], kept: [] };
  const schema = path.relative(setDir, opts.schemaFile).split(path.sep).join('/');
  for (const packing of Object.keys(TEXTURE_SET_PACKINGS) as TextureSetPacking[]) {
    const slots = set.packings[packing];
    if (!slots) continue;
    for (const slot of TEXTURE_SET_PACKINGS[packing] as readonly TextureSetSlot[]) {
      const textureId = slots[slot];
      if (!textureId) continue;
      const file = path.join(setDir, `${textureId}.texture.json`);
      if (fs.existsSync(file) || opts.existingIds.has(textureId)) {
        result.kept.push(textureId);
        continue;
      }
      const json = {
        $schema: schema,
        ...createSlotTextureJson(set, source, packing, slot, textureId),
      };
      writeFileAtomic(file, await formatDevFileJson(json, file));
      opts.existingIds.set(textureId, file);
      result.written.push(textureId);
    }
  }
  return result;
};

/** Every `*.texture.json`'s id under `srcDir`, with its file (an unreadable one is left out: the
 * gather reports it) */
export const listTextureIds = (srcDir: string) => {
  const ids = new Map<string, string>();
  for (const file of listSourceFiles(srcDir)) {
    if (!file.endsWith('.texture.json')) continue;
    const full = path.join(srcDir, file);
    try {
      const { id } = JSON.parse(fs.readFileSync(full, 'utf8')) as { id?: unknown };
      if (typeof id === 'string') ids.set(id, full);
    } catch {
      continue;
    }
  }
  return ids;
};
