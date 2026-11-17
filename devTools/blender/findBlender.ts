import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Finds a Blender for the dev tools (the Blender MCP server's background tools, p306 Phase 5's
 * `yarn verify:blender`): `AEK_BLENDER`, then `blender` on PATH, then the newest Windows install
 * under `C:\Program Files\Blender Foundation\` seen from WSL2 (`/mnt/c/…`), each only when its
 * version is at least the caller's minimum.
 */

/** Where the Windows installs are, seen from WSL2 */
export const WINDOWS_BLENDER_DIR = '/mnt/c/Program Files/Blender Foundation';

export type BlenderVersion = [major: number, minor: number];

export type FoundBlender = {
  /** The executable (a Windows `blender.exe` takes Windows paths: `wslpath -w`) */
  path: string;
  version: BlenderVersion;
  source: 'env' | 'path' | 'windows';
};

/** The version in `blender --version`'s first line or an install folder's name (`Blender 5.3`) */
export const parseBlenderVersion = (text: string): BlenderVersion | null => {
  const match = /Blender (\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/** Whether `version` is at least `min` */
export const isAtLeast = (version: BlenderVersion, min: BlenderVersion) =>
  version[0] !== min[0] ? version[0] > min[0] : version[1] >= min[1];

export const formatBlenderVersion = (version: BlenderVersion) => version.join('.');

/** The newest `Blender X.Y/blender.exe` among a folder's entries, at least `min` */
export const pickWindowsBlender = (
  entries: string[],
  min: BlenderVersion,
  exists: (file: string) => boolean = fs.existsSync
): FoundBlender | null => {
  let best: FoundBlender | null = null;
  for (const entry of entries) {
    const version = parseBlenderVersion(entry);
    if (!version || !isAtLeast(version, min)) continue;
    if (best && isAtLeast(best.version, version)) continue;
    const exe = path.join(WINDOWS_BLENDER_DIR, entry, 'blender.exe');
    if (exists(exe)) best = { path: exe, version, source: 'windows' };
  }
  return best;
};

/** Runs `blender --version` (a second or two); null when it doesn't run */
const readVersion = (exe: string): BlenderVersion | null => {
  try {
    const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 60_000 });
    return parseBlenderVersion(out);
  } catch {
    return null;
  }
};

/**
 * Finds a Blender of at least `minVersion`. Throws when `AEK_BLENDER` is set but isn't one (it
 * names the choice, so no fallback), and when none is found, naming every place looked.
 */
export const findBlender = (minVersion: BlenderVersion): FoundBlender => {
  const min = formatBlenderVersion(minVersion);
  const fromEnv = process.env.AEK_BLENDER;
  if (fromEnv) {
    const version = readVersion(fromEnv);
    if (!version) throw new Error(`AEK_BLENDER (${fromEnv}) doesn't run as Blender.`);
    if (!isAtLeast(version, minVersion)) {
      throw new Error(
        `AEK_BLENDER (${fromEnv}) is Blender ${formatBlenderVersion(version)}; ${min} or newer is needed.`
      );
    }
    return { path: fromEnv, version, source: 'env' };
  }
  const onPath = readVersion('blender');
  if (onPath && isAtLeast(onPath, minVersion)) {
    return { path: 'blender', version: onPath, source: 'path' };
  }
  const entries = fs.existsSync(WINDOWS_BLENDER_DIR) ? fs.readdirSync(WINDOWS_BLENDER_DIR) : [];
  const windows = pickWindowsBlender(entries, minVersion);
  if (windows) return windows;
  throw new Error(
    `No Blender ${min} or newer: not AEK_BLENDER, not \`blender\` on PATH${onPath ? ` (${formatBlenderVersion(onPath)})` : ''}, none in ${WINDOWS_BLENDER_DIR}. Install one, or set AEK_BLENDER to its executable.`
  );
};
