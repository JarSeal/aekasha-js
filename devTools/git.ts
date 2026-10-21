/** git for the dev tools, run in the repo root (one helper, p619 K3) */
import { execFileSync } from 'child_process';
import { ROOT } from './paths';

/**
 * A git command's output, trimmed.
 * @remarks Throws when git fails (its message names the command); see {@link readGit} for a
 * best-effort read.
 */
export const git = (args: string[]) =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

/** A git command's output, or '' when git or the repo isn't there (a build from an archive) */
export const readGit = (args: string[]) => {
  try {
    return git(args);
  } catch {
    return '';
  }
};
