import fs from 'fs';
import path from 'path';

/**
 * Writes a file atomically: into `<file>.<pid>.tmp` next to it, then renamed over it, so a reader
 * (a parallel run, an editor) never sees it half written and a killed process leaves the old file
 * whole (p619 §1.4 V2). The folder is created.
 */
export const writeFileAtomic = (file: string, content: string | Uint8Array) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tempFile, content);
    fs.renameSync(tempFile, file);
  } catch (err) {
    fs.rmSync(tempFile, { force: true });
    throw err;
  }
};
