import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../paths';

// No module-level side effects (p607 D8): a module registers nothing when it's imported, only when
// its feature is installed, so importing it costs a build nothing it doesn't use and its
// registration order doesn't depend on import order. Checked: every top-level statement that
// isn't a declaration (a call, an assignment, and an `if`, a loop, a block or a `try` around one,
// p617 G1) in the engine, the toolkit, the app and `src/*.ts`. A declaration's initializer isn't
// read: `const x = register()` is still a side effect this test can't see.

/** Run only by the debug loader's `import()` (their load is their install), or entry points */
const EXEMPT = [
  /(^|\/)_dbg__[^/]*\.ts$/,
  /^src\/_engine\/(features\/physics\/worker\/PhysicsWorker|kernel\/assets\/worker\/AssetsWorker)\.ts$/,
  /^src\/index\.ts$/,
];

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

/** A top-level statement that runs nothing at load: an import, an export of names, a declaration */
const isDeclaration = (statement: ts.Statement) =>
  ts.isImportDeclaration(statement) ||
  ts.isImportEqualsDeclaration(statement) ||
  ts.isExportDeclaration(statement) ||
  ts.isExportAssignment(statement) ||
  ts.isVariableStatement(statement) ||
  ts.isFunctionDeclaration(statement) ||
  ts.isClassDeclaration(statement) ||
  ts.isInterfaceDeclaration(statement) ||
  ts.isTypeAliasDeclaration(statement) ||
  ts.isEnumDeclaration(statement) ||
  ts.isModuleDeclaration(statement) ||
  ts.isEmptyStatement(statement);

const findTopLevelStatements = (file: string) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return sf.statements
    .filter((statement) => !isDeclaration(statement))
    .map((statement) => {
      const line = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1;
      return `${file}:${line} ${statement.getText(sf).split('\n')[0]}`;
    });
};

describe('module-level side effects', () => {
  // No allow-list: p607 moved every registration into an install (its `NOT_YET_INSTALLED` went
  // empty, then away with p619 §1.4 V6), so a registration goes in an install, never on a list
  it('no module runs a statement at load', () => {
    expect(listModules().flatMap(findTopLevelStatements)).toEqual([]);
  });
});
