import { type AekashaMount, type MountAekashaOptions, mountAekasha } from 'aekasha';
import { appData } from '../../../generated/profiles/banner';

// #region banner-embed (shown in the Hub: hub/pages/examples/embed/)
/** The banner's mount options: {@link MountAekashaOptions} without the parts this entry binds */
export type BannerMountOptions = Omit<MountAekashaOptions, 'data' | 'features' | 'config'>;

/**
 * Mounts the banner (`sbp.config.ts`' `banner` profile, built into `dist-embed/banner/`): its one
 * scene, no feature, a transparent canvas. A site imports this module's built file and calls it:
 * `import { mount } from './aekasha/banner.embed.js'; mount({ target: '#hero' })`.
 */
export const mount = (opts: BannerMountOptions): Promise<AekashaMount> =>
  mountAekasha({
    data: appData,
    features: [],
    // The built files sit next to this module; the dev server serves them from its root
    assetBaseUrl: import.meta.env.DEV ? undefined : new URL('.', import.meta.url).href,
    ...opts,
    renderer: { alpha: true, antialias: true, ...opts.renderer },
  });
// #endregion banner-embed
