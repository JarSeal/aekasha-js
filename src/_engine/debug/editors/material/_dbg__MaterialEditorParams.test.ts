import { beforeAll, describe, expect, test, vi } from 'vitest';
import type * as THREE from 'three/webgpu';

// localStorage before anything reads it (the storage helpers check it once), its items its own
// properties: the helpers find a key with hasOwnProperty
vi.hoisted(() => {
  const storage: Record<string, string> = {};
  Object.defineProperties(storage, {
    getItem: {
      value: (key: string) =>
        Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null,
    },
    setItem: { value: (key: string, value: string) => (storage[key] = String(value)) },
    removeItem: { value: (key: string) => delete storage[key] },
  });
  vi.stubGlobal('localStorage', storage);
});

import { createRootScene } from '../../../kernel/scene/Scene';
import { createMaterial } from '../../../kernel/assets/Material';
import { registerTslMaterial } from '../../../kernel/assets/MaterialTsl';
import type { MaterialAsset } from '../../../schemas/MaterialSchema';
import { getCopyProps } from './_dbg__MaterialEditorAssets';
import {
  fromNodeInputGroups,
  getAssetNodeInputs,
  getNodeInputKind,
  getNodeInputPaneItems,
  readNodeInputs,
  setNodeInputValue,
  SETUP_INPUTS,
} from './_dbg__MaterialEditorParams';
import {
  readMaterialOverrides,
  readMaterialRecord,
  setMaterialOverride,
} from './_dbg__MaterialEditorStore';

// A setup material (p302 D2) with a socket of its own too
const asset = {
  id: 'paramsTestSetup',
  type: 'STANDARDNODEMATERIAL',
  tslFile: 'paramsTestSetup.tsl.ts',
  inputs: { tint: '#ff8000', scale: 2 },
  nodes: { roughnessNode: { roughness: 0.5 } },
} as MaterialAsset;

beforeAll(() => {
  createRootScene();
  registerTslMaterial('paramsTestSetup', {
    setup: (inputs: { tint: THREE.Node<'color'>; scale: THREE.Node<'float'> }, material) => {
      material.colorNode = inputs.tint.mul(inputs.scale);
    },
    roughnessNode: (inputs: { roughness: THREE.Node<'float'> }) => inputs.roughness,
  });
});

describe("the Params tab's setup inputs", () => {
  test("lists the material's inputs as the setup group, before its sockets", () => {
    const groups = getAssetNodeInputs(asset);
    expect(Object.keys(groups ?? {})).toEqual([SETUP_INPUTS, 'roughnessNode']);
    expect(groups?.[SETUP_INPUTS]).toEqual({ tint: '#ff8000', scale: 2 });
    expect(fromNodeInputGroups(groups ?? {})).toEqual({
      inputs: { tint: '#ff8000', scale: 2 },
      nodes: { roughnessNode: { roughness: 0.5 } },
    });
  });

  test("merges the overrides into the copy's inputs and nodes, only for inputs the asset has", () => {
    const props = getCopyProps(asset, {
      inputs: { scale: 3, unknown: 1 },
      nodes: { roughnessNode: { roughness: 0.25 } },
    }) as { inputs?: unknown; nodes?: unknown };
    expect(props.inputs).toEqual({ tint: '#ff8000', scale: 3 });
    expect(props.nodes).toEqual({ roughnessNode: { roughness: 0.25 } });
  });

  test("reads and sets the copy's setup inputs through their setup_<key> uniforms", () => {
    const copy = createMaterial({
      ...getCopyProps(asset, { inputs: { scale: 3 } }),
      id: '__paramsTestCopy',
      tslMaterialId: 'paramsTestSetup',
    });
    const groups = getAssetNodeInputs(asset);
    expect(readNodeInputs(copy, groups)).toEqual({
      [SETUP_INPUTS]: { tint: '#ff8000', scale: 3 },
      roughnessNode: { roughness: 0.5 },
    });

    expect(setNodeInputValue(copy, groups, SETUP_INPUTS, 'scale', 5)).toBe(5);
    expect((copy.userData.uniforms.setup_scale as { value: number }).value).toBe(5);

    const [folder] = getNodeInputPaneItems(
      copy,
      groups,
      undefined,
      () => ({}),
      () => {}
    );
    const titles = (folder as { content: { title?: string }[] }).content.map((item) => item.title);
    expect(titles).toEqual(['setup (inputs)', 'roughnessNode']);
  });

  test('keeps an override of the setup group as the record’s inputs', () => {
    setMaterialOverride('paramsTestSetup', 'nodes', `${SETUP_INPUTS}.scale`, 4);
    expect(readMaterialRecord('paramsTestSetup').overrides).toEqual({ inputs: { scale: 4 } });
    expect(readMaterialOverrides('paramsTestSetup').inputs).toEqual({ scale: 4 });

    setMaterialOverride('paramsTestSetup', 'nodes', `${SETUP_INPUTS}.scale`, undefined);
    expect(readMaterialRecord('paramsTestSetup').overrides).toBeUndefined();
  });
});

describe('the object-form inputs (p302 D4, p299 D5)', () => {
  test('are read-only (OTHER): a texture ref, an array layer, an atlas cell', () => {
    expect(getNodeInputKind('ref', { texture: 'albedo', channel: 'r' })).toBe('OTHER');
    expect(getNodeInputKind('layer', { textureArray: 'ground', layer: 'rock' })).toBe('OTHER');
    expect(getNodeInputKind('index', { textureArray: 'ground', layer: 1 })).toBe('OTHER');
    expect(getNodeInputKind('cell', { atlas: 'decals', slot: 'albedo', cell: 'crack' })).toBe(
      'OTHER'
    );
  });
});
