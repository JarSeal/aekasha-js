import { type AekashaMount, type MountAekashaOptions, mountAekasha } from 'aekasha';
import { appData } from '../../../generated/profiles/uiKit';

/** The uiKit embed's mount options: {@link MountAekashaOptions} without the parts this entry binds */
export type UiKitMountOptions = Omit<MountAekashaOptions, 'data' | 'features' | 'config'>;

/**
 * Mounts the uiKit embed (`sbp.config.ts`' `uiKit` profile, built into `dist-embed/uiKit/`): its
 * one scene, no feature, with the UI kit's window and toast open over it, and its dialog with a
 * small form (the scene opens them). A site imports this module's built file and calls it:
 * `import { mount } from './aekasha/uiKit.embed.js'; mount({ target: '#kit' })`.
 */
export const mount = (opts: UiKitMountOptions): Promise<AekashaMount> =>
  mountAekasha({
    data: appData,
    features: [],
    // The built files sit next to this module; the dev server serves them from its root
    assetBaseUrl: import.meta.env.DEV ? undefined : new URL('.', import.meta.url).href,
    ...opts,
  });
