/**
 * Splitting a module per export (p608 §4.4), without the file system: each top-level statement
 * goes to the target of the export it declares, with its leading comments and JSDoc.
 *
 * - A target gets the split module's imports its statements use and imports of the other parts it
 *   uses, nothing else; a binding it uses only as a type is an `import type` (the lint's
 *   `consistent-type-imports`). Uses are read with a type checker on the module alone, so a
 *   parameter or a property named like an import isn't one.
 * - A re-export goes to its names' targets, and is dropped where it names the target itself
 *   (`helpers.ts`' `export { isOnlyObject3D } from './object3DHelpers'`).
 * - A target that's also a moved file's path, another split's target or the split file's own path
 *   in another case gets the parts after its own code, in the order of the map's splits and the
 *   statements' order, with the imports merged and deduplicated.
 * - Errors: a statement that exports nothing (an import aside), an export without a target, a name
 *   two parts of one target declare or bind, and a part that imports itself in a cycle the tree
 *   before the move didn't have (runtime imports only: a type import emits nothing).
 */
import path from 'path';
import ts from 'typescript';
import { parseModuleSource, resolveSpecifier } from './importGraph';
import { moveSpecifier, toSpecifier, type PathMap } from './moveApply';

const posix = path.posix;

/** One name a target imports: from a file after the move (its path) or a package (its name) */
type Binding = {
  module: string;
  /** How it's written from the target */
  spec: string;
  /** `*` for a namespace, `default`, or the imported name */
  imported: string;
  local: string;
  isType: boolean;
  /** Where it's written among a target's imports: the split files' imports in their order, then the parts' */
  order: number;
};

/** A top-level statement of a split module, as one target's part */
type Part = {
  source: string;
  /** Its statement's index in the source */
  index: number;
  /** What separates it from the statement before it in the source: a line break or a blank line */
  lead: '\n' | '\n\n';
  target: string;
  /** The names it declares */
  names: string[];
  text: string;
  bindings: Binding[];
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((m) => m.kind === kind);

const declaredNames = (name: ts.BindingName, out: ts.Identifier[]) => {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) declaredNames(el.name, out);
};

/** The names a top-level declaration exports; `null` when it exports nothing */
const exportedNames = (st: ts.Statement): ts.Identifier[] | null => {
  if (!hasModifier(st, ts.SyntaxKind.ExportKeyword)) return null;
  if (hasModifier(st, ts.SyntaxKind.DefaultKeyword)) return null;
  if (ts.isVariableStatement(st)) {
    const out: ts.Identifier[] = [];
    for (const decl of st.declarationList.declarations) declaredNames(decl.name, out);
    return out;
  }
  if (
    (ts.isFunctionDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isInterfaceDeclaration(st) ||
      ts.isTypeAliasDeclaration(st) ||
      ts.isEnumDeclaration(st)) &&
    st.name
  ) {
    return [st.name];
  }
  return null;
};

/** A program of the module alone, for its checker: what each identifier refers to */
const checkModule = (text: string) => {
  const fileName = '/split.ts';
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sf : undefined),
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => name === fileName,
    readFile: () => undefined,
  };
  const program = ts.createProgram([fileName], { noLib: true, noResolve: true }, host);
  return { sf, checker: program.getTypeChecker() };
};

/** A use in a type only: an `import type` binding may serve it (`typeof x` included) */
const isTypePosition = (node: ts.Node, statement: ts.Node) => {
  for (let n = node.parent; n && n !== statement; n = n.parent) {
    if (ts.isExpressionWithTypeArguments(n)) {
      const clause = n.parent;
      return !(
        ts.isHeritageClause(clause) &&
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        ts.isClassLike(clause.parent)
      );
    }
    if (ts.isTypeNode(n)) return true;
  }
  return false;
};

/**
 * Where each statement's text starts and ends: a statement takes the comments above it, and a
 * comment after it on its line
 */
const statementSpans = (sf: ts.SourceFile, text: string): [number, number][] => {
  let start = 0;
  return sf.statements.map((st) => {
    const trailing = ts.getTrailingCommentRanges(text, st.getEnd()) ?? [];
    const end = trailing.length ? trailing[trailing.length - 1].end : st.getEnd();
    const span: [number, number] = [start, end];
    start = end;
    return span;
  });
};

