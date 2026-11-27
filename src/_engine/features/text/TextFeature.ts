import type { EngineFeature } from '../../kernel/init/Features';
import { installFonts } from './Fonts';

// p391 D6 (the fonts' load); p392 adds the texts
/**
 * The text feature: `*.font.json` fonts, distance field atlases the asset pipeline encodes with
 * their layouts. A scene lists the fonts its code draws with (`fonts`), loaded with its assets
 * before its scene code runs; `loadFontAsync` loads one no scene lists. Without it, a scene
 * whose data names a font fails the boot.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { text } from 'aekasha/text';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [text()], start: async () => {} });
 * ```
 */
export const text = (): EngineFeature => ({
  id: 'text',
  install: (ctx) => {
    installFonts(ctx);
  },
});
