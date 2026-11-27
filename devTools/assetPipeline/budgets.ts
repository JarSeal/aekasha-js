import {
  estimateTextureVramBytes,
  estimateVramBytes,
  getResultFigures,
  getTextureImageCount,
} from './generated';
import { formatBytes } from './report';
import type { PipelineRunResult } from './run';
import type { BudgetLimit } from './settings';

/**
 * Asset budgets (p300 Phase 4 step 1). An optimized asset is checked against:
 * - the `budget` of its settings (`vramMB`, `downloadMB`; defaults, rules, profile, asset JSON,
 *   later wins), for the whole asset: its `__vramBytes.out` and `__bytes.out`;
 * - a ceiling per encoded texture (§11 question 3): its slot's `maxSize`² at the codec's rate plus
 *   mips, from the settings without the asset JSON's own overrides. So a texture whose JSON raises
 *   its size or codec past its profile is caught. A `budget` in the asset JSON replaces it.
 *
 * Pass-throughs aren't checked: their images aren't read (no VRAM figure), and opting out of
 * optimization opts out of its budgets too. A production build fails for an asset over budget
 * that a shipped scene uses; `yarn assets` exits 1 for any; the dev server only warns.
 */

const MB = 1e6;

/** How to fix an asset over its budget: the line every budget message ends with */
export const BUDGET_FIX =
  'Lower its maxSize or codec, pick a profile that allows it, or set its own "optimize": { "budget": { … } } in its JSON.';

const formatLimit = (limit: BudgetLimit) => `the ${limit.mb} MB budget of ${limit.from}`;

/** Why the result is over its budget, one line per limit; empty when it isn't (or isn't checked) */
export const getBudgetViolations = (result: PipelineRunResult): string[] => {
  if (result.status !== 'optimized') return [];
  const { budget } = result.settings;
  const figures = getResultFigures(result);
  const violations: string[] = [];
  const { vramMB, downloadMB } = budget;
  if (vramMB && figures?.vramBytes && figures.vramBytes.out > vramMB.mb * MB) {
    violations.push(`VRAM ${formatBytes(figures.vramBytes.out)} is over ${formatLimit(vramMB)}`);
  }
  if (downloadMB && figures && figures.bytes.out > downloadMB.mb * MB) {
    violations.push(
      `download ${formatBytes(figures.bytes.out)} is over ${formatLimit(downloadMB)}`
    );
  }
  if (budget.isOwn) return violations;

  const profile = result.settings.profile ? `the profile "${result.settings.profile}"` : null;
  for (const texture of result.textures) {
    const allowed = budget.profileTextures[texture.slot];
    if (allowed.maxSize === null) continue;
    const mipmaps = allowed.codec !== 'none' && allowed.mipmaps;
    // An array (p299 D2) gets the ceiling per layer, a cube (p311 D1) per face
    const layers = getTextureImageCount(texture);
    const ceiling =
      estimateVramBytes(allowed.maxSize, allowed.maxSize, allowed.codec, mipmaps) * layers;
    const vram = estimateTextureVramBytes(texture).out;
    if (vram <= ceiling) continue;
    const label = texture.name ? `texture "${texture.name}"` : 'the texture';
    const unit = texture.layers ? 'layer' : texture.isCube ? 'face' : null;
    const size = `${texture.width}×${texture.height}${unit ? `×${layers} ${unit}s` : ''}`;
    violations.push(
      `${label} (${texture.slot}, ${size} ${texture.codec}): VRAM ${formatBytes(vram)} is over the ${formatBytes(ceiling)} its slot's settings allow without the asset JSON's overrides (maxSize ${allowed.maxSize}, ${allowed.codec}${unit ? ` per ${unit}` : ''}${profile ? `, ${profile}` : ''})`
    );
  }
  return violations;
};

/**
 * A font's budget (p391 D3): its atlas and its glyph count past these are warned about, not
 * failed (a font past `atlas.maxSize` fails its encode already). A 2048² RGBA atlas is 16 MB of
 * VRAM, and 2000 glyphs a layout JSON of over 100 kB.
 */
export const FONT_BUDGET = { atlasPixels: 2048 * 2048, glyphs: 2000 } as const;

/** Why a font's encode is over {@link FONT_BUDGET}, one line per limit (its warnings) */
export const getFontBudgetWarnings = (stats: {
  glyphs: number;
  atlas: { width: number; height: number; channels: number };
}): string[] => {
  const warnings: string[] = [];
  const { width, height, channels } = stats.atlas;
  if (width * height > FONT_BUDGET.atlasPixels) {
    warnings.push(
      `its ${width} × ${height} atlas (${formatBytes(width * height * channels)} of VRAM) is over the font budget's 2048²: ask for fewer characters, or lower its size`
    );
  }
  if (stats.glyphs > FONT_BUDGET.glyphs) {
    warnings.push(
      `its ${stats.glyphs} glyphs are over the font budget's ${FONT_BUDGET.glyphs}: ask for fewer characters (a dynamic atlas suits a large character set)`
    );
  }
  return warnings;
};
