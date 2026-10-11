/**
 * The `@example` check (p606 §4.6): every `@example` of the documented API (TypeDoc's scope, its
 * excludes included) type-checks as app code that imports the entries.
 *
 * - An example is its tag's code blocks (```` ``` ```` fences; other languages than ts / js are
 *   skipped), or the whole tag when it has none, as TypeDoc reads it.
 * - Each becomes a module that imports, from the entries, the names it uses but doesn't import or
 *   declare itself: any entry, not only its own module's, since an example can combine features.
 * - All of them are checked in one in-memory program with the real `tsconfig.json`, minus the
 *   unused-name checks (an example shows a call, its result needn't be used). Only the examples'
 *   own diagnostics count.
 * - What the reader has is free: an undeclared name (`box`, `ecsWorld`) and a relative import (the
 *   reader's own `./CONFIG`). Every other error is a finding, with the source file and line.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { ENTRY_FILES } from '../aliases';
import { ROOT } from '../assetPipeline/sources';

/** One example's code, located by the source line of its first code line */
export type ExampleBlock = {
  /** Repo-relative path */
  file: string;
  line: number;
  /** The declaration the example documents (`createLines`, `LineWriter.vec`) */
  owner: string;
  code: string;
};

export type ExampleFinding = { file: string; line: number; owner: string; message: string };

/** TypeDoc's scope (`typedocOptions` in `tsconfig.json`, the Hub extract's excludes) */
const SCOPE_FOLDERS = ['src/_engine', 'src/toolkit'];
const EXCLUDED_FILE_REGEX = /^(_dbg__|index\.ts$)|\.test\.ts$/;
const CODE_FENCE_LANGS = new Set(['', 'ts', 'typescript', 'js', 'javascript']);

// Free names: "Cannot find name", its "Did you mean" form, a shorthand property of one
const FREE_NAME_CODES = new Set([2304, 2552, 18004]);
const CANNOT_FIND_MODULE = 2307;

// The examples' modules: a folder that doesn't exist, so a relative import resolves to nothing
const VIRTUAL_DIR = path.join(ROOT, 'src/__examples__');
// The imports go on one line above the example's code
const HEADER_LINES = 1;

const getOwnerName = (node: ts.Node): string => {
  if (ts.isVariableStatement(node)) {
    return getOwnerName(node.declarationList.declarations[0]);
  }
  const name = (node as { name?: ts.Node }).name;
  const own = name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : '?';
  const parent = node.parent;
  if (parent && (ts.isClassLike(parent) || ts.isInterfaceDeclaration(parent)) && parent.name) {
    return `${parent.name.text}.${own}`;
  }
  return own;
};

/** The tag's lines without the comment's ` * ` margin, the first one being `@example …` */
const getTagLines = (sf: ts.SourceFile, tag: ts.JSDocTag) =>
  sf.text
    .slice(tag.getStart(sf), tag.end)
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line, i) => (i === 0 ? line : line.replace(/^\s*\*( |$)/, '')));

const getTagBlocks = (lines: string[], firstLine: number) => {
  const blocks: { line: number; code: string }[] = [];
  const isFence = (line: string) => line.trimStart().startsWith('```');
  if (!lines.some(isFence)) {
    // The `@example` line's own text is code too when there's no fence
    const code = [lines[0].replace(/^@example\s?/, ''), ...lines.slice(1)];
    const start = code.findIndex((line) => line.trim());
    if (start >= 0) {
      blocks.push({ line: firstLine + start, code: code.slice(start).join('\n').trimEnd() });
    }
    return blocks;
  }
  let open: { line: number; lang: string; code: string[] } | undefined;
  lines.forEach((line, i) => {
    if (!isFence(line)) {
      open?.code.push(line);
    } else if (!open) {
      open = { line: firstLine + i + 1, lang: line.trim().slice(3).trim(), code: [] };
    } else {
      if (CODE_FENCE_LANGS.has(open.lang)) {
        blocks.push({ line: open.line, code: open.code.join('\n').trimEnd() });
      }
      open = undefined;
    }
  });
  return blocks;
};