/** A statement's text without the blank lines above it, and whether it had one */
const partText = (text: string, [start, end]: [number, number]) => {
  const chunk = text.slice(start, end);
  const blank = /^\s*\n/.exec(chunk)?.[0] ?? '';
  const lead: Part['lead'] = (blank.match(/\n/g) ?? []).length > 1 ? '\n\n' : '\n';
  return { text: chunk.slice(blank.length), lead };
};

type SourceAnalysis = { parts: Part[]; errors: string[] };

/** `Binding.order`: per split file, its imports (and their names), then the parts it imports */
const ORDER_SOURCE = 1e9;
const ORDER_IMPORT = 1e4;
const ORDER_PARTS = ORDER_SOURCE / 2;

/** One split module's statements as parts, with the bindings each one needs */
const analyzeSource = (
  map: PathMap,
  source: string,
  text: string,
  sourceIndex: number
): SourceAnalysis => {
  const split = map.splits.get(source) as Readonly<Record<string, string>>;
  const { sf, checker } = checkModule(text);
  const errors: string[] = [];
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const fail = (node: ts.Node, message: string) =>
    errors.push(`${source}:${lineOf(node)} ${message}`);
  const spans = statementSpans(sf, text);
  const tail = text.slice(spans.length ? spans[spans.length - 1][1] : 0);
  if (tail.trim()) errors.push(`${source}: text after the last statement goes with no export`);

  /** An import binding's declaration node → its import, the name it takes, `import type` or not */
  const importOf = new Map<
    ts.Node,
    { decl: ts.ImportDeclaration; imported: string; isTypeOnly: boolean; order: number }
  >();
  /** A declared name's declaration node → its statement */
  const statementOf = new Map<ts.Node, number>();
  const namesOf: string[][] = [];
  const exported = new Set<string>();

  sf.statements.forEach((st, i) => {
    namesOf.push([]);
    if (ts.isImportDeclaration(st)) {
      const leading = text.slice(spans[i][0], st.getStart(sf)).trim();
      if (leading) fail(st, 'a comment above an import goes with no export: move it');
      const clause = st.importClause;
      if (!clause) fail(st, 'a side-effect import goes with no export');
      const isTypeOnly = !!clause?.isTypeOnly;
      const order = ORDER_SOURCE * sourceIndex + ORDER_IMPORT * i;
      if (clause?.name) importOf.set(clause, { decl: st, imported: 'default', isTypeOnly, order });
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) {
        importOf.set(nb, { decl: st, imported: '*', isTypeOnly, order });
      } else if (nb) {
        nb.elements.forEach((el, k) => {
          const imported = (el.propertyName ?? el.name).text;
          importOf.set(el, {
            decl: st,
            imported,
            isTypeOnly: isTypeOnly || el.isTypeOnly,
            order: order + k + 1,
          });
        });
      }
      return;
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
      if (!st.exportClause || !ts.isNamedExports(st.exportClause)) {
        fail(st, '`export *` goes with no export: re-export its names');
      } else {
        for (const el of st.exportClause.elements) {
          namesOf[i].push(el.name.text);
          exported.add(el.name.text);
        }
      }
      return;
    }
    if (ts.isExportAssignment(st) || hasModifier(st, ts.SyntaxKind.DefaultKeyword)) {
      fail(st, 'a default export has no name to split by');
      return;
    }
    const names = exportedNames(st);
    if (!names) {
      fail(st, 'a statement that exports nothing goes with no export');
      return;
    }
    for (const id of names) {
      statementOf.set(id.parent, i);
      namesOf[i].push(id.text);
      exported.add(id.text);
    }
  });
  for (const name of exported) {
    if (!split[name]) errors.push(`${source}: ${name} has no target in the split`);
  }
  for (const name of Object.keys(split)) {
    if (!exported.has(name)) {
      errors.push(`${source}: the split names ${name}, which isn't exported`);
    }
  }
  if (errors.length) return { parts: [], errors };

  /**
   * Where a name the module imports or re-exports lands after the move, and how `target` writes
   * its module; `null` when it lands in `target` itself, `undefined` on an error
   */
  const located = new Map<string, { module: string; spec: string } | null | undefined>();
  const locate = (node: ts.Node, literal: ts.StringLiteral, imported: string, target: string) => {
    const spec = literal.text;
    const key = [spec, imported, target].join('\0');
    if (located.has(key)) return located.get(key);
    let result: { module: string; spec: string } | null | undefined;
    const oldFile = spec.startsWith('.')
      ? resolveSpecifier(source, spec, { exists: (f) => map.oldFiles.has(f) })
      : null;
    const otherSplit = oldFile ? map.splits.get(oldFile) : undefined;
    const module =
      oldFile === null
        ? spec
        : otherSplit
          ? otherSplit[imported]
          : oldFile && map.newPathOf(oldFile);
    if (oldFile === undefined) fail(node, `'${spec}' names no file`);
    else if (!module) {
      fail(node, `'${spec}': ${imported} ${otherSplit ? 'has no target' : 'is deleted'}`);
    } else if (module === target) result = null;
    else if (oldFile === null) result = { module, spec };
    else {
      const moved = moveSpecifier(map, source, spec, module, target);
      if (moved.error) fail(node, moved.error);
      else result = { module, spec: moved.spec ?? spec };
    }
    located.set(key, result);
    return result;
  };

  /** A re-export, per its names' targets; dropped where it names the target itself */
  const reexportParts = (st: ts.ExportDeclaration, i: number): Part[] => {
    const literal = st.moduleSpecifier as ts.StringLiteral;
    const groups = new Map<string, { target: string; spec: string; els: ts.ExportSpecifier[] }>();
    for (const el of (st.exportClause as ts.NamedExports).elements) {
      const target = split[el.name.text];
      const imported = (el.propertyName ?? el.name).text;
      const where = locate(el, literal, imported, target);
      if (where === null && imported !== el.name.text) {
        fail(el, `${el.name.text} renames ${imported} in its own module`);
      }
      if (!where) continue;
      const key = `${target}\0${where.module}`;
      const group = groups.get(key) ?? { target, spec: where.spec, els: [] };
      group.els.push(el);
      groups.set(key, group);
    }
    const keyword = `export${st.isTypeOnly ? ' type' : ''}`;
    const quote = text[literal.getStart(sf)];
    const { lead } = partText(text, spans[i]);
    const leading = partText(text, [spans[i][0], st.getStart(sf)]).text;
    return [...groups.values()].map(({ target, spec, els }, g) => ({
      source,
      index: i,
      lead,
      target,
      names: els.map((el) => el.name.text),
      text: `${g ? '' : leading}${keyword} { ${els.map((el) => el.getText(sf)).join(', ')} } from ${quote}${spec}${quote};`,
      bindings: [],
    }));
  };

  /** The imports and the other parts' names a statement uses, each a type only or not */
  const bindingsOf = (st: ts.Statement, i: number, target: string): Binding[] => {
    const uses = new Map<string, Binding>();
    const use = (id: ts.Node, symbol: ts.Symbol | undefined) => {
      const decl = symbol?.declarations?.[0];
      if (!decl) return;
      const imp = importOf.get(decl);
      const at = statementOf.get(decl);
      let binding: Omit<Binding, 'isType' | 'order'> | undefined;
      let order = 0;
      let isType = isTypePosition(id, st);
      if (imp) {
        const where = locate(
          imp.decl,
          imp.decl.moduleSpecifier as ts.StringLiteral,
          imp.imported,
          target
        );
        if (where === null && imp.imported !== symbol.name && imp.imported !== '*') {
          fail(id, `${symbol.name} renames ${imp.imported}, which ${target} declares`);
        }
        if (where) binding = { ...where, imported: imp.imported, local: symbol.name };
        isType ||= imp.isTypeOnly;
        order = imp.order;
      } else if (at !== undefined && at !== i && split[symbol.name] !== target) {
        const module = split[symbol.name];
        const spec = toSpecifier(posix.dirname(target), module.replace(/\.ts$/, ''));
        binding = { module, spec, imported: symbol.name, local: symbol.name };
        order = ORDER_SOURCE * sourceIndex + ORDER_PARTS + at;
      }
      if (!binding) return;
      const prior = uses.get(binding.local);
      uses.set(binding.local, { ...binding, isType: (prior?.isType ?? true) && isType, order });
    };
    const visit = (node: ts.Node) => {
      if (ts.isShorthandPropertyAssignment(node)) {
        use(node.name, checker.getShorthandAssignmentValueSymbol(node));
      } else if (ts.isIdentifier(node)) {
        use(node, checker.getSymbolAtLocation(node));
      }
      ts.forEachChild(node, visit);
    };
    visit(st);
    return [...uses.values()];
  };

  const parts: Part[] = [];
  sf.statements.forEach((st, i) => {
    if (ts.isImportDeclaration(st)) return;
    if (ts.isExportDeclaration(st)) {
      parts.push(...reexportParts(st, i));
      return;
    }
    const target = split[namesOf[i][0]];
    if (namesOf[i].some((name) => split[name] !== target)) {
      fail(st, `one statement declares ${namesOf[i].join(', ')}, whose targets differ`);
      return;
    }
    const bindings = bindingsOf(st, i, target);
    parts.push({
      source,
      index: i,
      target,
      names: namesOf[i],
      ...partText(text, spans[i]),
      bindings,
    });
  });
  return { parts, errors };
};

