import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_FONTS_DIR, HUB_ASSETS_DIR } from './paths';

// The Hub uses the UI kit's fonts (p801 D8): its `@font-face` rules (`_base.scss`) name the
// engine's files, which the build copies into `_assets/fonts/`, with the same descriptors as the
// engine's `fonts.css`, and `_base.scss` repeats `fonts.css`' opt-in of the kit's font tokens (the
// Hub can't load `fonts.css`: its `url()`s are relative to the engine's folder), which the Hub's
// font tokens alias.

const read = (file: string) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const fontsCss = read(path.join(ENGINE_FONTS_DIR, 'fonts.css'));
const hubBase = read(path.join(HUB_ASSETS_DIR, 'scss', '_base.scss'));
const hubTokens = read(path.join(HUB_ASSETS_DIR, 'scss', '_tokens.scss'));

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Each `@font-face`'s descriptors, its `src` reduced to the file's name */
const readFaces = (css: string) =>
  [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
    const face: Record<string, string> = {};
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      face[decl.slice(0, colon).trim()] = squash(decl.slice(colon + 1));
    }
    face.src = face.src.replace(/url\('(?:\.\/|fonts\/)([^']+)'\)/, 'url($1)');
    return face;
  });

/** A custom property's value in the text, its first declaration */
const readProperty = (css: string, name: string) => {
  const match = css.match(new RegExp(`${name}:([^;]+);`));
  return match ? squash(match[1]) : null;
};

describe("the Hub's fonts", () => {
  const engineFaces = readFaces(fontsCss);

  it("declares the engine's faces, on the engine's files", () => {
    expect(engineFaces).toHaveLength(6);
    expect(readFaces(hubBase)).toEqual(engineFaces);
    const named = engineFaces.map((face) => face.src.match(/url\(([^)]+)\)/)![1]).sort();
    const files = fs.readdirSync(ENGINE_FONTS_DIR).filter((name) => name.endsWith('.woff2'));
    expect(named).toEqual(files.sort());
  });

  it("opts its kit roots into the kit's stacks, which its font tokens read", () => {
    expect(readProperty(hubBase, '--aek-font-sans')).toBe(
      readProperty(fontsCss, '--aek-font-sans')
    );
    expect(readProperty(hubBase, '--aek-font-mono')).toBe(
      readProperty(fontsCss, '--aek-font-mono')
    );
    expect(readProperty(hubTokens, '--hub-font')).toBe('var(--aek-font-sans)');
    expect(readProperty(hubTokens, '--hub-font-mono')).toBe('var(--aek-font-mono)');
  });
});
