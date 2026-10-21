/** The repo's folders, for every dev tool (one definition, p619 K3) */
import path from 'path';
import { fileURLToPath } from 'url';

/** The repo root */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** `src/`: the Vite root, which the gather walks */
export const SRC_DIR = path.join(ROOT, 'src');
/** `src/public/`: files served at the site's root */
export const PUBLIC_DIR = path.join(SRC_DIR, 'public');
/** `src/generated/`: the gather's output */
export const GENERATED_DIR = path.join(SRC_DIR, 'generated');