// A target's text

type ImportLine = { module: string; spec: string; kind: 'named' | 'namespace' | 'default' };

/** A binding as an import's name (`a`, `a as b`) */
const elementText = (b: Binding) =>
  b.imported === b.local ? b.local : `${b.imported} as ${b.local}`;

const writeImports = (bindings: Binding[]) => {
  const groups = new Map<string, { line: ImportLine; isType: boolean; els: string[] }>();
  for (const b of bindings) {
    const kind = b.imported === '*' ? 'namespace' : b.imported === 'default' ? 'default' : 'named';
    const key = [b.module, kind, b.isType, kind === 'named' ? '' : b.local].join('\0');
    const group = groups.get(key) ?? {
      line: { module: b.module, spec: b.spec, kind },
      isType: b.isType,
      els: [],
    };
    group.els.push(kind === 'named' ? elementText(b) : b.local);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ line, isType, els }) => {
    const what =
      line.kind === 'named'
        ? `{ ${els.join(', ')} }`
        : line.kind === 'namespace'
          ? `* as ${els[0]}`
          : els[0];
    return `import ${isType ? 'type ' : ''}${what} from '${line.spec}';`;
  });
};

type Edit = { start: number; end: number; text: string };

/**
 * The bindings a target file already has, merged with the parts' (§4.4): the same binding is
 * deduplicated (a type-only namespace or default import becomes a value one when a part needs
 * that), a named one joins an import of its module and kind, and the rest are new lines after the
 * file's imports. A name bound or declared twice is an error.
 */
