/**
 * Rewrites deep imports of the engine and the toolkit to entry imports (p606 Phase 7): the logic of
 * `migrateToEntries.ts`, without the file system.
 *
 * - A module outside `src/_engine/` importing an engine module, or a module outside a toolkit
 *   category importing that category's modules, imports each name from the entry that exports
 *   it. Engine code is left alone: it imports engine code by relative path (p606 D3).
 * - A relative import of an entry file (`../_engine`) becomes its alias.
 * - The names going to one entry merge into one value import (inline `type` names kept inline)
 *   and one `import type`, placed where the first of them was, together with any import of that
 *   entry already in the module. A value import left with only inline types becomes `import type`
 *   (`no-import-type-side-effects`). `export … from` re-exports are merged the same way.
 * - A `.tsl.ts` module is an asset (the generated code imports it by path): imports of one stay.
 * - Anything else that can't be expressed through an entry is an error and the module is left as
 *   it is: a name no entry exports, a name two entries export, a namespace, default, side-effect
 *   or dynamic import, an `export *`.
 */
import ts from 'typescript';
import { buildImportGraph, resolveSpecifier, type ResolveOptions } from './importGraph';

export type EntryImportsInput = {
  /** Every module the imports can reach (repo-relative path → source) */
  sources: Map<string, string>;
  /** The modules to rewrite */
  files: string[];
  /** Entry alias → its file (`ENTRY_FILES`) */
  entries: Readonly<Record<string, string>>;
  exists: ResolveOptions['exists'];
};

export type EntryImportsResult = {
  /** Rewritten modules (path → new source, not formatted) */
  changed: Map<string, string>;
  /** `file:line message`; a module with an error isn't in `changed` */
  errors: string[];
};

type Spec = { imported: string; local: string; isType: boolean; isInline: boolean };
type Group = { entry: string; isExport: boolean; firstStart: number; specs: Spec[] };

/** `engine`, `toolkit/<category>` or `outside` */
const zoneOf = (file: string) => {
  if (file.startsWith('src/_engine/')) return 'engine';
  const m = /^src\/toolkit\/([^/]+)\//.exec(file);
  return m ? `toolkit/${m[1]}` : 'outside';
};

