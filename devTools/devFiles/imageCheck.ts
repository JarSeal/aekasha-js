import path from 'path';
import { DevFilesError } from './http';

/**
 * A staged file written as an image must start like one (p619 §1.4 F3): the server doesn't decode
 * images, and a `.png` holding anything else (a script another tool could be pointed at, a
 * corrupt or mislabelled upload) is refused before it's written. Checks the format's signature
 * only, not the whole file.
 */

/** Each image extension's signature: bytes at an offset (WebP: `RIFF`, a size, then `WEBP`) */
const SIGNATURES: Record<string, { name: string; parts: { at: number; bytes: number[] }[] }> = {
  '.png': {
    name: 'PNG',
    parts: [{ at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  '.jpg': { name: 'JPEG', parts: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }] },
  '.jpeg': { name: 'JPEG', parts: [{ at: 0, bytes: [0xff, 0xd8, 0xff] }] },
  '.webp': {
    name: 'WebP',
    parts: [
      { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
};

/**
 * Throws INVALID_IMAGE when `data` doesn't start like the image its path's extension names; any
 * other extension passes (a JSON is checked as a value).
 * @param repoPath The target, for its extension and the message
 */
export const checkImageBytes = (repoPath: string, data: Uint8Array) => {
  const signature = SIGNATURES[path.posix.extname(repoPath).toLowerCase()];
  if (!signature) return;
  const isMatch = signature.parts.every(({ at, bytes }) =>
    bytes.every((byte, i) => data[at + i] === byte)
  );
  if (!isMatch) {
    throw new DevFilesError(
      'INVALID_IMAGE',
      `${repoPath}: the staged file isn't a ${signature.name} image (its first bytes don't match)`,
      { path: repoPath }
    );
  }
};
