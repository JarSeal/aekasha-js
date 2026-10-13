import { describe, expect, it } from 'vitest';
import type { CharacterBrainSpec, CharacterControllerSpec } from './ActorTypes';
import {
  createBrain,
  createCharacterOfKind,
  getBrainKinds,
  registerBrainKind,
  unregisterBrainKind,
} from './ActorKinds';

// The kind maps are filled by declaration merging, so a test's own kinds are cast
const spec = (kind: string, params?: unknown) =>
  ({ kind, params }) as unknown as CharacterBrainSpec;

describe('brain kinds', () => {
  it('makes a brain with its kind factory, the params defaulting to {}', () => {
    const seen: unknown[] = [];
    registerBrainKind(
      'TEST_A' as never,
      ((params: unknown, characterId: string) => {
        seen.push(params, characterId);
        return { kind: 'TEST_A', think: () => {} };
      }) as never
    );
    expect(getBrainKinds()).toContain('TEST_A');
    expect(createBrain(spec('TEST_A'), 'c1').kind).toBe('TEST_A');
    createBrain(spec('TEST_A', { n: 1 }), 'c2');
    expect(seen).toEqual([{}, 'c1', { n: 1 }, 'c2']);
    expect(unregisterBrainKind('TEST_A')).toBe(true);
    expect(unregisterBrainKind('TEST_A')).toBe(false);
  });

  it('throws on an unknown kind, naming the registered ones', () => {
    registerBrainKind('TEST_B' as never, (() => ({ kind: 'TEST_B', think: () => {} })) as never);
    expect(() => createBrain(spec('NOPE'), 'c1')).toThrow(/'NOPE'.*TEST_B/);
    unregisterBrainKind('TEST_B');
  });
});

describe('controller kinds', () => {
  it('throws on an unknown controller kind before resolving the visual', async () => {
    await expect(
      createCharacterOfKind({
        id: 'c1',
        visual: 'missing',
        controller: { kind: 'NOPE' } as unknown as CharacterControllerSpec,
      })
    ).rejects.toThrow(/Unknown controller kind 'NOPE'/);
  });
});
