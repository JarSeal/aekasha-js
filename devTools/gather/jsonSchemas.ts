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
  MergeMaterialAssetSchema,
  PostFxAssetSchema,
  SkyBoxAssetSchema,
  TextureArrayAssetSchema,
  TextureAssetSchema,
  TextureAtlasAssetSchema,
} from '../../src/_engine/schemas';
import { ROOT } from '../paths';
import { EngineMeshAssetSchema, EngineSceneAssetSchema } from './engineSchemas';

type JsonSchemaOverride = NonNullable<Parameters<typeof z.toJSONSchema>[1]>['override'];

/** zod's types a JSON Schema can't hold. A transform is allowed: its pipe is written as its
 * input (`writeTransformAsInput`); any other fails the write, as zod's default does. */
const UNREPRESENTABLE = new Set([
  'bigint',
  'symbol',
  'undefined',
  'void',
  'date',
  'map',
  'set',
  'nan',
  'custom',
  'function',
]);

/**
 * A zod schema as the JSON Schema `writeJsonSchemas` writes: draft-07, a sub-schema used twice
 * written once under `definitions`, tuples sized, and a transform's pipe as its input.
 * @throws on a type JSON Schema can't hold (a date, a map, …)
 */
export const toJsonSchema = (schema: z.core.$ZodType) =>
  z.toJSONSchema(schema, {
    target: 'draft-07',
    override: overrideJsonSchema,
    // A transform's `{}` is replaced by its pipe's input; the rest throw in overrideJsonSchema
    unrepresentable: 'any',
    reused: 'ref',
  });

/** zod writes a draft-07 tuple as its `items` alone, which any length passes: the length is
 * added (`additionalItems: false` unless it has a rest). */
const sizeTuple: JsonSchemaOverride = (ctx) => {
  const def = ctx.zodSchema._zod.def;
  if (def.type !== 'tuple') return;
  ctx.jsonSchema.minItems = def.items.filter((item) => item._zod.optin !== 'optional').length;
  if (def.rest) return;
  ctx.jsonSchema.maxItems = def.items.length;
  ctx.jsonSchema.additionalItems = false;
};

/** A transform's output (a texture constant's name parsed to its number, p302 D1) is no JSON:
 * the JSON is the pipe's input, so the editor takes what the file may hold. Its description and
 * default stay. */
const writeTransformAsInput: JsonSchemaOverride = (ctx) => {
  const def = ctx.zodSchema._zod.def;
  if (def.type !== 'pipe' || def.out._zod.def.type !== 'transform') return;
  const { description, default: defaultValue } = ctx.jsonSchema;
  const input = toJsonSchema(def.in);
  delete input.$schema;
  for (const key of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[key];
  Object.assign(ctx.jsonSchema, input);
  if (description !== undefined) ctx.jsonSchema.description = description;
  if (defaultValue !== undefined) ctx.jsonSchema.default = defaultValue;
};

const overrideJsonSchema: JsonSchemaOverride = (ctx) => {
  const type = ctx.zodSchema._zod.def.type;
  if (UNREPRESENTABLE.has(type)) {
    throw new Error(`A ${type} can't be represented in JSON Schema (writeJsonSchemas)`);
  }
  sizeTuple(ctx);
  writeTransformAsInput(ctx);
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
    { name: 'mergeMaterial.schema.json', schema: MergeMaterialAssetSchema },
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
    const nativeSchema = toJsonSchema(target.schema);
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
