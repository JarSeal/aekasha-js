/**
 * The engine 6.0.0 codemod (p622 D10): the logic of `migrateEngine6.ts`, without the file system.
 *
 * - It runs on a `ts.Program` (`createMigrationProgram`: the CLI's from the repo's `tsconfig.json`
 *   on disk, a test's from virtual modules), so every reference is the checker's: a rename never
 *   touches a local or a property that only shares the name. Code that no longer compiles against
 *   the new engine is fine: an import of a removed name still binds in its module.
 * - Kinds 1-2 (`ImportRule`): a name imported by name from an entry becomes its new name in the
 *   import and in every reference (an aliased import keeps its local name), or moves to its new
 *   entry's import; when the module imports the new name already, the two merge. A namespace
 *   import's `ns.Old` and an `import('entry').Old` type are renamed too (a move through a
 *   namespace import is an error), and `export { Old } from` keeps the module's exported name
 *   (`export { New as Old } from`). A dynamic `import()` of an entry isn't followed.
 * - A touched import is written again whole, in the repo's style (a value import left with only
 *   inline types becomes `import type`); the CLI formats the module with Prettier.
 * - Kind 4, the reports (what needs a person), each from the checker's symbols: an import of a
 *   name an entry no longer exports (`RemovedImportRule`), a member an entry's type lost, read or
 *   written in an object literal of that contextual type (`RemovedMemberRule`), and an argument of
 *   an entry's function (`CallArgRule`, which also rewrites a renamed string option). An entry's
 *   exports are found through any module of the program that imports it.
 * - A module with an error is left as it was, and every error is listed: a renamed reference that
 *   would resolve to another declaration (shadowed, or a name the module declares itself), two
 *   edits on the same code.
 */
import path from 'path';
import ts from 'typescript';
import type {
  CallArgRule,
  Engine6Rule,
  EntryName,
  ImportRule,
  RemovedImportRule,
  RemovedMemberRule,
} from './engine6Rules';

/** An error or a report: where, what, and the migration page's anchor */
export type MigrationFinding = {
  /** The module, as the program names it */
  file: string;
  line: number;
  message: string;
  anchor?: string;
};

export type Engine6Input = {
  program: ts.Program;
  /** The modules to migrate, as the program names them */
  files: readonly string[];
  rules: readonly Engine6Rule[];
};

export type Engine6Result = {
  /** Migrated modules (file → new text, not formatted) */
  changed: Map<string, string>;
  /** A module with an error isn't in `changed` */
  errors: MigrationFinding[];
  /** What needs a person */
  reports: MigrationFinding[];
};

export type MigrationProgramInput = {
  rootNames: readonly string[];
  options: ts.CompilerOptions;
  /** Modules served instead of the files (absolute file name → source): a test's fixtures */
  texts?: ReadonlyMap<string, string>;
  /** Reads everything else (`ts.createCompilerHost(options)`) */
  baseHost: ts.CompilerHost;
};

/** A program over `texts` and the files `baseHost` reads */
export const createMigrationProgram = ({
  rootNames,
  options,
  texts = new Map(),
  baseHost,
}: MigrationProgramInput) => {
  const virtual = new Map([...texts].map(([file, text]) => [path.normalize(file), text]));
  const dirs = new Set<string>();
  for (const file of virtual.keys()) {
    for (let dir = path.dirname(file); !dirs.has(dir); dir = path.dirname(dir)) {
      dirs.add(dir);
      if (dir === path.dirname(dir)) break;
    }
  }
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (fileName, languageVersion, ...rest) => {
      const text = virtual.get(path.normalize(fileName));
      return text === undefined
        ? baseHost.getSourceFile(fileName, languageVersion, ...rest)
        : ts.createSourceFile(fileName, text, languageVersion, true);
    },
    fileExists: (fileName) =>
      virtual.has(path.normalize(fileName)) || baseHost.fileExists(fileName),
    readFile: (fileName) => virtual.get(path.normalize(fileName)) ?? baseHost.readFile(fileName),
    // The module resolution skips a folder that doesn't exist: the fixtures' folders do
    directoryExists: (dir) =>
      dirs.has(path.normalize(dir)) || (baseHost.directoryExists?.(dir) ?? true),
  };
  return ts.createProgram({ rootNames, options, host });
};

