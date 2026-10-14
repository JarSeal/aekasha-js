// TEMPORARY (p611 Phase 4 §2 probe): replaced by the banner in §3
import { mountAekasha, type MountAekashaOptions } from 'aekasha';
import { appData } from '../../../generated/profiles/probe';

export const mount = (opts: Omit<MountAekashaOptions, 'data' | 'features'>) =>
  mountAekasha({
    data: appData,
    features: [],
    assetBaseUrl: new URL('.', import.meta.url).href,
    ...opts,
  });
