/**
 * The asset JSONs' JSON Schemas in `.schemas/`, compiled from the zod schemas: what an editor
 * validates and completes an asset JSON with (its `$schema`).
 */
import fs from 'fs';
import path from 'path';
import z from 'zod';
import {
  AssetsConfigSchema,
  CameraAssetSchema,
  GeoAssetSchema,
  ImportedAssetSchema,
  ImpostorAssetSchema,
  LightAssetSchema,
  MaterialAssetSchema,
  PostFxAssetSchema,
  SkyBoxAssetSchema,
  TextureArrayAssetSchema,
  TextureAssetSchema,
  TextureAtlasAssetSchema,
} from '../../src/_engine/schemas';
import { ROOT } from '../paths';
import { EngineMeshAssetSchema, EngineSceneAssetSchema } from './engineSchemas';

/** zod writes a draft-07 tuple as its `items` alone, which any length passes: the length is
 * added (`additionalItems: false` unless it has a rest). */
const sizeTuple: NonNullable<Parameters<typeof z.toJSONSchema>[1]>['override'] = (ctx) => {
  const def = ctx.zodSchema._zod.def;
  if (def.type !== 'tuple') return;
  ctx.jsonSchema.minItems = def.items.filter((item) => item._zod.optin !== 'optional').length;
  if (def.rest) return;
  ctx.jsonSchema.maxItems = def.items.length;
  ctx.jsonSchema.additionalItems = false;
};

/**
 * Writes the asset JSONs' JSON Schemas into `.schemas/` (the editors' autocompletion and
 * validation), each only when its content changed. Called by the commands that gather (`yarn
 * gatherAppData`, `yarn assets`) and by the dev server's gatherer plugin on each (re)start, never
 * at module load (p619 §1.4 G3: every import rewrote the 14 tracked files).
 * @returns the files written, by name
 */
export const writeJsonSchemas = () => {
  const schemasDir = path.join(ROOT, '.schemas');
  fs.mkdirSync(schemasDir, { recursive: true });

  const targets = [
    { name: 'scene.schema.json', schema: EngineSceneAssetSchema },
    { name: 'camera.schema.json', schema: CameraAssetSchema },
    { name: 'light.schema.json', schema: LightAssetSchema },
    { name: 'geometry.schema.json', schema: GeoAssetSchema },
    { name: 'texture.schema.json', schema: TextureAssetSchema },
    { name: 'textureArray.schema.json', schema: TextureArrayAssetSchema },
    { name: 'textureAtlas.schema.json', schema: TextureAtlasAssetSchema },
    { name: 'material.schema.json', schema: MaterialAssetSchema },
    { name: 'mesh.schema.json', schema: EngineMeshAssetSchema },
    { name: 'importedAsset.schema.json', schema: ImportedAssetSchema },
    { name: 'skyBox.schema.json', schema: SkyBoxAssetSchema },
    { name: 'postFx.schema.json', schema: PostFxAssetSchema },
    { name: 'impostor.schema.json', schema: ImpostorAssetSchema },
    { name: 'assetsConfig.schema.json', schema: AssetsConfigSchema },
  ];

  const written: string[] = [];
  for (const target of targets) {
    // `reused: 'ref'`: a sub-schema used twice is written once, under `definitions` (the scene's
    // inline assets repeat whole asset schemas: 653 KB inline, 137 KB with refs)
    const nativeSchema = z.toJSONSchema(target.schema, {
      target: 'draft-07',
      override: sizeTuple,
      reused: 'ref',
    });
    const finalSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...nativeSchema,
    };
    const file = path.resolve(schemasDir, target.name);
    const content = JSON.stringify(finalSchema, null, 2);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === content) continue;
    fs.writeFileSync(file, content, 'utf-8');
    written.push(target.name);
  }
  if (written.length) {
    // eslint-disable-next-line no-console -- the command's own log
    console.log(
      `\x1b[32m✓ [Schema Compiler] Wrote the JSON Schemas of ${written.join(', ')} in .schemas/\x1b[0m`
    );
  }
  return written;
};
