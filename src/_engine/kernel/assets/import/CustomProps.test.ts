import { describe, expect, test } from 'vitest';
import { parseCustomProps } from './CustomProps';

describe('parseCustomProps', () => {
  test("reads a node's merge group, trimmed", () => {
    expect(parseCustomProps({ merge: 'AUTO' }).merge).toBe('AUTO');
    expect(parseCustomProps({ merge: ' ruins ' }).merge).toBe('ruins');
    expect(parseCustomProps({}).merge).toBeUndefined();
  });

  test("warns about a merge that isn't a non-empty string, and drops it", () => {
    for (const merge of [1, true, '', '  ']) {
      const props = parseCustomProps({ merge });
      expect(props.merge).toBeUndefined();
      expect(props.warnings).toEqual([expect.stringContaining('"merge"')]);
    }
  });
});
