import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import { installTextureSets, registerTextureSetsDebug } from './TextureSets';

/**
 * The texture sets feature (p303): `*.textureSet.json` sets, each a named group of packed PBR maps
 * (`FULL`, `LITE`, `MINIMAL`) with the physical facts of the surface. A scene lists the sets its
 * code uses (`textureSets`, each loading its default packing), and a TSL material's input
 * `{ "textureSet": id, "packing"? }` gets the packing's textures and the set's uniforms. Without
 * it, a scene whose data names a set fails the boot, and a material created from code with a
 * `{ textureSet }` input fails to build.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { textureSets } from 'aekasha/texturesets';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [textureSets()], start: async () => {} });
 * ```
 */
export const textureSets = (): EngineFeature => ({
  id: 'texturesets',
  install: (ctx) => {
    installTextureSets(ctx);
    // Gated like every debug hook: a production build drops the call and the wrapper it names
    if (IS_DEBUG_ENV) ctx.onDebug(registerTextureSetsDebug);
  },
});