/** One name of a modelled import or `export … from` */
type Spec = {
  /** The source's element; none for one a rule added */
  el: ts.ImportSpecifier | ts.ExportSpecifier | null;
  imported: string;
  /** The local name (an `export … from`'s exported name) */
  local: string;
  isType: boolean;
  isRemoved: boolean;
};

/** An import with named bindings, or a named `export … from`, and its names as the rules leave them */
type Decl = {
  node: ts.ImportDeclaration | ts.ExportDeclaration | null;
  /** Where a declaration a rule added goes: after this one */
  after: Decl | null;
  entry: string;
  isExport: boolean;
  isTypeOnly: boolean;
  specs: Spec[];
  isTouched: boolean;
};

type Edit = { start: number; end: number; text: string };

/** A module's state while the rules run on it */
type ModuleState = {
  file: string;
  sf: ts.SourceFile;
  checker: ts.TypeChecker;
  decls: Decl[];
  /** Namespace imports: entry → the namespace's symbols */
  namespaces: Map<string, ts.Symbol[]>;
  /** An imported binding's symbol → its new local name */
  renames: Map<ts.Symbol, string>;
  edits: Edit[];
  /** An error at a node or a position */
  error: (at: ts.Node | number, message: string) => void;
  /** A report at a node */
  report: (at: ts.Node, message: string, anchor: string) => void;
};

const specText = (s: Spec, isInline: boolean) =>
  `${isInline && s.isType ? 'type ' : ''}${s.imported === s.local ? s.local : `${s.imported} as ${s.local}`}`;

/** A declaration as text; empty when none of its names is left */
const renderDecl = (d: Decl) => {
  const live = d.specs.filter((s) => !s.isRemoved);
  if (!live.length) return '';
  const isTypeOnly = d.isTypeOnly || live.every((s) => s.isType);
  const names = live.map((s) => specText(s, !isTypeOnly)).join(', ');
  const quoted = d.node ? d.node.moduleSpecifier?.getText() : `'${d.entry}'`;
  return `${d.isExport ? 'export' : 'import'} ${isTypeOnly ? 'type ' : ''}{ ${names} } from ${quoted};`;
};

const readModule = (
  file: string,
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
  error: ModuleState['error'],
  report: ModuleState['report']
): ModuleState => {
  const decls: Decl[] = [];
  const namespaces = new Map<string, ts.Symbol[]>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause;
      const bindings = clause?.namedBindings;
      if (!clause || !bindings) continue;
      const entry = st.moduleSpecifier.text;
      if (ts.isNamespaceImport(bindings)) {
        const symbol = checker.getSymbolAtLocation(bindings.name);
        if (symbol) namespaces.set(entry, [...(namespaces.get(entry) ?? []), symbol]);
        continue;
      }
      // A default binding stays as written (no entry has a default export)
      if (clause.name) continue;
      decls.push({
        node: st,
        after: null,
        entry,
        isExport: false,
        isTypeOnly: clause.isTypeOnly,
        specs: bindings.elements.map((el) => ({
          el,
          imported: (el.propertyName ?? el.name).text,
          local: el.name.text,
          isType: clause.isTypeOnly || el.isTypeOnly,
          isRemoved: false,
        })),
        isTouched: false,
      });
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.exportClause &&
      ts.isNamedExports(st.exportClause)
    ) {
      decls.push({
        node: st,
        after: null,
        entry: st.moduleSpecifier.text,
        isExport: true,
        isTypeOnly: st.isTypeOnly,
        specs: st.exportClause.elements.map((el) => ({
          el,
          imported: (el.propertyName ?? el.name).text,
          local: el.name.text,
          isType: st.isTypeOnly || el.isTypeOnly,
          isRemoved: false,
        })),
        isTouched: false,
      });
    }
  }
  return { file, sf, checker, decls, namespaces, renames: new Map(), edits: [], error, report };
};

const symbolOf = (m: ModuleState, s: Spec) =>
  s.el ? m.checker.getSymbolAtLocation(s.el.name) : undefined;

