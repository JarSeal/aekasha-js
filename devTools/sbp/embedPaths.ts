/**
 * Where an embed profile's build goes (p611 D7), apart from `embedBuild.ts`, whose plugin imports
 * the gatherer (which compiles the JSON schemas when it loads): the Hub and the verify commands
 * read the build without it.
 */
import path from 'path';
import { ROOT } from '../paths';
import type { SbpProfile } from './config';

export const EMBED_ROOT_DIR = path.join(ROOT, 'dist-embed');

export const getEmbedOutDir = (id: string) => path.join(EMBED_ROOT_DIR, id);

/** The entry's file name in the output: its source's without `.ts` (`banner.embed.js`) */
export const getEmbedEntryFileName = (profile: SbpProfile) =>
  `${path.basename(profile.entry, '.ts')}.js`;
