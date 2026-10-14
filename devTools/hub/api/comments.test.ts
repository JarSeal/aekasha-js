import { describe, expect, it } from 'vitest';
import { type CommentParts, partsToMarkdown } from './comments';

const link = (text: string, tag = '@link'): NonNullable<CommentParts>[number] => ({
  kind: 'inline-tag',
  tag: tag as '@link',
  text,
});

describe('partsToMarkdown', () => {
  it('shows a link as its name in code, linked when it resolves', () => {
    const parts: CommentParts = [{ kind: 'text', text: 'See ' }, link('loadScene')];
    expect(partsToMarkdown(parts)).toBe('See `loadScene`');
    expect(partsToMarkdown(parts, () => '../SceneLoader/#loadScene')).toBe(
      'See [`loadScene`](<../SceneLoader/#loadScene>)'
    );
  });

  it("shows a declaration reference's name alone", () => {
    expect(partsToMarkdown([link('_engine/kernel/init/InitEngine!InitEngine')])).toBe(
      '`InitEngine`'
    );
    expect(partsToMarkdown([link('_engine/kernel/ecs/ECS!ECSWorld.addSystem')])).toBe(
      '`ECSWorld.addSystem`'
    );
    expect(partsToMarkdown([link('_engine/kernel/init/InitEngine!InitEngine', '@linkplain')])).toBe(
      'InitEngine'
    );
  });

  it("keeps a link's own text", () => {
    expect(partsToMarkdown([link('_engine/kernel/init/InitEngine!InitEngine | the boot')])).toBe(
      'the boot'
    );
  });
});