/** Adds a name to the module's import (or `export … from`) of an entry, or to a new one after `near` */
const addSpec = (m: ModuleState, entry: string, isExport: boolean, spec: Spec, near: Decl) => {
  const fits = (d: Decl) =>
    d.entry === entry && d.isExport === isExport && (spec.isType || !d.isTypeOnly);
  const target =
    (spec.isType ? m.decls.find((d) => fits(d) && d.isTypeOnly) : undefined) ?? m.decls.find(fits);
  if (target) {
    target.specs.push(spec);
    target.isTouched = true;
    return;
  }
  const after = near.after ?? near;
  m.decls.push({
    node: null,
    after,
    entry,
    isExport,
    isTypeOnly: spec.isType,
    specs: [spec],
    isTouched: true,
  });
};

const applyImportRule = (m: ModuleState, rule: ImportRule) => {
  const { from, to } = rule;
  const isMove = from.entry !== to.entry;
  for (const d of [...m.decls]) {
    if (d.entry !== from.entry) continue;
    for (const s of d.specs.filter((x) => !x.isRemoved && x.imported === from.name)) {
      if (d.isExport) {
        // The module's own exported name stays
        if (isMove) {
          s.isRemoved = true;
          addSpec(m, to.entry, true, { ...s, el: null, isRemoved: false, imported: to.name }, d);
        } else s.imported = to.name;
        d.isTouched = true;
        continue;
      }
      const existing = m.decls
        .filter((e) => !e.isExport && e.entry === to.entry)
        .flatMap((e) => e.specs.map((spec) => ({ decl: e, spec })))
        .find(({ spec }) => spec !== s && !spec.isRemoved && spec.imported === to.name);
      const symbol = symbolOf(m, s);
      let local = s.imported === s.local ? to.name : s.local;
      if (existing) {
        local = existing.spec.local;
        if (!s.isType && existing.spec.isType) {
          // The value import is the one kept: the type-only one goes, its local name stays
          existing.spec.isRemoved = true;
          existing.decl.isTouched = true;
        } else {
          s.isRemoved = true;
          d.isTouched = true;
          if (symbol && local !== s.el?.name.text) m.renames.set(symbol, local);
          continue;
        }
      }
      if (isMove) {
        s.isRemoved = true;
        addSpec(
          m,
          to.entry,
          false,
          { ...s, el: null, isRemoved: false, imported: to.name, local },
          d
        );
      } else {
        s.imported = to.name;
        s.local = local;
      }
      d.isTouched = true;
      if (symbol && local !== s.el?.name.text) m.renames.set(symbol, local);
    }
  }

  // `ns.Old` through a namespace import, and `import('entry').Old` types
  const namespaces = m.namespaces.get(from.entry) ?? [];
  const visit = (node: ts.Node) => {
    let name: ts.Identifier | undefined;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      name = ts.isIdentifier(node.name) ? node.name : undefined;
      if (name && !isNamespaceRef(m, node.expression, namespaces)) name = undefined;
    } else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
      name = isNamespaceRef(m, node.left, namespaces) ? node.right : undefined;
    }
    if (name?.text === from.name) {
      if (isMove) {
        m.error(node, `\`${node.getText(m.sf)}\`: import \`${to.name}\` from '${to.entry}'`);
      } else m.edits.push(replaceEdit(m.sf, name, to.name));
    }
    if (ts.isImportTypeNode(node) && node.qualifier) {
      const arg = node.argument;
      const literal =
        ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal) ? arg.literal : undefined;
      let first: ts.EntityName = node.qualifier;
      while (ts.isQualifiedName(first)) first = first.left;
      if (literal?.text === from.entry && first.text === from.name) {
        m.edits.push(replaceEdit(m.sf, first, to.name));
        if (isMove) m.edits.push(replaceEdit(m.sf, literal, `'${to.entry}'`));
      }
    }
    ts.forEachChild(node, visit);
  };
  if (
    namespaces.length ||
    m.sf.text.includes(`'${from.entry}'`) ||
    m.sf.text.includes(`"${from.entry}"`)
  ) {
    visit(m.sf);
  }
};

const isNamespaceRef = (m: ModuleState, id: ts.Identifier, namespaces: ts.Symbol[]) => {
  if (!namespaces.length) return false;
  const symbol = m.checker.getSymbolAtLocation(id);
  return !!symbol && namespaces.includes(symbol);
};

