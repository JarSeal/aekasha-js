import { describe, expect, it } from 'vitest';
import { FONT_BUDGET, getFontBudgetWarnings } from '../budgets';

// p391 Phase 2 section 3: a font's budget (D3) warns past a 2048² atlas or 2000 glyphs

describe('getFontBudgetWarnings', () => {
  it('passes a font at the budget', () => {
    expect(
      getFontBudgetWarnings({
        glyphs: FONT_BUDGET.glyphs,
        atlas: { width: 2048, height: 2048, channels: 4 },
      })
    ).toEqual([]);
  });

  it('warns past the atlas’s pixels and the glyph count, one line each', () => {
    const warnings = getFontBudgetWarnings({
      glyphs: 2001,
      atlas: { width: 4096, height: 2048, channels: 4 },
    });
    expect(warnings).toEqual([
      expect.stringMatching(
        /^its 4096 × 2048 atlas \(.* of VRAM\) is over the font budget's 2048²/
      ),
      expect.stringMatching(/^its 2001 glyphs are over the font budget's 2000/),
    ]);
  });
});
