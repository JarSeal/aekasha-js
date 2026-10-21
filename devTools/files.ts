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

/**
 * Writes a text file atomically (`writeFileAtomic`) only when its content differs from what's
 * there, so an unchanged output doesn't wake a watcher (p619 §1.4 G7: every gather rewrote the
 * generated data, which reloaded every open page).
 * @returns whether it was written
 */
export const writeFileIfChanged = (file: string, content: string) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  writeFileAtomic(file, content);
  return true;
};

/** The folders under `src/` that hold outputs, never a source: the gather's and the pipeline's */
const OUTPUT_FOLDERS = [path.join('generated'), path.join('public', 'aek-assets')];

/**
 * Every file under a source folder (`src/`), as paths from it, without the outputs' folders
 * (`generated/`, `public/aek-assets/`). In `fs.readdirSync`'s recursive order: a folder's
 * entries, then each of its folders' in turn.
 */
export const listSourceFiles = (srcDir: string) => {
  const files: string[] = [];
  const folders = [''];
  for (let i = 0; i < folders.length; i++) {
    for (const entry of fs.readdirSync(path.join(srcDir, folders[i]), { withFileTypes: true })) {
      const file = folders[i] ? path.join(folders[i], entry.name) : entry.name;
      if (!entry.isDirectory()) files.push(file);
      else if (!OUTPUT_FOLDERS.includes(file)) folders.push(file);
    }
  }
  return files;
};
