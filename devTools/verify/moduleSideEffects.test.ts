import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../assetPipeline/sources';

// No module-level side effects (p607 D8): a module registers nothing when it's imported, only when
// its feature is installed, so importing it costs a build nothing it doesn't use and its
// registration order doesn't depend on import order. Checked: every top-level expression
// statement (a call, an assignment) in the engine, the toolkit, the app and `src/*.ts`.

/** Run only by the debug loader's `import()` (their load is their install), or entry points */
const EXEMPT = [
  /(^|\/)_dbg__[^/]*\.ts$/,
  /^src\/_engine\/core\/Debug\//,
  /^src\/_engine\/workers\/(physicsWorker|assetsWorker)\.ts$/,
  /^src\/index\.ts$/,
];

/**
 * The statements p607 hasn't moved into an install yet, by file: the phases remove them, and a
 * count that drops must drop here too (so the list only shrinks). Empty when p607 is done.
 */
const NOT_YET_INSTALLED: Record<string, number> = {};

const SCANNED = ['src/_engine', 'src/toolkit', 'src/app'];

const listModules = () => {
  const files = fs
    .readdirSync(path.join(ROOT, 'src'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `src/${name}`);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name)) files.push(rel);
    }
  };
  SCANNED.forEach(walk);
  return files.filter((file) => !EXEMPT.some((re) => re.test(file)));
};

const findTopLevelStatements = (file: string) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return sf.statements.filter(ts.isExpressionStatement).map((statement) => {
    const line = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1;
    return `${file}:${line} ${statement.getText(sf).split('\n')[0]}`;
  });
};

describe('module-level side effects', () => {
  it('no module runs a statement at load, beyond the ones not yet installed', () => {
    const found = new Map<string, string[]>();
    for (const file of listModules()) {
      const statements = findTopLevelStatements(file);
      if (statements.length) found.set(file, statements);
    }
    const problems: string[] = [];
    for (const [file, statements] of found) {
      const allowed = NOT_YET_INSTALLED[file] ?? 0;
      if (statements.length > allowed) problems.push(...statements);
    }
    for (const [file, allowed] of Object.entries(NOT_YET_INSTALLED)) {
      const count = found.get(file)?.length ?? 0;
      if (count < allowed) {
        problems.push(`${file}: ${count} left, NOT_YET_INSTALLED says ${allowed} (lower it)`);
      }
    }
    expect(problems).toEqual([]);
  });
});
