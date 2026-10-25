import type { HubConfig } from '../devTools/hub/types';

/**
 * The Ækasha Hub's site settings. The menu comes from the pages themselves: each page's
 * `aek:menu`, `aek:order` and `aek:icon`. The GitHub links are `package.json`'s
 * repository.
 */
const hubConfig: HubConfig = {
  title: 'Ækasha Hub',
  description:
    'Instructions, examples and API documentation for Ækasha, the WebGPU framework built on Three.js, Rapier and its own ECS.',
  coverageIgnore: [],
};

export default hubConfig;