const mergeIntoFile = (
  map: PathMap,
  target: string,
  text: string,
  bindings: Binding[],
  declared: string[],
  fail: (message: string) => void
): { text: string; lines: Binding[]; insertAt: number } => {
  const sf = ts.createSourceFile(target, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Edit[] = [];
  /** Each import's file after the move (or package) */
  const moduleOf = new Map<ts.ImportDeclaration, string>();
  const existing = new Map<string, { imported: string; decl: ts.ImportDeclaration }>();
  const topLevel = new Set<string>();
  let insertAt = 0;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      insertAt = st.getEnd();
      const spec = st.moduleSpecifier.text;
      const module = spec.startsWith('.')
        ? resolveSpecifier(target, spec, { exists: (f) => map.newFiles.has(f) }) ?? spec
        : spec;
      if (module === target) fail(`${target} imports itself after the split ('${spec}')`);
      moduleOf.set(st, module);
      const clause = st.importClause;
      if (clause?.name) existing.set(clause.name.text, { imported: 'default', decl: st });
      const nb = clause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) existing.set(nb.name.text, { imported: '*', decl: st });
      else if (nb) {
        for (const el of nb.elements) {
          existing.set(el.name.text, { imported: (el.propertyName ?? el.name).text, decl: st });
        }
      }
    } else if (ts.isVariableStatement(st)) {
      const ids: ts.Identifier[] = [];
      for (const decl of st.declarationList.declarations) declaredNames(decl.name, ids);
      for (const id of ids) topLevel.add(id.text);
    } else if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isInterfaceDeclaration(st) ||
        ts.isTypeAliasDeclaration(st) ||
        ts.isEnumDeclaration(st)) &&
      st.name
    ) {
      topLevel.add(st.name.text);
    }
  }
  for (const name of declared) {
    if (topLevel.has(name) || existing.has(name)) fail(`${target} already has ${name}`);
  }

  const lines: Binding[] = [];
  for (const b of bindings) {
    const prior = existing.get(b.local);
    if (topLevel.has(b.local)) {
      fail(`${target} declares ${b.local}, which a part imports`);
    } else if (prior) {
      if (moduleOf.get(prior.decl) !== b.module || prior.imported !== b.imported) {
        fail(`${target} binds ${b.local} to ${moduleOf.get(prior.decl)}, a part to ${b.module}`);
      } else if (prior.decl.importClause?.isTypeOnly && !b.isType) {
        if (prior.imported === '*' || prior.imported === 'default') {
          const start = prior.decl.getStart(sf);
          edits.push({ start, end: start + 'import type'.length, text: 'import' });
        } else fail(`${target} imports ${b.local} as a type, a part as a value: merge by hand`);
      }
    } else {
      // A named binding joins an import of its module and kind
      const into = [...moduleOf].find(
        ([decl, module]) =>
          module === b.module &&
          b.imported !== '*' &&
          b.imported !== 'default' &&
          !!decl.importClause?.namedBindings &&
          ts.isNamedImports(decl.importClause.namedBindings) &&
          !!decl.importClause.isTypeOnly === b.isType
      )?.[0];
      if (into) {
        const named = (into.importClause as ts.ImportClause).namedBindings as ts.NamedImports;
        const at = named.elements.end;
        edits.push({ start: at, end: at, text: `, ${elementText(b)}` });
      } else lines.push(b);
    }
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    if (edit.start < insertAt) insertAt += edit.text.length - (edit.end - edit.start);
  }
  return { text: out, lines, insertAt };
};

