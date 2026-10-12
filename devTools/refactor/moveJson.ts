/**
 * The move's asset JSON rewrite (p609 D4), without the file system: the paths inside a gathered
 * asset JSON (`*.scene.json`, `*.texture.json`, …), which `moveText.ts` only reports.
 *
 * - `$schema`: the schema file in `.schemas/` (by its name), written from the JSON's new folder.
 *   Only for a JSON that moves; a broken one is fixed on the way.
 * - `sceneFile` (a scene JSON) and `tslFile` (a material or PostFX JSON): resolved as the gatherer
 *   does, from `src/app/` and from the JSON's root under `src/` (`src/toolkit/` for a toolkit
 *   material), with its `.ts` fallback, and written as it was (with or without `./` and `.ts`).
 * - Any other string starting `./` or `../` (`image`, `fileName`, an atlas slot): a file of the
 *   tree, resolved from the JSON's old folder and written from its new one.
 *
 * Only the string values change (text edits from the parsed positions), so the formatting and
 * `__saveData` stay as they are. A root-absolute path (`/debugger/…`) is a public URL, left alone.
 */
import path from 'path';
import ts from 'typescript';
import { toSpecifier, type PathMap, type RewriteResult } from './moveApply';

const posix = path.posix;

/** The gatherer's asset suffixes (`gatherAppData.ts`' `JSON_ENDING_SIGNATURES`) */
const ASSET_JSON =
  /\.(scene|camera|light|geometry|texture|textureArray|textureAtlas|material|mesh|importedAsset|skybox|postFx|impostor)\.json$/;

/** The folder a `sceneFile` is resolved from (`gatherAppData.ts`) */
const SCENE_FILE_BASE = 'src/app';

/** The folder a `tslFile` is resolved from: the JSON's first folder under `src/` (`getBasePath`) */
const getRootBase = (file: string) => file.split('/').slice(0, 2).join('/');

const SCHEMA_DIR = '.schemas';

/** Whether the asset JSON rewrite reads a file: a gathered asset JSON under `src/` */
export const isAssetJson = (file: string) =>
  file.startsWith('src/') && !file.startsWith('src/generated/') && ASSET_JSON.test(file);

const isRelative = (value: string) => value.startsWith('./') || value.startsWith('../');

type Edit = { start: number; end: number; text: string };

/** Every string value with the key of the property it's in (an array's items take its key) */
const stringValues = (file: string, text: string) => {
  const sf = ts.parseJsonText(file, text);
  const found: { node: ts.StringLiteral; key: string | undefined }[] = [];
  const visit = (node: ts.Node, key: string | undefined) => {
    if (ts.isStringLiteral(node)) found.push({ node, key });
    else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.getText(sf);
        visit(prop.initializer, name);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) visit(element, key);
    }
  };
  for (const statement of sf.statements) visit(statement.expression, undefined);
  return { sf, found };
};

/** A `sceneFile` or `tslFile` (`key`) resolved from `base`, after the move; `{}` when it stays */
const moveFromBase = (
  map: PathMap,
  key: string,
  base: string,
  value: string
): { text?: string; error?: string } => {
  let oldTarget = posix.normalize(posix.join(base, value));
  const hasExtension = posix.extname(oldTarget) !== '';
  if (!map.oldFiles.has(oldTarget) && !hasExtension) oldTarget += '.ts';
  if (!map.oldFiles.has(oldTarget)) return { error: `${key} '${value}' names no file` };
  const newTarget = map.newPathOf(oldTarget);
  if (!newTarget) return { error: `${key} '${value}' names ${oldTarget}, which is gone` };
  if (newTarget === oldTarget) return {};
  if (!newTarget.startsWith(`${base}/`)) {
    return { error: `${key} '${value}' moves to ${newTarget}, outside ${base}/` };
  }
  let written = posix.relative(base, newTarget);
  if (!hasExtension) written = written.replace(/\.ts$/, '');
  return { text: value.startsWith('./') ? `./${written}` : written };
};

/** A relative path after the move; `{}` when it stays as written */
const moveRelative = (
  map: PathMap,
  file: string,
  newFile: string,
  value: string
): { text?: string; error?: string } => {
  const oldTarget = posix.normalize(posix.join(posix.dirname(file), value));
  if (!map.oldFiles.has(oldTarget)) {
    return newFile === file ? {} : { error: `'${value}' names no file: it can't follow the JSON` };
  }
  const newTarget = map.newPathOf(oldTarget);
  if (!newTarget) return { error: `'${value}' names ${oldTarget}, which is gone` };
  if (newFile === file && newTarget === oldTarget) return {};
  const written = toSpecifier(posix.dirname(newFile), newTarget);
  return written === value ? {} : { text: written };
};

/**
 * Rewrites one asset JSON's paths for the move (`file` is its path before it). On an error the
 * text stays as it was.
 */
export const rewriteAssetJson = (map: PathMap, file: string, text: string): RewriteResult => {
  const newFile = map.newPathOf(file);
  if (!newFile) return { text, errors: [] };
  const { sf, found } = stringValues(file, text);
  const edits: Edit[] = [];
  const errors: string[] = [];
  for (const { node, key } of found) {
    const start = node.getStart(sf) + 1;
    const end = node.getEnd() - 1;
    const value = node.text;
    // A value with escapes isn't a path this rewrite writes
    if (text.slice(start, end) !== value) continue;
    let moved: { text?: string; error?: string } = {};
    if (key === '$schema') {
      if (newFile !== file && isRelative(value)) {
        const schema = `${SCHEMA_DIR}/${posix.basename(value)}`;
        const written = posix.relative(posix.dirname(newFile), schema);
        if (written !== value) moved = { text: written };
      }
    } else if (key === 'sceneFile' && file.endsWith('.scene.json')) {
      moved = moveFromBase(map, key, SCENE_FILE_BASE, value);
    } else if (key === 'tslFile' && /\.(material|postFx)\.json$/.test(file)) {
      moved = moveFromBase(map, key, getRootBase(file), value);
    } else if (isRelative(value)) {
      moved = moveRelative(map, file, newFile, value);
    }
    if (moved.error) {
      const line = sf.getLineAndCharacterOfPosition(start).line + 1;
      errors.push(`${file}:${line} ${moved.error}`);
    } else if (moved.text !== undefined) edits.push({ start, end, text: moved.text });
  }
  if (errors.length) return { text, errors };
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { text: out, errors };
};
