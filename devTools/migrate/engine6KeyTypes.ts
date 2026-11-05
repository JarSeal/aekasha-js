/**
 * The engine 6 codemod's component keys named as types (D10 kind 3, `KeyTypeRule`; p622 Phase
 * 7). Engine 5's keys were enums (`CoreComponentType`, the toolkit's four), so a member was a type
 * too; engine 6's are `as const` objects, values only, and a member's type is `typeof Key.X`. Each
 * reference is found by its import (the import specifier's symbol, or a namespace import of the
 * entry), so one that no longer resolves against the new engine is found as well.
 */
import ts from 'typescript';
import type { ModuleState } from './engine6';
import type { KeyTypeRule } from './engine6Rules';

const RESOLVE_MEANING =
  ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias;

/** Adds `typeof` to each key member named as a type, and rewrites a bare key with `bare` */
export const applyKeyTypeRules = (m: ModuleState, rules: readonly KeyTypeRule[]) => {
  if (!rules.length) return;
  const { checker, sf } = m;
  // `entry#name` → its rule, by the key's name and its engine 5 name
  const byName = new Map<string, KeyTypeRule>();
  for (const rule of rules) {
    for (const name of [rule.key.name, rule.was]) {
      if (name) byName.set(`${rule.key.entry}#${name}`, rule);
    }
  }
  // The module's bindings of a key: its import specifiers' symbols (named as written, before a
  // rename rule's change), and its namespace imports
  const bindings = new Map<ts.Symbol, KeyTypeRule>();
  for (const d of m.decls) {
    if (d.isExport) continue;
    for (const s of d.specs) {
      if (!s.el) continue;
      const rule = byName.get(`${d.entry}#${(s.el.propertyName ?? s.el.name).text}`);
      const symbol = rule && checker.getSymbolAtLocation(s.el.name);
      if (rule && symbol) bindings.set(symbol, rule);
    }
  }
  const namespaces = new Map<ts.Symbol, string>();
  for (const [entry, symbols] of m.namespaces) for (const s of symbols) namespaces.set(s, entry);
  if (!bindings.size && !namespaces.size && !sf.text.includes('import(')) return;

  // The binding a name in a type resolves to: the checker's symbol at a type position is the
  // type's, which a key object (a value) doesn't have, so the name is looked up in scope
  const bindingOf = (id: ts.Identifier) => checker.resolveName(id.text, id, RESOLVE_MEANING, false);
  /** The rule of a key named by `Key` or `ns.Key` */
  const keyOf = (name: ts.EntityName): KeyTypeRule | undefined => {
    if (ts.isIdentifier(name)) {
      const symbol = bindingOf(name);
      return symbol && bindings.get(symbol);
    }
    if (!ts.isIdentifier(name.left)) return undefined;
    const symbol = bindingOf(name.left);
    const entry = symbol && namespaces.get(symbol);
    return entry ? byName.get(`${entry}#${name.right.text}`) : undefined;
  };
  /** The rule of a key named by an `import('entry')` type's qualifier */
  const importedKeyOf = (node: ts.ImportTypeNode, name: ts.EntityName) => {
    const arg = node.argument;
    if (!ts.isLiteralTypeNode(arg) || !ts.isStringLiteral(arg.literal)) return undefined;
    return ts.isIdentifier(name) ? byName.get(`${arg.literal.text}#${name.text}`) : undefined;
  };
  const insertTypeof = (node: ts.Node) => {
    const start = node.getStart(sf);
    m.edits.push({ start, end: start, text: 'typeof ' });
  };
  const replaceBare = (node: ts.Node) => {
    const key = node.getText(sf);
    m.edits.push({
      start: node.getStart(sf),
      end: node.getEnd(),
      text: `(typeof ${key})[keyof typeof ${key}]`,
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isTypeReferenceNode(node)) {
      const { typeName } = node;
      const bare = keyOf(typeName);
      if (bare) {
        if (bare.bare) return replaceBare(node);
      } else if (ts.isQualifiedName(typeName) && keyOf(typeName.left)) insertTypeof(node);
    } else if (ts.isImportTypeNode(node) && !node.isTypeOf && node.qualifier) {
      const { qualifier } = node;
      const bare = importedKeyOf(node, qualifier);
      if (bare) {
        if (bare.bare) return replaceBare(node);
      } else if (ts.isQualifiedName(qualifier) && importedKeyOf(node, qualifier.left)) {
        insertTypeof(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
};
