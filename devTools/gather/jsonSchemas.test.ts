import { describe, expect, test } from 'vitest';
import z from 'zod';
import { TextureAssetSchema } from '../../src/_engine/schemas';
import { toJsonSchema } from './jsonSchemas';

// The texture's texOpts (its schema isn't on the schemas entry)
const TexOptsSchema = TextureAssetSchema.shape.texOpts.unwrap();

type JsonNode = { $ref?: string; [key: string]: unknown };

/** A node with its `$ref` followed, and a described ref's (`allOf` of one) */
const resolve = (schema: JsonNode, node: JsonNode): JsonNode => {
  const definitions = (schema.definitions ?? {}) as Record<string, JsonNode>;
  if (node.$ref) return resolve(schema, definitions[node.$ref.split('/').pop()!]);
  const allOf = node.allOf as JsonNode[] | undefined;
  return allOf?.length === 1 ? { ...resolve(schema, allOf[0]), ...node, allOf: undefined } : node;
};

/** A property's schema, resolved */
const getProperty = (schema: JsonNode, key: string) =>
  resolve(schema, (schema.properties as Record<string, JsonNode>)[key]);

describe('toJsonSchema', () => {
  test("writes a transform's pipe as its input, its description kept", () => {
    const wrapS = getProperty(toJsonSchema(TexOptsSchema) as JsonNode, 'wrapS');
    expect(wrapS.anyOf).toEqual([
      { type: 'string', enum: ['REPEAT', 'CLAMP_TO_EDGE', 'MIRRORED_REPEAT'] },
      { type: 'number', enum: [1000, 1001, 1002] },
    ]);
    expect(wrapS.description).toMatch(/^Horizontal wrapping/);
  });

  test('keeps an object closed and sizes a tuple', () => {
    const schema = toJsonSchema(TexOptsSchema) as JsonNode;
    expect(schema.additionalProperties).toBe(false);
    expect(getProperty(schema, 'repeat')).toMatchObject({
      minItems: 2,
      maxItems: 2,
      additionalItems: false,
    });
  });

  test('fails on any other type JSON Schema cannot hold', () => {
    expect(() => toJsonSchema(z.object({ at: z.date() }))).toThrow(/date/);
  });
});
