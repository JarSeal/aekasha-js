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
  // so an entry lists its API (no `export *`).
  it('an entry file holds only named `export … from` statements', () => {
    const offending: string[] = [];
    for (const file of Object.values(ENTRY_FILES)) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
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
