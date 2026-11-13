import { describe, expect, test } from 'vitest';
import { MaterialAssetSchema, MaterialVariantOverridesSchema } from './MaterialSchema';

/** A TSL material with these `inputs` and a socket of these inputs */
const tslMaterial = (inputs: Record<string, unknown>) => ({
  id: 'm',
  type: 'STANDARDNODEMATERIAL',
  tslFile: 'materials/m.tsl.ts',
  inputs,
  nodes: { colorNode: inputs },
});

/** The issues' paths and messages, or [] when it validates */
const issuesOf = (inputs: Record<string, unknown>) => {
  const result = MaterialAssetSchema.safeParse(tslMaterial(inputs));
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('a TSL input’s object forms (p302 D4, p299 D5)', () => {
  test('validate in inputs and in a socket, beside the other values', () => {
    expect(
      issuesOf({
        bare: 'albedo',
        ref: { texture: 'albedo', channel: 'rg' },
        layer: { textureArray: 'ground', layer: 'rock' },
        index: { textureArray: 'ground', layer: 2 },
        cell: { atlas: 'decals', slot: 'albedo', cell: 'crack', clampToCell: false },
        tint: '#ff8000',
        scale: [1, 2],
        vector: { x: 1, y: 2, z: 3 },
        appForm: { gradient: ['#000000', '#ffffff'] },
        // Not an input: its keys are defines, never checked as a form
        staticDefines: { texture: 1, atlas: true },
      })
    ).toEqual([]);
  });

  test.each([
    [{ texture: 'a', channel: 'x' }, 'x.channel: one to four of r, g, b and a'],
    [{ texture: 'a', scale: 2 }, 'x: Unrecognized key: "scale"'],
    [{ texture: 4 }, 'x.texture: Invalid input: expected string, received number'],
    [{ textureArray: 'a' }, 'x.layer: Invalid input'],
    [{ textureArray: 'a', layer: 1.5 }, 'x.layer: Invalid input'],
    [{ textureArray: 'a', layer: -1 }, 'x.layer: Too small'],
    [{ atlas: 'a', cell: 'c' }, 'x.slot: Invalid input: expected string, received undefined'],
    [{ atlas: 'a', slot: 's', cell: 'c', clampToCell: 'yes' }, 'x.clampToCell: Invalid input'],
  ])('fail on %j at the input’s path, in inputs and in a socket', (value, message) => {
    const issues = issuesOf({ x: value });
    expect(issues.find((issue) => issue.startsWith('inputs.'))).toContain(`inputs.${message}`);
    expect(issues.find((issue) => issue.startsWith('nodes.'))).toContain(
      `nodes.colorNode.${message}`
    );
  });

  test('validate in a mesh’s matOverrides too', () => {
    const result = MaterialVariantOverridesSchema.safeParse({
      inputs: { cell: { atlas: 'decals', slot: 'albedo' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['inputs', 'cell', 'cell']);
  });
});