/** One target's bindings: deduplicated, a value where any part uses it as one */
const collectBindings = (parts: Part[], fail: (message: string) => void) => {
  const byLocal = new Map<string, Binding>();
  for (const part of parts) {
    for (const b of part.bindings) {
      const prior = byLocal.get(b.local);
      if (!prior) byLocal.set(b.local, { ...b });
      else if (prior.module !== b.module || prior.imported !== b.imported) {
        fail(`${part.target}: ${b.local} is ${prior.module}'s and ${b.module}'s`);
      } else {
        prior.isType &&= b.isType;
        prior.order = Math.min(prior.order, b.order);
      }
    }
  }
  return [...byLocal.values()].sort((a, b) => a.order - b.order);
};

// The cycle check

/** Strongly connected components (Tarjan), each node's component index */
const components = (graph: Map<string, Set<string>>) => {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out = new Map<string, number>();
  let next = 0;
  let count = 0;
  const visit = (node: string) => {
    index.set(node, next);
    low.set(node, next++);
    stack.push(node);
    onStack.add(node);
    for (const to of graph.get(node) ?? []) {
      if (!index.has(to)) {
        visit(to);
        low.set(node, Math.min(low.get(node) as number, low.get(to) as number));
      } else if (onStack.has(to)) {
        low.set(node, Math.min(low.get(node) as number, index.get(to) as number));
      }
    }
    if (low.get(node) === index.get(node)) {
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        out.set(member, count);
      } while (member !== node);
      count++;
    }
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return out;
};

const addEdge = (graph: Map<string, Set<string>>, from: string, to: string) => {
  if (!graph.has(from)) graph.set(from, new Set());
  graph.get(from)?.add(to);
};

/** The runtime import graph before the move: a type import and an `import()` emit no edge */
const runtimeGraph = (map: PathMap, texts: ReadonlyMap<string, string>) => {
  const graph = new Map<string, Set<string>>();
  const edges: { from: string; to: string; names: string[] }[] = [];
  for (const [file, text] of texts) {
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    for (const imp of parseModuleSource(file, text).imports) {
      if (imp.kind !== 'runtime' || !imp.specifier.startsWith('.')) continue;
      const to = resolveSpecifier(file, imp.specifier, { exists: (f) => map.oldFiles.has(f) });
      if (!to) continue;
      addEdge(graph, file, to);
      edges.push({ from: file, to, names: imp.names });
    }
  }
  return { graph, edges };
};

/**
 * The parts' new import cycles: the runtime graph after the move, each split file's edges replaced
 * by its parts', and every cycle through a target checked against the graph before the move
 */
