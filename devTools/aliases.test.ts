import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ENTRY_FILES, getTsconfigPaths } from './aliases';
import { ROOT } from './paths';

describe('aliases', () => {
  it("tsconfig.json's paths are the entry list", () => {
    const { config, error } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
    expect(error).toBeUndefined();
    expect(config.compilerOptions.paths).toEqual(getTsconfigPaths());
  });

  it('every entry file exists', () => {
    for (const file of Object.values(ENTRY_FILES)) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });

  // An entry only names modules: the build keeps what's used of them (package.json's
  // `sideEffects`), and anything else in an entry would run wherever the entry is imported. Named,
  // so an entry lists its API (no `export *`). One exception: a stylesheet entry
  // (`aekasha/ui/fonts`, p801 D8) imports `.css` files and nothing else, and `sideEffects` lists
  // it, or the build drops it with its stylesheet.
  it('an entry file holds only named `export … from` statements', () => {
    const { sideEffects } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const offending: string[] = [];
    for (const file of Object.values(ENTRY_FILES)) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const isStylesheetImport = (statement: ts.Statement) =>
        ts.isImportDeclaration(statement) &&
        !statement.importClause &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.endsWith('.css');
      const isStylesheetEntry = sf.statements.length > 0 && sf.statements.every(isStylesheetImport);
      if (isStylesheetEntry) {
        expect(sideEffects, `${file}: package.json's sideEffects`).toContain(`./${file}`);
        continue;
      }
      for (const statement of sf.statements) {
        const isNamedReexport =
          ts.isExportDeclaration(statement) &&
          !!statement.moduleSpecifier &&
          !!statement.exportClause &&
          ts.isNamedExports(statement.exportClause);
        if (isNamedReexport) continue;
        const line = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1;
        offending.push(`${file}:${line} ${statement.getText(sf).split('\n')[0]}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