/** Every example in one module's source */
export const extractExamples = (file: string, text: string): ExampleBlock[] => {
  if (!text.includes('@example')) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const blocks: ExampleBlock[] = [];
  // A variable's tags are reported for its statement and its declaration: each tag once
  const seen = new Set<number>();
  const visit = (node: ts.Node) => {
    for (const tag of ts.getJSDocTags(node)) {
      if (tag.tagName.text !== 'example' || seen.has(tag.pos)) continue;
      seen.add(tag.pos);
      const firstLine = sf.getLineAndCharacterOfPosition(tag.getStart(sf)).line + 1;
      const owner = getOwnerName(tag.parent.parent);
      for (const block of getTagBlocks(getTagLines(sf, tag), firstLine)) {
        blocks.push({ file, owner, ...block });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return blocks;
};

/** Every example in TypeDoc's scope */
export const collectRepoExamples = (): ExampleBlock[] =>
  SCOPE_FOLDERS.flatMap((folder) =>
    (fs.readdirSync(path.join(ROOT, folder), { recursive: true }) as string[])
      .filter((rel) => rel.endsWith('.ts') && !EXCLUDED_FILE_REGEX.test(path.basename(rel)))
      .sort()
      .flatMap((rel) => {
        const file = path.posix.join(folder, rel.split(path.sep).join('/'));
        return extractExamples(file, fs.readFileSync(path.join(ROOT, file), 'utf-8'));
      })
  );

type EntryName = { entry: string; isType: boolean };

/** Each entry's names, and whether each is a type (an `export type { … } from`) */
const getEntryNames = () => {
  const names = new Map<string, EntryName>();
  for (const [entry, file] of Object.entries(ENTRY_FILES)) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
    for (const statement of sf.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const el of statement.exportClause.elements) {
        names.set(el.name.text, { entry, isType: statement.isTypeOnly || el.isTypeOnly });
      }
    }
  }
  return names;
};

const collectDeclaredNames = (name: ts.BindingName, into: Set<string>) => {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const el of name.elements) {
    if (!ts.isOmittedExpression(el)) collectDeclaredNames(el.name, into);
  }
};

/** The import line for the entry names an example uses without importing or declaring them */
const getHeader = (code: string, entryNames: Map<string, EntryName>) => {
  const sf = ts.createSourceFile('example.ts', code, ts.ScriptTarget.Latest, true);
  const declared = new Set<string>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) declared.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) declared.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) declared.add(el.name.text);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        collectDeclaredNames(decl.name, declared);
      }
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name) declared.add(statement.name.text);
    }
  }
  const used = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) used.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const byEntry = new Map<string, { values: string[]; types: string[] }>();
  for (const name of [...used].sort()) {
    const entryName = entryNames.get(name);
    if (!entryName || declared.has(name)) continue;
    const imports = byEntry.get(entryName.entry) ?? { values: [], types: [] };
    (entryName.isType ? imports.types : imports.values).push(name);
    byEntry.set(entryName.entry, imports);
  }
  return [...byEntry]
    .flatMap(([entry, { values, types }]) => [
      values.length ? `import { ${values.join(', ')} } from '${entry}';` : '',
      types.length ? `import type { ${types.join(', ')} } from '${entry}';` : '',
    ])
    .filter(Boolean)
    .join(' ');
};

const isFree = (d: ts.Diagnostic) => {
  if (FREE_NAME_CODES.has(d.code)) return true;
  if (d.code !== CANNOT_FIND_MODULE || !d.file || d.start === undefined) return false;
  // The reader's own module: the specifier (with its quote) is relative
  return /^['"]\.{1,2}\//.test(d.file.text.slice(d.start, d.start + (d.length ?? 0)));
};

/**
 * Type-checks the examples in one program and returns the errors that aren't free names or the
 * reader's own modules, at their source lines.
 */
export const checkExamples = (blocks: ExampleBlock[]): ExampleFinding[] => {
  const configPath = path.join(ROOT, 'tsconfig.json');
  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT, undefined, configPath);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noEmit: true,
  };

  const entryNames = getEntryNames();
  const virtual = new Map<string, { block: ExampleBlock; text: string }>();
  blocks.forEach((block, i) => {
    const header = getHeader(block.code, entryNames);
    // `export {}` makes it a module even without an import, so examples don't share a scope
    virtual.set(path.join(VIRTUAL_DIR, `example${i}.ts`), {
      block,
      text: `${header}\n${block.code}\nexport {};\n`,
    });
  });

  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const example = virtual.get(path.normalize(fileName));
    return example
      ? ts.createSourceFile(fileName, example.text, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  };
  host.fileExists = (fileName) => virtual.has(path.normalize(fileName)) || fileExists(fileName);
  host.readFile = (fileName) => virtual.get(path.normalize(fileName))?.text ?? readFile(fileName);

  // The examples, and the config's ambient declarations (`vite-env.d.ts`: `?worker`, `import.meta.env`)
  const ambient = parsed.fileNames.filter((f) => f.endsWith('.d.ts'));
  const program = ts.createProgram({ rootNames: [...virtual.keys(), ...ambient], options, host });

  const findings: ExampleFinding[] = [];
  for (const [fileName, { block }] of virtual) {
    const sf = program.getSourceFile(fileName);
    if (!sf) throw new Error(`The example module ${fileName} wasn't created`);
    const diagnostics = [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ];
    for (const d of diagnostics) {
      if (isFree(d)) continue;
      const line = d.start === undefined ? 0 : sf.getLineAndCharacterOfPosition(d.start).line;
      findings.push({
        file: block.file,
        line: block.line + Math.max(0, line - HEADER_LINES),
        owner: block.owner,
        message: `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
      });
    }
  }
  return findings;
};

export const formatFinding = (f: ExampleFinding) =>
  `${f.file}:${f.line} (${f.owner}'s example) ${f.message}`;