const replaceEdit = (sf: ts.SourceFile, node: ts.Node, text: string): Edit => ({
  start: node.getStart(sf),
  end: node.getEnd(),
  text,
});

const RESOLVE_MEANING =
  ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias;

/** The references' edits for the renamed bindings, after checking that no other name shadows them */
const renameReferences = (m: ModuleState) => {
  if (!m.renames.size) return;
  const { checker, sf } = m;
  const oldNames = new Set<string>();
  for (const d of m.decls) for (const s of d.specs) if (s.el) oldNames.add(s.el.name.text);

  // The names a renamed reference may resolve to: the module's imports of them
  const allowed = new Map<string, Set<ts.Symbol>>();
  for (const d of m.decls) {
    if (d.isExport) continue;
    for (const s of d.specs) {
      const symbol = symbolOf(m, s);
      if (!symbol || !s.el) continue;
      const set = allowed.get(s.el.name.text) ?? new Set();
      allowed.set(s.el.name.text, set.add(symbol));
    }
  }
  const isFree = (name: string, at: ts.Node) => {
    const found = checker.resolveName(name, at, RESOLVE_MEANING, false);
    return !found || !!allowed.get(name)?.has(found);
  };
  for (const [symbol, name] of m.renames) {
    const at = symbol.declarations?.[0] ?? sf;
    if (!isFree(name, at)) {
      m.error(at, `\`${symbol.name}\` → \`${name}\`: the module has another \`${name}\``);
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      return;
    }
    if (ts.isIdentifier(node) && oldNames.has(node.text)) {
      const parent = node.parent;
      const isShorthand = ts.isShorthandPropertyAssignment(parent) && parent.name === node;
      const isExportSpec = ts.isExportSpecifier(parent);
      // `export { Old as Mine }`: `Mine` is the module's own name
      if (isExportSpec && parent.propertyName && parent.name === node) return;
      const symbol = isShorthand
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : isExportSpec
          ? checker.getExportSpecifierLocalTargetSymbol(parent)
          : checker.getSymbolAtLocation(node);
      const name = symbol && m.renames.get(symbol);
      if (name) {
        if (!isFree(name, node)) {
          m.error(node, `\`${node.text}\` → \`${name}\`: another \`${name}\` is in scope here`);
        }
        const text = isShorthand
          ? `${node.text}: ${name}`
          : isExportSpec && !parent.propertyName
            ? `${name} as ${node.text}`
            : name;
        m.edits.push(replaceEdit(sf, node, text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
};

/** The touched declarations' edits: each written again, a new one after its neighbour */
const declarationEdits = (m: ModuleState) => {
  const { sf } = m;
  for (const d of m.decls) {
    if (!d.node) continue;
    const added = m.decls.filter((x) => !x.node && x.after === d);
    if (!d.isTouched && !added.length) continue;
    const text = [d.isTouched ? renderDecl(d) : d.node.getText(sf), ...added.map(renderDecl)]
      .filter(Boolean)
      .join('\n');
    let end = d.node.getEnd();
    if (!text && sf.text[end] === '\n') end++;
    m.edits.push({ start: d.node.getStart(sf), end, text });
  }
};

const applyEdits = (m: ModuleState) => {
  const edits = [...m.edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end)
      m.error(edits[i].start, 'two of the codemod’s edits overlap here');
  }
  let text = m.sf.text;
  for (const edit of edits.reverse()) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return text;
};

const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol) =>
  symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

/** An entry's exports by name (aliases resolved), found through the first module of the program
 * that imports it or re-exports from it; empty when none does */
const createEntryExports = (program: ts.Program, checker: ts.TypeChecker) => {
  const cache = new Map<string, Map<string, ts.Symbol>>();
  const find = (entry: string) => {
    for (const sf of program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      for (const st of sf.statements) {
        const spec =
          ts.isImportDeclaration(st) || ts.isExportDeclaration(st) ? st.moduleSpecifier : undefined;
        if (!spec || !ts.isStringLiteral(spec) || spec.text !== entry) continue;
        const moduleSymbol = checker.getSymbolAtLocation(spec);
        if (moduleSymbol) return checker.getExportsOfModule(moduleSymbol);
      }
    }
    return [];
  };
  return (entry: string) => {
    let exports = cache.get(entry);
    if (!exports) {
      exports = new Map(find(entry).map((s) => [s.name, resolveAlias(checker, s)]));
      cache.set(entry, exports);
    }
    return exports;
  };
};

type EntryExports = ReturnType<typeof createEntryExports>;

const symbolsOf = (exportsOf: EntryExports, names: readonly EntryName[]) =>
  new Set(
    names.map((n) => exportsOf(n.entry).get(n.name)).filter((s): s is ts.Symbol => s !== undefined)
  );

/** The first of `targets` the type is (by its alias or its own symbol), or a union's or an
 * intersection's member is */
const findTargetType = (type: ts.Type, targets: ReadonlySet<ts.Symbol>): ts.Symbol | undefined => {
  for (const s of [type.aliasSymbol, type.getSymbol()]) if (s && targets.has(s)) return s;
  if (type.isUnionOrIntersection()) {
    for (const t of type.types) {
      const found = findTargetType(t, targets);
      if (found) return found;
    }
  }
  return undefined;
};

const propertyNameOf = (name: ts.PropertyName | ts.BindingName | undefined) =>
  name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;

/** The reports of the removed imports: each import, `export … from` and `ns.Name` of one */
const applyRemovedImportRule = (m: ModuleState, rule: RemovedImportRule) => {
  const report = (at: ts.Node, name: string) => {
    const advice = rule.names[name];
    if (advice) m.report(at, `\`${name}\` (${rule.entry}): ${advice}`, rule.anchor);
  };
  for (const d of m.decls) {
    if (d.entry !== rule.entry) continue;
    for (const s of d.specs) if (s.el) report(s.el, s.imported);
  }
  const namespaces = m.namespaces.get(rule.entry) ?? [];
  if (!namespaces.length) return;
  const visit = (node: ts.Node) => {
    const pair = ts.isPropertyAccessExpression(node)
      ? ([node.expression, node.name] as const)
      : ts.isQualifiedName(node)
        ? ([node.left, node.right] as const)
        : undefined;
    if (pair && ts.isIdentifier(pair[0]) && ts.isIdentifier(pair[1])) {
      if (isNamespaceRef(m, pair[0], namespaces)) report(node, pair[1].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(m.sf);
};

type MemberRuleTargets = { rule: RemovedMemberRule; targets: ReadonlySet<ts.Symbol> };

/** The reports of the removed members: a read (`x.member`, a destructuring) of one on a value of
 * a target type, and an object literal of a target contextual type writing one */
const applyRemovedMemberRules = (m: ModuleState, rules: readonly MemberRuleTargets[]) => {
  const byMember = new Map<string, MemberRuleTargets[]>();
  for (const r of rules) {
    if (!r.targets.size) continue;
    for (const member of Object.keys(r.rule.members)) {
      if (m.sf.text.includes(member)) byMember.set(member, [...(byMember.get(member) ?? []), r]);
    }
  }
  if (!byMember.size) return;
  const { checker } = m;
  const check = (at: ts.Node, member: string, type: ts.Type | undefined, value?: ts.Node) => {
    if (!type) return;
    for (const { rule, targets } of byMember.get(member) ?? []) {
      const target = findTargetType(type, targets);
      if (!target) continue;
      if (rule.onlyString) {
        if (!value || !(checker.getTypeAtLocation(value).flags & ts.TypeFlags.StringLike)) continue;
      }
      m.report(at, `\`${target.name}.${member}\`: ${rule.members[member]}`, rule.anchor);
      return;
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && byMember.has(node.name.text)) {
      check(node.name, node.name.text, checker.getTypeAtLocation(node.expression));
    } else if (ts.isObjectLiteralExpression(node)) {
      let contextual: ts.Type | undefined | null = null;
      for (const prop of node.properties) {
        const member = propertyNameOf(prop.name);
        if (!member || !byMember.has(member)) continue;
        contextual ??= checker.getContextualType(node);
        const value = ts.isPropertyAssignment(prop)
          ? prop.initializer
          : ts.isShorthandPropertyAssignment(prop)
            ? prop.name
            : undefined;
        check(prop, member, contextual, value);
      }
    } else if (ts.isObjectBindingPattern(node)) {
      for (const el of node.elements) {
        const member = propertyNameOf(el.propertyName ?? el.name);
        if (member && byMember.has(member)) check(el, member, checker.getTypeAtLocation(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(m.sf);
};

type CallRuleTargets = { rule: CallArgRule; target: ts.Symbol };

/** The argument rules on each call of their entry functions */
const applyCallArgRules = (m: ModuleState, rules: readonly CallRuleTargets[]) => {
  if (!rules.length) return;
  const { checker, sf } = m;
  const applyRule = (rule: CallArgRule, arg: ts.Expression) => {
    const name = `\`${rule.callee.name}\``;
    if (rule.literal !== undefined) {
      if (!ts.isStringLiteralLike(arg) || arg.text !== rule.literal) return;
      if (rule.rewrite === undefined) {
        m.report(arg, `${name}'s '${rule.literal}': ${rule.advice}`, rule.anchor);
        return;
      }
      const quote = arg.getText(sf)[0];
      m.edits.push(replaceEdit(sf, arg, `${quote}${rule.rewrite}${quote}`));
    } else if (rule.members) {
      if (!ts.isObjectLiteralExpression(arg)) return;
      for (const prop of arg.properties) {
        const member = propertyNameOf(prop.name);
        if (member && rule.members.includes(member)) {
          m.report(prop, `${name}'s \`${member}\`: ${rule.advice}`, rule.anchor);
        }
      }
    } else m.report(arg, `${name}'s argument ${rule.index + 1}: ${rule.advice}`, rule.anchor);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name
        : node.expression;
      const symbol = checker.getSymbolAtLocation(callee);
      const resolved = symbol && resolveAlias(checker, symbol);
      for (const { rule, target } of rules) {
        const arg = node.arguments[rule.index];
        if (resolved === target && arg) applyRule(rule, arg);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
};

/** Runs the rules on each module; a module with an error is left as it was */
export const migrateEngine6 = ({ program, files, rules }: Engine6Input): Engine6Result => {
  const checker = program.getTypeChecker();
  const changed = new Map<string, string>();
  const errors: MigrationFinding[] = [];
  const reports: MigrationFinding[] = [];
  const exportsOf = createEntryExports(program, checker);
  const memberRules: MemberRuleTargets[] = [];
  const callRules: CallRuleTargets[] = [];
  for (const rule of rules) {
    if (rule.kind === 'removedMember') {
      memberRules.push({ rule, targets: symbolsOf(exportsOf, rule.types) });
    } else if (rule.kind === 'callArg') {
      const [target] = symbolsOf(exportsOf, [rule.callee]);
      if (target) callRules.push({ rule, target });
    }
  }

  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) {
      errors.push({ file, line: 0, message: 'not in the program' });
      continue;
    }
    const fileErrors: MigrationFinding[] = [];
    const lineOf = (at: ts.Node | number) =>
      sf.getLineAndCharacterOfPosition(typeof at === 'number' ? at : at.getStart(sf)).line + 1;
    const error = (at: ts.Node | number, message: string) =>
      fileErrors.push({ file, line: lineOf(at), message });
    const fileReports: MigrationFinding[] = [];
    const report = (at: ts.Node, message: string, anchor: string) =>
      fileReports.push({ file, line: lineOf(at), message, anchor });
    const m = readModule(file, sf, checker, error, report);
    for (const rule of rules) {
      if (rule.kind === 'import') applyImportRule(m, rule);
      else if (rule.kind === 'removedImport') applyRemovedImportRule(m, rule);
    }
    applyRemovedMemberRules(m, memberRules);
    applyCallArgRules(m, callRules);
    renameReferences(m);
    declarationEdits(m);
    const text = applyEdits(m);
    // By line: the rules' walks find them in their own orders
    reports.push(...fileReports.sort((a, b) => a.line - b.line));
    if (fileErrors.length) errors.push(...fileErrors);
    else if (text !== sf.text) changed.set(file, text);
  }

  return { changed, errors, reports };
};