const findNewCycles = (
  map: PathMap,
  texts: ReadonlyMap<string, string>,
  targets: Map<string, Binding[]>
) => {
  const before = runtimeGraph(map, texts);
  const after = new Map<string, Set<string>>();
  for (const { from, to, names } of before.edges) {
    const newFrom = map.newPathOf(from);
    if (!newFrom) continue; // a split file's edges are its parts'
    const split = map.splits.get(to);
    const tos = split
      ? names.includes('*')
        ? Object.values(split)
        : names.map((n) => split[n]).filter(Boolean)
      : [map.newPathOf(to)];
    for (const t of tos) if (t) addEdge(after, newFrom, t);
  }
  for (const [target, bindings] of targets) {
    for (const b of bindings)
      if (!b.isType && map.newFiles.has(b.module)) addEdge(after, target, b.module);
  }

  const origins = (file: string) => {
    const out: string[] = [];
    const old = map.oldPathOf(file);
    if (old && map.newPathOf(old) === file) out.push(old);
    for (const [source, split] of map.splits) {
      if (Object.values(split).includes(file)) out.push(source);
    }
    return out;
  };
  const beforeOf = components(before.graph);
  const afterOf = components(after);
  const members = new Map<number, string[]>();
  for (const [node, c] of afterOf) members.set(c, [...(members.get(c) ?? []), node]);
  const errors: string[] = [];
  for (const nodes of members.values()) {
    const isCycle = nodes.length > 1 || !!after.get(nodes[0])?.has(nodes[0]);
    if (!isCycle || !nodes.some((n) => targets.has(n))) continue;
    const old = new Set(nodes.flatMap(origins));
    const oldComponents = new Set([...old].map((f) => beforeOf.get(f) ?? f));
    const wasCycle = old.size > 1 && oldComponents.size === 1;
    if (!wasCycle) errors.push(`the split makes a new import cycle: ${nodes.sort().join(' → ')}`);
  }
  return errors;
};

// Splitting

export type SplitResult = {
  /**
   * Each target's text by its path after the move: a new module, or a moved file's text (`current`'s)
   * with the parts after its own code
   */
  targets: Map<string, string>;
  errors: string[];
};

export type SplitInput = {
  /** Every text of the tree before the move, by its path (the cycle check's graph) */
  texts: ReadonlyMap<string, string>;
  /** A split file's text to split: its comments already rewritten for the move */
  sourceText: (file: string) => string;
  /** A moved file's text after the rewrite, by its path before the move */
  current: (file: string) => string;
};

/** Splits every split file of a path map into its targets (§4.4); on an error, no target */
export const splitModules = (
  map: PathMap,
  { texts, sourceText, current }: SplitInput
): SplitResult => {
  const errors: string[] = [];
  const byTarget = new Map<string, Part[]>();
  for (const [i, source] of [...map.splits.keys()].entries()) {
    const analysis = analyzeSource(map, source, sourceText(source), i);
    errors.push(...analysis.errors);
    for (const part of analysis.parts) {
      byTarget.set(part.target, [...(byTarget.get(part.target) ?? []), part]);
    }
  }
  if (errors.length) return { targets: new Map(), errors };

  const targets = new Map<string, string>();
  const bindingsOf = new Map<string, Binding[]>();
  for (const [target, parts] of byTarget) {
    const fail = (message: string) => errors.push(message);
    const declared = parts.flatMap((p) => p.names);
    const twice = declared.filter((name, i) => declared.indexOf(name) !== i);
    if (twice.length) fail(`${target}: two parts declare ${[...new Set(twice)].join(', ')}`);
    const bindings = collectBindings(parts, fail);
    bindingsOf.set(target, bindings);
    // Neighbours in their source keep what separated them there
    const body = parts
      .map((p, k) => {
        const prior = parts[k - 1];
        const isNext = prior?.source === p.source && prior.index === p.index - 1;
        return (k ? (isNext ? p.lead : '\n\n') : '') + p.text.trimEnd();
      })
      .join('');
    const owner = map.oldPathOf(target);
    if (owner && map.newPathOf(owner) === target) {
      const merged = mergeIntoFile(map, target, current(owner), bindings, declared, fail);
      const head = merged.text.slice(0, merged.insertAt);
      const imports = writeImports(merged.lines);
      const rest = merged.text.slice(merged.insertAt).trimEnd();
      const withImports = imports.length
        ? merged.insertAt
          ? `${head}\n${imports.join('\n')}${rest}`
          : `${imports.join('\n')}\n\n${rest.replace(/^\s*\n/, '')}`
        : merged.text.trimEnd();
      targets.set(target, `${withImports}\n\n${body}\n`);
    } else {
      const imports = writeImports(bindings);
      targets.set(target, `${imports.length ? `${imports.join('\n')}\n\n` : ''}${body}\n`);
    }
  }
  // A part that resolves nothing has nothing to check yet
  if (!errors.length) errors.push(...findNewCycles(map, texts, bindingsOf));
  return errors.length ? { targets: new Map(), errors } : { targets, errors };
};