export const migrateToEntryImports = ({
  sources,
  files,
  entries,
  exists,
}: EntryImportsInput): EntryImportsResult => {
  const resolveOpts: ResolveOptions = { exists, aliases: entries };
  const graph = buildImportGraph(sources, resolveOpts);
  const entryOfFile = new Map(Object.entries(entries).map(([alias, file]) => [file, alias]));

  // Each declaration → the entries exporting it, under their exported name
  const byDecl = new Map<string, { entry: string; name: string }[]>();
  for (const [entry, file] of Object.entries(entries)) {
    for (const name of graph.allExports(file)) {
      const decl = graph.resolveExport(file, name);
      if (!decl) continue;
      const key = `${decl.file}#${decl.name}`;
      byDecl.set(key, [...(byDecl.get(key) ?? []), { entry, name }]);
    }
  }

  const changed = new Map<string, string>();
  const errors: string[] = [];

  for (const file of files) {
    const text = sources.get(file);
    if (text === undefined || zoneOf(file) === 'engine') continue;
    const fromZone = zoneOf(file);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const fileErrors: string[] = [];
    const fail = (node: ts.Node, msg: string) => fileErrors.push(`${file}:${lineOf(node)} ${msg}`);

    /** Whether an import of `spec` (resolved to `target`) must go through an entry */
    const needsEntry = (spec: string, target: string | null | undefined) => {
      if (!target) return false;
      const toZone = zoneOf(target);
      if (toZone === 'outside' || toZone === fromZone || target.endsWith('.tsl.ts')) return false;
      return !(entryOfFile.has(target) && entries[spec] === target);
    };

    const groups = new Map<string, Group>();
    const statements: ts.Statement[] = [];
    const addSpec = (key: string, entry: string, isExport: boolean, start: number, spec: Spec) => {
      const group = groups.get(key) ?? { entry, isExport, firstStart: start, specs: [] };
      groups.set(key, group);
      group.firstStart = Math.min(group.firstStart, start);
      group.specs.push(spec);
    };

    /** Maps one named element to its entry and the entry's name for it; null on an error */
    const mapName = (node: ts.Node, target: string, imported: string) => {
      if (entryOfFile.has(target)) return { entry: entryOfFile.get(target) as string, imported };
      const decl = graph.resolveExport(target, imported);
      const found = decl ? byDecl.get(`${decl.file}#${decl.name}`) : undefined;
      if (!found?.length) {
        fail(node, `\`${imported}\` (${target}) is in no entry`);
        return null;
      }
      if (found.length > 1) {
        const names = found.map((f) => f.entry).join(', ');
        fail(node, `\`${imported}\` (${target}) is in several entries: ${names}`);
        return null;
      }
      return { entry: found[0].entry, imported: found[0].name };
    };

    let hasDeep = false;
    for (const st of sf.statements) {
      const isImport = ts.isImportDeclaration(st);
      if (!isImport && !ts.isExportDeclaration(st)) continue;
      const specNode = st.moduleSpecifier;
      if (!specNode || !ts.isStringLiteral(specNode)) continue;
      const spec = specNode.text;
      const target = resolveSpecifier(file, spec, resolveOpts);
      const isEntryAlias = entries[spec] !== undefined;
      if (!isEntryAlias && !needsEntry(spec, target)) continue;
      if (!target) {
        fail(st, `${spec} doesn't resolve to a file`);
        continue;
      }
      if (!isEntryAlias) hasDeep = true;
      const resolved = target;
      const start = st.getStart(sf);
      const isExport = !isImport;

      let named: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier> | undefined;
      let isTypeOnly = false;
      if (isImport) {
        const clause = st.importClause;
        if (!clause) {
          fail(st, `side-effect import of ${spec}: no entry can express it`);
          continue;
        }
        if (clause.name || (clause.namedBindings && !ts.isNamedImports(clause.namedBindings))) {
          fail(st, `default or namespace import of ${spec}: import the names from an entry`);
          continue;
        }
        named = (clause.namedBindings as ts.NamedImports | undefined)?.elements;
        isTypeOnly = clause.isTypeOnly;
      } else {
        if (!st.exportClause || !ts.isNamedExports(st.exportClause)) {
          fail(st, `\`export *\` from ${spec}: re-export the names from an entry`);
          continue;
        }
        named = st.exportClause.elements;
        isTypeOnly = st.isTypeOnly;
      }
      statements.push(st);
      for (const el of named ?? []) {
        const imported = (el.propertyName ?? el.name).text;
        const mapped = mapName(el, resolved, imported);
        if (!mapped) continue;
        const key = `${isExport ? 'export' : 'import'} ${mapped.entry}`;
        addSpec(key, mapped.entry, isExport, start, {
          imported: mapped.imported,
          local: el.name.text,
          isType: isTypeOnly || el.isTypeOnly,
          isInline: !isTypeOnly && el.isTypeOnly,
        });
      }
    }

    // Dynamic imports into the engine or another toolkit category
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const spec = node.arguments[0].text;
        if (needsEntry(spec, resolveSpecifier(file, spec, resolveOpts))) {
          fail(node, `dynamic import of ${spec}: import the names from an entry`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (fileErrors.length) {
      errors.push(...fileErrors);
      continue;
    }
    if (!hasDeep) continue;

    // Each group's statements, at its first statement; the other statements go
    const out: { start: number; end: number; text: string }[] = [];
    const written = new Set<string>();
    for (const node of statements) {
      const start = node.getStart(sf);
      let end = node.getEnd();
      const here = [...groups.entries()].filter(
        ([key, g]) => g.firstStart === start && !written.has(key)
      );
      if (here.length) {
        here.forEach(([key]) => written.add(key));
        const text = here.map(([, g]) => renderGroup(g)).join('\n');
        out.push({ start, end, text });
      } else {
        if (text[end] === '\n') end++;
        out.push({ start, end, text: '' });
      }
    }
    let next = text;
    for (const edit of out.sort((a, b) => b.start - a.start)) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    // The last statement removed leaves the newline before it
    if (!text.endsWith('\n')) next = next.replace(/\n+$/, '');
    if (next !== text) changed.set(file, next);
  }

  return { changed, errors };
};

const specText = (s: Spec, inline: boolean) =>
  `${inline && s.isType ? 'type ' : ''}${s.imported === s.local ? s.local : `${s.imported} as ${s.local}`}`;

/** A group's value statement and type statement; a name imported twice keeps its value import */
const renderGroup = ({ entry, isExport, specs }: Group) => {
  const unique = new Map<string, Spec>();
  for (const s of specs) {
    const key = `${s.imported}>${s.local}`;
    const seen = unique.get(key);
    if (!seen || (seen.isType && !s.isType)) unique.set(key, s);
  }
  const all = [...unique.values()];
  const hasValue = all.some((s) => !s.isType);
  const valueSpecs = all.filter((s) => !s.isType || (s.isInline && hasValue));
  const typeSpecs = all.filter((s) => !valueSpecs.includes(s));
  const kw = isExport ? 'export' : 'import';
  const lines: string[] = [];
  if (valueSpecs.length) {
    lines.push(`${kw} { ${valueSpecs.map((s) => specText(s, true)).join(', ')} } from '${entry}';`);
  }
  if (typeSpecs.length) {
    lines.push(
      `${kw} type { ${typeSpecs.map((s) => specText(s, false)).join(', ')} } from '${entry}';`
    );
  }
  return lines.join('\n');
};
