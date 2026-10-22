import { sha256 } from '../files';

/** A short content hash: the `?v=` on asset URLs */
export const hashContent = (content: string | Buffer) => sha256(content).slice(0, 10);
