/**
 * The working tree as the layout check reads it (`layout.test.ts`, `layoutReport.ts`): every file
 * git tracks or would add (an ignored one aside, a deleted one too), and the sources of `src/`'s
 * modules.
 */
import fs from 'fs';
import path from 'path';
import { git } from '../git';
import { ROOT } from '../paths';

/** The files (repo-relative, `/`) and `src/`'s `.ts` modules without the declarations */
export const readLayoutTree = () => {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter((file) => file && fs.existsSync(path.join(ROOT, file)));
  const sources = new Map<string, string>();
  for (const file of files) {
    if (!file.startsWith('src/') || !file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    sources.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  return { files, sources };
};
