import path from 'path';
import { format, resolveConfig, resolveConfigFile } from 'prettier';
import { ROOT } from '../paths';

/**
 * How a dev files JSON write is formatted: Prettier with the repo root's config only (p619 §1.4
 * F3). Prettier's own lookup starts at the target's folder, and a config there (a `package.json`
 * with a `"prettier"` key naming a module) is loaded with `require()`: code a dev files write
 * could have put there would run in the dev server. The root's config is the developer's.
 */

let rootConfigFile: Promise<string | null> | null = null;

/** The repo root's Prettier config file (`.prettierrc`), looked up once */
const getRootConfigFile = () =>
  (rootConfigFile ??= resolveConfigFile(path.join(ROOT, 'package.json')));

/** The JSON as the file gets it: `value` as JSON, Prettier-formatted for `absPath` */
export const formatDevFileJson = async (value: unknown, absPath: string) => {
  const config = await getRootConfigFile();
  // `config` given: Prettier reads that file (its overrides matched against `absPath`), no other
  const options = config ? (await resolveConfig(absPath, { config })) ?? {} : {};
  return format(JSON.stringify(value, null, 2), { ...options, filepath: absPath });
};
